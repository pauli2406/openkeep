const IS_DEV = process.env.APP_VARIANT === 'development';

export default {
  "expo": {
    name: IS_DEV ? 'OpenKeep (Dev)' : 'OpenKeep',
    "slug": "openkeep-mobile",
    "scheme": "openkeep",
    // `web` is here for the visual-regression build only (#150); nothing ships
    // to a browser. See `visual/README.md`.
    "platforms": [
      "ios",
      "android",
      "web"
    ],
    "version": "0.4.0",
    "icon": "./assets/icon.png",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "plugins": [
      "expo-secure-store",
      "expo-document-picker",
      "expo-font"
    ],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": IS_DEV ? "com.openkeep.mobile.dev" : "com.openkeep.mobile",
      "infoPlist": {
        "NSCameraUsageDescription": "OpenKeep uses the camera to scan paper documents into your archive.",
        // The offline copy is encrypted with SQLCipher (AES) and the key lives in
        // the keychain. That is data protection with standard cryptography, which
        // Apple's exemption covers — but it is a declaration about this build, so
        // re-read the current export-compliance questions before a submission
        // rather than trusting this comment.
        "ITSAppUsesNonExemptEncryption": false
      },
      "appleTeamId": "6DTWU4679K"
    },
    "android": {
      "package": IS_DEV ? "com.openkeep.mobile.dev" : "com.openkeep.mobile",
      "permissions": [
        "android.permission.CAMERA"
      ],
      "intentFilters": [],
      "queries": {
        "intent": [
          {
            "action": "VIEW",
            "data": {
              "mimeType": "application/pdf"
            }
          }
        ]
      },
      "adaptiveIcon": {
        "foregroundImage": "./assets/icon.png",
        "backgroundColor": "#fcfcfb"
      }
    },
    "extra": {
      "eas": {
        "projectId": "73d7171d-c90b-42be-901b-bf7d2e38394f"
      }
    }
  }
};
