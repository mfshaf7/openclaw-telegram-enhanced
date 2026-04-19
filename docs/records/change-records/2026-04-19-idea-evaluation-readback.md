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

# 2026-04-19 Idea Evaluation Readback

## Summary

- change class: Telegram read-surface enhancement
- user-facing impact: `/idea show` now renders stored internal evaluation
  metadata when the broker has populated it
- operator-facing impact: later AI-written owner and scope analysis can be read
  back from Telegram without exposing a Telegram-local write command

## Classification

- owner repo: `openclaw-telegram-enhanced`
- related repos:
  - `operator-orchestration-service`
  - `workspace-governance`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - ai

## Ownership

- Telegram formatting and readback rendering:
  `openclaw-telegram-enhanced`
- internal evaluation metadata truth and writes:
  `operator-orchestration-service`
- canonical workspace vocabulary source:
  `workspace-governance`
- backlog field model:
  `platform-engineering`
- security review authority:
  `security-architecture`

## Root Cause

Even after the backlog gained internal evaluation metadata, operators would not
benefit from it if Telegram could not show what had been populated later from a
manual Codex session or a future AI-assisted evaluation path.

## Source Changes

- extended `/idea show` rendering to include internal evaluation metadata when
  present
- kept the Telegram command surface read-only for this metadata slice
- updated Telegram operator docs and configuration guidance so the readback
  behavior is explicit

## Artifact And Deployment Evidence

- overlay rebuild and governed rollout:
  - pending `platform-engineering` stage overlay lane

## Live Verification

- `npm run test:standalone`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`
- local `dev-integration` proof through the real Telegram command simulator:
  - `/idea show idea-37`

## Follow-Up

- keep internal evaluation metadata broker-owned when later AI-assisted
  population is enabled
