# Bundled fonts

The app ships Geist, the same family as the web client, rather than pulling it from a
CDN, so text renders identically offline.

| Family | Weights | Source | Licence |
|---|---|---|---|
| Geist | 400, 500, 600, 700 | [vercel/geist-font](https://github.com/vercel/geist-font) v1.9.2 (`geist` on npm) | `Geist-OFL.txt` |
| Geist Mono | 400, 500, 600 | same | `Geist-OFL.txt` |

Static instances, not variable fonts: React Native selects a face by `fontFamily` name, so
each weight is its own file and styles set `fontFamily` instead of `fontWeight`. The names
registered with `useFonts` are the file stems; see `src/typography.ts`.
