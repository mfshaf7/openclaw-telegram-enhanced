# openclaw-telegram-enhanced

Enhanced Telegram channel replacement for OpenClaw.

It improves Telegram-specific delivery behavior, approval UX, and integration
hooks without carrying a broad OpenClaw core fork.

This project provides a Telegram plugin implementation that keeps the runtime
plugin id as `telegram`, so it can replace the bundled Telegram channel plugin
through the supported bundled-plugin seam.

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

- replace the bundled Telegram channel plugin through the bundled plugin tree
- suppress duplicate approval prose when Telegram button approvals already exist
- support document-style delivery for staged local media
- provide a host screenshot shortcut integration path used by `pc-control`

## Install model

The supported production model is:

- keep runtime plugin id as `telegram`
- ship this plugin inside the bundled plugins tree used by the OpenClaw image
- replace the bundled `telegram` directory in the image or point
  `OPENCLAW_BUNDLED_PLUGINS_DIR` at a full replacement bundled tree
- do not rely on `plugins.load.paths` to shadow the bundled Telegram plugin in production

The package name also needs to stay compatible with the manifest id to avoid
loader warnings. For that reason the package name is `telegram-plugin`, while
the repository/project name can stay `openclaw-telegram-enhanced`.

Development note:

- a config-path or linked-path load can still be useful for short-lived local
  experiments
- it is not the supported long-lived deployment path for this repository
- the production target remains one bundled `telegram` plugin candidate in the
  image, not a duplicate-id override at runtime

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
