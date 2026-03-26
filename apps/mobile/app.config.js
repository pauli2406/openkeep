const IS_DEV = process.env.APP_VARIANT === 'development';

export default {
  "expo": {
    "name": "OpenKeep",
    name: IS_DEV ? 'OpenKeep (Dev)' : 'OpenKeep',
    "slug": "openkeep-mobile",
    "scheme": "openkeep",
    "platforms": [
      "ios",
      "android"
    ],
    "version": "0.1.0",
    "icon": "./assets/icon.png",
    "orientation": "portrait",
    "userInterfaceStyle": "light",
    "plugins": [
      "expo-secure-store",
      "expo-document-picker",
      "expo-font"
    ],
    "build": {
      "development": {
        "ios": {
          "simulator": true
        }
      }
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": IS_DEV ? "com.openkeep.mobile.dev" : "com.openkeep.mobile",
      "infoPlist": {
        "NSCameraUsageDescription": "OpenKeep uses the camera to scan paper documents into your archive."
      },
      "appleTeamId": "6DTWU4679K"
    },
    "android": {
      "package": IS_DEV ? "com.openkeep.mobile.dev" : "com.openkeep.mobile",
      "permissions": [
        "android.permission.CAMERA"
      ],
      "adaptiveIcon": {
        "foregroundImage": "./assets/icon.png",
        "backgroundColor": "#f6f3ed"
      }
    },
    "extra": {
      "eas": {
        "projectId": "73d7171d-c90b-42be-901b-bf7d2e38394f"
      }
    }
  }
};
