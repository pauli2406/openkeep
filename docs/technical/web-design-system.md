---
title: Web Design System
description: The look of the web and desktop clients, and the rules that keep it consistent.
---

# Web Design System

The web client (and the desktop client, which reuses it) is built from
[shadcn/ui](https://ui.shadcn.com/) components and the
[AI Elements](https://ui.shadcn.com/docs/ai-elements) patterns. The components are
copied into `apps/web/src/components/ui` and belong to this repo, so tune them there.
Add new ones with `pnpm dlx shadcn@latest add <name>` from `apps/web`.

## The idea

**A white workspace floating on a deep-blue field.** The gradient carries the app
chrome, primary actions and AI moments. Everything people read sits on calm white
with generous spacing. Dark mode keeps the same structure on navy.

## Tokens

`apps/web/src/theme.css` is the only place colours are defined, for every client.
`pnpm tokens:generate` converts it into `packages/tokens/src/palette.generated.ts`, which
the mobile app imports, because React Native understands neither `oklch()` nor CSS
gradients. `scripts/tokens/check.mjs` fails the build when that file is stale, and on a
colour literal anywhere else in `apps/web/src` or `apps/mobile/src`.

Use the shadcn names through Tailwind (`bg-card`, `text-muted-foreground`,
`border-border`, `bg-primary`), plus these additions:

| Purpose | Classes |
| --- | --- |
| Blue text on a surface: links, active labels | `text-brand` |
| Tinted surface: selected rows, icon tiles | `bg-brand-soft`, `text-brand-soft-foreground` |
| Status, soft pill | `bg-success-soft text-success`, and `warning`, `danger`, `info` |
| Categories, charts | `chart-1` to `chart-8` |
| A document page, white in both themes | `bg-paper`, `border-paper-border`, on a `bg-stage` |
| A cited or highlighted passage | `bg-highlight text-highlight-foreground` |
| Numbers that should line up | `num` (tabular figures) |
| Elevation | `shadow-card`, `shadow-raised`, `shadow-action` |

Gradients are utilities, never spelled out: `bg-gradient-chrome` (app shell),
`bg-gradient-brand` (hero panels), `bg-gradient-action` (primary buttons, the user's
chat bubble), `bg-gradient-wash` (a soft tint behind empty states), `text-gradient`
(a heading on an empty state).

## Layout primitives

`apps/web/src/components/layout/page.tsx` holds what every screen shares:

- `Page`: the padded, centred content column (`width`: `default`, `wide`, `narrow`).
- `PageHeader`: title, description, optional `icon` and `actions`.
- `IconTile`: a soft blue (or `tone="solid"` gradient) square around an icon.
- `GradientPanel`: the signature hero. Use it at most once on a screen, for the thing
  that screen is about.
- `CategoryDot`: the small round category marker.

## Rules

- **Compose from `components/ui`.** Reach for `Card`, `Table`, `Tabs`, `Dialog`,
  `Sheet`, `Select`, `Field`, `Empty`, `Skeleton`, `Alert`, `Badge`, `ToggleGroup` and
  the rest before writing a bespoke element.
- **Hierarchy comes from type and space.** Page titles are `text-2xl font-semibold
  tracking-tight`, card titles `font-medium`, labels `text-xs font-medium
  text-muted-foreground`. No uppercase eyebrows and no monospace except for checksums,
  tokens and other literal machine values.
- **One primary action per view.** It is the default `Button`, with its gradient; other
  actions are `outline`, `secondary` or `ghost`.
- **Every state is designed.** Loading uses `Skeleton` or `Spinner`, nothing-here uses
  `Empty`, and failure uses `Alert` or `ErrorBlock` with a way to retry.
- **Responsive to phone width.** Secondary panels become a `Sheet` below their
  breakpoint rather than disappearing.
- **User-visible text goes through `t()`** in `apps/web/src/lib/i18n.tsx`, in both
  English and German.

## AI surfaces

Chat, the omnibar and the document Q&A compose the AI Elements patterns: `Message` and
`Bubble` for turns, `MessageScroller` for the thread, `Trace` for what the agent did,
`InputGroup` for the prompt, inline citations on `HoverCard`, and suggestions as a row of
outline buttons. `components/chat/answer-markdown.tsx` renders every answer, including
its citation markers.

These components sit on OpenKeep's own answer stream (`hooks/use-answer-stream.ts`), not
on the AI SDK, because the patterns only need plain props.

## Mobile

`apps/mobile` looks and works the same: the web at phone width is its specification. The same
theme, Geist and radius scale reach it through `packages/tokens` and `src/typography.ts`, and
`src/components/layout.tsx` holds its `Gradient`, `GradientPanel`, `IconTile`, `Chip`,
`Segmented`, `Skeleton` and `BottomSheet`. `src/components/shell.tsx` is the header and sidebar,
opened as a drawer. A feature added to the web belongs in the app as well.

## Visual baselines

`apps/web/visual` captures each screen in both themes. A redesign moves them on purpose:
re-render them with `pnpm --filter @openkeep/web test:visual:update`, which runs inside
the pinned Playwright container, and read the diff in review.
