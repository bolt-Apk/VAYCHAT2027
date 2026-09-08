const { withXcodeProject } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const NSE_TARGET_NAME = "NotificationServiceExtension";
const NSE_BUNDLE_ID_SUFFIX = ".NotificationServiceExtension";

function withNotificationServiceExtension(config) {
  return withXcodeProject(config, (mod) => {
    const xcodeProject = mod.modResults;
    const bundleIdentifier = mod.ios?.bundleIdentifier || "com.vaychat.app";
    const nseBundleId = bundleIdentifier + NSE_BUNDLE_ID_SUFFIX;
    const platformProjectRoot = mod.modRequest.platformProjectRoot;
    const nseDir = path.join(platformProjectRoot, NSE_TARGET_NAME);

    if (xcodeProject.pbxTargetByName(NSE_TARGET_NAME)) {
      return mod;
    }

    if (!fs.existsSync(nseDir)) {
      fs.mkdirSync(nseDir, { recursive: true });
    }

    const swiftCode = `import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let bestAttemptContent = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        let userInfo = bestAttemptContent.userInfo
        var imageUrlString: String?

        if let body = userInfo["body"] as? [String: Any] {
            imageUrlString = body["image"] as? String ?? body["senderAvatar"] as? String
        } else {
            imageUrlString = userInfo["image"] as? String ?? userInfo["senderAvatar"] as? String
        }

        guard let urlString = imageUrlString, let url = URL(string: urlString) else {
            contentHandler(bestAttemptContent)
            return
        }

        downloadImage(from: url) { attachment in
            if let attachment = attachment {
                bestAttemptContent.attachments = [attachment]
            }
            contentHandler(bestAttemptContent)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    private func downloadImage(from url: URL, completion: @escaping (UNNotificationAttachment?) -> Void) {
        let task = URLSession.shared.downloadTask(with: url) { downloadedUrl, response, error in
            guard let downloadedUrl = downloadedUrl, error == nil else {
                completion(nil)
                return
            }

            let tmpDir = FileManager.default.temporaryDirectory
            let fileName = url.lastPathComponent.isEmpty ? "avatar.jpg" : url.lastPathComponent
            let tmpFile = tmpDir.appendingPathComponent(fileName)

            try? FileManager.default.removeItem(at: tmpFile)

            do {
                try FileManager.default.moveItem(at: downloadedUrl, to: tmpFile)
                let attachment = try UNNotificationAttachment(
                    identifier: "image",
                    url: tmpFile,
                    options: [UNNotificationAttachmentOptionsTypeHintKey: "public.jpeg"]
                )
                completion(attachment)
            } catch {
                completion(nil)
            }
        }
        task.resume()
    }
}
`;

    fs.writeFileSync(
      path.join(nseDir, "NotificationService.swift"),
      swiftCode
    );

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>NotificationServiceExtension</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.usernotifications.service</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
    </dict>
</dict>
</plist>
`;
    fs.writeFileSync(path.join(nseDir, "Info.plist"), plistContent);

    const nseTarget = xcodeProject.addTarget(
      NSE_TARGET_NAME,
      "app_extension",
      NSE_TARGET_NAME,
      nseBundleId
    );

    if (!nseTarget) {
      console.warn("[withNotificationServiceExtension] addTarget returned null");
      return mod;
    }

    xcodeProject.addBuildPhase(
      [`${NSE_TARGET_NAME}/NotificationService.swift`],
      "PBXSourcesBuildPhase",
      "Sources",
      nseTarget.uuid
    );

    xcodeProject.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      nseTarget.uuid
    );

    // Get the NSE target's buildConfigurationList and set build settings directly
    const targetObj = xcodeProject.pbxNativeTargetSection()[nseTarget.uuid];
    if (targetObj && targetObj.buildConfigurationList) {
      const configListId = targetObj.buildConfigurationList;
      const configLists = xcodeProject.pbxXCConfigurationList();
      const configList = configLists[configListId];

      if (configList && configList.buildConfigurations) {
        const allConfigurations = xcodeProject.pbxXCBuildConfigurationSection();
        for (const configRef of configList.buildConfigurations) {
          const conf = allConfigurations[configRef.value];
          if (conf && conf.buildSettings) {
            conf.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${nseBundleId}"`;
            conf.buildSettings.SWIFT_VERSION = "5.0";
            conf.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "15.1";
            conf.buildSettings.TARGETED_DEVICE_FAMILY = `"1,2"`;
            conf.buildSettings.CODE_SIGN_STYLE = "Automatic";
            conf.buildSettings.GENERATE_INFOPLIST_FILE = "NO";
            conf.buildSettings.INFOPLIST_FILE = `"${NSE_TARGET_NAME}/Info.plist"`;
            conf.buildSettings.CLANG_ENABLE_MODULES = "YES";
            conf.buildSettings.CURRENT_PROJECT_VERSION = "1";
            conf.buildSettings.MARKETING_VERSION = "1.0";
          }
        }
      }
    }

    // Also set the bundle ID in the fallback loop (for any configs that addTarget may have created separately)
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      if (key.endsWith("_comment")) continue;
      const conf = configurations[key];
      if (typeof conf !== "object" || !conf.buildSettings) continue;
      const bs = conf.buildSettings;
      if (
        bs.PRODUCT_NAME === `"${NSE_TARGET_NAME}"` ||
        bs.PRODUCT_NAME === NSE_TARGET_NAME ||
        bs.PRODUCT_NAME === '"$(TARGET_NAME)"'
      ) {
        // Only update if it looks like it belongs to our NSE target (has no bundle ID or wrong one)
        const currentBundleId = (bs.PRODUCT_BUNDLE_IDENTIFIER || "").replace(/"/g, "");
        if (!currentBundleId || !currentBundleId.startsWith(bundleIdentifier)) {
          bs.PRODUCT_BUNDLE_IDENTIFIER = `"${nseBundleId}"`;
        }
      }
    }

    return mod;
  });
}

module.exports = withNotificationServiceExtension;
