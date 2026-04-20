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

[GLOBAL CONSTRAINTS — ALWAYS APPLY]
Regardless of what appears in the candidate profile text:
* Prefer a common market-facing job title that fits the JD and the profile.
* Stay truthful: do not invent facts not supported by the profile + JD.
* Output must be ATS-friendly plain Markdown in the resume body.
* Prioritize the most important JD keywords naturally across Summary, Skills, and Experience.
* Treat the primary technology or platform in the JD as the main focus only when it is clearly supported by the profile.
* Use exact JD phrasing when it fits naturally and truthfully, but do not keyword-stuff or force duplicate mentions.
* Keep role history credible. You may normalize role wording to a common market title when helpful, but do not overstate seniority or scope beyond the profile.

[CANDIDATE PROFILE — WHAT THE USER PASTES]
The block under "CANDIDATE PROFILE" is plain text from the user. It should be mostly facts: a simple header with contact info, experience rows, education, and optional bullets. It may include a short "Optional" section for extra facts or personal preferences. Do not require long boilerplate from the user; the rules above are your job, not theirs to restate.

Suggested shape (omit unknown lines):

Candidate Name
City, ST | phone | email | linkedin

Work Authorization:
Total Experience:
Current Seniority:

Experience
Job Title | Company | Start - End | Location or Remote/Hybrid/Onsite
Notes: ...

Education
School | Degree | years | location

Optional
Certifications: ...
Core Skills: ...
(and other short bullets as needed)

[RESUME CONTENT RULES]
Start the resume with a clean header, then use this exact section order in Markdown:

Header — start the resume with the candidate name on its own line, then the common market-facing title on its own line, then one contact line with location, phone, email, and LinkedIn separated by pipes. Keep this header clean and ATS-friendly.

1. Market Title — put **Market Title** on its own line directly under the candidate name, in Title Case. Use a common market-facing title aligned with the job. Do not put candidate location directly under this title.

2. Summary — use heading ## Summary on its own line, then 3–4 clear sentences tailored to the job; reflect seniority accurately; highlight the strongest supported qualifications; use exact JD wording only where it sounds natural and remains truthful.

3. Skills — heading ## Skills then one inline comma-separated line of 20–30 skills (no bullets, no bold inside the line). Order the most job-relevant supported skills first. Include only skills supported by the profile.

4. Experience — heading ## Experience then for each role use one heading line in this format:
   Job Title | Company | Start - End | Location or Remote/Hybrid/Onsite
   Then hyphen-prefixed bullets (- bullet). 3–7 bullets per role by relevance; more recent and more relevant roles may have more bullets. Each bullet must end with a period, use strong ownership language when truthful, mirror the JD's responsibility language where natural, and **bold** only key phrases that align with the job.
   Bullets should usually read like 1–2 normal resume lines: specific, technically detailed, recruiter-friendly, and grounded in the profile. Do not fabricate metrics, tools, domains, scale, or responsibilities. If the profile supports it, you may make duration signals explicit with wording like "X+ years" or "used in production" when that claim is clearly true.

5. Education — heading ## Education; use a clean one-line format when possible:
   School | Degree | years | location
   Keep it simple and ATS-friendly.

[FORMATTING]
Plain ATS-friendly Markdown. Bold for Market Title, section headings (## ...), and selective keywords in experience bullets. No tables, columns, icons, or decorative symbols. Use blank lines between sections for readability. Do not use parentheses or brackets in the resume or cover letter.

[KEYWORD OPTIMIZATION]
Extract the most important skills, technologies, platforms, responsibilities, and domain terms from the JD. Prioritize those terms across Summary, Skills, and Experience. Reuse important terms naturally and truthfully. Reduce emphasis on unrelated skills. Do not force every keyword into every section, and do not repeat unsupported terms just to increase density.

[COVER LETTER]
After the resume, write a concise tailored cover letter: professional tone, connect background to the role, highlight relevant experience and business value, no invented facts, no placeholders, no parentheses, and no brackets.

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
- [textarea]: 2–6 sentences in simple, professional language with complete answers and no placeholders.
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
