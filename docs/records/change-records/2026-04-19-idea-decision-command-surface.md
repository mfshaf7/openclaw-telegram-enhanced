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

# 2026-04-19 Idea Decision Command Surface

## Summary

- change class: Telegram operator-surface expansion
- user-facing impact: `/idea` now supports the first bounded durable decision
  step for triaged ideas
- operator-facing impact: phone-only operators can park, accept, or reject a
  triaged record without leaving Telegram

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

- Telegram command parsing, rendering, and placeholder handling:
  `openclaw-telegram-enhanced`
- decision workflow truth and canonical record writes:
  `operator-orchestration-service`
- runtime rollout and local dev-integration lane:
  `platform-engineering`
- security review authority:
  `security-architecture`

## Root Cause

Telegram already exposed capture, triage, list, and show flows, but there was
no phone-friendly durable decision step after triage. That forced operators to
hold later outcomes in chat memory or leave the Telegram surface for manual
backlog edits.

## Source Changes

- added thin Telegram adapter support for
  `/idea decide <idea-id> <parked|accepted|rejected> <notes>`
- kept the reserved `/idea triage discuss <idea-id>` path explicitly
  not-implemented instead of inventing Telegram-local AI behavior
- updated `/idea show` rendering so stored operator decision notes are visible
  to the operator
- updated the Telegram operator docs and configuration guide for the new
  decision surface

## Artifact And Deployment Evidence

- overlay rebuild and governed rollout:
  - pending `platform-engineering` stage overlay lane

## Live Verification

- `npm run test:standalone`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`
- local `dev-integration` proof through the real Telegram command simulator:
  - `/idea decide idea-37 parked <notes>`
  - `/idea list status parked`
  - `/idea show idea-37`

## Follow-Up

- keep `owner-assigned` deferred until the owner vocabulary is explicit
- keep AI-assisted discussion broker-owned when it is later implemented
