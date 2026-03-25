# Install

This plugin is intended to replace the bundled Telegram plugin through the
supported bundled-plugin seam.

## Recommended production install shape

1. Build a custom OpenClaw image that replaces `/app/extensions/telegram`
   with this plugin.
2. Keep the runtime plugin id as `telegram`.
3. Keep `plugins.allow` pinned if you use an allowlist.
4. Enable the Telegram channel normally through `channels.telegram.enabled`.

## Why this is the supported clean path

OpenClaw treats built-in channel ids as bundled plugins first.

If you load another `telegram` plugin through `plugins.load.paths`, the loader
will intentionally treat that as a duplicate-id override and emit warnings.

If you replace the bundled `telegram` plugin inside the bundled plugin tree
instead, there is only one `telegram` plugin candidate and the duplicate-id
warning goes away.

## Example config shape

```json
{
  "channels": {
    "telegram": {
      "enabled": true
    }
  },
  "plugins": {
    "allow": ["telegram", "pc-control"]
  }
}
```

## Notes

- The plugin id remains `telegram`.
- The repository/project name can still be `openclaw-telegram-enhanced`.
- The package name should stay compatible with the plugin id to avoid loader
  mismatch warnings. In this repository the package name is
  `@mfshaf7/telegram-plugin`.
- `plugins.load.paths` is only for short-lived development and local debugging.
  Do not treat it as the supported steady-state deployment path for a built-in
  channel replacement.
- The clean production result is exactly one runtime `telegram` plugin source:
  the bundled replacement in the image.

## Dependency note

Because this is a bundled channel replacement, it needs Telegram runtime
dependencies available at load time.

In the recommended image-based deployment, those dependencies come from the
OpenClaw runtime image and the replacement plugin directory you copy into the
bundled plugins tree.
