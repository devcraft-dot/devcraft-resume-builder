"""
User prompt assembly for resume + cover letter generation.

The colocated `prompt_template` file is the source of truth. This module loads it
from disk so prompt changes only need to be made in one place, then appends the
live job/profile/question blocks required by the API.
"""

from __future__ import annotations

from pathlib import Path


def _load_prompt_template() -> str:
    """Load the shared prompt template and strip repo-only placeholder tail."""
    module_dir = Path(__file__).resolve().parent
    template_path = module_dir / "prompt_template"
    if not template_path.exists():
        template_path = module_dir.parents[1] / "prompt_template"
    text = template_path.read_text(encoding="utf-8").strip()

    # The human-readable template ends with placeholder sections and an API note.
    # For live generation we append the real blocks below, so keep only the rules.
    for marker in ("\n[CANDIDATE PROFILE]\n", "\n--- API / EXTENSION NOTE"):
        if marker in text:
            text = text.split(marker, 1)[0].rstrip()
    return text


RESUME_BUILD_INSTRUCTIONS = _load_prompt_template()


def build_generation_user_message(
    *,
    job_title: str,
    job_url: str,
    description: str,
    questions_block: str,
    profile_text: str,
) -> str:
    return f"""{RESUME_BUILD_INSTRUCTIONS}

==================================================
TARGET JOB
==================================================
Title: {job_title}
URL: {job_url}

==================================================
JOB DESCRIPTION
==================================================
{description}

==================================================
CANDIDATE PROFILE
==================================================
{profile_text}

==================================================
APPLICATION QUESTIONS (from job form; or None)
==================================================
{questions_block}
""".strip()
