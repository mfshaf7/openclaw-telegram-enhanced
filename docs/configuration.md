# Configuration

The current runtime code is still early-stage and not all of these knobs are
implemented yet. This document defines the intended long-term configuration
surface.

## Core plugin config

Suggested shape:

```json
{
  "plugins": {
    "entries": {
      "telegram": {
        "config": {
          "enhancedDelivery": {
            "forceDocumentForLocalImages": true
          },
          "execApprovals": {
            "suppressFallbackTextWhenButtonsExist": true
          },
          "shortcutIntents": {
            "enabled": true
          },
          "integrations": {
            "pcControl": {
              "enabled": true,
              "pluginId": "pc-control"
            }
          }
        }
      }
    }
  }
}
```

## Intended configurable areas

- delivery policy
  - send certain media as document instead of photo
  - local staged media handling
- approval UX
  - hide duplicate prose when Telegram button flow already exists
- shortcut intents
  - map certain Telegram phrasing to registered integrations
- integration bindings
  - let another plugin claim a shortcut behavior without hardcoding all logic here

## What should stay out of config

- machine-specific host paths
- bridge secrets
- Windows-only assumptions
- hardcoded `pc-control` behavior as the only supported integration
