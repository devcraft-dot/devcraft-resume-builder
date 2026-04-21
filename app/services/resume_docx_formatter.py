"""
ATS-oriented resume .docx generation (aligned with automation/building/resume_builder.py).

Follows automation/guide/prompt/format_rules.txt: Calibri, 0.75\" margins, structured
header / sections / bullets / skills. JD text is used only to bold matching phrases in .docx
(same idea as automation); the full JD is still sent to the model in the API prompt.
"""

from __future__ import annotations

import re
from datetime import date
from io import BytesIO

# ── Section detection (same semantics as automation) ──────────────────────────
_SECTION_KEYWORDS = {
    "SUMMARY",
    "MARKET TITLE",
    "PROFESSIONAL SUMMARY",
    "OBJECTIVE",
    "SKILLS",
    "TECHNICAL SKILLS",
    "CORE COMPETENCIES",
    "WORK EXPERIENCE",
    "PROFESSIONAL EXPERIENCE",
    "EXPERIENCE",
    "PROJECTS",
    "NOTABLE PROJECTS",
    "KEY PROJECTS",
    "EDUCATION",
    "CERTIFICATIONS",
    "CERTIFICATIONS OR ACHIEVEMENTS",
    "ACHIEVEMENTS",
    "AWARDS",
    "ADDITIONAL INFORMATION",
}

_EXPERIENCE_SECTIONS = {
    "WORK EXPERIENCE",
    "PROFESSIONAL EXPERIENCE",
    "EXPERIENCE",
    "EDUCATION",
}

_BODY_FONT = "Calibri"


def _safe_filename(value: str) -> str:
    return re.sub(r"[^\w\s-]", "", str(value or "")).strip().replace(" ", "_")


def _strip_md_bold(text: str) -> str:
    s = text.strip()
    if s.startswith("**") and s.endswith("**") and len(s) > 4:
        inner = s[2:-2].strip()
        if "**" not in inner:
            return inner
    return s


def _strip_md_heading(text: str) -> str:
    return re.sub(r"^#{1,6}\s*", "", text.strip())


_SPLIT_WORD_PATTERNS = re.compile(
    r"\b("
    r"Softw\s+are|TypeScrip\s+t|Java\s+Script|Type\s+Script|"
    r"Micro\s+soft|data\s+base|frame\s+work|work\s+flow|"
    r"pay\s+ments|deploy\s+ment|manage\s+ment|develop\s+ment|"
    r"environ\s+ment|infra\s+structure|auto\s+mation"
    r")\b",
    re.IGNORECASE,
)

_TECH_SPELLING_FIXES: dict[re.Pattern, str] = {
    re.compile(r"\bKubernates\b"): "Kubernetes",
    re.compile(r"\bKuberneties\b"): "Kubernetes",
    re.compile(r"\bJavascipt\b"): "JavaScript",
    re.compile(r"\bJavaScipt\b"): "JavaScript",
    re.compile(r"\bTypeScipt\b"): "TypeScript",
    re.compile(r"\bTypscript\b"): "TypeScript",
    re.compile(r"\bPostgresql\b"): "PostgreSQL",
    re.compile(r"\bPostgresSql\b"): "PostgreSQL",
    re.compile(r"\bPostgress\b"): "PostgreSQL",
    re.compile(r"\bMongoDb\b"): "MongoDB",
    re.compile(r"\bGithub\b"): "GitHub",
    re.compile(r"\bGitlab\b"): "GitLab",
    re.compile(r"\bBitbucket\b"): "Bitbucket",
    re.compile(r"\bGraphql\b"): "GraphQL",
    re.compile(r"\bNodejs\b"): "Node.js",
    re.compile(r"\bNodeJS\b"): "Node.js",
    re.compile(r"\bNextjs\b"): "Next.js",
    re.compile(r"\bNextJS\b"): "Next.js",
    re.compile(r"\bVuejs\b"): "Vue.js",
    re.compile(r"\bVueJS\b"): "Vue.js",
    re.compile(r"\bElasticSearch\b"): "Elasticsearch",
    re.compile(r"\bTerraFrom\b"): "Terraform",
    re.compile(r"\bTeraform\b"): "Terraform",
    re.compile(r"\bJenkins\b"): "Jenkins",
    re.compile(r"\bDockerfile\b"): "Dockerfile",
    re.compile(r"\bFastApi\b"): "FastAPI",
    re.compile(r"\bFastapi\b"): "FastAPI",
    re.compile(r"\bDjnago\b"): "Django",
    re.compile(r"\bPythn\b"): "Python",
    re.compile(r"\bPytho\b"): "Python",
    re.compile(r"\bAmaozn\b"): "Amazon",
    re.compile(r"\bMircroservices?\b"): "Microservices",
    re.compile(r"\bMicroservies\b"): "Microservices",
}


