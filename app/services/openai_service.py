"""Multi-model resume generation via OpenAI-compatible APIs (GPT-5.4, DeepSeek)."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from app.core.config import settings
from app.schemas.generate import QuestionField

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model registry — both providers use the OpenAI SDK
# ---------------------------------------------------------------------------

MODEL_REGISTRY: dict[str, dict[str, str]] = {
    "gpt-5.4": {
        "api_key_field": "openai_api_key",
        "base_url_field": "openai_base_url",
        "model_id": "gpt-5.4",
    },
    "gpt-5.4-mini": {
        "api_key_field": "openai_api_key",
        "base_url_field": "openai_base_url",
        "model_id": "gpt-5.4-mini",
    },
    "deepseek": {
        "api_key_field": "deepseek_api_key",
        "base_url_field": "deepseek_base_url",
        "model_id": "deepseek-chat",
    },
}

_clients: dict[str, OpenAI] = {}


def _get_client(model_key: str) -> tuple[OpenAI, str]:
    """Return (client, model_id) for the given registry key."""
    entry = MODEL_REGISTRY.get(model_key)
    if not entry:
        raise ValueError(f"Unknown model: {model_key!r}. Choose from {list(MODEL_REGISTRY)}")

    api_key = getattr(settings, entry["api_key_field"], "") or ""
    if not api_key:
        raise ValueError(f"No API key configured for {model_key} (set {entry['api_key_field'].upper()})")

    cache_key = model_key
    if cache_key not in _clients:
        kwargs: dict[str, Any] = {"api_key": api_key}
        base_url = getattr(settings, entry["base_url_field"], "") or ""
        if base_url:
            kwargs["base_url"] = base_url
        _clients[cache_key] = OpenAI(**kwargs)

    return _clients[cache_key], entry["model_id"]


# ---------------------------------------------------------------------------
# Prompt building (absorbed from prompt_builder.py)
# ---------------------------------------------------------------------------

_PROMPT_TEMPLATE = """
You are helping tailor a resume for a job application.

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
{profile}

==================================================
APPLICATION QUESTIONS (from job form)
==================================================
{questions}

==================================================
OUTPUT CONTRACT
==================================================
1) Produce the full resume in Markdown (Summary, Skills, Experience, Education).
2) If APPLICATION QUESTIONS above is not "None", you MUST append after Education:
   ## Application Questions
   For each question, add a subheading with the question text, then your answer.
   - [select]: pick ONLY from the given options, matching wording exactly.
   - [textarea]: 2-6 sentences of original prose.
   - [input]: a concise phrase or short paragraph.
