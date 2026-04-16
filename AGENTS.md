# openclaw-telegram-enhanced Agent Notes

This repository is the canonical Telegram channel plugin source for this
workspace.

## What This Repo Owns

- Telegram delivery shaping
- button-driven approval UX
- staged and local media delivery behavior
- deterministic Telegram-side routing helpers
- Telegram integration hooks for domain plugins

It does not own host policy, bridge enforcement, or environment promotion.

## Read First

- `README.md`
- `docs/architecture.md`
- `docs/install.md`
- `docs/configuration.md`

## Working Rules

- Keep Telegram behavior at the channel layer; do not push Telegram-specific UX
  decisions down into host-bridge or platform repos.
- If bundled runtime behavior is patched live, backport it here and then carry
  it through the governed build path.
- Treat approval flows, callback handling, and media send behavior as
  real-operator paths that need stage verification, not just unit tests.

## Validation

- `npm run test:standalone`
- `npm run test:bundle` when bundled/integration seams changed
- `npm pack` when packaging metadata matters
