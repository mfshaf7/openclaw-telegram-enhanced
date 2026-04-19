---
security_evidence:
  review_areas:
    - runtime
    - ai
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-19 Idea Command Keyword Guardrails

## Summary

- change class: Telegram operator-surface guardrail fix
- user-facing impact: reserved `/idea` command keywords no longer fall through
  into raw idea capture
- operator-facing impact: incomplete or malformed command attempts now fail
  visibly instead of silently creating a bogus idea record

## Classification

- owner repo: `openclaw-telegram-enhanced`
- related repos:
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - ai

## Ownership

- Telegram command parsing, reserved-keyword rejection, and operator reply text:
  `openclaw-telegram-enhanced`
- stage overlay rollout and governed runtime rehearsal:
  `platform-engineering`
- security review authority:
  `security-architecture`

## Root Cause

The Telegram parser still allowed some reserved command prefixes such as
`decide` to fall through into free-form idea capture when the remainder of the
command was malformed. On stage that meant `/idea decide ...` could create a
new idea record instead of rejecting the operator mistake.

## Source Changes

- stopped treating malformed `/idea decide ...` requests as raw idea capture
- reserved top-level command keywords such as `decide`, `status`, and `help`
  now stay in command space instead of silently creating ideas
- added parser and Telegram-handler regression tests for the stage failure mode
- updated the Telegram operator guide to state that reserved command keywords
  are never captured as free-form ideas

## Artifact And Deployment Evidence

- governed stage rollout:
  - pending `platform-engineering` Telegram overlay candidate update

## Live Verification

- `npm run test:standalone`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- carry this parser fix through the governed stage Telegram overlay path before
  relying on the clearer rejection behavior in stage
