# openclaw-telegram-enhanced Agent Notes

This repository is the canonical Telegram channel plugin source for this
workspace.

## What This Repo Owns

- Telegram delivery shaping
- button-driven approval UX
- staged and local media delivery behavior
- deterministic Telegram-side routing helpers
- Telegram integration hooks for domain plugins
- read-only Telegram-native operator commands such as `/platform`

It does not own host policy, bridge enforcement, or environment promotion.

## Read First

- `README.md`
- `docs/architecture.md`
- `docs/install.md`
- `docs/configuration.md`
- `security-architecture/docs/architecture/components/openclaw-telegram-channel/README.md`
- `security-architecture/docs/architecture/products/openclaw/data-flow-and-boundaries.md`
- `security-architecture/docs/architecture/domains/ai-and-agentic.md`
- `security-architecture/docs/reviews/security-review-checklist.md`
- `security-architecture/docs/reviews/components/README.md`

## Working Rules

- Keep Telegram behavior at the channel layer; do not push Telegram-specific UX
  decisions down into host-bridge or platform repos.
- Keep platform inventory truth in `platform-engineering`; Telegram may render
  it, but should not become the canonical owner of endpoints, health checks, or
  operator URLs.
- If bundled runtime behavior is patched live, backport it here and then carry
  it through the governed build path.
- Treat approval flows, callback handling, and media send behavior as
  real-operator paths that need stage verification, not just unit tests.

## Validation

- `npm run test:standalone`
- `npm run test:bundle` when bundled/integration seams changed
- `npm pack` when packaging metadata matters
