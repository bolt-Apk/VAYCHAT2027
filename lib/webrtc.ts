import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getStorageSettings } from './storage-settings';

let RNWebRTC: any = null;
if (Platform.OS !== 'web') {
  try {
    RNWebRTC = require('react-native-webrtc');
    if (typeof RNWebRTC.registerGlobals === 'function') {
      RNWebRTC.registerGlobals();
    }
  } catch {}
}

const nativeMediaDevices = RNWebRTC?.mediaDevices;
const NativeRTCPeerConnection = RNWebRTC?.RTCPeerConnection;
const NativeRTCSessionDescription = RNWebRTC?.RTCSessionDescription;
const NativeRTCIceCandidate = RNWebRTC?.RTCIceCandidate;
const NativeMediaStream = RNWebRTC?.MediaStream;

let MeteredPeerClass: any = null;
try {
  MeteredPeerClass = require('@metered-ca/realtime').MeteredPeer;
} catch (e) {
  console.warn('[WebRTC] @metered-ca/realtime not available:', e);
}

export interface ConnectionStats {
  roundTripTime: number | null;
  packetsLost: number;
  jitter: number | null;
  bytesReceived: number;
  bytesSent: number;
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  audioLevel: number | null;
}

export class WebRTCCall {
  private meteredPeer: any = null;
  private remotePeers = new Map<string, any>();
  private localStream: any = null;
  private remoteStream: any = null;
  private callId: string;
  private userId: string;
  private isInitiator: boolean;
  private facingMode: 'user' | 'environment' = 'user';
  private callType: 'voice' | 'video' = 'voice';
  private screenStream: any = null;
  private _isScreenSharing = false;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private _destroyed = false;
  private _connectedFired = false;
  private _joined = false;

  private controlChannel: any = null;

  onRemoteStream: ((stream: any) => void) | null = null;
  onLocalStream: ((stream: any) => void) | null = null;
  onConnectionStateChange: ((state: string) => void) | null = null;
  onHangup: (() => void) | null = null;
  onScreenShareChanged: ((sharing: boolean, fromUserId: string) => void) | null = null;
  onStatsUpdate: ((stats: ConnectionStats) => void) | null = null;
  onRemoteHold: ((held: boolean) => void) | null = null;

  constructor(callId: string, userId: string, isInitiator: boolean) {
    this.callId = callId;
    this.userId = userId;
    this.isInitiator = isInitiator;
  }

  async start(callType: 'voice' | 'video'): Promise<void> {
    this.callType = callType;
    console.log('[WebRTC] Starting call with MeteredPeer, type:', callType, 'callId:', this.callId);

    if (!MeteredPeerClass) {
      console.error('[WebRTC] MeteredPeer SDK not available');
      this.onConnectionStateChange?.('failed');
      return;
    }

    this.setupControlChannel();

    // Docs: getUserMedia first, then addStream, then join -- minimizes renegotiation
    await this.acquireMedia();
    if (this._destroyed) return;

    await this.initMeteredPeer();
  }

