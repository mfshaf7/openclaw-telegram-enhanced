---
security_evidence:
  review_areas:
    - ai
    - runtime
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-18 Idea Command Lifecycle And Table Rendering

## Summary

The Telegram `/idea` surface now renders broker-owned lifecycle guidance more
clearly, adds `/idea list all`, and switches help, list, and show replies to a
cleaner table-style presentation.

## Classification

- owner repo: `openclaw-telegram-enhanced`
- related repos:
  - `operator-orchestration-service`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - ai

## Ownership

- Telegram command parsing and rendering: `openclaw-telegram-enhanced`
- lifecycle truth and command semantics: `operator-orchestration-service`
- runtime rollout and evidence: `platform-engineering`
- security review authority: `security-architecture`

## Root Cause

The broker already owned the `/idea` workflow truth, but the Telegram surface
still rendered that information too loosely. Operators could not see the full
status model in help, and list/show replies did not present stored state
cleanly enough for routine use.

## Source Changes

- added `/idea list all` by stitching broker pagination in the Telegram adapter
- switched `/idea help` to render broker lifecycle statuses and command surface
  in table-style blocks
- switched `/idea list` and `/idea show <idea-id>` to cleaner table-style
  layouts
- updated capture replies to point operators back to the richer read surfaces

## Artifact And Deployment Evidence

- Telegram overlay rebuild and governed stage rollout:
  - pending `platform-engineering` stage overlay lane

## Live Verification

- `npm run test:standalone`
- `git diff --check`

## Follow-Up

- rebuild and roll the Telegram overlay through the governed stage lane
- verify `/idea help`, `/idea list`, `/idea list all`, `/idea show <idea-id>`,
  and `/idea <text>` together on stage
