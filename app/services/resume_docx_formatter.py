"""
ATS-oriented resume .docx generation.

Renders model Markdown into .docx with real bold formatting for ``**keyword**`` markers.
Structural styling: name, section titles, experience header rows, skill category labels.

Layout spec: **Cambria**, **26 pt** bold name, **11 pt** body, **11 pt bold** section titles,
**0.5 in** narrow margins, **~1.1** line spacing. Name + contact centered; all other content
left-aligned. Contact info in the document body, never Word header/footer.

Experience rows: bold **Role | Company** on line 1, Location | Dates on line 2.
Bullets: 0.25 in hanging indent, tight stack, solid bullet leader.
Skills: bold category label + tab stop + plain values for aligned wrapping.

Text cleanup: curly quotes to ASCII, collapsed whitespace, date normalization to
``Month YYYY - Month YYYY`` with simple hyphens (no em/en dashes).

Sections reordered: Summary, Skills, Experience, Education, then other, regardless of model order.
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
    "APPLICATION QUESTIONS",
}

_EXPERIENCE_SECTIONS = {
    "WORK EXPERIENCE",
    "PROFESSIONAL EXPERIENCE",
    "EXPERIENCE",
    "EDUCATION",
}

_EXPERIENCE_ROLE_SECTIONS = frozenset(
    {
        "WORK EXPERIENCE",
        "PROFESSIONAL EXPERIENCE",
        "EXPERIENCE",
        "PROJECTS",
        "NOTABLE PROJECTS",
        "KEY PROJECTS",
    }
)

_BODY_FONT = "Cambria"
_BODY_PT = 11.0
_NAME_PT = 26.0
_SECTION_TITLE_PT = 11.0
_LINE_SPACING = 1.1
_MARGINS_IN = 0.5
_BULLET_LEFT_INDENT_IN = 0.25
_BULLET_FIRST_LINE_INDENT_IN = -0.25
_BULLET_LEADER = "\u2022 "
_SKILL_VALUE_TAB_IN = 2.2
_SKILL_HANGING_INDENT_IN = 2.2


def _safe_filename(value: str) -> str:
    return re.sub(r"[^\w\s-]", "", str(value or "")).strip().replace(" ", "_")


def _strip_md_bold(text: str) -> str:
    s = text.strip()
    if s.startswith("**") and s.endswith("**") and len(s) > 4:
        inner = s[2:-2].strip()
        if "**" not in inner:
            return inner
    return s


def _strip_md_spans_for_skill_values(text: str) -> str:
    """Skills: strip ``**...**`` so only the formatter's category label stays bold."""
    return re.sub(r"\*\*([^*]+)\*\*", r"\1", str(text or ""))


def _strip_md_heading(text: str) -> str:
    return re.sub(r"^#{1,6}\s*", "", text.strip())


def _sanitize_text(text: str) -> str:
    """Normalize encoding-safe whitespace and quotes; does not rewrite vocabulary."""
    s = text
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


_MONTH_ABBR_TO_FULL = {
    "jan": "January",
    "feb": "February",
    "mar": "March",
    "apr": "April",
    "may": "May",
    "jun": "June",
    "jul": "July",
    "aug": "August",
    "sep": "September",
    "sept": "September",
    "oct": "October",
    "nov": "November",
    "dec": "December",
}
_FULL_MONTH_RE = re.compile(
    r"\b("
    + "|".join(
        [
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ]
    )
    + r")\s+(\d{4})\b",
    re.IGNORECASE,
)
_ABBR_MONTH_RE = re.compile(
    r"\b(" + "|".join(_MONTH_ABBR_TO_FULL) + r")\.?\s+(\d{4})\b",
    re.IGNORECASE,
)


