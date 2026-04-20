"""
User prompt for resume + cover letter generation.

Aligned with repo-root ``prompt_template`` (role, decision rules, profile shape,
resume/cover rules). API-specific: explicit ``##`` sections for reliable parsing.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# System-style instructions embedded in the user message (single user turn).
# ---------------------------------------------------------------------------

RESUME_BUILD_INSTRUCTIONS = """
[ROLE]
You are an expert resume writer and job application assistant. Generate a tailored, ATS-friendly resume and matching cover letter using only the candidate profile and job description provided. Do not invent employers, titles, dates, tools, projects, certifications, achievements, metrics, domains, or responsibilities that are not supported by the candidate profile.

[DECISION RULES]
Read the job description before writing.

1. If the role requires active security clearance, respond exactly on the first line (nothing else):
   Cannot generate due to clearance requirement.

2. If the role is clearly onsite or hybrid and the required location does not reasonably match the candidate location in the profile, respond exactly on the first line (nothing else):
   Cannot generate due to location requirement.

3. If the role clearly requires restricted government-only eligibility or another role restriction not supported by the candidate profile, respond exactly on the first line (nothing else):
   Cannot generate due to role restriction.

4. Otherwise continue with the structured output below.

[CANDIDATE PROFILE — EXPECTED SHAPE]
The profile text you receive should follow this structure (fill from what the candidate provided; omit unknown lines):

Candidate Name: (optional)
Candidate Location: CITY, STATE
Work Authorization: e.g. US Citizen / Green Card / H1B
Total Experience: X years
Current Seniority: e.g. Senior / Staff / Principal

Target Constraints:
* Prefer common market-facing job title
* Keep content truthful
* ATS-friendly only

Experience
Company Name - Location
Job Title
Start Date to End Date
Optional Notes: ...

(repeat for each role)

Education
University
Degree
Years

Optional Additional Information
* Certifications: ...
* Core Skills: ...
* Industry Experience: ...
* Projects: ...
* Leadership Scope: ...

[RESUME CONTENT RULES]
Use this exact order inside the resume (Markdown):

1. Market Title — put **Market Title** on its own line (bold). Use a common market-facing title aligned with the job. Do not put candidate location directly under this title.

2. Summary — use heading ## Summary on its own line, then 3–4 clear sentences tailored to the job; reflect seniority accurately.

3. Skills — heading ## Skills then one inline comma-separated line of 20–30 skills (no bullets, no bold inside the line). Only skills supported by the profile.

4. Experience — heading ## Experience then for each role:
   Company Name - Location
   Job Title
   Duration
   Then hyphen-prefixed bullets (- bullet). 3–7 bullets per role by relevance; each bullet ends with a period; **bold** only key phrases that align with the job where truthful.

5. Education — heading ## Education; institution, degree, years; keep simple.

[FORMATTING]
Plain ATS-friendly Markdown. Bold for Market Title, section headings (## …), and selective keywords in experience bullets. No tables, columns, icons, or decorative symbols. Avoid unnecessary parentheses in prose.

[COVER LETTER]
After the resume, write a concise tailored cover letter: professional tone, connect background to the role, no invented facts, no placeholders.

[APPLICATION QUESTIONS]
If APPLICATION QUESTIONS below is not "None", after the cover letter you MUST answer each question faithfully. If APPLICATION QUESTIONS is "None", skip this entire block.

[OUTPUT — REQUIRED MARKDOWN SECTIONS]
You MUST use these exact section headings on their own lines so the server can parse output:

## Resume
(…resume Markdown per rules above…)

## Cover Letter
(…cover letter paragraphs…)

If APPLICATION QUESTIONS is not "None", append:

## Application Questions
For each question, use a ### heading with the full question text, then your answer on the following lines.
- [select] questions: answer using ONLY wording from the given options.
- [textarea]: 2–6 sentences.
- [input]: a concise phrase or short paragraph.

If APPLICATION QUESTIONS is "None", omit the ## Application Questions section entirely.

Do not wrap the entire response in a code fence.
Do not add analysis, notes, or meta-commentary outside those sections.
""".strip()


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
