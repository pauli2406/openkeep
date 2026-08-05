---
title: iOS Releases
description: How an OpenKeep iOS build is produced, submitted to TestFlight, and released to the App Store.
---

# iOS Releases

The iOS app is built on Expo's servers (EAS Build) and uploaded to TestFlight from
CI. The workflow is `Release iOS` (`.github/workflows/release-mobile.yml`), and it
is shaped like the server release: manually triggered, refuses to run on anything
untested, and tags what it shipped.

Android is not wired up. The `production` profile builds it, but nothing submits
it, and the app has never been tested on a device.

## One-time setup

### Apple side

1. **Register the app.** In App Store Connect, create an app for the bundle
   identifier `com.openkeep.mobile` (team `6DTWU4679K`). The app record has to
   exist before anything can be uploaded to it.
2. **Note the app id.** App Store Connect → your app → App Information → General →
   **Apple ID**. It is a number, not a bundle identifier, and it is not a secret.
3. **Create an App Store Connect API key.** Users and Access → Integrations → App
   Store Connect API → generate a key with the **App Manager** role. Download the
   `.p8` once; it cannot be downloaded again.
4. **Answer App Privacy** for the app record. OpenKeep stores documents on the
   archive the user connects to; the app itself collects nothing. Camera use is
   already declared in the binary (`NSCameraUsageDescription`), and
   `ITSAppUsesNonExemptEncryption: false` means no export-compliance question per
   build.

### EAS side

Run this once from `apps/mobile`, logged in as the account that owns the Expo
project:

```bash
pnpm exec eas credentials
```

Pick iOS → the production profile, and let EAS **manage the distribution
certificate and the provisioning profile**. Upload the `.p8` App Store Connect API
key in the same place. From then on nothing Apple-related lives in this repository
— no certificates, no keys, no `match` repo.

### Repository side

| Kind | Name | Value |
|---|---|---|
| Secret | `EXPO_TOKEN` | An Expo access token with build permissions (expo.dev → account settings → access tokens). Prefer a robot account over a personal token. |
| Variable | `ASC_APP_ID` | The App Store Connect Apple ID from step 2. Alternatively put it in `submit.production.ios.ascAppId` in `apps/mobile/eas.json`. |

The workflow fails with an explicit message if either is missing, before it spends
a build.

## Releasing

1. **Bump the version in a PR.** `version` in `apps/mobile/app.config.js` — for
   example `0.1.0` → `0.2.0`. The release workflow verifies this matches what you
   asked it to release; it deliberately does not rewrite the commit it is
   releasing.
2. **Wait for CI to be green on main.** The workflow reads the `CI` check for the
   commit and refuses anything else. A release build is not where you want to
   discover a failing test.
3. **Run the workflow.** Actions → `Release iOS` → Run workflow, with the version
   (`0.2.0`, no leading `v`) and optionally a specific commit. Leave `submit` on to
   have the build uploaded to TestFlight.
4. **Release from App Store Connect** when you want it public. The workflow stops
   at TestFlight on purpose: submitting for review is a decision, not a build
   step.

The workflow tags the commit `mobile-v0.2.0` and creates a GitHub Release with
generated notes. The `mobile-v*` prefix keeps the mobile line from colliding with
the server's `v*` tags.

### What the build number does

`eas.json` sets `appVersionSource: "remote"`, so `ios.buildNumber` lives on EAS and
`autoIncrement` raises it for every production build. Nothing in git tracks it, and
nothing needs to. Only the user-facing `version` is in the repository.

If you ever need to align EAS with a build number that already exists in App Store
Connect: `pnpm exec eas build:version:set`.

## Before you ship to anyone

- **Run the app on a device.** Nothing in CI has (see issue #154). The screenshot
  suite renders through react-native-web, which does not prove native text
  metrics, the native header, the real PDF viewer or the OS scanner.
- Check both themes and the offline path on that device.
- `pnpm test` and `pnpm --filter @openkeep/mobile test:visual` are already covered
  by the `CI` check the workflow requires.

## What the free EAS plan gives you

| | |
|---|---|
| iOS builds | 15 per month |
| Queue | low priority — minutes to hours at peak |
| Build timeout | 45 minutes |
| Concurrency | 1 |
| EAS Submit | included, unlimited |

That is comfortable for a release every week or two. The way people run out is
debugging the pipeline itself, where each attempt costs a build — which is why the
workflow does all of its checking before it starts one.

If the queue or the quota becomes the problem, the escape hatch does not need a
paid plan: standard `macos-latest` runners are free for public repositories, so
`eas build --platform ios --profile production --local` on a macOS runner produces
the same `.ipa` without touching the EAS build allowance. It costs you the runner's
wall clock and pinning an Xcode version instead. Note that this economics flips if
the repository ever becomes private, where macOS minutes are billed at 10×.

## Rollback

There is no rollback for a binary that has shipped. What you can do:

- **TestFlight:** expire the build so testers stop getting it.
- **App Store:** if the version is still in review, cancel the submission. If it is
  live, the only route is releasing a fixed version — App Store Connect can revert
  to the previous *release* for phased rollouts, but not to a previous binary once
  a version is fully released.

This is the strongest argument for keeping the TestFlight step separate from the
store step.

## When it fails

| Message | Meaning |
|---|---|
| `… is not an ancestor of origin/main` | You pointed the workflow at a branch or an unmerged commit. |
| `CI is 'failure' for …` | The commit's CI is not green. Fix it and release the fix. |
| `app.config.js says X but you asked to release Y` | Bump the version in a PR first. |
| `no App Store Connect app id` | Set the `ASC_APP_ID` variable, or add `ascAppId` to `eas.json`. |
| `EXPO_TOKEN secret is not set` | Add it under repository secrets. |
| An EAS build failure | The link in the job summary goes to the build page with full logs. Nothing has been tagged at that point. |

## Related

- [Deployment Guide](./deployment-guide.md) for the server release
- [Mobile App](../user/mobile-app.md) for what is in the app
- [Testing and Validation](../technical/testing-and-validation.md) for what CI covers
