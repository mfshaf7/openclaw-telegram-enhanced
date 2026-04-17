# Change Records

This directory stores short evidence records for security-significant or
production-impacting source changes in `openclaw-telegram-enhanced`.

These are not design ADRs and not full incident diaries. They are structured
completion records that answer:

- what changed
- why it mattered
- which repo owned the fix
- what validation or live evidence proved the outcome
- which security workstream or review area the change belonged to

When a change should feed `security-architecture` automation, include optional
`security_evidence` YAML front matter. The generated
`security-change-record-index.yaml` in `security-architecture` consumes that
metadata directly.

Start from [TEMPLATE.md](TEMPLATE.md).
