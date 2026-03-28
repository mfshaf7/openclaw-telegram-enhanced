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

## What Should Stay Out Of This Plugin

- host path policy
- bridge secrets
- Windows-specific assumptions
- domain-specific logic that belongs in another plugin

## Design Rule

This plugin should stay Telegram-specific. If a feature is really about host policy or bridge behavior, it belongs outside this repo.
