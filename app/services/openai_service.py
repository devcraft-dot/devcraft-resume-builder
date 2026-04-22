"""Multi-model resume generation via OpenAI-compatible APIs (GPT-5.4, DeepSeek)."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from app.core.config import settings
from app.schemas.generate import QuestionField
from app.services.resume_generation_prompt import build_generation_user_message

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model registry — both providers use the OpenAI SDK
# ---------------------------------------------------------------------------

MODEL_REGISTRY: dict[str, dict[str, Any]] = {
    "gpt-5.4": {
        "api_key_field": "openai_api_key",
        "base_url_field": "openai_base_url",
        "model_id": "gpt-5.4",
        "invoke": "responses",
    },
    "gpt-5.4-mini": {
        "api_key_field": "openai_api_key",
        "base_url_field": "openai_base_url",
        "model_id": "gpt-5.4-mini",
        "invoke": "responses",
    },
    "deepseek": {
        "api_key_field": "deepseek_api_key",
        "base_url_field": "deepseek_base_url",
        "model_id": "deepseek-chat",
        "invoke": "chat",
    },
    "deepseek-reasoner": {
        "api_key_field": "deepseek_api_key",
        "base_url_field": "deepseek_base_url",
        "model_id": "deepseek-reasoner",
        "invoke": "chat",
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
            base_url = base_url.rstrip("/")
            # DeepSeek (and other OpenAI-compatible chat hosts) expect …/v1 for the SDK path.
            if entry.get("invoke") == "chat" and not base_url.endswith("/v1"):
                base_url = f"{base_url}/v1"
            kwargs["base_url"] = base_url
        _clients[cache_key] = OpenAI(**kwargs)

    return _clients[cache_key], entry["model_id"]


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------


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
    profile_text: str,
) -> str:
    return build_generation_user_message(
        job_title=title,
        job_url=url,
        description=description_text or "(No job description provided.)",
        questions_block=_render_questions_block(questions),
        profile_text=profile_text.strip() or "(No candidate profile provided.)",
    )


# ---------------------------------------------------------------------------
# AI output parsing
# ---------------------------------------------------------------------------

_ANSWERS_SECTION_RE = re.compile(
    r"^#{1,3}\s*Application\s+Questions\s*$",
    re.IGNORECASE | re.MULTILINE,
)

_APPLICATION_ANSWERS_RE = re.compile(
    r"^#{1,3}\s*Application\s+Answers\s*$|^APPLICATION\s+ANSWERS\s*$",
    re.IGNORECASE | re.MULTILINE,
)

_QUALITY_CHECK_RE = re.compile(
    r"^#{1,3}\s*Quality\s+Check\s*$|^QUALITY\s+CHECK\s*$",
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
    best: re.Match[str] | None = None
    for pat in (_ANSWERS_SECTION_RE, _APPLICATION_ANSWERS_RE):
        m = pat.search(text)
        if m and (best is None or m.start() < best.start()):
            best = m
    if not best:
        return text, ""
    return text[: best.start()].strip(), text[best.start() :].strip()


def _trim_trailing_meta_from_app_block(app: str) -> str:
    """Strip optional post-Q&A sections (quality checklist) from the answers buffer."""
    s = str(app or "").strip()
    if not s:
        return s
    m = _QUALITY_CHECK_RE.search(s)
    if m:
        s = s[: m.start()].strip()
    return s


_RESUME_HEADER_RE = re.compile(r"^##\s*Resume\s*$", re.IGNORECASE | re.MULTILINE)
_RESUME_START_ALTERNATES = (
    re.compile(r"^#{1,3}\s*Final\s+Resume\s*$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^FINAL\s+RESUME\s*$", re.IGNORECASE | re.MULTILINE),
)
_COVER_HEADER_RE = re.compile(r"^##\s*Cover\s+Letter\s*$", re.IGNORECASE | re.MULTILINE)


def _find_resume_header_match(text: str) -> re.Match[str] | None:
    """Earliest ## Resume / ## Final Resume / FINAL RESUME line."""
    candidates: list[re.Match[str]] = []
    m0 = _RESUME_HEADER_RE.search(text)
    if m0:
        candidates.append(m0)
    for pat in _RESUME_START_ALTERNATES:
        m = pat.search(text)
        if m:
            candidates.append(m)
    if not candidates:
        return None
    return min(candidates, key=lambda m: m.start())


