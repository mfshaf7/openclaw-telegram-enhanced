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

# 2026-04-18 Idea Command Usage Guidance

## Summary

- change class: Telegram operator-surface usability fix
- user-facing impact: `/idea` now exposes a real in-band usage guide instead of only a terse missing-argument error
- operator-facing impact: stage users can ask `/idea help` and get examples without hitting the broker

## Classification

- owner repo: `openclaw-telegram-enhanced`
- related repos:
  - `operator-orchestration-service`
  - `platform-engineering`
- trust-boundary areas:
  - runtime

## Ownership

- Telegram command UX and operator guidance: `openclaw-telegram-enhanced`
- broker workflow and OpenProject persistence: `operator-orchestration-service`
- stage rollout and evidence: `platform-engineering`

## Root Cause

The first live `/idea` capture path worked, but the command was still too thin
for real operator use. A bare missing-argument error did not give enough
instruction on what belongs in the command, how to ask for help, or what good
input looks like from the Telegram surface itself.

## Source Changes

- added a reusable `/idea` usage guide
- added explicit `/idea help` handling that returns guidance locally
- changed empty `/idea` input to return guidance instead of a terse error
- added tests that prove help stays local and does not call the broker
- documented the in-band guidance path in the Telegram configuration contract
- fixed the governance-doc workflow so CI installs `pyyaml` before running the validator

## Artifact And Deployment Evidence

- build and stage evidence:
  - pending governed Telegram overlay rebuild and stage rehearsal

## Live Verification

- repo-local validation:
  - `npm run test:standalone`
  - `npm run validate:governance-docs`
  - `npm run validate:change-record-requirement`
  - `git diff --check`
  - attempted `npm exec vitest run src/bot-native-commands.idea-capture.test.ts`
    against the broader native-command integration surface, but this checkout
    still lacks the upstream OpenClaw SDK module path that test expects
- stage verification:
  - pending one real `/idea help` and `/idea <text>` check after rollout

## Follow-Up

- carry the command-guidance fix through the governed Telegram stage lane
- update the stage evidence record only after the help path is proven live
