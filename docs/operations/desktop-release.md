---
title: Desktop Release Operations
description: Release, rollback, credential rotation, and failed-update runbooks.
---

# Desktop Release Operations

Desktop artifacts ship with the ordinary server release: the `Release` workflow
tags the verified commit, creates the GitHub Release, and then calls
`Release Desktop`, which builds each platform on its native runner and uploads
everything to that same release only after every platform succeeded. macOS and
Windows clients update from those release assets through update.electronjs.org;
Linux clients link to the release page.

## Support matrix

| Platform | Architectures | Artifact | Updates |
| --- | --- | --- | --- |
| macOS 13+ | arm64, x64 | DMG (install), ZIP (update feed) | Automatic in-app (Squirrel.Mac) |
| Windows 10+ | x64 | Squirrel installer (`OpenKeep-Setup.exe`), RELEASES + nupkg feed | Automatic in-app (Squirrel.Windows) |
| Linux | x64 | deb, rpm | Manual — in-app link to the release page |

## When a Build Fails on the Electron Download

`socket hang up` partway through `Packaging application` is the Electron binary
download failing, not the code. Both the CI desktop job and the release build
cache that download and retry the packaging step three times, so this should be
rare — but a cold cache plus a bad network can still exhaust the retries. Re-run
the failed jobs; the cache entry from the successful attempt makes the next run
immune.

## Release runbook

1. Run the `Release` workflow with the version (`vX.Y.Z`). It verifies the
   commit's images, deploys the server, tags, and creates the GitHub Release;
   the `desktop` job then builds and attaches the desktop artifacts. Leave
   `desktop` enabled unless you are releasing a server-only hotfix.
2. To rebuild desktop artifacts for an existing release (a runner failure, new
   signing credentials), run `Release Desktop` directly with the same tag. It
   refuses a tag whose commit did not pass CI and re-uploads with `--clobber`.
3. Verify: the release page carries the DMGs, darwin ZIPs, `OpenKeep-Setup.exe`
   with `RELEASES` + `.nupkg`, and the deb/rpm. A signed macOS build passes
   `spctl -a -vv OpenKeep.app`; a signed Windows installer shows a valid
   signature in the file properties.

Unsigned builds (missing credentials) still complete — the workflow is testable
without secrets — but must not be published for end users: macOS Gatekeeper
will refuse them and the in-app updater cannot apply them.

## Rollback runbook

Desktop clients update to the **latest** GitHub Release.

1. Server: set `IMAGE_TAG` to the previous version in Dokploy and redeploy
   (unchanged from the server runbook).
2. Desktop: mark the bad release as a pre-release or delete it, so the previous
   release becomes `latest` again — update.electronjs.org and the Linux
   in-app check both follow `latest`. Clients that already updated stay on the
   bad version until a newer release exists; for a defective build, ship a
   fixed `vX.Y.Z+1` rather than relying on downgrade, which Squirrel does not
   support.

## Credential rotation runbook

All signing credentials live only in GitHub Actions secrets and are read only
by the `Release Desktop` workflow; the repository secret scan covers the tree,
not the secret store.

- **Apple**: replace `MACOS_CERTIFICATE_P12`/`MACOS_CERTIFICATE_PASSWORD` with
  the new Developer ID Application certificate export, and rotate
  `APPLE_APP_SPECIFIC_PASSWORD` from appleid.apple.com. Old releases stay
  valid; notarization is per-artifact.
- **Windows**: update `WINDOWS_SIGN_PARAMS` with the new certificate reference
  (keep a timestamp server in the parameters — timestamped signatures outlive
  the certificate).
- After rotating, re-run `Release Desktop` against a test tag before the next
  real release.

## Failed-update runbook

- **A platform build failed during release**: nothing was published for any
  platform (publishing requires all platforms). Fix the cause and re-run
  `Release Desktop` with the same tag.
- **Clients report a failed update check**: the in-app state shows the error
  category. An unsigned build reports itself as unable to self-update; a feed
  problem is retried on the next startup or manual check. Verify the release
  assets exist and `https://update.electronjs.org/pauli2406/openkeep/darwin-arm64/0.0.0`
  answers.
- **An update installs but the app is broken**: ship a fixed release
  immediately (clients follow `latest`); users can also reinstall any previous
  version from its release page, and their profiles, credentials, and offline
  copies live in the per-user data directory, which reinstalls do not touch.
