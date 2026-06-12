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

If the sheet is private (you open it with Gmail only), export CSV manually:
  Google Sheets → File → Download → Comma Separated Values (.csv)
Then set local_csv= input/sheet.csv in settings.txt (see settings comments).
"""

from __future__ import annotations

import csv
import io
import json
import sys
import re
import time
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


def resolve_local_csv_path(settings: dict[str, str]) -> Path | None:
    rel = (settings.get("local_csv") or "").strip()
    if not rel:
        return None
    path = Path(rel)
    if not path.is_absolute():
        path = SCRIPT_DIR / path
    return path.resolve()


def data_source_key(settings: dict[str, str], local_path: Path | None) -> str:
    if local_path:
        return f"local:{local_path}"
    return f"sheet:{settings.get('spreadsheet_id', '')}:{settings.get('worksheet_gid', '0')}"


def load_fetch_state(
    path: Path,
    *,
    source_key: str,
) -> int | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    stored_key = data.get("source_key")
    if stored_key != source_key:
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
    source_key: str,
    last_row: int,
    start_row: int,
    urls_fetched: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "last_row": last_row,
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "source_key": source_key,
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
    retries = int(settings.get("network_retries", "3"))
    last_err: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            with urlopen(req, timeout=60) as resp:
                raw = resp.read()
            text = raw.decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text))
            return [list(row) for row in reader]
        except HTTPError as exc:
            if exc.code in (401, 403):
                raise RuntimeError(
                    "Could not read the sheet (access denied).\n"
                    "Share it as 'Anyone with the link can view':\n"
                    f"  https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit\n"
                    "Then run this script again."
                ) from exc
            raise RuntimeError(f"Could not read the sheet (HTTP {exc.code}).") from exc
        except URLError as exc:
            last_err = exc
            reason = str(exc.reason)
            if attempt < retries:
                wait = 2 * attempt
                print(f"  Network error (attempt {attempt}/{retries}): {reason}. Retrying in {wait}s...")
                time.sleep(wait)
                continue
            if "getaddrinfo failed" in reason or "11001" in reason:
                raise RuntimeError(
                    "Could not reach docs.google.com (DNS/network error).\n"
                    "Check your internet connection, VPN, or firewall, then try again."
                ) from exc
            raise RuntimeError(f"Could not download sheet CSV: {reason}") from exc

    raise RuntimeError(f"Could not download sheet CSV: {last_err}") from last_err


def read_local_csv_rows(path: Path) -> list[list[str]]:
    if not path.exists():
        raise FileNotFoundError(
            f"local_csv file not found: {path}\n"
            "Export from Google Sheets while logged in:\n"
            "  File → Download → Comma Separated Values (.csv)\n"
            f"Save it to: {path}"
        )
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    return [list(row) for row in reader]


def load_sheet_rows(
    settings: dict[str, str],
    spreadsheet_id: str,
) -> tuple[list[list[str]], str, Path | None]:
    local_path = resolve_local_csv_path(settings)
    if local_path:
        return read_local_csv_rows(local_path), "local_csv", local_path
    if not spreadsheet_id:
        raise RuntimeError(
            "Set spreadsheet_id (public sheet) or local_csv (downloaded CSV) in settings.txt"
        )
    return fetch_public_sheet_rows(spreadsheet_id, settings), "public_csv_export", None


def build_item(
    row_idx: int,
    row: list[str],
    url: str,
    *,
    company_col: str,
    role_col: str,
    status_col: str,
    board: str | None,
    is_supported: bool,
) -> dict:
    item: dict = {
        "row": row_idx,
        "url": url,
    }
    if company_col:
        item["company"] = cell(row, company_col)
    if role_col:
        item["role"] = cell(row, role_col)
    if status_col:
        item["status"] = cell(row, status_col)
    if is_supported and board:
        item["board"] = board
    return item


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
    local_path = resolve_local_csv_path(settings)
    source_key = data_source_key(settings, local_path)

    saved_last_row = None if reset_progress else load_fetch_state(
        state_path,
        source_key=source_key,
    )
    if saved_last_row is not None:
        start_row = saved_last_row + 1
    else:
        start_row = configured_start_row

    if local_path:
        print(f"Reading local CSV: {local_path}")
    else:
        if not spreadsheet_id:
            print("Error: spreadsheet_id or local_csv is required in settings.txt", file=sys.stderr)
            return 1
        print(f"Fetching public sheet {spreadsheet_id} (gid={worksheet_gid or '0'})...")
    if reset_progress:
        print(f"  Progress reset - starting at row {start_row} (from settings.txt)")
    elif saved_last_row is not None:
        print(f"  Resuming after row {saved_last_row} - starting at row {start_row}")
    else:
        print(f"  First run - starting at row {start_row} (from settings.txt)")

    rows, source_kind, local_path = load_sheet_rows(settings, spreadsheet_id)
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
        item = build_item(
            row_idx,
            row,
            url,
            company_col=company_col,
            role_col=role_col,
            status_col=status_col,
            board=board,
            is_supported=is_supported,
        )
        if is_supported:
            supported.append(item)
        else:
            unsupported.append(item)

    output_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "spreadsheet_id": spreadsheet_id or None,
        "worksheet": worksheet_name or None,
        "worksheet_gid": worksheet_gid or "0",
        "local_csv": str(local_path) if local_path else None,
        "start_row": start_row,
        "last_row": last_processed_row,
        "url_column": url_col,
        "source": source_kind,
    }
    support_path = output_dir / "manualJD-support.json"
    nonsupport_path = output_dir / "manualJD-non-support.json"

    support_doc = {**meta, "count": len(supported), "items": supported}
    nonsupport_doc = {**meta, "count": len(unsupported), "items": unsupported}

    support_path.write_text(json.dumps(support_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    nonsupport_path.write_text(json.dumps(nonsupport_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    save_fetch_state(
        state_path,
        source_key=source_key,
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
