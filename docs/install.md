# Install

## Purpose

This plugin is intended to ship as a normal managed OpenClaw plugin package.

## Supported Deployment Shape

1. package the plugin as a `.tgz` or publish it to npm/ClawHub
2. install it with `openclaw plugins install <path-or-spec>`
3. keep the runtime plugin id as `telegram`
4. avoid copying plugin source directly into `/app/extensions/telegram`

## Why This Is The Supported Path

OpenClaw's official plugin guidance expects publishable plugin packages with accurate manifest and `package.json` metadata.

Using `openclaw plugins install` keeps plugin provenance inside the runtime's managed install records and makes deployment reproducible for other operators.

## Current Compatibility Rule

This package must only depend on public `openclaw/plugin-sdk/*` entrypoints.

If an upstream Telegram-specific helper is not available through the public SDK:

- add or request a typed public seam upstream, or
- keep a small local helper inside this repository

Do not depend on private bundled-extension files or undocumented package paths.