def _sanitize_text(text: str) -> str:
    """Fix common formatting artifacts: extra spaces, curly quotes, split words, tech spelling."""
    s = text
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = _SPLIT_WORD_PATTERNS.sub(lambda m: re.sub(r"\s+", "", m.group(0)), s)
    for pattern, fix in _TECH_SPELLING_FIXES.items():
        s = pattern.sub(fix, s)
    return s.strip()


_FULL_TO_ABBR_MONTH = {
    "january": "Jan", "february": "Feb", "march": "Mar", "april": "Apr",
    "may": "May", "june": "Jun", "july": "Jul", "august": "Aug",
    "september": "Sep", "october": "Oct", "november": "Nov", "december": "Dec",
}
_FULL_MONTH_RE = re.compile(
    r"\b(" + "|".join(_FULL_TO_ABBR_MONTH) + r")\s+(\d{4})\b",
    re.IGNORECASE,
)


def _normalize_dates(text: str) -> str:
    """Normalize date formats: full month → 3-letter abbr, hyphen → en dash."""
    def _abbr(m: re.Match) -> str:
        return f"{_FULL_TO_ABBR_MONTH[m.group(1).lower()]} {m.group(2)}"
    s = _FULL_MONTH_RE.sub(_abbr, text)
    s = re.sub(r"(\w{3,4}\s+\d{4})\s*-\s*(\w{3,}\s+\d{4}|Present)", r"\1 – \2", s)
    return s


def _clean_line(text: str) -> str:
    return _normalize_dates(_sanitize_text(_strip_md_bold(_strip_md_heading(text))))


def _is_section_header(line: str) -> bool:
    stripped = _clean_line(line.strip())
    if stripped.upper() in _SECTION_KEYWORDS:
        return True
    return (
        stripped.isupper()
        and 3 <= len(stripped) <= 80
        and "|" not in stripped
        and "•" not in stripped
        and "@" not in stripped
        and not stripped.startswith("http")
    )


def _line_is_role_or_degree_row(stripped: str, current_section: str) -> bool:
    """
    Experience/education entry line: has | (dates) and/or Role — Company / Degree — School.
    Models often emit ### headings instead of the pipe form; those must still become job_title rows.
    """
    if current_section not in _EXPERIENCE_SECTIONS:
        return False
    if "•" in stripped:
        return False
    clean = _clean_line(stripped)
    if not clean or len(clean) < 6:
        return False
    if "|" in stripped:
        return True
    if "\u2014" in clean or " -- " in clean:
        return True
    # En dash or hyphen as separator: "Role - Company"
    if re.search(r"\s[-\u2013]\s", clean):
        return True
    return False


