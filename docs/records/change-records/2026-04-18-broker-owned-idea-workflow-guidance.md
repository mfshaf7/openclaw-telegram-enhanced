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

# 2026-04-18 Broker-Owned Idea Workflow Guidance

## Summary

- change class: Telegram adapter contract correction
- user-facing impact: `/idea help` and empty `/idea` now depend on broker-owned workflow guidance instead of Telegram-local instructions
- operator-facing impact: the Telegram surface no longer invents canonical `/idea` semantics and stays a thin renderer over broker-owned workflow descriptors

## Classification

- owner repo: `openclaw-telegram-enhanced`
- related repos:
  - `operator-orchestration-service`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime

## Ownership

- Telegram rendering and invocation mechanics: `openclaw-telegram-enhanced`
- workflow guidance semantics and read projection: `operator-orchestration-service`
- stage rollout and evidence: `platform-engineering`
- security review authority: `security-architecture`

## Root Cause

The earlier `/idea help` fix solved immediate usability, but it put canonical
workflow guidance in the Telegram repo. That was the wrong trust boundary and
the wrong scalability model because future intake surfaces should consume one
broker-owned workflow contract rather than copy Telegram-local instructions.

## Source Changes

- removed Telegram-local `/idea` guidance ownership
- made `/idea help` and empty `/idea` fetch the broker-owned `idea-capture`
  workflow descriptor
- kept Telegram responsible only for formatting the returned workflow semantics
- updated capture requests to use the normalized broker source model
- replaced tests that proved local help with tests that prove broker-owned help

## Artifact And Deployment Evidence

- build and stage evidence:
  - pending governed Telegram overlay rebuild and stage rehearsal

## Live Verification

- repo-local validation:
  - `npm run test:standalone`
  - `npm run validate:governance-docs`
  - `npm run validate:change-record-requirement`
  - `git diff --check`
- broader native-command integration coverage:
  - the repo-local focused tests cover the broker-owned guidance path, but the
    broader OpenClaw-native integration test surface in this checkout still
    depends on upstream SDK module paths that are not present here

## Follow-Up

- rebuild and deploy the corrected overlay through the governed stage lane
- verify `/idea help` on stage now fails closed if the broker is unavailable
- verify `/idea help` and `/idea <text>` both succeed against the new broker
  contract before calling the lane complete
