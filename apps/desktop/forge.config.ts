import type { ForgeConfig } from "@electron-forge/shared-types";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
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
 * notarization additionally needs either an App Store Connect API key
 * (APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER) or an Apple ID
 * (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID). Windows: OPENKEEP_WIN_SIGNING=1 enables Squirrel signing via
 * WINDOWS_SIGN_PARAMS (a complete signtool parameter string, including a
 * timestamp server).
 */
const macSigningEnabled = process.env.OPENKEEP_MAC_SIGNING === "1";

/**
 * Notarization takes either an App Store Connect API key or an Apple ID with an
 * app-specific password. The key is preferred where both exist: it is scoped to
 * the team rather than to a person, it does not expire when someone changes their
 * Apple ID password, and it is what this repository already holds.
 */
const notaryApiKey =
  process.env.APPLE_API_KEY_PATH &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER
    ? {
        appleApiKey: process.env.APPLE_API_KEY_PATH,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_ISSUER,
      }
    : null;

const notaryAppleId =
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : null;

const notarize = notaryApiKey ?? notaryAppleId;
const macNotarizeEnabled = macSigningEnabled && Boolean(notarize);
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
    // Without this the executable is named after the package — `@openkeep/desktop`
    // — and the Linux makers look for a binary at that path and fail. A scoped
    // name is not a file name, and Linux conventionally wants a lowercase one,
    // which is also what the deb's desktop entry and its `/usr/lib/openkeep`
    // layout expect.
    executableName: "openkeep",
    extendInfo: {
      CFBundleDocumentTypes: MACOS_DOCUMENT_TYPES,
    },
    ...(macSigningEnabled
      ? {
          osxSign: {},
          ...(macNotarizeEnabled ? { osxNotarize: notarize! } : {}),
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
      // Squirrel names its nuspec after the package, and `@openkeep/desktop`
      // turns the scope into a directory that does not exist. The name also ends
      // up in the NuGet package id, where a scope is not allowed at all.
      name: "openkeep",
      // Has to match `executableName`, or the installer looks for the wrong file.
      exe: "openkeep.exe",
      authors: "OpenKeep contributors",
      description: "OpenKeep desktop client",
      setupExe: "OpenKeep-Setup.exe",
      ...(windowsSignParams ? { signWithParams: windowsSignParams } : {}),
    }),
    new MakerDeb({
      options: {
        name: "openkeep",
        productName: "OpenKeep",
        // Explicit rather than derived: the maker otherwise looks for a binary
        // named after the package, and `@openkeep/desktop` is not a file name.
        bin: "openkeep",
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
        // Explicit rather than derived: the maker otherwise looks for a binary
        // named after the package, and `@openkeep/desktop` is not a file name.
        bin: "openkeep",
        // rpmbuild refuses a package without one, and the root package.json says
        // "SEE LICENSE IN LICENSE", which is not a license identifier.
        license: "PolyForm-Noncommercial-1.0.0",
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
  hooks: {
    /**
     * The fuses plugin ad-hoc signs while flipping fuses, but Packager rewrites
     * Info.plist (bundle id, document types, asar integrity hashes) afterwards,
     * which invalidates that signature. macOS then refuses the Keychain item
     * behind Electron's safeStorage, so the unsigned developer build reports
     * secure storage as unavailable and cannot store archive credentials.
     * Re-signing ad hoc after packaging keeps local builds usable; release
     * builds are signed for real by osxSign instead.
     */
    postPackage: async (_forgeConfig, options) => {
      if (options.platform !== "darwin" || macSigningEnabled) return;
      for (const outputPath of options.outputPaths) {
        const bundle = readdirSync(outputPath).find((entry) =>
          entry.endsWith(".app"),
        );
        if (!bundle) continue;
        execFileSync("codesign", [
          "--sign",
          "-",
          "--force",
          "--deep",
          path.join(outputPath, bundle),
        ]);
      }
    },
  },
};

export default config;
