# Architecture

`openclaw-telegram-enhanced` is a Telegram channel override plugin for OpenClaw.

## Design goal

Keep Telegram-specific behavior outside OpenClaw core while still letting the
runtime replace the bundled Telegram plugin intentionally.

## Key idea

- package name: distinct from the bundled plugin
- runtime plugin id: still `telegram`

That split matters because OpenClaw resolves plugin precedence by plugin id.
To override the bundled Telegram plugin cleanly, this plugin must still register
as `telegram`.

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
- the override is explicit in config
- repo boundary is clearer
- OpenClaw base can stay close to upstream
