---
security_evidence:
  review_areas:
    - runtime
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-18 Idea List And Status Surface

## Summary

- change class: Telegram operator-surface expansion
- user-facing impact: `/idea list` and `/idea show <idea-id>` now expose
  broker-owned idea visibility in Telegram
- operator-facing impact: idea replies now surface canonical statuses clearly
  instead of forcing operators to infer state from record references alone

## Classification

- owner repo: `openclaw-telegram-enhanced`
- related repos:
  - `operator-orchestration-service`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime

## Ownership

- Telegram command rendering and parsing: `openclaw-telegram-enhanced`
- list/read/capture semantics and stored-state truth: `operator-orchestration-service`
- runtime rollout and evidence: `platform-engineering`
- security review authority: `security-architecture`

## Root Cause

The earlier broker-owned help correction still left the `/idea` surface too thin.
Operators could capture an idea and, later, a broker client could read it, but
Telegram itself could not list existing records or show one record with its
status in a clear way.

## Source Changes

- expanded `/idea` into a thin broker-backed command family:
  - `/idea <text>`
  - `/idea list`
  - `/idea show <idea-id>`
  - `/idea help`
- switched help loading to the broker-owned `idea-command` descriptor
- made capture replies include the canonical status on the first line
- made list and show replies render broker-owned statuses and record refs

## Artifact And Deployment Evidence

- overlay rebuild and governed rollout:
  - pending `platform-engineering` stage overlay lane

## Live Verification

- `npm run test:standalone`
- `git diff --check`

## Follow-Up

- rebuild and roll the Telegram overlay through the governed stage lane
- verify `/idea help`, `/idea list`, `/idea show <idea-id>`, and `/idea <text>`
  together on stage
