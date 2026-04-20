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
{profile_text}

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
    return _PROMPT_TEMPLATE.format(
        job_title=title,
        job_url=url,
        description=description_text or "(No job description provided.)",
        profile_text=profile_text.strip() or "(No candidate profile provided.)",
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

    resume_text, answers_text = _split_resume_and_answers(full_text)

    logger.info(
        "Split result: resume_chars=%d answers_chars=%d response_id=%s",
        len(resume_text),
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
    )
