#!/usr/bin/env python3
"""
Generate bcrypt password_hash for manual SQL admin insert.

Uses the `bcrypt` library (same as `app.core.passwords`).

From repo root:

  pip install -r requirements.txt
  python samples/generate_admin_password_hash.py "your-secure-password"

Prints one line: paste into migrations/manual_insert_admin.sql (replace placeholder).
Sign in with the same plaintext password (not the hash).
"""
from __future__ import annotations

import sys

import bcrypt


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print(
            "Usage: python samples/generate_admin_password_hash.py <plaintext-password>",
            file=sys.stderr,
        )
        sys.exit(1)
    password = sys.argv[1].strip()
    if len(password.encode("utf-8")) > 72:
        print(
            "Error: password longer than 72 bytes (bcrypt limit). Use a shorter password.",
            file=sys.stderr,
        )
        sys.exit(1)

    h = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
    print(h.decode())


if __name__ == "__main__":
    main()
