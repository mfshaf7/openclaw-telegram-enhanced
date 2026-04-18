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

# 2026-04-18 Idea Capture Broker Command

## Summary

- change class: Telegram operator-surface extension
- user-facing impact: adds a bounded `/idea` command for operator-side idea capture
- operator-facing impact: Telegram now forwards capture requests to `operator-orchestration-service` instead of trying to write backlog records itself

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

- Telegram command UX and transport handling: `openclaw-telegram-enhanced`
- workflow orchestration and OpenProject writes: `operator-orchestration-service`
- runtime wiring and caller secret delivery: `platform-engineering`
- security review: `security-architecture`

## Root Cause

The workspace needed idea capture where ideas naturally occur, but implementing backlog writes directly in the Telegram plugin would have made the fast-changing channel repo own workflow orchestration and backend credential flows it should not own.

## Source Changes

- added a thin `/idea` local command
- added a broker-calling helper module for bounded idea capture
- kept OpenProject and workflow logic outside this repo
- documented the broker-wired operator-command contract

## Artifact And Deployment Evidence

- build workflow run:
  - pending governed Telegram runtime build after merge
- published artifact:
  - pending
- deployment owner:
  - `platform-engineering`

## Live Verification

- repo-local validation:
  - pending in this source change set
- stage verification:
  - pending stage Telegram `/idea` capture rehearsal against the broker runtime

## Follow-Up

- wire the stage gateway env vars and caller secret through `platform-engineering`
- verify one real stage `/idea` capture into OpenProject
- keep triage and decision workflows outside the Telegram repo
