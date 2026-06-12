#!/usr/bin/env python3
"""
Fetch job URLs from a Google Sheet and split them into Manual JD autofill support files.

Reads:
  - settings.txt          (spreadsheet id, worksheet gid, start row, columns)
  - support-url-types.txt (Greenhouse / Ashby / Workable URL patterns)

Writes:
  - output/manualJD-support.json
  - output/manualJD-non-support.json

Public sheets (Anyone with the link can view) need no credentials — data is fetched
via Google's CSV export URL. Private sheets are not supported.

Progress is saved to output/fetch_state.json (last processed sheet row). The next run
starts at last_row + 1. Set reset_progress=true in settings.txt or pass --reset to
start over from start_row in settings.txt.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
SETTINGS_PATH = SCRIPT_DIR / "settings.txt"
SUPPORT_TYPES_PATH = SCRIPT_DIR / "support-url-types.txt"
USER_AGENT = "resume-builder-sheet-scraper/1.0"


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


def load_support_rules(path: Path) -> list[tuple[str, str, re.Pattern[str] | None, str]]:
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
    if "." in s.split("/")[0]:
        return f"https://{s}"
    return s


def cell(row: list[str], col_letter: str | None) -> str:
    if not col_letter:
        return ""
    idx = col_letter_to_index(col_letter)
    if idx < 0 or idx >= len(row):
        return ""
    return str(row[idx] or "").strip()


def parse_bool(value: str) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def fetch_state_path(output_dir: Path, settings: dict[str, str]) -> Path:
    rel = (settings.get("state_file") or "fetch_state.json").strip()
    path = Path(rel)
    if not path.is_absolute():
        path = output_dir / path
    return path


def load_fetch_state(
    path: Path,
    *,
    spreadsheet_id: str,
    worksheet_gid: str,
) -> int | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if data.get("spreadsheet_id") != spreadsheet_id:
        return None
    if str(data.get("worksheet_gid") or "0") != str(worksheet_gid or "0"):
        return None
    last = data.get("last_row")
    if last is None:
        return None
    try:
        return int(last)
    except (TypeError, ValueError):
        return None


def save_fetch_state(
    path: Path,
    *,
    spreadsheet_id: str,
    worksheet_gid: str,
    last_row: int,
    start_row: int,
    urls_fetched: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "last_row": last_row,
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "spreadsheet_id": spreadsheet_id,
        "worksheet_gid": str(worksheet_gid or "0"),
        "start_row_used": start_row,
        "urls_fetched": urls_fetched,
    }
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def public_export_url(spreadsheet_id: str, settings: dict[str, str]) -> str:
    gid = (settings.get("worksheet_gid") or "").strip()
    worksheet = (settings.get("worksheet") or "").strip()
    if gid:
        return (
            f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export"
            f"?format=csv&gid={quote(gid, safe='')}"
        )
    if worksheet:
        return (
            f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/gviz/tq"
            f"?tqx=out:csv&sheet={quote(worksheet, safe='')}"
        )
    return (
        f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export"
        f"?format=csv&gid=0"
    )


def fetch_public_sheet_rows(spreadsheet_id: str, settings: dict[str, str]) -> list[list[str]]:
    url = public_export_url(spreadsheet_id, settings)
    req = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise RuntimeError(
                "Could not read the sheet (access denied). "
                "The sheet must be shared as 'Anyone with the link can view'."
            ) from exc
        raise RuntimeError(f"Could not read the sheet (HTTP {exc.code}).") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not download sheet CSV: {exc.reason}") from exc

    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    return [list(row) for row in reader]


def main() -> int:
    reset_progress = "--reset" in sys.argv
    settings = load_settings(SETTINGS_PATH)
    if not reset_progress:
        reset_progress = parse_bool(settings.get("reset_progress", ""))

    rules = load_support_rules(SUPPORT_TYPES_PATH)

    spreadsheet_id = settings.get("spreadsheet_id", "")
    worksheet_name = settings.get("worksheet", "")
    worksheet_gid = settings.get("worksheet_gid", "0")
    configured_start_row = int(settings.get("start_row", "2"))
    url_col = settings.get("url_column", "F")
    company_col = settings.get("company_column") or ""
    role_col = settings.get("role_column") or ""
    status_col = settings.get("status_column") or ""
    output_dir = SCRIPT_DIR / settings.get("output_dir", "output")
    state_path = fetch_state_path(output_dir, settings)

    if not spreadsheet_id:
        print("Error: spreadsheet_id is required in settings.txt", file=sys.stderr)
        return 1

    saved_last_row = None if reset_progress else load_fetch_state(
        state_path,
        spreadsheet_id=spreadsheet_id,
        worksheet_gid=worksheet_gid,
    )
    if saved_last_row is not None:
        start_row = saved_last_row + 1
    else:
        start_row = configured_start_row

    print(f"Fetching public sheet {spreadsheet_id} (gid={worksheet_gid or '0'})...")
    if reset_progress:
        print(f"  Progress reset - starting at row {start_row} (from settings.txt)")
    elif saved_last_row is not None:
        print(f"  Resuming after row {saved_last_row} - starting at row {start_row}")
    else:
        print(f"  First run - starting at row {start_row} (from settings.txt)")

    rows = fetch_public_sheet_rows(spreadsheet_id, settings)
    if start_row > len(rows):
        print(f"No new rows to fetch (start_row={start_row}, sheet has {len(rows)} row(s)).")
        return 0

    supported: list[dict] = []
    unsupported: list[dict] = []
    seen_urls: set[str] = set()
    last_processed_row = start_row - 1

    for row_idx, row in enumerate(rows, start=1):
        if row_idx < start_row:
            continue
        last_processed_row = row_idx
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
        "worksheet": worksheet_name or None,
        "worksheet_gid": worksheet_gid or "0",
        "start_row": start_row,
        "last_row": last_processed_row,
        "url_column": url_col,
        "source": "public_csv_export",
    }
    support_path = output_dir / "manualJD-support.json"
    nonsupport_path = output_dir / "manualJD-non-support.json"

    support_doc = {**meta, "count": len(supported), "items": supported}
    nonsupport_doc = {**meta, "count": len(unsupported), "items": unsupported}

    support_path.write_text(json.dumps(support_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    nonsupport_path.write_text(json.dumps(nonsupport_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    save_fetch_state(
        state_path,
        spreadsheet_id=spreadsheet_id,
        worksheet_gid=worksheet_gid,
        last_row=last_processed_row,
        start_row=start_row,
        urls_fetched=len(seen_urls),
    )

    print(f"Processed sheet rows {start_row}-{last_processed_row} ({len(seen_urls)} unique job URL(s))")
    print(f"  Support (autofill):     {len(supported)} -> {support_path}")
    print(f"  Non-support:            {len(unsupported)} -> {nonsupport_path}")
    print(f"  Next run will start at row {last_processed_row + 1} (saved in {state_path.name})")
    by_board: dict[str, int] = {}
    for it in supported:
        b = it.get("board") or "unknown"
        by_board[b] = by_board.get(b, 0) + 1
    if by_board:
        print("  By board:", ", ".join(f"{k}={v}" for k, v in sorted(by_board.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
