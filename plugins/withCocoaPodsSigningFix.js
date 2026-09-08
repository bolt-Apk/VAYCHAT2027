const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withCocoaPodsSigningFix(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const podfilePath = path.join(
        mod.modRequest.platformProjectRoot,
        "Podfile"
      );

      if (!fs.existsSync(podfilePath)) {
        return mod;
      }

      let podfileContent = fs.readFileSync(podfilePath, "utf-8");

      const signingFix = `
  post_install do |installer|
    installer.pods_project.targets.each do |target|
      if target.respond_to?(:product_type) && target.product_type == "com.apple.product-type.bundle"
        target.build_configurations.each do |config|
          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      end
    end
  end`;

      if (podfileContent.includes("post_install")) {
        podfileContent = podfileContent.replace(
          /post_install do \|installer\|/,
          `post_install do |installer|
    installer.pods_project.targets.each do |target|
      if target.respond_to?(:product_type) && target.product_type == "com.apple.product-type.bundle"
        target.build_configurations.each do |config|
          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      end
    end`
        );
      } else {
        podfileContent += signingFix;
      }

      fs.writeFileSync(podfilePath, podfileContent, "utf-8");
      return mod;
    },
  ]);
}

module.exports = withCocoaPodsSigningFix;
