#!/usr/bin/env python3
"""
Fetch job URLs from a Google Sheet and split them into Manual JD autofill support files.

Reads:
  - settings.txt          (spreadsheet id, worksheet, start row, columns)
  - support-url-types.txt (Greenhouse / Ashby / Workable URL patterns)

Writes:
  - output/manualJD-support.json
  - output/manualJD-non-support.json

Requires a Google service account JSON with access to the spreadsheet (Editor).
Set service_account_json in settings.txt or GOOGLE_SERVICE_ACCOUNT_JSON env var.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

SCRIPT_DIR = Path(__file__).resolve().parent
SETTINGS_PATH = SCRIPT_DIR / "settings.txt"
SUPPORT_TYPES_PATH = SCRIPT_DIR / "support-url-types.txt"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]


def load_settings(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        raise FileNotFoundError(f"Missing settings file: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        out[key.strip()] = val.strip()
    return out


def col_letter_to_index(letter: str) -> int:
    """Convert column letter (A, F, AA) to 0-based index."""
    s = (letter or "").strip().upper()
    if not s:
        raise ValueError("Empty column letter")
    n = 0
    for ch in s:
        if not ("A" <= ch <= "Z"):
            raise ValueError(f"Invalid column letter: {letter!r}")
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1


def load_support_rules(path: Path) -> list[tuple[str, str, re.Pattern[str] | None]]:
    """
    Returns list of (board, kind, pattern).
    kind is 'substr' or 'regex'.
    For substr, pattern is None and board is used with substring stored separately.
    """
    rules: list[tuple[str, str, re.Pattern[str] | None, str]] = []
    if not path.exists():
        raise FileNotFoundError(f"Missing support-url-types file: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("regex:"):
            _, board, pat = line.split(":", 2)
            rules.append((board.strip().lower(), "regex", re.compile(pat.strip(), re.I), pat.strip()))
        else:
            board, substr = line.split(":", 1)
            rules.append((board.strip().lower(), "substr", None, substr.strip().lower()))
    return rules


def classify_url(url: str, rules: list) -> tuple[bool, str | None]:
    u = (url or "").strip()
    if not u:
        return False, None
    low = u.lower()
    for board, kind, compiled, substr in rules:
        if kind == "regex" and compiled and compiled.search(u):
            return True, board
        if kind == "substr" and substr and substr in low:
            return True, board
    return False, None


def normalize_url(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith("http://") or s.startswith("https://"):
        return s
    if s.startswith("www."):
        return f"https://{s}"
    # e.g. indeed.com/... without scheme
    if "." in s.split("/")[0]:
        return f"https://{s}"
    return s


def load_service_account_info(settings: dict[str, str]) -> dict:
    env_json = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
    if env_json:
        return json.loads(env_json)
    rel = settings.get("service_account_json", "service_account.json")
    path = Path(rel)
    if not path.is_absolute():
        path = SCRIPT_DIR / path
    if not path.exists():
        raise FileNotFoundError(
            f"Service account JSON not found: {path}\n"
            "Download a key from Google Cloud Console or set GOOGLE_SERVICE_ACCOUNT_JSON."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def cell(row: list[str], col_letter: str | None) -> str:
    if not col_letter:
        return ""
    idx = col_letter_to_index(col_letter)
    if idx < 0 or idx >= len(row):
        return ""
    return str(row[idx] or "").strip()


def main() -> int:
    settings = load_settings(SETTINGS_PATH)
    rules = load_support_rules(SUPPORT_TYPES_PATH)

    spreadsheet_id = settings.get("spreadsheet_id", "")
    worksheet_name = settings.get("worksheet", "Sheet1")
    start_row = int(settings.get("start_row", "2"))
    url_col = settings.get("url_column", "F")
    company_col = settings.get("company_column") or ""
    role_col = settings.get("role_column") or ""
    status_col = settings.get("status_column") or ""
    output_dir = SCRIPT_DIR / settings.get("output_dir", "output")

    if not spreadsheet_id:
        print("Error: spreadsheet_id is required in settings.txt", file=sys.stderr)
        return 1

    info = load_service_account_info(settings)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(spreadsheet_id)
    worksheet = spreadsheet.worksheet(worksheet_name)
    rows = worksheet.get_all_values()

    supported: list[dict] = []
    unsupported: list[dict] = []
    seen_urls: set[str] = set()

    for row_idx, row in enumerate(rows, start=1):
        if row_idx < start_row:
            continue
        raw_url = cell(row, url_col)
        url = normalize_url(raw_url)
        if not url:
            continue
        key = url.lower().rstrip("/")
        if key in seen_urls:
            continue
        seen_urls.add(key)

        is_supported, board = classify_url(url, rules)
        item = {
            "row": row_idx,
            "url": url,
            "company": cell(row, company_col) if company_col else "",
            "role": cell(row, role_col) if role_col else "",
            "status": cell(row, status_col) if status_col else "",
        }
        if is_supported:
            item["board"] = board
            supported.append(item)
        else:
            unsupported.append(item)

    output_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "spreadsheet_id": spreadsheet_id,
        "worksheet": worksheet_name,
        "start_row": start_row,
        "url_column": url_col,
    }
    support_path = output_dir / "manualJD-support.json"
    nonsupport_path = output_dir / "manualJD-non-support.json"

    support_doc = {**meta, "count": len(supported), "items": supported}
    nonsupport_doc = {**meta, "count": len(unsupported), "items": unsupported}

    support_path.write_text(json.dumps(support_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    nonsupport_path.write_text(json.dumps(nonsupport_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Fetched {len(seen_urls)} unique job URL(s) from row {start_row}+")
    print(f"  Support (autofill):     {len(supported)} -> {support_path}")
    print(f"  Non-support:            {len(unsupported)} -> {nonsupport_path}")
    by_board: dict[str, int] = {}
    for it in supported:
        b = it.get("board") or "unknown"
        by_board[b] = by_board.get(b, 0) + 1
    if by_board:
        print("  By board:", ", ".join(f"{k}={v}" for k, v in sorted(by_board.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
