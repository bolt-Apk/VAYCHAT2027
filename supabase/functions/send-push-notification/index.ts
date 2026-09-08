import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotificationPayload {
  user_ids: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: string;
  categoryId?: string;
}

interface TicketResult {
  id?: string;
  status: string;
  details?: { error?: string };
}

function resolveChannelId(categoryId?: string, type?: string): string {
  if (categoryId === "incoming_call" || type === "call") return "incoming_calls";
  if (categoryId === "reaction" || type === "reaction") return "reactions";
  if (categoryId === "story" || type === "story") return "stories";
  if (type === "contact_joined") return "contacts";
  return "messages";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const payload: NotificationPayload = await req.json();
    const { user_ids, title, body, data, badge, sound, categoryId } = payload;

    if (!user_ids?.length || !title || !body) {
      return new Response(
        JSON.stringify({ error: "user_ids, title, and body are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token, user_id")
      .in("user_id", user_ids);

    if (tokensError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch tokens", details: tokensError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!tokens?.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No push tokens found for users" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const uniqueUserIds = [...new Set(tokens.map((t: { user_id: string }) => t.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, notification_settings")
      .in("id", uniqueUserIds);

    const settingsMap = new Map<string, Record<string, unknown>>();
    if (profiles) {
      for (const p of profiles) {
        if (p.notification_settings) {
          settingsMap.set(p.id, p.notification_settings as Record<string, unknown>);
        }
      }
    }

    const isCallNotification = data?.type === "call" || categoryId === "incoming_call";
    const conversationId = data?.conversation_id as string | undefined;
    const notifType = (data?.type as string) ?? "";
    const channelId = resolveChannelId(categoryId, notifType);

    const senderAvatar = (data?.sender_avatar as string) || "";
    const messageType = (data?.message_type as string) || "";
    const mediaUrl = (data?.media_url as string) || "";

    let unreadSummary: string | undefined;
    if (conversationId && !isCallNotification && notifType === "message") {
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .eq("is_read", false)
        .not("sender_id", "in", `(${user_ids.join(",")})`)
        .limit(0);

      if (count && count > 1) {
        unreadSummary = `${count} непрочитанных сообщений`;
      }
    }

    const messages = tokens.map((t: { token: string; user_id: string }) => {
      const userSettings = settingsMap.get(t.user_id);
      const previewEnabled = userSettings?.preview !== false;
      const soundsEnabled = userSettings?.sounds !== false;

      const notifBody = previewEnabled ? body : "Новое сообщение";

      const msg: Record<string, unknown> = {
        to: t.token,
        title,
        body: isCallNotification ? body : notifBody,
        data: data ?? {},
        sound: isCallNotification ? "default" : (soundsEnabled ? (sound ?? "default") : null),
        badge: badge ?? 1,
        priority: "high",
        channelId,
        _contentAvailable: true,
      };

      if (categoryId) {
        msg.categoryId = categoryId;
      }

      if (conversationId && !isCallNotification) {
        msg.threadId = conversationId;
        msg.collapseKey = `chat_${conversationId}`;
      }

      if (isCallNotification) {
        msg.channelId = "incoming_calls";
        msg._mutableContent = true;
        msg.expiration = Math.floor(Date.now() / 1000) + 30;
      }

      if (senderAvatar) {
        msg._mutableContent = true;
        (msg.data as Record<string, unknown>).image = senderAvatar;
        (msg.data as Record<string, unknown>).senderAvatar = senderAvatar;
      }

      if (messageType === "image" && mediaUrl) {
        msg._mutableContent = true;
        (msg.data as Record<string, unknown>).mediaImage = mediaUrl;
      }

      if (unreadSummary && !isCallNotification) {
        msg.subtitle = unreadSummary;
      }

      return msg;
    });

    const chunks = chunkArray(messages, 100);
    let totalSent = 0;
    const errors: string[] = [];
    const ticketIds: string[] = [];

    const expoToken = "SPMFxx0DBZ4vh9w1opq8Ih_-0mLGaQy0LHrbvcu9";
    const tokenDebug = expoToken.length > 0 
      ? `${expoToken.substring(0, 4)}...${expoToken.substring(expoToken.length - 4)} (len=${expoToken.length})`
      : "EMPTY";

    for (const chunk of chunks) {
      const pushHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        };
      if (expoToken.length > 0) {
        pushHeaders["Authorization"] = `Bearer ${expoToken}`;
      }

      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: pushHeaders,
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const errText = await response.text();
        errors.push(`Expo push API error: ${response.status} - ${errText}`);
        continue;
      }

      const result = await response.json();

      if (result.data) {
        const invalidTokenIds: string[] = [];
        for (let i = 0; i < result.data.length; i++) {
          const ticket: TicketResult = result.data[i];
          if (ticket.status === "ok") {
            totalSent++;
            if (ticket.id) {
              ticketIds.push(ticket.id);
            }
          } else {
            errors.push(`ticket[${i}]: ${JSON.stringify(ticket)}`);
            if (
              ticket.details?.error === "DeviceNotRegistered" ||
              ticket.details?.error === "InvalidCredentials"
            ) {
              invalidTokenIds.push(chunk[i].to as string);
            }
          }
        }

        if (invalidTokenIds.length > 0) {
          await supabase
            .from("push_tokens")
            .delete()
            .in("token", invalidTokenIds);
        }
      }
    }

    if (ticketIds.length > 0) {
      await supabase.from("push_receipt_queue").insert(
        ticketIds.map((id) => ({ ticket_id: id }))
      );
    }

    return new Response(
      JSON.stringify({
        sent: totalSent,
        total_tokens: tokens.length,
        tickets_queued: ticketIds.length,
        token_debug: tokenDebug,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
