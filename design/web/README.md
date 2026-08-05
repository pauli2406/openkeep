# OpenKeep redesign — design reference

This folder is the visual source of truth for the **Redesign 2026** epic.
Every ticket in that milestone is implementing some part of what is shown here.

## Screens

Full-size PNGs, 3456 × 2160 (16:10, 2× — 1728 × 1080 logical).

| File | Screen | Issue |
|---|---|---|
| `screens/01-today.png` | Today (replaces the dashboard) | #45 |
| `screens/02-documents-list.png` | Documents · list | #46, #49 |
| `screens/03-documents-timeline.png` | Documents · timeline | #47 |
| `screens/04-documents-groups.png` | Documents · groups (replaces galaxy) | #48 |
| `screens/05-review-queue.png` | Review queue | #51 |
| `screens/06-chat.png` | Chat (standalone conversational search) | #52 |
| `screens/07-settings-general.png` | Settings · General | #55 |
| `screens/08-settings-taxonomy.png` | Settings · Tags & taxonomy | #56 |
| `screens/09-settings-providers.png` | Settings · AI providers | #57 |
| `screens/10-profile.png` | User profile | #58 |
| `screens/11-document-detail.png` | Document detail | #50 |
| `screens/12-import.png` | Import | #54 |
| `screens/13-today-dark.png` | Today, dark theme | #44 |
| `screens/14-chat-dark.png` | Chat, dark theme | #44, #52 |
| `screens/15-omnibar.png` | Omnibar (⌘K) | #53 |

The top bar is visible in every screenshot — that is issue #43.

## Interactive prototype

`prototype/openkeep-workspace.dc.html` — open it in a browser. It is clickable:
every top-bar tab, the view switcher, the settings sections, the theme toggle
and ⌘K all work. Use it to check hover states, spacing and behaviour that a
screenshot cannot show.

It needs `prototype/support.js` next to it; both files are self-contained
otherwise (fonts load from Google Fonts, icons from the lucide CDN).

## How to read it

The prototype is a **design artifact, not a codebase**. It is one HTML file with
inline styles and fake data. Do not port its markup. Take from it:

- exact colors, radii, font sizes, row heights and spacing
- layout structure and column proportions
- what information appears on each screen, and in what order
- interaction affordances (keyboard hints, selection bars, hover targets)

Everything else — data fetching, routing, state, components — stays as it is in
`web/`.

## Where the values live

Pull the palette out of the prototype's logic block (the `GREEN`, `AMBER`, `RED`,
`MONO` constants and the `dark` token map). Those are the same values the design
tokens ticket (#40) asks you to put into `web/src/index.css`.
