# Architecture

`openclaw-telegram-enhanced` is a Telegram channel replacement plugin for OpenClaw.

## Design goal

Keep Telegram-specific behavior outside OpenClaw core while still letting the
runtime replace the bundled Telegram plugin intentionally through the bundled
plugin tree.

## Key idea

- package name: compatible with the `telegram` manifest id
- runtime plugin id: still `telegram`

That split matters because OpenClaw resolves plugin precedence by plugin id.
To replace the bundled Telegram plugin cleanly, this plugin must still register
as `telegram` and must not be loaded as a second config-path duplicate.

In this repository the package name is `@mfshaf7/telegram-plugin`, while the
runtime plugin id remains `telegram`.

## Boundaries

This plugin should own:
- Telegram delivery behavior
- Telegram approval UX behavior
- Telegram-native shortcut routing
- Telegram-specific local media handling

This plugin should not own:
- host-control logic
- bridge security policy
- Windows-specific execution
- generic OpenClaw reply/core behavior

## Integration model

General pattern:
- `openclaw-telegram-enhanced` handles Telegram-specific transport concerns
- domain plugins provide the actual business logic

Example:
- `pc-control` provides typed host tools
- this plugin provides Telegram-side screenshot/document delivery behavior

## Why this is cleaner than patching core

- update surface is smaller
- behavior is versionable as a plugin
- the replacement lives on the supported bundled-plugin seam
- repo boundary is clearer
- OpenClaw base can stay close to upstream
