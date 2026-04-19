# Change Record

## Summary

- Date: 2026-04-20
- Short title: Harden Telegram repo-boundary and operator-doc truth checks
- Environment: `openclaw-telegram-enhanced` repository documentation and validation surface
- Severity: Medium

## Classification

- Type: governance and operator-doc hardening
- User-facing impact: Operators now get a cleaner repo-boundary map, and future README or operator-doc drift will fail validation instead of silently accumulating.

## Ownership

- Owning repo or layer: `openclaw-telegram-enhanced`
- Related repos:
  - `openclaw-runtime-distribution`
  - `platform-engineering`
  - `security-architecture`

## Root Cause

- Immediate failure: the repo README described `host-control-openclaw-plugin` like a sibling owner repo instead of as a packaged component seam owned under `openclaw-runtime-distribution`.
- Actual root cause: the repo had governance-doc validation, but no repo-local check that enforced the intended cross-repo boundary map or the required operator-command ownership markers.
- Why it escaped earlier controls: existing validators focused on change-record evidence and governance-doc structure, not on whether the README and operator command guide stayed aligned with the workspace owner model.

## Source Changes

- Repo: `openclaw-telegram-enhanced`
- Commit(s): Local worktree only
- Guardrail added:
  - `scripts/validate_repo_docs.py` now validates the README related-repo map and required operator-command markers
  - `package.json` and `AGENTS.md` now include `npm run validate:repo-docs`
  - `README.md` now describes `host-control-openclaw-plugin` as a packaged seam within `openclaw-runtime-distribution`, not as a sibling repo

## Artifact And Deployment Evidence

- Packaged artifact: None
- Related platform or release evidence: None
- Build or workflow evidence:
  - `npm run validate:repo-docs`
  - `npm run validate:governance-docs`
  - `npm run test:host-control-contract`

If not applicable, write `None`.

## Live Verification

- Validation: repo-doc, governance-doc, and host-control contract validation passed after the guardrail and README updates landed.
- Runtime or stage evidence: None
- Residual risk: This hardens the Telegram repo surface only; other owner repos still need the same repo-by-repo sweep for boundary and legacy drift.

## Follow-Up

- Required follow-up: Continue the workspace sweep in `openclaw-runtime-distribution` and the remaining owner repos so the packaged seam and runtime composition docs match the same owner model.
- Optional hardening: Add a broader workspace-level validator later if repo-boundary maps keep drifting in multiple repos.
- Owner: `openclaw-telegram-enhanced`
