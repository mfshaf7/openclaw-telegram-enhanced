# Configuration

## Purpose

This document describes the configuration areas this Telegram replacement should own.

## Intended Areas

- delivery policy
  - whether certain local media should be sent as document vs photo
- approval UX
  - whether button flows suppress duplicate prose
- shortcut routing
  - Telegram-specific shortcuts that should resolve to integrations
- integration bindings
  - opt-in hooks for domain plugins such as `host-control`
- read-only operator surfaces
  - Telegram-native command views that present platform-owned troubleshooting
    inventory without exposing mutating controls or secrets
  - thin operator workflow capture commands that forward bounded requests to a
    separate broker service

## Startup Backlog Control

When two Telegram bots intentionally share the same group or topic surface across
stage and prod, the startup policy matters as much as the routing policy.

By default, the polling runtime preserves pending Telegram updates on startup.
That means a bot that comes online later can drain buffered shared-group traffic
that was posted while it was offline.

If an environment should come online cleanly instead of replaying buffered
updates, set:

- `OPENCLAW_TELEGRAM_DROP_PENDING_UPDATES_ON_STARTUP=1`

This drops pending Telegram updates once during polling startup before the bot
begins serving live traffic. Internal polling retries after startup still keep
pending updates, so transient restarts do not silently discard live messages.

## What Should Stay Out Of This Plugin

- host path policy
- bridge secrets
- OpenProject API tokens
- workflow orchestration or backlog status logic
- Windows-specific assumptions
- domain-specific logic that belongs in another plugin

## Broker-Wired Operator Commands

Operator workflow capture commands may exist here only as thin adapters.

Current phase-1 contract:

- `/idea <text>`
  - captures the idea through `operator-orchestration-service`
  - does not hold OpenProject credentials
  - does not perform backlog workflow logic locally
- `/idea help`
  - loads the canonical `idea-capture` workflow descriptor from `operator-orchestration-service`
  - renders broker-owned semantics into Telegram-friendly text
  - must not fall back to Telegram-local workflow truth if the broker is unavailable

Expected runtime env vars for the thin adapter:

- `OPERATOR_ORCHESTRATION_BASE_URL`
- `OPERATOR_ORCHESTRATION_CALLER_ID`
- `OPERATOR_ORCHESTRATION_CALLER_SECRET`

## Design Rule

This plugin should stay Telegram-specific. If a feature is really about host policy or bridge behavior, it belongs outside this repo.
