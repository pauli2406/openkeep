# Documentation Rules

## Core Principle

Documentation is part of the product. Do not treat it as a later cleanup task.

If a change modifies behavior, architecture, operator workflow, setup, verification, or the visible UI, update the matching docs in the same workstream.

## Documentation Map

- `docs/README.md`: top-level documentation hub
- `docs/user/`: user-facing workflows and product guidance
- `docs/technical/`: contributor-facing architecture and implementation guidance
- `docs/operations/`: deployment, configuration, monitoring, and runbooks
- `apps/docs`: Docusaurus site that renders the root `docs/` content
- `README.md`: repo entry point, setup, and verification overview

The canonical markdown stays in the root `docs/` directory. Do not move source docs into `apps/docs` unless the project explicitly changes that rule.

If you change Docusaurus navigation, branding, homepage structure, search integration, or docs-site behavior, update both `apps/docs` and any affected root docs or repo guidance together.

## Update Triggers

### Update `docs/user/*` when you change:

- visible UI flows
- navigation or page structure
- upload, search, review, or settings behavior
- document detail capabilities
- end-user AI behavior such as summaries, Q&A, or archive answers

### Update `docs/technical/*` when you change:

- architecture
- backend or web application structure
- API flows
- data flow shape
- agentic extraction design
- test strategy or contributor workflow

### Update `docs/operations/*` when you change:

- deployment shape
- Docker or runtime topology
- environment variables
- provider setup requirements
- readiness, health, metrics, or logging behavior
- backup, restore, import/export, or runbook procedures

### Update `README.md` when you change:

- primary setup steps
- top-level capabilities
- major verification commands
- main documentation entry points

## Expected Agent Behavior

- Check whether docs need updating before finishing a feature or refactor.
- Prefer small doc updates during implementation over large catch-up rewrites later.
- Keep statements factual and tied to the current repo state.
- Remove or correct stale claims when you find them.
- If no docs update is needed, make that a conscious decision rather than an omission.

## Minimum Closing Check

Before wrapping up substantial work, ask yourself:

1. Did this change affect users?
2. Did this change affect contributors?
3. Did this change affect operators?
4. Did setup, verification, or deployment guidance change?

If any answer is yes, update the matching docs.