def _normalize_dates(text: str) -> str:
    """Normalize dates to full month names and a simple hyphen separator."""
    def _full(m: re.Match) -> str:
        return f"{m.group(1).capitalize()} {m.group(2)}"

    def _expand(m: re.Match) -> str:
        return f"{_MONTH_ABBR_TO_FULL[m.group(1).lower().rstrip('.')]} {m.group(2)}"

    s = _FULL_MONTH_RE.sub(_full, text)
    s = _ABBR_MONTH_RE.sub(_expand, s)

    def _range_dash(m: re.Match) -> str:
        return f"{m.group(1)} - {m.group(2)}"

    s = re.sub(
        r"([A-Za-z]+\s+\d{4})\s*[\u2013\u2014-]\s*([A-Za-z]+\s+\d{4}|Present)",
        _range_dash,
        s,
    )
    return s


def _clean_line(text: str) -> str:
    return _normalize_dates(_sanitize_text(_strip_md_bold(_strip_md_heading(text))))


def _is_section_header(line: str) -> bool:
    raw = line.strip()
    stripped = _clean_line(raw)
    head = _strip_md_heading(raw)
    if head.upper() in _SECTION_KEYWORDS or stripped.upper() in _SECTION_KEYWORDS:
        return True
    check = head.strip()
    return (
        check.isupper()
        and 3 <= len(check) <= 80
        and "|" not in check
        and "\u2022" not in check
        and "@" not in check
        and not check.startswith("http")
    )


def _line_is_role_or_degree_row(stripped: str, current_section: str) -> bool:
    """
    Experience/education entry line: has | (dates) and/or Role - Company / Degree - School.
    Models often emit ### headings instead of the pipe form; those must still become job_title rows.
    """
    if current_section not in _EXPERIENCE_SECTIONS:
        return False
    if "\u2022" in stripped:
        return False
    clean = _clean_line(stripped)
    if not clean or len(clean) < 6:
        return False
    if "|" in stripped:
        return True
    if "\u2014" in clean or " -- " in clean:
        return True
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
                result.append(("contact", _clean_line(stripped)))
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
            if stripped[0] in ("\u2022", "\u00b7", "-", "*") and len(stripped) > 1 and stripped[1] in (" ", "\t"):
                skill_line = stripped[2:].strip()
                bulleted = True
            if ":" in skill_line and not skill_line.startswith("http"):
                idx = skill_line.index(":")
                label = skill_line[:idx].replace("**", "").replace("__", "").strip()
                values = skill_line[idx + 1 :].strip()
                if values.startswith("**") and "**" not in values[2:]:
                    values = values[2:].strip()
                result.append(("skill", (label, values, bulleted)))
                continue

        if stripped[0] in ("\u2022", "\u00b7", "-") and (len(stripped) < 2 or stripped[1] in (" ", "\t")):
            result.append(("bullet", stripped.lstrip("\u2022\u00b7- ").strip()))
            continue
        if stripped[0] == "*" and len(stripped) > 1 and stripped[1] == " ":
            result.append(("bullet", stripped[2:].strip()))
            continue

        result.append(("body", _clean_line(stripped)))

    return result


def _section_bucket(header_line: str) -> int:
    """
    Canonical section order for DOCX output (lower sorts earlier).
    10 Summary, 20 Skills, 30 Experience/Projects, 40 Education, 45 certs/etc., 50 other.
    """
    u = str(header_line or "").strip().upper()
    if u in (
        "SUMMARY",
        "MARKET TITLE",
        "PROFESSIONAL SUMMARY",
        "OBJECTIVE",
    ):
        return 10
    if "SKILL" in u or "COMPETENC" in u:
        return 20
    if u in (
        "WORK EXPERIENCE",
        "PROFESSIONAL EXPERIENCE",
        "EXPERIENCE",
        "PROJECTS",
        "NOTABLE PROJECTS",
        "KEY PROJECTS",
    ):
        return 30
    if u == "EDUCATION":
        return 40
    if u in (
        "CERTIFICATIONS",
        "CERTIFICATIONS OR ACHIEVEMENTS",
        "ACHIEVEMENTS",
        "AWARDS",
        "ADDITIONAL INFORMATION",
    ):
        return 45
    if u in ("APPLICATION QUESTIONS", "APPLICATION Q&A", "APPLICATION ANSWERS"):
        return 55
    return 50