  private async initMeteredPeer(): Promise<void> {
    const apiKey = process.env.EXPO_PUBLIC_METERED_KEY;
    if (!apiKey) {
      console.error('[WebRTC] EXPO_PUBLIC_METERED_KEY not set');
      this.onConnectionStateChange?.('failed');
      return;
    }

    // Docs: apiKey (pk_live_...) for browser use, mutually exclusive with tokenProvider.
    // TURN is auto-injected by Metered when Auto-inject TURN is enabled (default).
    const peerOptions: any = { apiKey };

    if (Platform.OS !== 'web' && NativeRTCPeerConnection) {
      peerOptions.rtcPeerConnectionFactory = (cfg: any) => {
        const pc = new NativeRTCPeerConnection(cfg as object);
        return pc;
      };
      if (NativeMediaStream) {
        peerOptions.mediaStreamFactory = () => new NativeMediaStream();
      }
    }

    this.meteredPeer = new MeteredPeerClass(peerOptions);

    // --- Docs: wire up event handlers BEFORE join() ---

    // Docs: "joined" event fires once after join() resolves, gives final peerId
    this.meteredPeer.on('joined', ({ peerId, channel }: any) => {
      console.log('[WebRTC] Joined as peerId:', peerId, 'channel:', channel);
      this._joined = true;
    });

    // Docs: "left" event fires once when reaching "closed"
    this.meteredPeer.on('left', ({ reason }: any) => {
      console.log('[WebRTC] Left channel, reason:', reason);
      this._joined = false;
    });

    // --- peer-joined: wire up per-remote-peer events ---
    this.meteredPeer.on('peer-joined', ({ peer: remote }: any) => {
      console.log('[WebRTC] Remote peer joined:', remote.id?.substring(0, 8));
      this.remotePeers.set(remote.id, remote);

      const markConnected = () => {
        if (!this._connectedFired) {
          this._connectedFired = true;
          this.onConnectionStateChange?.('connected');
          this.startStatsMonitoring();
        }
      };

      // Docs: stream-added with metadata for routing (camera vs screen)
      remote.on('stream-added', ({ stream, metadata }: any) => {
        console.log('[WebRTC] Remote stream added, role:', metadata?.role);
        if (metadata?.role === 'screen') {
          this.onScreenShareChanged?.(true, remote.id);
        }
        this.remoteStream = stream;
        this.onRemoteStream?.(stream);
        markConnected();
      });

      // Docs: stream-removed -- clean up screen share tile
      remote.on('stream-removed', ({ stream, metadata }: any) => {
        console.log('[WebRTC] Remote stream removed, role:', metadata?.role);
        if (metadata?.role === 'screen') {
          this.onScreenShareChanged?.(false, remote.id);
        }
      });

      // Docs: state-change per remote peer -- "connected", "reconnecting", "closed"
      remote.on('state-change', ({ to }: any) => {
        console.log('[WebRTC] Remote peer state:', to);
        if (to === 'connected') markConnected();
        else if (to === 'reconnecting') this.onConnectionStateChange?.('reconnecting');
        else if (to === 'closed') this.onConnectionStateChange?.('failed');
      });
    });

    // Docs: always clean up on peer-left -- frozen <video> otherwise
    this.meteredPeer.on('peer-left', ({ peer: remote }: any) => {
      console.log('[WebRTC] Remote peer left:', remote.id?.substring(0, 8));
      this.remotePeers.delete(remote.id);
      this.onHangup?.();
    });

    // Docs: state-change drives reconnect UI
    this.meteredPeer.on('state-change', ({ from, to }: any) => {
      console.log('[WebRTC] MeteredPeer state:', from, '->', to);
      if (to === 'joining' || to === 'joined') {
        this.onConnectionStateChange?.('connecting');
      } else if (to === 'reconnecting') {
        this.onConnectionStateChange?.('reconnecting');
      } else if (to === 'leaving') {
        this._joined = false;
      } else if (to === 'closed') {
        // Docs: closed is terminal -- construct a fresh MeteredPeer
        this._joined = false;
        this.onConnectionStateChange?.('failed');
      }
    });

    // Docs: error event -- branch on err.name for specific handling
    this.meteredPeer.on('error', ({ err }: any) => {
      console.error('[WebRTC] MeteredPeer error:', err?.name, err?.message);
      switch (err?.name) {
        case 'invalid_token':
        case 'token_expired':
        case 'channel_not_authorized':
        case 'TokenProviderError':
          console.error('[WebRTC] Auth error -- call cannot proceed');
          this.onConnectionStateChange?.('failed');
          break;
        case 'account_suspended':
          console.error('[WebRTC] Account suspended');
          this.onConnectionStateChange?.('failed');
          break;
        case 'admin_disconnect':
          console.error('[WebRTC] Admin disconnected');
          this.onHangup?.();
          break;
        case 'ReconcileTimeoutError':
          // Docs: recover with close() + fresh MeteredPeer + join()
          console.error('[WebRTC] Reconcile timeout -- connection stale');
          this.onConnectionStateChange?.('failed');
          break;
        default:
          console.error('[WebRTC] Unhandled error:', err);
          break;
      }
    });

    // Docs: senderPeerId is server-stamped, trust it. data.from is spoofable.
    // Docs: kind discriminates "broadcast" vs "direct"
    this.meteredPeer.on('data', ({ senderPeerId, data: payload, kind }: any) => {
      if (senderPeerId === this.meteredPeer?.peerId) return;
      const msg = payload as Record<string, unknown> | null;
      if (!msg) return;
      if (msg.type === 'hangup') {
        this.onHangup?.();
      } else if (msg.type === 'audio-state') {
        // mute/unmute notification from remote
      }
    });

    // Docs: addStream BEFORE join to ride along in first SDP offer (one round trip)
    if (this.localStream) {
      const streamMeta = {
        role: this.callType === 'video' ? 'camera' : 'audio',
        label: this.callType === 'video' ? 'front cam' : 'mic',
      };
      this.meteredPeer.addStream(this.localStream as never, streamMeta);
    }

    // Docs: join() connects and subscribes. Peers arrive asynchronously via peer-joined.
    const channelName = `call-${this.callId}`;
    console.log('[WebRTC] Joining MeteredPeer channel:', channelName);
    this.onConnectionStateChange?.('connecting');

    try {
      await this.meteredPeer.join(channelName);
      console.log('[WebRTC] Joined channel successfully');
    } catch (err) {
      console.error('[WebRTC] Failed to join channel:', err);
      this.onConnectionStateChange?.('failed');
    }
  }

