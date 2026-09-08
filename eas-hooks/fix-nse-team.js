#!/usr/bin/env node

/**
 * EAS Build hook: copies DEVELOPMENT_TEAM from the main app target
 * to the NotificationServiceExtension target in the pbxproj file.
 * Runs after EAS configures credentials but before xcodebuild.
 */

const fs = require("fs");
const path = require("path");

const IOS_DIR = path.join(process.cwd(), "ios");
const NSE_TARGET_NAME = "NotificationServiceExtension";

function findPbxproj() {
  const entries = fs.readdirSync(IOS_DIR);
  for (const entry of entries) {
    const xcodeprojPath = path.join(IOS_DIR, entry);
    if (entry.endsWith(".xcodeproj") && fs.statSync(xcodeprojPath).isDirectory()) {
      const pbxproj = path.join(xcodeprojPath, "project.pbxproj");
      if (fs.existsSync(pbxproj)) return pbxproj;
    }
  }
  return null;
}

function run() {
  const pbxprojPath = findPbxproj();
  if (!pbxprojPath) {
    console.log("[eas-hook] No pbxproj found, skipping NSE team fix");
    return;
  }

  let content = fs.readFileSync(pbxprojPath, "utf-8");

  // Find DEVELOPMENT_TEAM from main app target build settings
  // Look for a DEVELOPMENT_TEAM that's not empty
  const teamMatch = content.match(/DEVELOPMENT_TEAM\s*=\s*"?([A-Z0-9]{10})"?\s*;/);
  if (!teamMatch) {
    console.log("[eas-hook] No DEVELOPMENT_TEAM found in pbxproj, skipping");
    return;
  }

  const teamId = teamMatch[1];
  console.log(`[eas-hook] Found DEVELOPMENT_TEAM: ${teamId}`);

  // Find NSE target sections and ensure they have DEVELOPMENT_TEAM
  // Replace empty or missing DEVELOPMENT_TEAM in NSE build configurations
  // Strategy: find build settings blocks that contain NotificationServiceExtension
  // and ensure they have the correct DEVELOPMENT_TEAM

  let modified = false;

  // Pattern: find build config blocks for NSE (they contain PRODUCT_NAME = NotificationServiceExtension)
  const nseBlockRegex = /(\{[^{}]*PRODUCT_NAME\s*=\s*"?NotificationServiceExtension"?[^{}]*\})/g;
  
  content = content.replace(nseBlockRegex, (block) => {
    if (block.includes("DEVELOPMENT_TEAM")) {
      // Replace existing (possibly empty) team
      const updated = block.replace(
        /DEVELOPMENT_TEAM\s*=\s*"?[^";]*"?\s*;/,
        `DEVELOPMENT_TEAM = ${teamId};`
      );
      if (updated !== block) modified = true;
      return updated;
    } else {
      // Add DEVELOPMENT_TEAM before the closing brace
      modified = true;
      return block.replace(/(\s*)\}$/, `$1\tDEVELOPMENT_TEAM = ${teamId};\n$1}`);
    }
  });

  if (modified) {
    fs.writeFileSync(pbxprojPath, content, "utf-8");
    console.log(`[eas-hook] Set DEVELOPMENT_TEAM = ${teamId} for ${NSE_TARGET_NAME}`);
  } else {
    console.log("[eas-hook] NSE target already has correct DEVELOPMENT_TEAM");
  }
}

run();
