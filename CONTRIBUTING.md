# Contributing

## Scope

Keep this repo focused on Telegram-specific runtime behavior for OpenClaw.
Do not add host-control logic, bridge security policy, or machine-specific paths
here unless they are part of a documented integration boundary.

## Principles

- Prefer Telegram-layer behavior over OpenClaw core patches.
- Keep plugin id `telegram` for intentional override behavior.
- Keep package naming and repo naming distinct from the runtime plugin id.
- Avoid hardcoding machine-specific paths, accounts, or secrets.
- Keep integrations optional and config-driven where possible.

## Changes

When adding a feature:
- document whether it is Telegram-generic or integration-specific
- add or update tests for the behavior
- keep `README.md` and `docs/` aligned with the actual implementation

## Testing

Run the relevant plugin tests before release. At minimum, verify:
- plugin loads as `telegram`
- media delivery still works
- approval UX still works
- configured integrations still load cleanly