def _parse_resume(text: str) -> list[tuple[str, object]]:
    lines = text.splitlines()
    result: list[tuple[str, object]] = []
    header_block = True
    name_found = False
    title_found = False
    current_section = ""

    for raw in lines:
        stripped = raw.strip()

        if not stripped:
            result.append(("empty", ""))
            continue

        if re.match(r"^[-*=]{3,}$", stripped):
            if header_block and stripped == "---":
                result.append(("hr", ""))
            continue

        if name_found and _is_section_header(stripped):
            clean = _clean_line(stripped)
            header_block = False
            current_section = clean.upper()
            result.append(("section_header", clean))
            continue

        if header_block:
            if not name_found:
                result.append(("name", _clean_line(stripped)))
                name_found = True
                continue
            # Treat as contact when the line clearly contains contact fields
            # (pipes, email, phone, or a URL). Otherwise treat it as an optional
            # title line, which is kept for backward compatibility.
            looks_like_contact = (
                "|" in stripped
                or "@" in stripped
                or re.search(r"\d{3}[-.\s]?\d{3}[-.\s]?\d{4}", stripped)
                or "linkedin" in stripped.lower()
                or stripped.lower().startswith(("http://", "https://"))
            )
            if looks_like_contact:
                result.append(("contact", stripped))
            elif not title_found:
                result.append(("title", _clean_line(stripped)))
                title_found = True
            else:
                result.append(("contact", stripped))
            continue

        if _line_is_role_or_degree_row(stripped, current_section):
            result.append(("job_title", _clean_line(stripped)))
            continue

        skills_section = any(kw in current_section for kw in ("SKILL", "COMPETENC"))
        if skills_section:
            skill_line = stripped
            bulleted = False
            if stripped[0] in ("•", "·", "-", "*") and len(stripped) > 1 and stripped[1] in (" ", "\t"):
                skill_line = stripped[2:].strip()
                bulleted = True
            if ":" in skill_line and not skill_line.startswith("http"):
                idx = skill_line.index(":")
                label = skill_line[:idx].replace("**", "").replace("__", "").strip()
                values = skill_line[idx + 1 :].strip()
                result.append(("skill", (label, values, bulleted)))
                continue

        if stripped[0] in ("•", "·", "-") and (len(stripped) < 2 or stripped[1] in (" ", "\t")):
            result.append(("bullet", stripped.lstrip("•·- ").strip()))
            continue
        if stripped[0] == "*" and len(stripped) > 1 and stripped[1] == " ":
            result.append(("bullet", stripped[2:].strip()))
            continue

        result.append(("body", _clean_line(stripped)))

    return result


def _extract_jd_keywords(jd_text: str) -> list[str]:
    if not jd_text:
        return []

    STOP = {
        "the",
        "and",
        "for",
        "are",
        "you",
        "our",
        "with",
        "this",
        "that",
        "have",
        "from",
        "they",
        "will",
        "your",
        "been",
        "their",
        "has",
        "more",
        "also",
        "can",
        "not",
        "but",
        "its",
        "was",
        "had",
        "about",
        "into",
        "than",
        "them",
        "such",
        "when",
        "which",
        "able",
        "both",
        "use",
        "used",
        "well",
        "new",
        "all",
        "who",
    }

    jd_lower = jd_text.lower()
    keywords: list[str] = []

    words = re.findall(r"\b[a-zA-Z][a-zA-Z0-9+#.-]*\b", jd_text)
    for n in (4, 3, 2):
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i : i + n])
            phrase_lower = phrase.lower()
            content_words = [w for w in phrase_lower.split() if w not in STOP]
            if len(content_words) >= 1 and len(phrase) >= 6:
                if re.search(r"\b" + re.escape(phrase_lower) + r"\b", jd_lower):
                    keywords.append(phrase)

    for word in set(words):
        if len(word) >= 3 and word.lower() not in STOP:
            keywords.append(word)

    seen: set[str] = set()
    result: list[str] = []
    for kw in sorted(keywords, key=len, reverse=True):
        kw_lower = kw.lower()
        if kw_lower not in seen:
            seen.add(kw_lower)
            result.append(kw)

    return result


def _auto_bold_jd_skills(values_str: str, jd_text: str) -> str:
    if not jd_text:
        return values_str

    jd_lower = jd_text.lower()
    items = [item.strip() for item in values_str.split(",")]
    out: list[str] = []
    for item in items:
        clean = item.replace("**", "").strip()
        if not clean:
            continue
        if len(clean) >= 2:
            pattern = r"\b" + re.escape(clean.lower()) + r"\b"
            if re.search(pattern, jd_lower):
                out.append(f"**{clean}**")
                continue
        out.append(clean)
    return ", ".join(out)


def _bold_first_use_in_bullet(text: str, jd_keywords: list[str], seen: set[str]) -> str:
    for kw in jd_keywords:
        kw_lower = kw.lower()
        if kw_lower in seen or len(kw) < 3:
            continue
        pattern = r"(?<!\*)\b(" + re.escape(re.sub(r"\*\*", "", kw)) + r")\b(?!\*)"
        text_plain = re.sub(r"\*\*", "", text)
        if re.search(re.escape(kw_lower), text_plain.lower()):

            def _replacer(m: re.Match) -> str:
                return f"**{m.group(1)}**"

            new_text = re.sub(pattern, _replacer, text, count=1, flags=re.IGNORECASE)
            if new_text != text:
                text = new_text
                seen.add(kw_lower)
    return text


