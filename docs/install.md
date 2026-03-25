# Install

This plugin is intended to override the bundled Telegram plugin explicitly.

## Recommended install shape

1. Install the plugin into OpenClaw extensions state.
2. Add an explicit `plugins.load.paths` entry for this plugin.
3. Keep `plugins.allow` pinned.
4. Let the runtime load this plugin as `telegram`.

## Why explicit install matters

OpenClaw lets bundled plugins beat auto-discovered duplicates by default.

So the clean operator model is:
- explicit install or explicit load path
- explicit allowlist
- intentional override

## Example config shape

```json
{
  "plugins": {
    "allow": ["telegram", "pc-control"],
    "load": {
      "paths": [
        "/home/node/.openclaw/extensions/telegram"
      ]
    }
  }
}
```

## Notes

- The plugin id remains `telegram`.
- The package name can still be `openclaw-telegram-enhanced`.
- Some OpenClaw diagnostics may warn about package-name-vs-plugin-id mismatch.
  That is expected for an override plugin with a distinct publishable package name.

## Dependency note

Because this is a channel plugin override, it needs Telegram runtime
dependencies available at load time.

In local/state-based deployments, that usually means one of:
- install the package normally so dependencies are staged with it
- link it in development with a real `node_modules`
- or share dependency resolution from the OpenClaw runtime image