def _reorder_section_blocks(items: list[tuple[str, object]]) -> list[tuple[str, object]]:
    """Place Summary, Skills, Experience, Education (then other sections) regardless of model order."""
    if not items:
        return items
    i = 0
    preamble: list[tuple[str, object]] = []
    while i < len(items) and items[i][0] != "section_header":
        preamble.append(items[i])
        i += 1

    buckets: dict[int, list[tuple[str, object]]] = {
        10: [],
        20: [],
        30: [],
        40: [],
        45: [],
        50: [],
        55: [],
    }
    while i < len(items):
        if items[i][0] != "section_header":
            preamble.append(items[i])
            i += 1
            continue
        block: list[tuple[str, object]] = [items[i]]
        hdr = str(items[i][1]).strip()
        i += 1
        while i < len(items) and items[i][0] != "section_header":
            block.append(items[i])
            i += 1
        buckets[_section_bucket(hdr)].extend(block)

    out: list[tuple[str, object]] = list(preamble)
    for k in (10, 20, 30, 40, 45, 50, 55):
        out.extend(buckets.get(k, []))
    return out


_SKILL_LABEL_SHORT: dict[str, str] = {
    "cloud, infrastructure & tools": "Cloud & Tools",
    "cloud infrastructure & tools": "Cloud & Tools",
    "cloud & infrastructure": "Cloud & Tools",
    "cloud and infrastructure": "Cloud & Tools",
    "concepts & methodologies": "Engineering Practices",
    "concepts and methodologies": "Engineering Practices",
    "testing, quality & sdlc": "Testing & SDLC",
    "testing quality & sdlc": "Testing & SDLC",
    "databases & data": "Databases",
    "apis & integration": "APIs & Integration",
}


def _short_skill_category_label(label: str) -> str:
    key = str(label or "").strip().lower()
    return _SKILL_LABEL_SHORT.get(key, str(label or "").strip())


_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
_YEAR_RANGE_RE = re.compile(
    r"\b((?:19|20)\d{2})\s*[\u2013\u2014-]\s*((?:19|20)\d{2})\b"
)
_SCHOOL_RE = re.compile(
    r"\b(University|College|Institute|School|Academy|Polytechnic)\b",
    re.IGNORECASE,
)


def _contains_year(text: str) -> bool:
    s = str(text or "")
    return bool(_YEAR_RANGE_RE.search(s) or _YEAR_RE.search(s))


def _extract_year_range(text: str) -> str:
    """Preserve start-end ranges from profile (e.g. 2016-2019 -> 2016 - 2019)."""
    s = str(text or "").strip()
    m = _YEAR_RANGE_RE.search(s)
    if m:
        return f"{m.group(1)} - {m.group(2)}"
    m = _YEAR_RE.search(s)
    if m:
        return m.group(0)
    return s


def _looks_like_school(text: str) -> bool:
    return bool(_SCHOOL_RE.search(str(text or "")))


def _split_pipe_parts(raw: str) -> list[str]:
    normalized = re.sub(r"\t+", " | ", re.sub(r"\*\*", "", str(raw)).strip())
    return [x.strip() for x in normalized.split("|") if x.strip()]