def _add_md_runs(paragraph, text: str, base_size_pt: float, bold_base: bool = False) -> None:
    from docx.shared import Pt

    sanitized = _sanitize_text(text)
    parts = re.split(r"(\*\*[^*]+\*\*)", sanitized)
    for part in parts:
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            run = paragraph.add_run(part[2:-2])
            run.bold = True
        else:
            run = paragraph.add_run(part.replace("**", ""))
            run.bold = bold_base
        run.font.name = _BODY_FONT
        run.font.size = Pt(base_size_pt)


def _build_docx(items: list[tuple[str, object]], jd_text: str = "") -> object:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt

    doc = Document()

    for section in doc.sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)

    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)
    style.paragraph_format.space_before = Pt(0)
    style.paragraph_format.space_after = Pt(0)
    style.paragraph_format.line_spacing = 1.0

    def _para(
        text="",
        bold=False,
        italic=False,
        size=10.5,
        space_before=0,
        space_after=0,
        align=None,
    ):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = 1.0
        if align:
            p.alignment = align
        if text:
            run = p.add_run(text)
            run.bold = bold
            run.italic = italic
            run.font.size = Pt(size)
        return p

    def _add_bottom_rule(paragraph) -> None:
        p_pr = paragraph._p.get_or_add_pPr()
        borders = p_pr.find(qn("w:pBdr"))
        if borders is None:
            borders = OxmlElement("w:pBdr")
            p_pr.append(borders)
        bottom = borders.find(qn("w:bottom"))
        if bottom is None:
            bottom = OxmlElement("w:bottom")
            borders.append(bottom)
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "1")
        bottom.set(qn("w:color"), "B7C3D0")

    def _next_non_empty_type(start_idx: int) -> str:
        for next_idx in range(start_idx + 1, len(items)):
            next_type = items[next_idx][0]
            if next_type != "empty":
                return next_type
        return ""

    jd_keywords = _extract_jd_keywords(jd_text) if jd_text else []
    content_bold_seen: set[str] = set()

    last_bullet_indices: set[int] = set()
    for _i, (_it, _) in enumerate(items):
        if _it == "bullet":
            for _j in range(_i + 1, len(items)):
                if items[_j][0] != "empty":
                    if items[_j][0] != "bullet":
                        last_bullet_indices.add(_i)
                    break
            else:
                last_bullet_indices.add(_i)

    for idx, (item_type, content) in enumerate(items):
        if item_type == "empty":
            continue

        if item_type == "name":
            p = _para(space_before=0, space_after=2, align=WD_ALIGN_PARAGRAPH.CENTER)
            run = p.add_run(str(content))
            run.bold = True
            run.font.name = _BODY_FONT
            run.font.size = Pt(18)

        elif item_type == "title":
            p = _para(space_before=0, space_after=2, align=WD_ALIGN_PARAGRAPH.CENTER)
            run = p.add_run(str(content))
            run.bold = False
            run.font.name = _BODY_FONT
            run.font.size = Pt(12)

        elif item_type == "contact":
            p = _para(space_before=0, space_after=8, align=WD_ALIGN_PARAGRAPH.CENTER)
            _add_md_runs(p, str(content), base_size_pt=10.5)
            if _next_non_empty_type(idx) == "section_header":
                _add_bottom_rule(p)

        elif item_type == "hr":
            continue

        elif item_type == "section_header":
            display = str(content).strip().title()
            p = _para(space_before=10, space_after=4)
            run = p.add_run(display)
            run.bold = True
            run.font.name = _BODY_FONT
            run.font.size = Pt(12)
            _add_bottom_rule(p)

        elif item_type == "job_title":
            raw = re.sub(r"\*\*", "", str(content)).strip()
            parts = [x.strip() for x in raw.split("|") if x.strip()]
            first = parts[0] if parts else raw
            if len(parts) >= 4:
                role_co = f"{parts[0]}  |  {parts[1]}"
                right = "  |  ".join(parts[2:])
            elif len(parts) == 3:
                role_co = f"{parts[0]}  |  {parts[1]}"
                right = parts[2]
            elif "--" in first:
                sub = [x.strip() for x in first.split("--", 1)]
                role_co = f"{sub[0]} \u2014 {sub[1]}"
                right = ""
            elif "\u2014" in first:
                sub = [x.strip() for x in first.split("\u2014", 1)]
                role_co = f"{sub[0]} \u2014 {sub[1]}"
                right = ""
            else:
                role_co = first
                right = "  |  ".join(parts[1:]) if len(parts) > 1 else ""

            p = _para(space_before=6, space_after=2)
            pPr = p._p.get_or_add_pPr()
            tabs_el = OxmlElement("w:tabs")
            tab_el = OxmlElement("w:tab")
            tab_el.set(qn("w:val"), "right")
            tab_el.set(qn("w:pos"), "10080")
            tabs_el.append(tab_el)
            pPr.append(tabs_el)

            run = p.add_run(role_co)
            run.bold = True
            run.font.name = _BODY_FONT
            run.font.size = Pt(11)
            if right:
                run_tab = p.add_run("\t")
                run_tab.font.name = _BODY_FONT
                run_tab.font.size = Pt(10.5)
                run2 = p.add_run(right)
                run2.bold = False
                run2.font.name = _BODY_FONT
                run2.font.size = Pt(10.5)

        elif item_type == "bullet":
            is_last_bullet = idx in last_bullet_indices
            p = _para(space_before=0, space_after=6 if is_last_bullet else 0)
            p.paragraph_format.left_indent = Inches(0.2)
            p.paragraph_format.first_line_indent = Inches(-0.2)
            run = p.add_run("\u2022 ")
            run.font.name = _BODY_FONT
            run.font.size = Pt(10.5)
            bullet_text = _bold_first_use_in_bullet(
                str(content), jd_keywords, content_bold_seen
            )
            _add_md_runs(p, bullet_text, base_size_pt=10.5)

        elif item_type == "skill":
            label, values, _bulleted = content  # type: ignore[misc]
            p = _para(space_before=0, space_after=2)
            r_label = p.add_run(f"{label}: ")
            r_label.bold = True
            r_label.font.name = _BODY_FONT
            r_label.font.size = Pt(10.5)
            # Skill items stay plain (no per-item bolding); only the
            # category label above is bold. This matches the CV-platform
            # style and avoids highlighter-style noise in Skills.
            plain_values = re.sub(r"\*\*([^*]+)\*\*", r"\1", str(values))
            _add_md_runs(p, plain_values, base_size_pt=10.5)

        elif item_type == "body":
            p = _para(space_before=0, space_after=0)
            p.paragraph_format.left_indent = Inches(0)
            p.paragraph_format.first_line_indent = Inches(0)
            body_text = _bold_first_use_in_bullet(
                str(content), jd_keywords, content_bold_seen
            )
            _add_md_runs(p, body_text, base_size_pt=10.5)

    return doc


