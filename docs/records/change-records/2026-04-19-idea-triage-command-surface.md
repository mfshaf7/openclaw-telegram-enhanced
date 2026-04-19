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

# 2026-04-19 Idea Triage Command Surface

## Summary

- change class: Telegram operator-surface expansion
- user-facing impact: `/idea` now supports operator-authored triage from
  Telegram, and `/idea show` now renders the stored triage summary when present
- operator-facing impact: phone-only operators can move captured records into
  `triaged` without waiting for a desktop Codex session

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
- triage workflow truth and canonical record writes:
  `operator-orchestration-service`
- runtime rollout and local dev-integration lane:
  `platform-engineering`
- security review authority:
  `security-architecture`

## Root Cause

Telegram already exposed broker-owned capture, list, and read flows, but it had
no phone-friendly triage command. That forced operators to leave the Telegram
surface for the first durable framing step even though the approved workflow
semantics did not actually require AI assistance.

## Source Changes

- added thin Telegram adapter support for `/idea triage <idea-id> <summary>`
- reserved `/idea triage discuss <idea-id>` as an explicit not-implemented
  placeholder instead of inventing Telegram-local AI behavior
- updated `/idea show` rendering so stored triage summaries are visible to the
  operator
- updated the Telegram operator docs and configuration guide for the new triage
  surface

## Artifact And Deployment Evidence

- overlay rebuild and governed rollout:
  - pending `platform-engineering` stage overlay lane

## Live Verification

- `npm run test:standalone`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `git diff --check`
- local `dev-integration` proof through the real Telegram command simulator:
  - `/idea list status captured`
  - `/idea triage idea-37 <summary>`
  - `/idea list status triaged`
  - `/idea show idea-37`
  - `/idea triage discuss idea-37`

## Follow-Up

- keep AI-assisted discussion broker-owned when it is later implemented
- add decision-path rendering once the broker exposes the later decision
  workflow