def _parse_education_fields(parts: list[str]) -> tuple[str, str, str, str]:
    """
    Normalize to (degree, school, location, years).
    Profile format: School | Degree | StartYear-EndYear | Location
    Common model output: Degree | School  then  Location | StartYear-EndYear
    """
    clean = [p.strip() for p in parts if p.strip()]
    if not clean:
        return "", "", "", ""

    if len(clean) >= 4:
        a, b, c, d = clean[0], clean[1], clean[2], clean[3]
        if _looks_like_school(a) and not _looks_like_school(b):
            school, degree = a, b
        elif _looks_like_school(b):
            degree, school = a, b
        else:
            school, degree = a, b
        if _contains_year(c) and not _contains_year(d):
            location, years = d, _extract_year_range(c)
        elif _contains_year(d) and not _contains_year(c):
            location, years = c, _extract_year_range(d)
        else:
            location, years = d, _extract_year_range(c)
        return degree, school, location, years

    if len(clean) == 3:
        a, b, c = clean
        if _looks_like_school(a):
            return b, a, "", _extract_year_range(c)
        if _looks_like_school(b):
            return a, b, "", _extract_year_range(c)
        return a, b, "", _extract_year_range(c)

    if len(clean) == 2:
        a, b = clean
        if _contains_year(a) or _contains_year(b):
            if _contains_year(b):
                return "", "", a, _extract_year_range(b)
            return "", "", b, _extract_year_range(a)
        if _looks_like_school(b):
            return a, b, "", ""
        if _looks_like_school(a):
            return b, a, "", ""
        return a, b, "", ""

    return clean[0], "", "", ""


def _next_education_subline(items: list[tuple[str, object]], start_idx: int) -> tuple[int, list[str]] | None:
    """If the next row is a 2-part location|year education line, return its index and parts."""
    for j in range(start_idx + 1, len(items)):
        item_type, content = items[j]
        if item_type == "empty":
            continue
        if item_type != "job_title":
            return None
        parts = _split_pipe_parts(str(content))
        if len(parts) == 2 and (_contains_year(parts[0]) or _contains_year(parts[1])):
            return j, parts
        return None
    return None


def _add_md_runs(paragraph, text: str, base_size_pt: float, bold_base: bool = False) -> None:
    from docx.shared import Pt

    base_size_pt = float(base_size_pt) if base_size_pt else _BODY_PT
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