_STOP_WORDS = {
    "the", "and", "for", "are", "you", "our", "with", "this", "that", "have",
    "from", "they", "will", "your", "been", "their", "has", "more", "also",
    "can", "not", "but", "its", "was", "had", "about", "into", "than", "them",
    "such", "when", "which", "able", "both", "well", "new", "all", "who",
    "use", "used", "each", "across", "these", "those", "while", "where",
    "what", "than", "then", "over", "through", "during", "between", "after",
    "before", "under", "above", "using", "based", "within", "including",
    "teams", "team", "time",
}


_VERB_GROUPS: dict[str, list[str]] = {
    "Build/Create": ["architected", "built", "constructed", "created", "designed", "devised", "engineered", "prototyped", "programmed"],
    "Improve/Optimize": ["accelerated", "enhanced", "optimized", "refined", "refactored", "streamlined", "upgraded", "modernized"],
    "Grow/Scale": ["amplified", "boosted", "expanded", "grew", "increased", "lifted", "maximized", "scaled"],
    "Reduce/Cut": ["consolidated", "decreased", "eliminated", "minimized", "reduced", "saved", "trimmed"],
    "Lead/Direct": ["chaired", "coordinated", "delegated", "directed", "headed", "mentored", "orchestrated", "spearheaded"],
    "Deliver/Ship": ["delivered", "deployed", "executed", "expedited", "launched", "produced", "shipped", "released"],
    "Analyze/Measure": ["analyzed", "audited", "benchmarked", "diagnosed", "evaluated", "modeled", "profiled", "validated"],
    "Integrate/Connect": ["configured", "incorporated", "integrated", "introduced", "migrated", "unified"],
    "Document/Communicate": ["authored", "documented", "drafted", "formalized", "presented", "published"],
    "Solve/Fix": ["debugged", "reconciled", "resolved", "restructured", "standardized", "tested"],
    "Initiate/Pioneer": ["established", "founded", "initiated", "instituted", "pioneered"],
    "Collaborate": ["collaborated", "partnered"],
    "Achieve": ["achieved", "attained", "exceeded", "outpaced", "surpassed"],
}

