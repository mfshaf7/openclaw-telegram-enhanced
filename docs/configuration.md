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
- Windows-specific assumptions
- domain-specific logic that belongs in another plugin

## Design Rule

This plugin should stay Telegram-specific. If a feature is really about host policy or bridge behavior, it belongs outside this repo.
