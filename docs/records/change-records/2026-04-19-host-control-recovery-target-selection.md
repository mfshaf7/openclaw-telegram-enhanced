---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings:
    - F-019
  risks:
    - R-019
  workstreams:
    - WS-019
---

# Change Record

## Summary

- Date: 2026-04-19
- Short title: Preserve explicit host-control recovery targeting in the Telegram layer
- Environment: OpenClaw Telegram host-control recovery adapter
- Severity: High

## Classification

- Type: adapter contract hardening
- User-facing impact: Telegram-triggered host-control recovery now carries the explicit bridge target instead of relying on ambiguous host-side defaults.

## Ownership

- Owning repo or layer: `openclaw-telegram-enhanced`
- Related repos:
  - `openclaw-host-bridge`
  - `platform-engineering`

## Root Cause

- Immediate failure: stage and prod currently share the same recovery token, so the host recovery service needed an explicit target to avoid defaulting to the wrong profile.
- Actual root cause: the Telegram layer derived the recovery URL from the bridge config but did not previously preserve the intended target profile as part of the recovery request contract.
- Why it escaped earlier controls: the host-control contract test covered router behavior and callbacks, but it did not assert recovery payload targeting or diagnostics text.

## Source Changes

- Repo: `openclaw-telegram-enhanced`
- Commit(s): Local worktree only
- Guardrail added:
  - exported helper coverage for recovery target derivation and payload building
  - host-control contract tests for explicit recovery targeting
  - README note clarifying why the target profile must be preserved

## Artifact And Deployment Evidence

- Packaged artifact: None
- Related platform or release evidence: None
- Build or workflow evidence: `npm run test:host-control-contract`

If not applicable, write `None`.

## Live Verification

- Validation: `npm run test:host-control-contract` passed after the new recovery-target assertions were added.
- Runtime or stage evidence: The caller now emits `targetProfile` and `bridgeUrl`, which matches the hardened host-recovery selector contract.
- Residual risk: If another caller bypasses the Telegram adapter and omits the target profile, the host side now rejects the request instead of guessing.

## Follow-Up

- Required follow-up: Carry the updated Telegram runtime through the governed image path before treating the new recovery contract as deployed.
- Optional hardening: Add a bundled runtime smoke that asserts stage-targeted recovery payloads survive packaging.
- Owner: `openclaw-telegram-enhanced`