_VERB_TO_GROUP: dict[str, str] = {}
for _grp, _verbs in _VERB_GROUPS.items():
    for _v in _verbs:
        _VERB_TO_GROUP[_v] = _grp


def _suggest_replacement(verb: str) -> str:
    grp = _VERB_TO_GROUP.get(verb)
    if not grp:
        return ""
    alternatives = [v for v in _VERB_GROUPS[grp] if v != verb]
    return f" (try: {', '.join(alternatives[:4])})" if alternatives else ""


def audit_word_repetition(resume_text: str) -> list[str]:
    """
    Scan Summary + bullet text for over-repeated words.
    Returns a list of warning strings (empty = clean).
    """
    import logging
    logger = logging.getLogger(__name__)

    items = _parse_resume(resume_text)
    bullet_texts: list[str] = []
    leading_verbs: list[str] = []

    for kind, content in items:
        if kind in ("bullet", "body"):
            text = str(content).strip()
            bullet_texts.append(text)
            first_word = re.split(r"\s+", text)[0].lower().rstrip(".,;:")
            if len(first_word) >= 3:
                leading_verbs.append(first_word)

    full_text = " ".join(bullet_texts).lower()
    words = re.findall(r"\b[a-z][a-z-]{3,}\b", full_text)

    counts: dict[str, int] = {}
    for w in words:
        if w not in _STOP_WORDS:
            counts[w] = counts.get(w, 0) + 1

    verb_counts: dict[str, int] = {}
    for v in leading_verbs:
        verb_counts[v] = verb_counts.get(v, 0) + 1

    warnings: list[str] = []

    for verb, n in verb_counts.items():
        if n > 1:
            suggestion = _suggest_replacement(verb)
            msg = f"Leading action verb '{verb}' repeated {n}x (max 1){suggestion}"
            warnings.append(msg)
            logger.warning("resume-audit: %s", msg)

    for word, n in sorted(counts.items(), key=lambda x: -x[1]):
        if n > 2 and word not in _STOP_WORDS:
            msg = f"Word '{word}' appears {n}x (max 2)"
            warnings.append(msg)
            logger.warning("resume-audit: %s", msg)

    if not warnings:
        logger.info("resume-audit: PASS — no word repetition issues found")

    return warnings


def _jd_text_for_job(job) -> str:
    parts = [
        getattr(job, "title", None) or "",
        getattr(job, "description_text", None) or "",
    ]
    return " ".join(p for p in parts if p)


def build_formatted_resume_docx(resume_text: str, job, profile_name: str) -> tuple[BytesIO, str]:
    """Build resume .docx in memory. Returns (buffer, filename)."""
    items = _parse_resume(str(resume_text or ""))
    doc = _build_docx(items, jd_text=_jd_text_for_job(job))

    candidate_name = (profile_name or "").strip() or "Candidate"
    company_name = getattr(job, "company_name", None) or ""
    job_title = getattr(job, "title", None) or "Role"
    today = date.today().isoformat()
    filename = (
        f"{_safe_filename(candidate_name)}_{_safe_filename(company_name)}"
        f"_{_safe_filename(job_title)}_{today}.docx"
    )
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf, filename
