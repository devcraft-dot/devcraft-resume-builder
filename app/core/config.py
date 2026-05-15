from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_APP_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_name: str = "resume-builder"

    database_url: str = ""

    # OpenAI (GPT-5.4 / GPT-5.4-mini)
    openai_api_key: str = ""
    openai_base_url: str = ""

    # DeepSeek (OpenAI-compatible chat API; SDK appends paths under …/v1)
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"

    # Google Drive — credentials as JSON string (env var)
    google_drive_folder_id: str = ""
    drive_token_json: str = ""

    # Google Sheets — credentials as JSON string (env var)
    google_sheets_id: str = ""
    google_service_account_json: str = ""
    google_sheet_worksheet: str = "Sheet1"

    # Auth: stateless JWT (HS256). Set JWT_SECRET in the environment (e.g. deploy secrets).
    jwt_secret: str = ""
    jwt_expire_minutes: int = 60 * 24 * 7
    # Dashboard + admin API: header X-Admin-Key must match to manage server profiles / see all data.
    admin_api_key: str = ""
    # Optional: comma-separated extra browser origins (dashboard on another domain).
    # Example: https://devcraft-resume-builder-dashboard.vercel.app
    cors_allow_origins: str = ""

    model_config = SettingsConfigDict(
        env_file=str(_APP_DIR / ".env") if (_APP_DIR / ".env").exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
