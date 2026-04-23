"""One-off: write a sample formatted resume .docx using the production formatter."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.services.resume_docx_formatter import build_formatted_resume_docx

SAMPLE_MARKDOWN = """# Cheuk Chan
Homestead, FL | cheukchan9503@outlook.com | 352-723-2015 | linkedin.com/in/example

## Summary
Senior software engineer with 6+ years building cloud-backed APIs and data-heavy web apps. Shipped production features in healthcare and fintech with a focus on reliability and measurable outcomes.

## Skills
Programming Languages: TypeScript, JavaScript, Python, SQL
Frameworks: React, Node.js
Cloud, Infrastructure & Tools: AWS Lambda, S3, Docker, GitHub Actions
Concepts & Methodologies: CI/CD, code review, incident response

## Experience
Senior Software Engineer | Taazaa Inc | May 2025 – March 2026 | Remote
- Led design of a customer-facing workflow module; reduced related support tickets by roughly 25% across two release cycles.
- Improved API observability and error handling; fewer Sev-2 incidents in the service area quarter over quarter.

Software Engineer | Alaffia Health | January 2023 - April 2025 | Remote
- Built HIPAA-aware services integrating claims and eligibility data; supported daily batch volumes in the millions of records.
- Delivered biweekly releases with rollback-safe deployments.

## Education
State University | B.S. Computer Science | May 2018 | Tampa, FL
"""


def main() -> None:
    job = SimpleNamespace(company_name="Sample Corp", title="Senior Software Engineer")
    buf, suggested_name = build_formatted_resume_docx(
        SAMPLE_MARKDOWN,
        job,
        "Cheuk Chan",
    )
    data = buf.getvalue()
    base = Path(__file__).resolve().parent
    primary = base / "formatted_resume_sample.docx"
    fallback = base / "formatted_resume_sample_latest.docx"
    try:
        primary.write_bytes(data)
        out = primary
    except OSError:
        fallback.write_bytes(data)
        out = fallback
        print("(Primary file was locked; wrote fallback.)", flush=True)
    print(out)
    print("suggested download name:", suggested_name)


if __name__ == "__main__":
    main()