  private setupControlChannel(): void {
    const channelName = `call-ctrl-${this.callId}`;
    this.controlChannel = supabase.channel(channelName, {
      config: { broadcast: { self: false, ack: false } },
    });

    this.controlChannel
      .on('broadcast', { event: 'control' }, (message: any) => {
        const data = message?.payload ?? message;
        if (!data?.type || data.from === this.userId) return;

        if (data.type === 'hangup') {
          this.onHangup?.();
        } else if (data.type === 'hold') {
          this.onRemoteHold?.(true);
        } else if (data.type === 'unhold') {
          this.onRemoteHold?.(false);
        } else if (data.type === 'screen-share-start') {
          this.onScreenShareChanged?.(true, data.from);
        } else if (data.type === 'screen-share-stop') {
          this.onScreenShareChanged?.(false, data.from);
        }
      })
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[WebRTC] Control channel subscription failed:', status);
          setTimeout(() => {
            if (!this._destroyed && this.controlChannel) {
              this.controlChannel.subscribe();
            }
          }, 3000);
        }
      });
  }

  // Docs: send() rejects with not_joined if called before join() or after close()
  private sendControl(type: string): void {
    if (this.controlChannel && !this._destroyed) {
      this.controlChannel.send({
        type: 'broadcast',
        event: 'control',
        payload: { type, from: this.userId },
      }).catch(() => {});
    }

    // Docs: peer.send is server-routed, works before ICE, doesn't need DataChannel
    // Guard: only send if joined (send rejects with not_joined otherwise)
    if (this._joined && this.meteredPeer && typeof this.meteredPeer.send === 'function') {
      try {
        const result = this.meteredPeer.send({ type });
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      } catch {}
    }
  }

  private async acquireMedia(): Promise<void> {
    try {
      console.log('[WebRTC] Acquiring media, type:', this.callType);

      const storageSettings = await getStorageSettings();
      const reduced = storageSettings.reducedCallTraffic;

      if (Platform.OS === 'web') {
        const constraints: any = {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: this.callType === 'video'
            ? reduced
              ? { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 15 } }
              : { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } }
            : false,
        };
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (mediaErr) {
          console.warn('[WebRTC] getUserMedia failed, trying audio-only:', mediaErr);
          if (this.callType === 'video') {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio, video: false });
          } else {
            throw mediaErr;
          }
        }
      } else if (nativeMediaDevices) {
        const nativeConstraints: any = {
          audio: true,
          video: this.callType === 'video'
            ? reduced
              ? { facingMode: 'user', frameRate: 15, width: 320, height: 240 }
              : { facingMode: 'user', frameRate: 30, width: 720, height: 1280 }
            : false,
        };
        try {
          this.localStream = await nativeMediaDevices.getUserMedia(nativeConstraints);
        } catch (mediaErr) {
          console.warn('[WebRTC] Native getUserMedia failed, trying audio-only:', mediaErr);
          if (this.callType === 'video') {
            this.localStream = await nativeMediaDevices.getUserMedia({ audio: true, video: false });
          } else {
            throw mediaErr;
          }
        }
      }

      if (this.localStream) {
        console.log('[WebRTC] Got local stream, tracks:', this.localStream.getTracks().map((t: any) => t.kind).join(','));
        this.onLocalStream?.(this.localStream);
      } else {
        console.warn('[WebRTC] No local stream acquired');
      }
    } catch (err) {
      console.error('[WebRTC] Failed to acquire media:', err);
    }
  }

  private _prevBytesReceived = 0;
  private _prevBytesSent = 0;
  private _prevPacketsLost = 0;
  private _prevPacketsReceived = 0;

  private startStatsMonitoring() {
    this.stopStatsMonitoring();

    this.statsInterval = setInterval(async () => {
      if (this._destroyed) { this.stopStatsMonitoring(); return; }

      try {
        let rtt: number | null = null;
        let jitter: number | null = null;
        let totalBytesReceived = 0;
        let totalBytesSent = 0;
        let totalPacketsLost = 0;
        let totalPacketsReceived = 0;

        if (this.meteredPeer) {
          const pcs: any[] = [];
          this.remotePeers.forEach((_, peerId) => {
            try {
              const pc = this.meteredPeer?._getPeerConnection?.(peerId);
              if (pc) pcs.push(pc);
            } catch {}
          });

          for (const pc of pcs) {
            try {
              const reports = await pc.getStats();
              const processReport = (report: any) => {
                if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
                  if (report.currentRoundTripTime != null) rtt = report.currentRoundTripTime;
                }
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                  if (report.jitter != null) jitter = report.jitter;
                  if (report.packetsLost != null) totalPacketsLost += report.packetsLost;
                  if (report.packetsReceived != null) totalPacketsReceived += report.packetsReceived;
                  if (report.bytesReceived != null) totalBytesReceived += report.bytesReceived;
                }
                if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                  if (report.bytesSent != null) totalBytesSent += report.bytesSent;
                }
              };
              if (typeof reports.forEach === 'function') {
                reports.forEach(processReport);
              } else if (reports && typeof reports === 'object') {
                Object.values(reports).forEach((r: any) => processReport(r));
              }
            } catch {}
          }
        }

        const lossRate = totalPacketsReceived > 0
          ? (totalPacketsLost - this._prevPacketsLost) / Math.max(1, totalPacketsReceived - this._prevPacketsReceived)
          : 0;

        let quality: ConnectionStats['quality'];
        if (rtt !== null) {
          if (rtt < 0.1 && lossRate < 0.01) quality = 'excellent';
          else if (rtt < 0.2 && lossRate < 0.03) quality = 'good';
          else if (rtt < 0.4 && lossRate < 0.08) quality = 'fair';
          else quality = 'poor';
        } else {
          const byteDelta = totalBytesReceived - this._prevBytesReceived;
          if (byteDelta > 0 || totalBytesReceived === 0) quality = 'good';
          else quality = 'fair';
        }

        let audioLevel: number | null = null;
        const bytesDelta = totalBytesReceived - this._prevBytesReceived;

        this._prevBytesReceived = totalBytesReceived;
        this._prevBytesSent = totalBytesSent;
        this._prevPacketsLost = totalPacketsLost;
        this._prevPacketsReceived = totalPacketsReceived;
        if (bytesDelta <= 0 && totalBytesReceived > 0) {
          audioLevel = 0;
        } else if (totalBytesReceived > 0) {
          audioLevel = Math.min(1, bytesDelta / 5000);
        }

        const stats: ConnectionStats = {
          roundTripTime: rtt,
          packetsLost: totalPacketsLost,
          jitter,
          bytesReceived: totalBytesReceived,
          bytesSent: totalBytesSent,
          quality,
          audioLevel,
        };
        this.onStatsUpdate?.(stats);
      } catch {}
    }, 5000);
  }

  private stopStatsMonitoring() {
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
  }

  // Docs: track.enabled = false keeps SDP connected -- cheaper than remove+add
  toggleMute(): boolean {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    const wasEnabled = audioTracks.length > 0 ? audioTracks[0].enabled : false;
    audioTracks.forEach((t: any) => { t.enabled = !t.enabled; });

    // Docs: peer.send to tell other peers about audio state
    if (this._joined && this.meteredPeer && typeof this.meteredPeer.send === 'function') {
      try {
        const result = this.meteredPeer.send({ type: 'audio-state', enabled: !wasEnabled });
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {}
    }

    return wasEnabled;
  }

  toggleVideo(): boolean {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    const newEnabled = videoTracks.length > 0 ? !videoTracks[0].enabled : false;
    videoTracks.forEach((t: any) => { t.enabled = newEnabled; });
    return newEnabled;
  }

  isMuted(): boolean {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    return audioTracks.length > 0 ? !audioTracks[0].enabled : true;
  }

  isVideoEnabled(): boolean {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    return videoTracks.length > 0 ? videoTracks[0].enabled : false;
  }

  // Docs: replaceTrack swaps sender without renegotiating SDP
  async switchCamera(): Promise<'user' | 'environment'> {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    if (!this.localStream) return this.facingMode;

    if (Platform.OS !== 'web') {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack._switchCamera === 'function') {
        await videoTrack._switchCamera();
        this.onLocalStream?.(this.localStream);
      }
      return this.facingMode;
    }

    const oldVideoTrack = this.localStream.getVideoTracks()[0];
    if (!oldVideoTrack) return this.facingMode;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: this.facingMode, width: { ideal: 720 }, height: { ideal: 1280 } },
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack && this.meteredPeer && typeof this.meteredPeer.replaceTrack === 'function') {
        try {
          // Docs: replaceTrack fans swap to every peer, updates tracking map
          await this.meteredPeer.replaceTrack(oldVideoTrack, newVideoTrack);
          oldVideoTrack.stop();
        } catch (e: any) {
          // Docs: MeteredPeerReplaceTrackError has e.succeeded and e.failed
          if (e?.failed) {
            for (const { peerId, err } of e.failed) {
              console.warn(`[WebRTC] replaceTrack failed for ${peerId}:`, err);
            }
          }
          // Fallback: manual track swap on localStream
          this.localStream.removeTrack(oldVideoTrack);
          this.localStream.addTrack(newVideoTrack);
          oldVideoTrack.stop();
        }
        this.onLocalStream?.(this.localStream);
      }
    } catch (err) {
      console.error('[WebRTC] switchCamera failed:', err);
    }

    return this.facingMode;
  }

  getFacingMode(): 'user' | 'environment' {
    return this.facingMode;
  }

  // Docs Pattern A: add screen as SECOND stream alongside camera
  // Both streams sent simultaneously, receivers route by metadata.role
  async startScreenShare(): Promise<boolean> {
    if (this._isScreenSharing) return false;
    try {
      if (Platform.OS === 'web') {
        this.screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
          video: { cursor: 'always' },
          audio: false,
        });
      } else if (nativeMediaDevices) {
        this.screenStream = await nativeMediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
      } else {
        return false;
      }

      const screenTrack = this.screenStream?.getVideoTracks?.()?.[0];
      if (!screenTrack) { this.screenStream = null; return false; }

      if (this.meteredPeer && typeof this.meteredPeer.addStream === 'function') {
        this.meteredPeer.addStream(this.screenStream, { role: 'screen', label: 'shared screen' });
      }

      screenTrack.onended = () => { this.stopScreenShare(); };
      this._isScreenSharing = true;
      this.sendControl('screen-share-start');
      return true;
    } catch {
      return false;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this._isScreenSharing) return;

    if (this.screenStream && this.meteredPeer && typeof this.meteredPeer.removeStream === 'function') {
      try {
        this.meteredPeer.removeStream(this.screenStream);
      } catch {}
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t: any) => t.stop());
      this.screenStream = null;
    }

    this._isScreenSharing = false;
    this.sendControl('screen-share-stop');
  }

  isScreenSharing(): boolean {
    return this._isScreenSharing;
  }

  sendHold() { this.sendControl('hold'); }
  sendUnhold() { this.sendControl('unhold'); }

  hangup() {
    if (this._isScreenSharing) this.stopScreenShare();
    this.sendControl('hangup');
    this.cleanup();
  }

  // Docs: peer.close() does NOT stop underlying tracks -- camera indicator stays on
  // Must call localStream.getTracks().forEach(t => t.stop()) for cleanup
  cleanup() {
    this._destroyed = true;
    this._connectedFired = false;
    this._joined = false;
    this.stopStatsMonitoring();

    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t: any) => t.stop());
      this.screenStream = null;
    }
    this._isScreenSharing = false;

    // Docs: always stop localStream tracks to turn off camera indicator
    if (this.localStream) {
      this.localStream.getTracks().forEach((t: any) => t.stop());
      this.localStream = null;
    }

    // Docs: close() is terminal -- once closed, same instance can't rejoin
    if (this.meteredPeer) {
      try { this.meteredPeer.close(); } catch {}
      this.meteredPeer = null;
    }

    if (this.controlChannel) {
      supabase.removeChannel(this.controlChannel);
      this.controlChannel = null;
    }

    this.remotePeers.clear();
    this.remoteStream = null;
  }

  getLocalStream(): any {
    return this.localStream;
  }

  getRemoteStream(): any {
    return this.remoteStream;
  }

  async enableVideo(): Promise<boolean> {
    if (!this.localStream || this._destroyed) return false;
    const existingVideo = this.localStream.getVideoTracks();
    if (existingVideo.length > 0 && existingVideo[0].enabled) return true;
    if (existingVideo.length > 0) {
      existingVideo[0].enabled = true;
      return true;
    }
    try {
      const videoStream = Platform.OS === 'web'
        ? await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: this.facingMode, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } },
          })
        : nativeMediaDevices
          ? await nativeMediaDevices.getUserMedia({ audio: false, video: { facingMode: this.facingMode, frameRate: 30, width: 720, height: 1280 } })
          : null;
      if (!videoStream) return false;
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return false;
      this.localStream.addTrack(videoTrack);
      if (this.meteredPeer && this._joined) {
        if (typeof this.meteredPeer.addStream === 'function') {
          this.meteredPeer.addStream(this.localStream, { role: 'camera', label: 'front cam' });
        }
      }
      this.callType = 'video';
      this.onLocalStream?.(this.localStream);
      return true;
    } catch (err) {
      console.error('[WebRTC] enableVideo failed:', err);
      return false;
    }
  }

  disableVideo(): void {
    if (!this.localStream) return;
    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach((t: any) => { t.enabled = false; });
    this.callType = 'voice';
  }
}