def _build_docx(items: list[tuple[str, object]]) -> object:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    doc = Document()

    _COLOR_BLACK = RGBColor(0x00, 0x00, 0x00)

    for section in doc.sections:
        m = Inches(_MARGINS_IN)
        section.top_margin = m
        section.bottom_margin = m
        section.left_margin = m
        section.right_margin = m

    style = doc.styles["Normal"]
    style.font.name = _BODY_FONT
    style.font.size = Pt(_BODY_PT)
    style.paragraph_format.space_before = Pt(0)
    style.paragraph_format.space_after = Pt(0)
    style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    style.paragraph_format.line_spacing = _LINE_SPACING

    def _para(
        text="",
        bold=False,
        italic=False,
        size=_BODY_PT,
        space_before=0,
        space_after=0,
        align=WD_ALIGN_PARAGRAPH.LEFT,
    ):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        p.paragraph_format.line_spacing = _LINE_SPACING
        if align is not None:
            p.alignment = align
        if text:
            run = p.add_run(text)
            run.bold = bold
            run.italic = italic
            run.font.name = _BODY_FONT
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
        bottom.set(qn("w:sz"), "4")
        bottom.set(qn("w:space"), "1")
        bottom.set(qn("w:color"), "999999")

    def _next_non_empty_type(start_idx: int) -> str:
        for next_idx in range(start_idx + 1, len(items)):
            next_type = items[next_idx][0]
            if next_type != "empty":
                return next_type
        return ""

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

    def _set_right_tab(paragraph, pos: int = 10080) -> None:
        pPr = paragraph._p.get_or_add_pPr()
        tabs_el = OxmlElement("w:tabs")
        tab_el = OxmlElement("w:tab")
        tab_el.set(qn("w:val"), "right")
        tab_el.set(qn("w:pos"), str(pos))
        tabs_el.append(tab_el)
        pPr.append(tabs_el)

    def _add_plain(
        paragraph,
        text: str,
        *,
        bold: bool = False,
        italic: bool = False,
        size: float = _BODY_PT,
        color=None,
    ) -> None:
        run = paragraph.add_run(text)
        run.bold = bold
        run.italic = italic
        run.font.name = _BODY_FONT
        run.font.size = Pt(size)
        if color is not None:
            run.font.color.rgb = color

    current_section = ""
    consumed_indices: set[int] = set()

    for idx, (item_type, content) in enumerate(items):
        if idx in consumed_indices:
            continue
        if item_type == "empty":
            continue

        if item_type == "name":
            p = _para(space_before=0, space_after=3, align=WD_ALIGN_PARAGRAPH.CENTER)
            run = p.add_run(str(content))
            run.bold = True
            run.font.name = _BODY_FONT
            run.font.size = Pt(_NAME_PT)
            run.font.color.rgb = _COLOR_BLACK

        elif item_type == "title":
            continue

        elif item_type == "contact":
            p = _para(space_before=0, space_after=9, align=WD_ALIGN_PARAGRAPH.CENTER)
            _add_md_runs(p, str(content), base_size_pt=_BODY_PT)
            if _next_non_empty_type(idx) == "section_header":
                _add_bottom_rule(p)

        elif item_type == "hr":
            continue

        elif item_type == "section_header":
            display = str(content).strip().title()
            current_section = display.upper()
            p = _para(space_before=10, space_after=7)
            run = p.add_run(display)
            run.bold = True
            run.font.name = _BODY_FONT
            run.font.size = Pt(_SECTION_TITLE_PT)
            run.font.color.rgb = _COLOR_BLACK
            _add_bottom_rule(p)

        elif item_type == "job_title":
            parts = _split_pipe_parts(str(content))
            is_education = current_section == "EDUCATION"

            if is_education:
                merged_parts = list(parts)
                if (
                    len(parts) == 2
                    and not _contains_year(parts[0])
                    and not _contains_year(parts[1])
                ):
                    nxt = _next_education_subline(items, idx)
                    if nxt:
                        consumed_indices.add(nxt[0])
                        loc, yr = nxt[1]
                        if _contains_year(yr):
                            merged_parts = parts + [loc, yr]
                        else:
                            merged_parts = parts + [yr, loc]

                degree, school, location, years = _parse_education_fields(merged_parts)

                if degree or school:
                    p1 = _para(space_before=6, space_after=3)
                    if degree and school:
                        _add_plain(p1, degree, bold=True, size=_BODY_PT, color=_COLOR_BLACK)
                        _add_plain(p1, " | ", bold=False, size=_BODY_PT, color=_COLOR_BLACK)
                        _add_plain(p1, school, bold=True, size=_BODY_PT, color=_COLOR_BLACK)
                    elif degree:
                        _add_plain(p1, degree, bold=True, size=_BODY_PT, color=_COLOR_BLACK)
                    else:
                        _add_plain(p1, school, bold=True, size=_BODY_PT, color=_COLOR_BLACK)

                if location or years:
                    years_fmt = _normalize_dates(years) if years else ""
                    line2 = " | ".join(x for x in (location, years_fmt) if x)
                    p2 = _para(space_before=0, space_after=8)
                    _add_plain(p2, line2, bold=False, size=_BODY_PT, color=_COLOR_BLACK)
                elif not (degree or school):
                    p = _para(space_before=6, space_after=8)
                    _add_plain(p, " | ".join(parts), bold=False, size=_BODY_PT, color=_COLOR_BLACK)

            elif len(parts) >= 3:
                role = parts[0]
                company = parts[1]
                dates = parts[2] if len(parts) > 2 else ""
                location = parts[3] if len(parts) > 3 else ""

                p1 = _para(space_before=8, space_after=3)
                if role and company:
                    _add_plain(p1, role, bold=True, size=_BODY_PT, color=_COLOR_BLACK)
                    _add_plain(p1, " | ", bold=False, size=_BODY_PT, color=_COLOR_BLACK)
                    _add_plain(p1, company, bold=True, size=_BODY_PT, color=_COLOR_BLACK)
                elif role:
                    _add_plain(p1, role, bold=True, size=_BODY_PT, color=_COLOR_BLACK)
                elif company:
                    _add_plain(p1, company, bold=True, size=_BODY_PT, color=_COLOR_BLACK)

                line2 = " | ".join(x for x in (location, dates) if x)
                if line2:
                    p2 = _para(space_before=0, space_after=6)
                    _add_plain(p2, line2, bold=False, size=_BODY_PT, color=_COLOR_BLACK)

            else:
                first = parts[0] if parts else raw
                if "\u2014" in first:
                    sub = [x.strip() for x in first.split("\u2014", 1)]
                    role_co = f"{sub[0]} - {sub[1]}"
                    right = ""
                elif "--" in first:
                    sub = [x.strip() for x in first.split("--", 1)]
                    role_co = f"{sub[0]} - {sub[1]}"
                    right = ""
                elif len(parts) >= 2:
                    role_co = f"{parts[1]}, {parts[0]}"
                    right = ""
                else:
                    role_co = first
                    right = ""
                p = _para(space_before=6, space_after=4)
                _set_right_tab(p)
                _add_plain(p, role_co, bold=True, size=_BODY_PT, color=_COLOR_BLACK)
                if right:
                    _add_plain(p, "\t", size=_BODY_PT)
                    _add_plain(p, right, size=_BODY_PT)

        elif item_type == "bullet":
            is_last_bullet = idx in last_bullet_indices
            in_exp = current_section in _EXPERIENCE_ROLE_SECTIONS
            in_edu = current_section == "EDUCATION"
            if in_exp:
                space_before = 0
                space_after = 6 if is_last_bullet else 0
            elif in_edu:
                space_before = 0
                space_after = 5 if is_last_bullet else 0
            else:
                space_before = 0
                space_after = 4 if is_last_bullet else 0
            p = _para(space_before=space_before, space_after=space_after)
            p.paragraph_format.left_indent = Inches(_BULLET_LEFT_INDENT_IN)
            p.paragraph_format.first_line_indent = Inches(_BULLET_FIRST_LINE_INDENT_IN)
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            p.paragraph_format.line_spacing = _LINE_SPACING
            run = p.add_run(_BULLET_LEADER)
            run.font.name = _BODY_FONT
            run.font.size = Pt(_BODY_PT)
            _add_md_runs(p, str(content), base_size_pt=_BODY_PT)

        elif item_type == "skill":
            label, values, _bulleted = content  # type: ignore[misc]
            label_out = _short_skill_category_label(str(label))
            plain_values = _strip_md_spans_for_skill_values(str(values))
            p = _para(space_before=0, space_after=3)
            p.paragraph_format.left_indent = Inches(_SKILL_HANGING_INDENT_IN)
            p.paragraph_format.first_line_indent = Inches(-_SKILL_HANGING_INDENT_IN)
            p.paragraph_format.tab_stops.add_tab_stop(
                Inches(_SKILL_VALUE_TAB_IN),
                WD_TAB_ALIGNMENT.LEFT,
            )
            r_label = p.add_run(f"{label_out}:\t")
            r_label.bold = True
            r_label.font.name = _BODY_FONT
            r_label.font.size = Pt(_BODY_PT)
            _add_md_runs(p, plain_values, base_size_pt=_BODY_PT)

        elif item_type == "body":
            is_summary = "SUMMARY" in current_section
            sa = 6 if is_summary else 0
            p = _para(space_before=0, space_after=sa)
            p.paragraph_format.left_indent = Inches(0)
            p.paragraph_format.first_line_indent = Inches(0)
            _add_md_runs(p, str(content), base_size_pt=_BODY_PT)

    return doc


def build_formatted_resume_docx(resume_text: str, job, profile_name: str) -> tuple[BytesIO, str]:
    """Build resume .docx in memory. Returns (buffer, filename)."""
    items = _reorder_section_blocks(_parse_resume(str(resume_text or "")))
    doc = _build_docx(items)

    candidate_name = (profile_name or "").strip() or "Candidate"
    company_name = getattr(job, "company_name", None) or ""
    filename = f"{_safe_filename(candidate_name)}_{_safe_filename(company_name)}.docx"
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf, filename
