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

Four things, in this order. Nothing here is repeated per release, and none of it
puts an Apple credential in this repository — CI never sees your Apple account.

**Prerequisites:** an active Apple Developer Program membership on team
`6DTWU4679K`, and an Expo account that owns the project
(`extra.eas.projectId` in `apps/mobile/app.config.js`).

### 1. Expo access token

CI authenticates to EAS with a token, and nothing else.

1. Open **[expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens)**
   — the dashboard path is Settings → Access tokens.
2. **Create token**, name it for where it will live (`github-actions-openkeep`),
   and copy the value. It is shown once.
3. Put it in the repository:

   ```bash
   # Prompts with hidden input, so the value never reaches your shell history.
   gh secret set EXPO_TOKEN --repo pauli2406/openkeep
   ```

4. Check it works:

   ```bash
   cd apps/mobile
   EXPO_TOKEN='<paste>' pnpm exec eas whoami
   ```

A personal token acts on your behalf everywhere you have access. For a shared
project, prefer a **robot user** with a role scoped to builds (Expo dashboard →
account settings → robot users); it cannot sign in, only hold a token. Either kind
is revoked from the same access-tokens page without touching your password.

### 2. The App Store Connect app record

Nothing can be uploaded to an app that does not exist yet.

1. Make sure the bundle identifier is registered: **developer.apple.com →
   Certificates, Identifiers & Profiles → Identifiers → + → App IDs → App** with
   `com.openkeep.mobile`. (EAS registers it for you during the first build if you
   let it manage credentials — step 3 — so this is only needed if you would rather
   do it by hand.)
2. **App Store Connect → Apps → + → New App**: platform iOS, the name, primary
   language, the bundle identifier from above, an SKU of your choosing.
3. Read the app id off **App Information → General → Apple ID**. It is a number,
   not the bundle identifier, and it is not a secret:

   ```bash
   gh variable set ASC_APP_ID --repo pauli2406/openkeep --body '1234567890'
   ```

   Alternatively put it in `submit.production.ios.ascAppId` in
   `apps/mobile/eas.json`; the workflow accepts either and fails with an explicit
   message if it finds neither.

### 3. Signing credentials — let EAS generate them

```bash
cd apps/mobile
pnpm exec eas credentials --platform ios
```

Choose the **production** profile, sign in with your Apple ID (a 2FA code is asked
for once, interactively — this is why the step is not in CI), and let EAS create
and store:

- the **distribution certificate** — about you as a developer, not about the app
- the **provisioning profile** — about this app

Both then live on EAS. There is no certificate in git, no keychain to export, no
`match` repository to maintain.

### 4. App Store Connect API key — let EAS generate that too

In the same `eas credentials --platform ios` session:

1. **App Store Connect: Manage your API Key**
2. **Set up your project to use an API Key for EAS Submit**

EAS creates the key against your account and keeps it. That is all `--auto-submit`
needs.

If you would rather create the key yourself: App Store Connect → **Users and
Access → Integrations → App Store Connect API**, generate a team key with the
**App Manager** role, download the `.p8` **once** (Apple will not offer it again),
and note the Key ID and Issuer ID. Then either upload it in the same
`eas credentials` menu, or set `ascApiKeyPath`, `ascApiKeyId` and
`ascApiKeyIssuerId` under `submit.production.ios` in `eas.json` — in which case
keep the `.p8` out of git. Apple moves this part of the UI around; their
[API key documentation](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
is the authority if the menu names have changed.

### 5. App Privacy and a TestFlight group

Before a build can be distributed, App Store Connect wants:

- **App Privacy** answers on the app record. OpenKeep stores documents on the
  archive the user connects to; the app itself collects nothing. Camera use is
  already declared in the binary (`NSCameraUsageDescription`), and
  `ITSAppUsesNonExemptEncryption: false` means there is no export-compliance
  question per build.
- an **internal TestFlight group** with at least yourself in it, so an uploaded
  build reaches a device.

### Check the setup without spending a build

The free plan allows fifteen iOS builds a month, so verify everything that can be
verified for free first:

```bash
cd apps/mobile
export EXPO_TOKEN='<paste>'

pnpm exec eas whoami                                        # token works
pnpm exec eas config --platform ios --profile production     # profile resolves
pnpm exec eas credentials --platform ios                     # cert + profile + API key are there
pnpm exec eas build:list --platform ios --limit 5            # project is reachable
```

Then take the first build with submission turned off — signing gets proven without
touching App Store Connect:

```bash
gh workflow run "Release iOS" --repo pauli2406/openkeep \
  -f version=0.1.0 -f ref=main -f submit=false
gh run watch --repo pauli2406/openkeep
```

`0.1.0` is what `app.config.js` says today, so the version check passes without a
bump.

### What ends up where

| Where | What |
|---|---|
| GitHub secret `EXPO_TOKEN` | the only credential in this repository's CI |
| GitHub variable `ASC_APP_ID` | the App Store Connect app id (not secret) |
| EAS | distribution certificate, provisioning profile, App Store Connect API key, and the iOS build number |
| This repository | the user-facing `version`, and nothing else about releasing |

## Releasing

1. **Bump the version in a PR.** `version` in `apps/mobile/app.config.js` — for
   example `0.1.0` → `0.2.0`. The release workflow verifies this matches what you
   asked it to release; it deliberately does not rewrite the commit it is
   releasing.
2. **CI has to be green on the commit.** The workflow reads the `CI` check and
   waits for it if it is still running — releasing straight after a merge is the
   normal case, and the merge commit's CI is usually still in flight. It refuses a
   commit whose CI failed, and a commit with no CI run at all. A release build is
   not where you want to discover a failing test.
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
| `CI concluded 'failure' for …` | The commit's CI is not green. Fix it and release the fix. |
| `no CI run for … after 180s` | The commit never had a CI run — CI runs on pushes to main and on pull requests. |
| `CI was still 'in_progress' after 2700s` | CI is stuck or unusually slow; look at the run before releasing. |
| `app.config.js says X but you asked to release Y` | Bump the version in a PR first. |
| `no App Store Connect app id` | Set the `ASC_APP_ID` variable, or add `ascAppId` to `eas.json`. |
| `EXPO_TOKEN secret is not set` | Add it under repository secrets. |
| An EAS build failure | The link in the job summary goes to the build page with full logs. Nothing has been tagged at that point. |

## Related

- [Deployment Guide](./deployment-guide.md) for the server release
- [Mobile App](../user/mobile-app.md) for what is in the app
- [Testing and Validation](../technical/testing-and-validation.md) for what CI covers
