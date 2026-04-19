# Telegram Operator Commands

This is the primary operator-facing guide for Telegram-native operator commands
owned by `openclaw-telegram-enhanced`.

Use it when you need to know:

- which Telegram operator command families this repo exposes
- what each command is for
- which system owns the underlying truth
- where to go when the command depends on another repo's contract

Do not reconstruct this from source files. The implementation remains the
executable contract, but this document is the primary operator path.

## What This Repo Actually Owns

This repo owns the Telegram command UX and rendering for:

- `/platform`
- `/idea`

It does not own the canonical backend truth behind those commands:

- `/platform`
  - renders platform-owned inventory, health, and governance notes
  - canonical truth stays in `platform-engineering`
- `/idea`
  - acts as a thin Telegram adapter for broker-owned idea workflows
  - canonical workflow truth stays in `operator-orchestration-service`

## `/platform`

Purpose:

- show read-only platform troubleshooting inventory
- show component-specific endpoints and health checks
- show governance notes for the current runtime

Supported commands:

- `/platform`
  - overview summary
- `/platform endpoints`
  - operator URLs, WSL fallbacks, and credential sources by surface
- `/platform health`
  - health checks and troubleshooting notes by surface
- `/platform govern`
  - governance notes plus current runtime summary
- `/platform <component>`
  - one named platform surface from the configured catalog

Runtime dependency:

- `OPENCLAW_PLATFORM_OPERATOR_CATALOG_JSON`

If that catalog is missing, `/platform` will reply with a configuration error.
That is a runtime wiring issue, not a Telegram UX issue.

Canonical owner:

- `platform-engineering`

## `/idea`

Purpose:

- capture and inspect operator idea records through the broker

Supported commands:

- `/idea <text>`
  - create a new idea record through the broker
  - reserved command keywords are not captured as free-form idea text; malformed
    command attempts such as `/idea decide ...` or `/idea status ...` must fail
    visibly instead of silently creating a new record
- `/idea triage <idea-id> <summary>`
  - record operator-authored framing for an existing captured idea
  - move it into `triaged` without requiring desktop Codex access
- `/idea decide <idea-id> <parked|accepted|rejected> <notes>`
  - record the first bounded durable outcome for a triaged idea
  - stores operator decision notes on the canonical record
  - does not expose `owner-assigned` yet
- `/idea triage discuss <idea-id>`
  - reserved placeholder for a future AI-assisted discussion path
  - currently returns a not-implemented message and does not call the broker
- `/idea help`
  - show the broker-owned workflow guidance and lifecycle statuses
- `/idea list`
  - show the recent bounded idea slice
- `/idea list all`
  - show the full stored idea backlog through broker pagination
- `/idea list status <status>`
  - show the recent bounded idea slice filtered by one canonical lifecycle
    status such as `captured` or `parked`
- `/idea list all status <status>`
  - show the full stored idea backlog filtered by one canonical lifecycle
    status
- `/idea show <idea-id>`
  - show one stored idea record by canonical broker idea id such as
    `idea-41`
  - includes the stored triage summary when the record has already been
    triaged
  - includes stored operator decision notes when the record has already been
    decided
  - includes internal evaluation metadata when the broker has already
    populated it

Runtime dependencies:

- `OPERATOR_ORCHESTRATION_BASE_URL`
- `OPERATOR_ORCHESTRATION_CALLER_ID`
- `OPERATOR_ORCHESTRATION_CALLER_SECRET`

Canonical owner:

- `operator-orchestration-service`

The Telegram plugin must stay a thin adapter here:

- no OpenProject credentials
- no backlog workflow logic
- no Telegram-local fallback truth for broker-owned help semantics
- no Telegram-local AI triage logic

## Troubleshooting Boundary

If the command text or rendering is wrong:

- fix it in `openclaw-telegram-enhanced`

If the command loads the wrong workflow truth:

- `/platform`
  - inspect `platform-engineering`
- `/idea`
  - inspect `operator-orchestration-service`

If the command fails because the runtime wiring is missing:

- treat it as deployment/runtime composition work, not channel UX ownership

## Related Operator Docs

- [configuration.md](configuration.md)
- [install.md](install.md)
- [`platform-engineering/docs/runbooks/dev-integration-profiles.md`](https://github.com/mfshaf7/platform-engineering/blob/main/docs/runbooks/dev-integration-profiles.md)
