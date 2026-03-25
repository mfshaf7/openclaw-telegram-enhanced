# openclaw-telegram-enhanced

Enhanced Telegram channel override for OpenClaw.

It improves Telegram-specific delivery behavior, approval UX, and integration
hooks without carrying a broad OpenClaw core fork.

This project is a Telegram plugin override that keeps the runtime
plugin id as `telegram`, so it can deliberately override the bundled Telegram
channel plugin when explicitly installed or loaded.

It is meant for Telegram-specific UX and delivery improvements that should not
live inside OpenClaw core, for example:
- better local media delivery behavior
- Telegram-specific approval UX improvements
- shortcut intent handling
- integration hooks for plugins like `pc-control`

What this is not:
- not a host-control plugin
- not a replacement for `pc-control-bridge`
- not a generic OpenClaw core fork

## Current feature set

- override the bundled Telegram channel plugin through explicit plugin loading
- suppress duplicate approval prose when Telegram button approvals already exist
- support document-style delivery for staged local media
- provide a host screenshot shortcut integration path used by `pc-control`

## Install model

This plugin is designed to be installed as an explicit override, not as an
accidental auto-discovered shadow.

The important detail is:
- npm/package name can be `openclaw-telegram-enhanced`
- runtime plugin id stays `telegram`

That lets OpenClaw treat it as the Telegram plugin that should win over the
bundled one when the operator explicitly chooses it.

See:
- [Architecture](docs/architecture.md)
- [Install](docs/install.md)
- [Configuration](docs/configuration.md)

## Relationship to pc-control

`pc-control` is one integration, not the identity of this plugin.

The goal is:
- `openclaw-telegram-enhanced` owns Telegram-specific behavior
- `pc-control` plugs into that behavior for host screenshot/file flows
- future plugins can reuse the same Telegram enhancement layer for other use cases