def _parse_model_sections(raw: str) -> tuple[str, str, str]:
    """Split model output into resume Markdown, cover letter body, application Q&A block."""
    text = _strip_outer_code_fence(str(raw or "").strip())
    if not text:
        return "", "", ""

    low = text.lower()
    if low.startswith("cannot generate due to"):
        return text.strip(), "", ""

    r_m = _find_resume_header_match(text)
    if not r_m:
        resume_part, app_part = _split_resume_and_answers(text)
        app_part = _trim_trailing_meta_from_app_block(app_part)
        return resume_part, "", app_part

    pos = r_m.end()
    next_headers: list[tuple[int, int, str]] = []
    for m in _COVER_HEADER_RE.finditer(text, pos):
        next_headers.append((m.start(), m.end(), "cover"))
    for m in _ANSWERS_SECTION_RE.finditer(text, pos):
        next_headers.append((m.start(), m.end(), "app"))
    for m in _APPLICATION_ANSWERS_RE.finditer(text, pos):
        next_headers.append((m.start(), m.end(), "app"))
    next_headers.sort(key=lambda x: x[0])
    first = next_headers[0] if next_headers else None

    if not first:
        return text[pos:].strip(), "", ""

    resume_body = text[pos : first[0]].strip()
    cover_body = ""
    app_body = ""

    if first[2] == "cover":
        c_end = first[1]
        rest = text[c_end:].strip()
        second = None
        for pat in (_ANSWERS_SECTION_RE, _APPLICATION_ANSWERS_RE):
            sm = pat.search(rest)
            if sm and (second is None or sm.start() < second.start()):
                second = sm
        if second:
            cover_body = rest[: second.start()].strip()
            app_body = rest[second.end() :].strip()
        else:
            cover_body = rest

    elif first[2] == "app":
        app_body = text[first[1] :].strip()

    app_body = _trim_trailing_meta_from_app_block(app_body)
    return resume_body, cover_body, app_body


def _compose_answers_doc_text(cover_letter: str, application_block: str) -> str:
    parts: list[str] = []
    c = (cover_letter or "").strip()
    a = (application_block or "").strip()
    if c:
        parts.append(f"## Cover Letter\n\n{c}")
    if a:
        if a.lstrip().lower().startswith("## application"):
            parts.append(a)
        else:
            parts.append(f"## Application Questions\n\n{a}")
    return "\n\n".join(parts).strip()


def _generate_with_responses_api(client: OpenAI, model_id: str, prompt: str) -> tuple[str, str | None]:
    response = client.responses.create(model=model_id, input=prompt)
    raw = str(getattr(response, "output_text", "") or "").strip()
    return _strip_outer_code_fence(raw), getattr(response, "id", None)


def _generate_with_chat_completions(client: OpenAI, model_id: str, prompt: str) -> tuple[str, str | None]:
    """OpenAI-compatible chat (used for DeepSeek)."""
    completion = client.chat.completions.create(
        model=model_id,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        max_tokens=8192,
    )
    if not completion.choices:
        raise ValueError("Chat completion returned no choices")
    raw = str(completion.choices[0].message.content or "").strip()
    return _strip_outer_code_fence(raw), getattr(completion, "id", None)


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
    cover_letter_text: str = ""


def generate_resume(
    *,
    model_key: str,
    title: str,
    url: str,
    description_text: str,
    questions: list[QuestionField],
    profile_text: str,
) -> GenerationResult:
    """Call the selected AI model and return parsed resume + answers."""
    entry = MODEL_REGISTRY.get(model_key)
    if not entry:
        raise ValueError(f"Unknown model: {model_key!r}. Choose from {list(MODEL_REGISTRY)}")

    client, model_id = _get_client(model_key)
    prompt = _render_prompt(title, url, description_text, questions, profile_text)
    invoke = entry.get("invoke", "responses")

    logger.info("generate_resume: model=%s invoke=%s title=%r", model_id, invoke, title)

    if invoke == "chat":
        full_text, response_id = _generate_with_chat_completions(client, model_id, prompt)
    else:
        full_text, response_id = _generate_with_responses_api(client, model_id, prompt)

    if not str(full_text or "").strip():
        raise ValueError(
            f"Model {model_id!r} returned empty output; check API key, base URL, and model id for provider {model_key!r}."
        )

    resume_text, cover_letter_text, app_block = _parse_model_sections(full_text)
    answers_text = _compose_answers_doc_text(cover_letter_text, app_block)

    logger.info(
        "Split result: resume_chars=%d cover_chars=%d answers_chars=%d response_id=%s",
        len(resume_text),
        len(cover_letter_text),
        len(answers_text),
        response_id,
    )

    return GenerationResult(
        prompt_text=prompt,
        resume_text=resume_text,
        answers_text=answers_text,
        response_id=response_id,
        model_name=model_id,
        raw_output_text=full_text,
        cover_letter_text=cover_letter_text,
    )
