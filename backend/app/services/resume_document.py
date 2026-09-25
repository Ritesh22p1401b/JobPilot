"""Resume content model construction, ATS-safe templates and DOCX / PDF / TXT rendering.

Every template follows the parser-safe baseline: single column, standard headings, contact
details in the document body, standard bullets, no tables / images / text boxes / headers.
Content, layout and styling are separate: templates only change ordering, labels and typography.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

from app.schemas.profile import CandidateProfileData
from app.schemas.resume import ResumeBullet, ResumeContent, ResumeExperienceBlock, ResumeProjectBlock
from app.services.skill_ontology import CATEGORY_LABELS

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    description: str
    section_order: tuple[str, ...]
    headings: dict[str, str] = field(default_factory=dict)
    font: str = "Calibri"
    pdf_font: str = "Helvetica"
    base_size: float = 10.5
    skills_grouped: bool = True


_H = {"summary": "Summary", "skills": "Skills", "experience": "Experience", "projects": "Projects",
      "education": "Education", "certifications": "Certifications", "achievements": "Achievements"}

TEMPLATES: dict[str, Template] = {
    t.id: t
    for t in [
        Template("ats_classic", "ATS Classic", "Conventional order, works for most roles.",
                 ("summary", "experience", "skills", "projects", "education", "certifications", "achievements"), _H),
        Template("ats_technical", "ATS Technical", "Skills first for technical screening.",
                 ("summary", "skills", "experience", "projects", "education", "certifications", "achievements"),
                 {**_H, "skills": "Technical Skills"}),
        Template("ats_ai_ml", "ATS AI/ML", "Projects surfaced early for AI/ML roles.",
                 ("summary", "skills", "experience", "projects", "education", "certifications", "achievements"),
                 {**_H, "skills": "Technical Skills"}),
        Template("ats_software_engineer", "ATS Software Engineer", "Experience-led engineering layout.",
                 ("summary", "experience", "projects", "skills", "education", "certifications", "achievements"),
                 {**_H, "skills": "Technical Skills"}),
        Template("ats_data_analyst", "ATS Data Analyst", "Skills and projects for analytics roles.",
                 ("summary", "skills", "projects", "experience", "education", "certifications", "achievements"), _H),
        Template("ats_backend_engineer", "ATS Backend Engineer", "Backend-focused ordering.",
                 ("summary", "skills", "experience", "projects", "education", "certifications", "achievements"),
                 {**_H, "skills": "Technical Skills"}),
        Template("ats_entry_level", "ATS Entry Level", "Education and projects before experience.",
                 ("summary", "education", "skills", "projects", "experience", "certifications", "achievements"), _H),
    ]
}


def fmt_date(value: str | None) -> str:
    if not value:
        return ""
    try:
        year, month = value.split("-")
        return f"{MONTHS[int(month) - 1]} {year}"
    except (ValueError, IndexError):
        return value


def date_range(start: str | None, end: str | None, current: bool) -> str:
    s = fmt_date(start)
    e = "Present" if current or (start and not end) else fmt_date(end)
    if s and e:
        return f"{s} – {e}"
    return s or e


LISTABLE_SECTIONS = {"skills", "experience", "projects", "summary"}


def group_skills(profile: CandidateProfileData) -> dict[str, list[str]]:
    """Skills for the Skills section: only those the resume itself lists or demonstrates
    (a skill inferred solely from a certificate title is not promoted into the list)."""
    grouped: dict[str, list[str]] = {}
    for s in profile.skills:
        if s.sections and not set(s.sections) & LISTABLE_SECTIONS:
            continue
        label = CATEGORY_LABELS.get(s.category, "Other")
        grouped.setdefault(label, []).append(s.name)
    return grouped


def content_from_profile(profile: CandidateProfileData, template: str = "ats_classic") -> ResumeContent:
    """Master resume content: a faithful restatement of the verified profile."""
    tpl = TEMPLATES.get(template, TEMPLATES["ats_classic"])
    return ResumeContent(
        contact=profile.contact,
        summary=profile.summary,
        summary_source="original" if profile.summary else "none",
        skills=group_skills(profile),
        experience=[
            ResumeExperienceBlock(
                source_id=e.id, title=e.title, company=e.company, location=e.location, start_date=e.start_date,
                end_date=e.end_date, current=e.current, is_internship=e.is_internship,
                bullets=[ResumeBullet(text=b, source_type="experience", source_id=e.id, source_index=i, original_text=b)
                         for i, b in enumerate(e.bullets)],
            )
            for e in profile.experience
        ],
        projects=[
            ResumeProjectBlock(
                source_id=p.id, name=p.name, description=p.description, url=p.url, start_date=p.start_date,
                end_date=p.end_date,
                bullets=[ResumeBullet(text=b, source_type="project", source_id=p.id, source_index=i, original_text=b)
                         for i, b in enumerate(p.bullets)],
            )
            for p in profile.projects
        ],
        education=profile.education,
        certifications=profile.certifications,
        achievements=profile.achievements,
        section_order=list(tpl.section_order),
        template=tpl.id,
    )


# ------------------------------------------------------------------------------ plain structure
def _contact_line(content: ResumeContent) -> str:
    c = content.contact
    return " | ".join(x for x in (c.location, c.email, c.phone, c.linkedin, c.github, c.portfolio) if x)


def _exp_header(e: ResumeExperienceBlock) -> tuple[str, str]:
    left = " | ".join(x for x in (e.title, e.company, e.location) if x)
    return left, date_range(e.start_date, e.end_date, e.current)


def _edu_line(ed) -> str:  # type: ignore[no-untyped-def]
    degree = ed.degree + (f" in {ed.field}" if ed.field and ed.field not in (ed.degree or "") else "") if ed.degree else None
    dates = date_range(ed.start_date, ed.end_date, False) if ed.start_date else fmt_date(ed.end_date)
    grade = f"CGPA/Grade: {ed.grade}" if ed.grade else None
    return " | ".join(x for x in (degree, ed.institution, dates, grade) if x)


def _project_header(p: ResumeProjectBlock) -> str:
    return " | ".join(x for x in (p.name, p.description, p.url, date_range(p.start_date, p.end_date, False) if p.start_date else None) if x)


def _sections(content: ResumeContent, tpl: Template) -> list[tuple[str, str, list[tuple[str, str]]]]:
    """(key, heading, lines) where each line is (kind, text); kinds: para, entry, date, bullet."""
    out = []
    for key in content.section_order:
        lines: list[tuple[str, str]] = []
        if key == "summary" and content.summary:
            lines.append(("para", content.summary))
        elif key == "skills" and content.skills:
            if tpl.skills_grouped:
                lines.extend(("para", f"{cat}: {', '.join(items)}") for cat, items in content.skills.items() if items)
            else:
                lines.append(("para", ", ".join(s for items in content.skills.values() for s in items)))
        elif key == "experience":
            for e in content.experience:
                left, dates = _exp_header(e)
                lines.append(("entry", left))
                if dates:
                    lines.append(("date", dates))
                lines.extend(("bullet", b.text) for b in e.bullets)
        elif key == "projects":
            for p in content.projects:
                lines.append(("entry", _project_header(p)))
                lines.extend(("bullet", b.text) for b in p.bullets)
        elif key == "education":
            lines.extend(("para", _edu_line(ed)) for ed in content.education)
        elif key == "certifications":
            for c in content.certifications:
                lines.append(("bullet", " – ".join(x for x in (c.name, c.issuer, fmt_date(c.date)) if x)))
        elif key == "achievements":
            lines.extend(("bullet", a) for a in content.achievements)
        if lines:
            out.append((key, tpl.headings.get(key, key.title()), lines))
    return out


def render_txt(content: ResumeContent) -> str:
    tpl = TEMPLATES.get(content.template, TEMPLATES["ats_classic"])
    parts = [content.contact.name or "", _contact_line(content), ""]
    for _key, heading, lines in _sections(content, tpl):
        parts.append(heading.upper())
        for kind, text in lines:
            parts.append(f"• {text}" if kind == "bullet" else text)
        parts.append("")
    return "\n".join(parts).strip() + "\n"


def render_docx(content: ResumeContent) -> bytes:
    import docx
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Inches, Pt

    tpl = TEMPLATES.get(content.template, TEMPLATES["ats_classic"])
    document = docx.Document()
    for section in document.sections:
        section.top_margin = section.bottom_margin = Inches(0.6)
        section.left_margin = section.right_margin = Inches(0.75)
    normal = document.styles["Normal"]
    normal.font.name = tpl.font
    normal.font.size = Pt(tpl.base_size)
    normal.paragraph_format.space_after = Pt(2)

    name = document.add_paragraph()
    run = name.add_run(content.contact.name or "")
    run.bold = True
    run.font.size = Pt(18)
    name.alignment = WD_ALIGN_PARAGRAPH.LEFT
    document.add_paragraph(_contact_line(content))  # contact in body, never header/footer

    for _key, heading, lines in _sections(content, tpl):
        h = document.add_paragraph()
        h.paragraph_format.space_before = Pt(8)
        hr = h.add_run(heading.upper())
        hr.bold = True
        hr.font.size = Pt(tpl.base_size + 1.5)
        for kind, text in lines:
            if kind == "bullet":
                document.add_paragraph(text, style="List Bullet")
            elif kind == "entry":
                p = document.add_paragraph()
                p.paragraph_format.space_before = Pt(4)
                p.add_run(text).bold = True
            elif kind == "date":
                p = document.add_paragraph()
                p.add_run(text).italic = True
            else:
                document.add_paragraph(text)
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def render_pdf(content: ResumeContent) -> bytes:
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    tpl = TEMPLATES.get(content.template, TEMPLATES["ats_classic"])
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.6 * inch,
                            title=f"{content.contact.name or 'Resume'}", author=content.contact.name or "")
    size = tpl.base_size
    font, bold, italic = tpl.pdf_font, f"{tpl.pdf_font}-Bold", f"{tpl.pdf_font}-Oblique"
    st_name = ParagraphStyle("name", fontName=bold, fontSize=18, leading=22, alignment=TA_LEFT)
    st_body = ParagraphStyle("body", fontName=font, fontSize=size, leading=size * 1.3)
    st_head = ParagraphStyle("head", fontName=bold, fontSize=size + 1.5, leading=(size + 1.5) * 1.3, spaceBefore=8, spaceAfter=2)
    st_entry = ParagraphStyle("entry", fontName=bold, fontSize=size, leading=size * 1.3, spaceBefore=4)
    st_date = ParagraphStyle("date", fontName=italic, fontSize=size, leading=size * 1.3)
    st_bullet = ParagraphStyle("bullet", parent=st_body, leftIndent=12, bulletIndent=2)

    story = [Paragraph(escape(content.contact.name or ""), st_name), Paragraph(escape(_contact_line(content)), st_body)]
    for _key, heading, lines in _sections(content, tpl):
        story.append(Paragraph(escape(heading.upper()), st_head))
        for kind, text in lines:
            t = escape(text)
            if kind == "bullet":
                story.append(Paragraph(t, st_bullet, bulletText="•"))
            elif kind == "entry":
                story.append(Paragraph(t, st_entry))
            elif kind == "date":
                story.append(Paragraph(t, st_date))
            else:
                story.append(Paragraph(t, st_body))
        story.append(Spacer(1, 2))
    doc.build(story)
    return buf.getvalue()
