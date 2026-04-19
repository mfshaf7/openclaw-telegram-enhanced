#!/usr/bin/env python3
"""Validate README and operator-doc truth for openclaw-telegram-enhanced."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


REQUIRED_RELATED_REPOS = (
    "openclaw-host-bridge",
    "openclaw-runtime-distribution",
    "platform-engineering",
    "security-architecture",
)
FORBIDDEN_RELATED_REPO_BULLETS = (
    "- `host-control-openclaw-plugin`",
)
REQUIRED_OPERATOR_MARKERS = (
    "/platform",
    "/idea",
    "Canonical owner:",
    "platform-engineering",
    "operator-orchestration-service",
    "OPENCLAW_PLATFORM_OPERATOR_CATALOG_JSON",
    "OPERATOR_ORCHESTRATION_BASE_URL",
    "OPERATOR_ORCHESTRATION_CALLER_ID",
    "OPERATOR_ORCHESTRATION_CALLER_SECRET",
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def validate_readme(errors: list[str], repo_root: Path) -> None:
    readme_path = repo_root / "README.md"
    if not readme_path.exists():
        errors.append(f"{readme_path}: missing repo README")
        return
    text = read_text(readme_path)
    for repo_name in REQUIRED_RELATED_REPOS:
        if f"`{repo_name}`" not in text:
            errors.append(f"{readme_path}: missing related repo entry for `{repo_name}`")
    for forbidden in FORBIDDEN_RELATED_REPO_BULLETS:
        if forbidden in text:
            errors.append(
                f"{readme_path}: `host-control-openclaw-plugin` is a packaged component seam, not a sibling owner repo"
            )


def validate_operator_commands_doc(errors: list[str], repo_root: Path) -> None:
    doc_path = repo_root / "docs" / "operator-commands.md"
    if not doc_path.exists():
        errors.append(f"{doc_path}: missing operator commands doc")
        return
    text = read_text(doc_path)
    missing = [marker for marker in REQUIRED_OPERATOR_MARKERS if marker not in text]
    if missing:
        errors.append(f"{doc_path}: missing operator command markers: {', '.join(missing)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate openclaw-telegram-enhanced README and operator docs.")
    parser.add_argument(
        "--repo-root",
        default=Path(__file__).resolve().parents[1],
        type=Path,
        help="openclaw-telegram-enhanced repository root",
    )
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    errors: list[str] = []
    validate_readme(errors, repo_root)
    validate_operator_commands_doc(errors, repo_root)

    if errors:
        raise SystemExit("\n".join(errors))

    print("openclaw-telegram-enhanced repo docs valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
