---
security_evidence:
  review_areas:
    - ai
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# Change Record

## Summary

- Date: 2026-04-17
- Short title: Stored model override resolution no longer crashes on missing provider values
- Environment: stage
- Severity: medium

## Classification

- Type: app/plugin source bug
- User-facing impact: Telegram turns that exercised stored model override
  resolution could fail with a `.trim` exception instead of producing a normal
  reply, creating operator noise and weakening confidence in governed stage
  rehearsal.

## Ownership

- Owning repo or layer: `openclaw-telegram-enhanced`
- Related repos: `platform-engineering`

## Root Cause

- Immediate failure: the Telegram runtime attempted to call `.trim()` on an
  undefined model-provider value while resolving stored override state.
- Actual root cause: the channel layer treated the provider field as always
  present even when the stored override record only carried a model id.
- Why it escaped earlier controls: existing tests covered stored-model override
  parameters but did not exercise the missing-provider branch seen in the live
  stage runtime.

## Source Changes

- Repo: `openclaw-telegram-enhanced`
- Commit(s): `5b90b79`
- Guardrail added:
  - hardened stored-model override resolution to tolerate missing provider
    values
  - standalone test coverage for stored-model override parameter handling

## Artifact And Deployment Evidence

- Packaged artifact: Telegram overlay source SHA `8a07f15486bd80084b68a623633af6343a6300a0`
- Related platform or release evidence:
  `platform-engineering/environments/stage/release-candidate.yaml`
- Build or workflow evidence: the fixed overlay was rehearsed on stage before
  the candidate was left pending readiness approval

## Live Verification

- Validation:
  - `npm run test:standalone`
- Runtime or stage evidence:
  - the fresh stage `Hello` turn at message `965` completed normally
  - the previous `stored model override resolution failed` / `.trim` error no
    longer appeared in fresh stage gateway logs after deployment
- Residual risk: the fix hardened the missing-provider path, but future AI and
  model-selection changes still need explicit stage rehearsal because the
  runtime remains stateful.

## Follow-Up

- Required follow-up: keep stored-model override state compatible with both
  explicit provider/model pairs and older model-only records.
- Optional hardening: add a dedicated stage smoke probe for stored-model
  override recovery after Telegram runtime upgrades.
- Owner: Telegram plugin maintainers
