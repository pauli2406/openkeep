import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MACOS_DOCUMENT_TYPES } from "./src/main/file-associations";

/**
 * Signing is driven entirely by environment, so the same configuration
 * produces an unsigned developer build locally and a signed, notarized
 * release in CI once the credentials exist as GitHub Actions secrets.
 * Nothing here embeds a secret; the secret scan stays clean by construction.
 *
 * macOS: OPENKEEP_MAC_SIGNING=1 enables signing with the keychain identity;
 * notarization additionally needs APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and
 * APPLE_TEAM_ID. Windows: OPENKEEP_WIN_SIGNING=1 enables Squirrel signing via
 * WINDOWS_SIGN_PARAMS (a complete signtool parameter string, including a
 * timestamp server).
 */
const macSigningEnabled = process.env.OPENKEEP_MAC_SIGNING === "1";
const macNotarizeEnabled =
  macSigningEnabled &&
  Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID,
  );
const windowsSignParams = process.env.OPENKEEP_WIN_SIGNING === "1"
  ? process.env.WINDOWS_SIGN_PARAMS
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Main, preload, React, and shared workspace sources are bundled by Vite.
    // Skipping the hoisted workspace node_modules tree keeps packaging bounded
    // to those trusted build artifacts.
    prune: false,
    appBundleId: "de.openkeep.desktop",
    extendInfo: {
      CFBundleDocumentTypes: MACOS_DOCUMENT_TYPES,
    },
    ...(macSigningEnabled
      ? {
          osxSign: {},
          ...(macNotarizeEnabled
            ? {
                osxNotarize: {
                  appleId: process.env.APPLE_ID!,
                  appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
                  teamId: process.env.APPLE_TEAM_ID!,
                },
              }
            : {}),
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    // The darwin ZIP is what Squirrel.Mac's update feed serves; the DMG is
    // what users download and drag to /Applications.
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({ format: "ULFO" }, ["darwin"]),
    // Squirrel.Windows produces the installer plus the RELEASES/nupkg feed the
    // built-in Windows auto-updater consumes.
    new MakerSquirrel({
      setupExe: "OpenKeep-Setup.exe",
      ...(windowsSignParams ? { signWithParams: windowsSignParams } : {}),
    }),
    new MakerDeb({
      options: {
        name: "openkeep",
        productName: "OpenKeep",
        genericName: "Document Archive",
        categories: ["Office"],
        section: "misc",
        homepage: "https://openkeep.de",
        // Registers the MIME associations so "Open with OpenKeep" works from
        // Linux file managers; the runtime association handling already
        // exists in main/file-associations.
        mimeType: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/tiff",
          "image/heic",
        ],
      },
    }),
    new MakerRpm({
      options: {
        name: "openkeep",
        productName: "OpenKeep",
        genericName: "Document Archive",
        categories: ["Office"],
        homepage: "https://openkeep.de",
        mimeType: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/tiff",
          "image/heic",
        ],
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.ts",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
