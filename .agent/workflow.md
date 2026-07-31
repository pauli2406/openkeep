# Agent Workflow

How agents plan and deliver work in this repo. Two modes: **feature planning** and **story implementation**. Only do what the current task asks for — planning does not imply starting implementation.

## Mode 1: Feature → User Stories

When asked to split a feature into user stories:

1. Understand the feature against the current codebase and docs before splitting.
2. Cut vertical, independently shippable stories (each delivers user-visible or operator-visible value; avoid layer-only stories like "build the API part").
3. Create one GitHub issue per story with `gh issue create`:
   - Title: `Story: <outcome from the user's perspective>`
   - Body: user-story statement, acceptance criteria as a checklist, affected workspaces (`apps/*`, `packages/*`), and known constraints.
   - Label: `enhancement`.
4. Create a parent feature issue that lists all story issues as a task list (`- [ ] #123`), so progress is visible in one place.
5. If a GitHub Project board is in use, add the issues to it (`gh project item-add`; requires a token with `project` scope).
6. Stop after creating the issues. Present the breakdown and wait for direction.

## Mode 2: Implement a Story End-to-End

When asked to implement a story, own the full loop through automated review. Manual review and merge stay with the maintainer.

### 1. Branch

- Start from up-to-date `main`.
- Branch name: `feat/<issue-number>-<short-slug>` (or `fix/`, `docs/` as appropriate).

### 2. Implement

- Work in small, coherent commits — one logical change per commit, conventional-commit style messages (`feat:`, `fix:`, `docs:`, ...).
- Follow the working rules in `AGENTS.md`: update docs in the same change, regenerate the SDK after API contract changes, never hardcode providers.
- Run the verification commands from `AGENTS.md` before opening the PR; environment-dependent suites only where the environment supports them.

### 3. Pull Request

- Push the branch and open a PR against `main` with `gh pr create`.
- PR body: what changed and why, how it was verified, and `Closes #<story-issue>`.
- Self-review the full diff once before requesting review — fix anything you would flag on someone else's PR.

### 4. Automated Review Loop

The repo runs Codex as an automated PR reviewer (triggered on PR open, on marking a draft ready, or by commenting `@codex review`).

Repeat until clean:

1. Wait a few minutes after pushing, then fetch review comments:
   `gh api repos/<owner>/<repo>/pulls/<n>/comments` and `gh pr view <n> --comments`.
2. Judge each comment on its merits — verify claims against the code instead of accepting them blindly.
3. For valid findings: implement the fix, and check whether the same defect exists elsewhere in the repo.
4. For findings you reject: reply to the comment explaining why, with evidence.
5. Commit, push, and re-check for new comments on the new commit.

Exit the loop when the latest automated review raises no new valid findings and every comment has either a fix or a reasoned reply.

### 5. Hand-off

- Do not merge. The maintainer does the final review and merge.
- Finish with a short summary: what was implemented, how it was verified, which review findings were fixed vs. rejected and why, and a link to the PR.
