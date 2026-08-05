# Bundled fonts

The mobile app ships the two families the design uses (#105) rather than pulling
them from a CDN, so text renders identically offline.

| Family | Weights | Source | Licence |
|---|---|---|---|
| Public Sans | 400, 500, 600, 700 | [uswds/public-sans](https://github.com/uswds/public-sans) v2.001 | `PublicSans-OFL.txt` (SIL OFL 1.1) |
| IBM Plex Mono | 400, 500, 600 | [google/fonts](https://github.com/google/fonts/tree/main/ofl/ibmplexmono) | `IBMPlexMono-OFL.txt` (SIL OFL 1.1) |

Static instances, not variable fonts: React Native selects a face by
`fontFamily` name, so each weight is its own file and styles set `fontFamily`
instead of `fontWeight`. The names registered with `useFonts` are the file
stems — see `src/typography.ts`.
