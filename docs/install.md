# Install

## Purpose

This plugin is intended to replace the bundled OpenClaw Telegram plugin through the bundled-plugin seam.

## Supported Deployment Shape

1. build a custom OpenClaw image
2. replace the bundled `/app/extensions/telegram` directory with this plugin
3. keep the runtime plugin id as `telegram`

## Why This Is The Supported Path

`telegram` is a built-in channel id.

If you try to load another `telegram` plugin through generic plugin path overrides, the runtime treats that as a duplicate-id override.

Replacing the bundled plugin instead gives the runtime exactly one `telegram` plugin candidate.

## Example Runtime Shape

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

- runtime plugin id remains `telegram`
- repository name can still be `openclaw-telegram-enhanced`
- short-lived dev experimentation can still use local override paths, but that is not the preferred long-lived deployment path