3) If APPLICATION QUESTIONS is "None", omit ## Application Questions entirely.
4) Do not wrap the entire response in a code fence.
5) Do not invent experience the candidate does not have.
""".strip()


_MONTH_ABBR = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
    "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
    "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
}

_PROFILE_SKIP_KEYS = {"id", "school_attribution_note"}


def _format_date(raw: str) -> str:
    s = raw.strip()
    m = re.match(r"^(\d{4})-(\d{2})$", s)
    if m:
        return f"{_MONTH_ABBR.get(m.group(2), m.group(2))} {m.group(1)}"
    return s


def _human_label(key: str) -> str:
    return " ".join(part.capitalize() for part in str(key).replace("-", "_").split("_") if part)


def _format_inline_list(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, list):
        parts = [str(x).strip() for x in val if x is not None and str(x).strip()]
        return ", ".join(parts) if parts else ""
    return str(val).strip()


def _render_education_entry(i: int, edu: dict) -> list[str]:
    if not isinstance(edu, dict):
        return [f"{i}. {edu!s}"]
    degree = str(edu.get("degree") or "").strip()
    school = str(edu.get("school") or "").strip()
    start = _format_date(str(edu.get("start") or ""))
    end = _format_date(str(edu.get("end") or ""))
    when = " – ".join(x for x in (start, end) if x)
    head = f"{i}. "
    if degree and school:
        head += f"{degree} — {school}"
    elif degree or school:
        head += degree or school
    else:
        head += "(education entry)"
    if when:
        head += f" ({when})"
    loc = str(edu.get("location") or "").strip()
    if loc:
        head += f", {loc}"
    out = [head]
    for k, v in edu.items():
        if k in ("degree", "school", "start", "end", "location") or k in _PROFILE_SKIP_KEYS:
            continue
        if isinstance(v, (dict, list)):
            continue
        s = str(v).strip()
        if s:
            out.append(f"   {_human_label(k)}: {s}")
    return out


def _render_experience_entry(i: int, ex: dict) -> list[str]:
    if not isinstance(ex, dict):
        return [f"{i}. {ex!s}", ""]
    title = str(ex.get("title") or "").strip()
    company = str(ex.get("company") or "").strip()
    start = _format_date(str(ex.get("start") or ""))
    end = _format_date(str(ex.get("end") or ""))
    when = " – ".join(x for x in (start, end) if x)
    line = f"{i}. {title or 'Role'} — {company or 'Company'}"
    if when:
        line += f" ({when})"
    out = [line]
    for key, label in (
        ("industry", "Industry"),
        ("company_summary", "Company summary"),
    ):
        v = str(ex.get(key) or "").strip()
        if v:
            out.append(f"   {label}: {v}")
    dom = _format_inline_list(ex.get("domains"))
    if dom:
        out.append(f"   Domains: {dom}")
    tech = _format_inline_list(ex.get("tech_stack") or ex.get("technologies"))
    if tech:
        out.append(f"   Tech: {tech}")
    out.append("")
    return out


def _profile_to_plain_text(profile: dict | None) -> str:
    if not isinstance(profile, dict):
        return str(profile or "").strip() or "(No candidate profile provided.)"

    lines: list[str] = []
    scalar_order = ("name", "email", "phone", "location", "linkedin")
    done: set[str] = set(_PROFILE_SKIP_KEYS)
    for k in scalar_order:
        if k not in profile:
            continue
        s = str(profile[k]).strip()
        if s:
            lines.append(f"{_human_label(k)}: {s}")
        done.add(k)
    for k, v in profile.items():
        if k in done or k in ("education", "experience"):
            continue
        if isinstance(v, (dict, list)):
            continue
        s = str(v).strip()
        if s:
            lines.append(f"{_human_label(k)}: {s}")
    lines.append("")

    edu = profile.get("education")
    if isinstance(edu, list) and edu:
        lines.append("--- Education ---")
        for i, e in enumerate(edu, start=1):
            lines.extend(_render_education_entry(i, e))
        lines.append("")

    exp = profile.get("experience")
    if isinstance(exp, list) and exp:
        lines.append("--- Work experience ---")
        for i, e in enumerate(exp, start=1):
            lines.extend(_render_experience_entry(i, e))

    tail = "\n".join(lines).strip()
    return tail if tail else "(Empty candidate profile.)"


def _normalize_field_type(raw: str) -> str:
    t = (raw or "").lower().strip()
    if t in ("select", "radio", "checkbox"):
        return "select"
    if t in ("textarea", "longtext"):
        return "textarea"
    return "input"


def _render_questions_block(questions: list[QuestionField]) -> str:
    if not questions:
        return "None"

    lines: list[str] = []
    for i, f in enumerate(questions, start=1):
        ft = _normalize_field_type(f.type)
        req = " (required)" if f.required else ""
        lines.append(f"{i}. [{ft}]{req} {f.label}")

        if ft == "select" and f.options:
            lines.append("   Choose from:")
            for opt in f.options:
                lines.append(f"   - {opt}")
        elif ft == "textarea":
            lines.append("   Free text answer.")
        else:
            lines.append("   Short answer.")

    return "\n".join(lines)


def _render_prompt(
    title: str,
    url: str,
    description_text: str,
    questions: list[QuestionField],
    profile: dict,
) -> str:
    return _PROMPT_TEMPLATE.format(
        job_title=title,
        job_url=url,
        description=description_text or "(No job description provided.)",
        profile=_profile_to_plain_text(profile),
        questions=_render_questions_block(questions),
    )


# ---------------------------------------------------------------------------
# AI output parsing
# ---------------------------------------------------------------------------

_ANSWERS_SECTION_RE = re.compile(
    r"^#{1,3}\s*Application\s+Questions\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _strip_outer_code_fence(text: str) -> str:
    t = str(text or "").strip()
    if not t.startswith("```"):
        return t
    lines = t.split("\n")
    if len(lines) < 2:
        return t
    rest = "\n".join(lines[1:]).strip()
    if rest.endswith("```"):
        rest = rest[:-3].rstrip()
    return rest


def _split_resume_and_answers(raw: str) -> tuple[str, str]:
    text = str(raw or "").strip()
    match = _ANSWERS_SECTION_RE.search(text)
    if not match:
        return text, ""
    return text[: match.start()].strip(), text[match.start() :].strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@dataclass
class GenerationResult:
    prompt_text: str
    resume_text: str
    answers_text: str
    response_id: str | None
    model_name: str
    raw_output_text: str


def generate_resume(
    *,
    model_key: str,
    title: str,
    url: str,
    description_text: str,
    questions: list[QuestionField],
    profile: dict,
) -> GenerationResult:
    """Call the selected AI model and return parsed resume + answers."""
    client, model_id = _get_client(model_key)
    prompt = _render_prompt(title, url, description_text, questions, profile)

    logger.info("generate_resume: model=%s title=%r", model_id, title)

    response = client.responses.create(model=model_id, input=prompt)

    full_text = _strip_outer_code_fence(response.output_text.strip())
    resume_text, answers_text = _split_resume_and_answers(full_text)

    logger.info(
        "Split result: resume_chars=%d answers_chars=%d response_id=%s",
        len(resume_text), len(answers_text), getattr(response, "id", None),
    )

    return GenerationResult(
        prompt_text=prompt,
        resume_text=resume_text,
        answers_text=answers_text,
        response_id=getattr(response, "id", None),
        model_name=model_id,
        raw_output_text=full_text,
    )
