"""Optional Google Sheets sync — append one row per generation."""

import json
import logging
from datetime import date

import gspread
from google.oauth2.service_account import Credentials

from app.core.config import settings

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _get_client() -> gspread.Client:
    info = json.loads(settings.google_service_account_json)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    return gspread.authorize(creds)


def append_generation_row(
    *,
    profile_name: str,
    stage: str,
    title: str,
    company_name: str,
    salary_range: str,
    jd_drive_url: str,
    jd_link: str,
    resume_drive_url: str,
    questions_drive_url: str,
) -> bool:
    """Append a single row to the configured Google Sheet. Returns False if Sheets is not configured."""
    if not settings.google_sheets_id or not settings.google_service_account_json.strip():
        logger.info("append_generation_row skipped: GOOGLE_SHEETS_ID or GOOGLE_SERVICE_ACCOUNT_JSON not set")
        return False

    client = _get_client()
    spreadsheet = client.open_by_key(settings.google_sheets_id)
    worksheet = spreadsheet.worksheet(settings.google_sheet_worksheet)

    row = [
        date.today().isoformat(),   # Date
        profile_name,                # ProfileName
        stage,                       # Stage
        title,                       # Title
        company_name,                # CompanyName
        resume_drive_url,            # Resume_file_url
        questions_drive_url,         # Question_File_Url
        jd_drive_url,                # JD_file_Link
        jd_link,                     # JD_Link (original job URL)
        salary_range,                # SalaryRange
    ]

    worksheet.append_row(row, value_input_option="USER_ENTERED")
    logger.info("Sheets row appended: profile=%r title=%r company=%r", profile_name, title, company_name)
    return True
