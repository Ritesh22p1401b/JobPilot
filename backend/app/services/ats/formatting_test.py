"""Formatting compatibility risks. Findings are labelled as *risks*; e.g. not every table breaks every ATS."""

from __future__ import annotations

import re

from app.schemas.profile import CandidateProfileData
from app.services.ats.models import Issue, TestResult
from app.services.ats.profiles import ATSProfile
from app.services.resume_parser import EMAIL_RE
from app.services.text_extraction import ExtractedDocument, unusual_symbol_count

STANDARD_SECTIONS = {"experience", "internships", "education", "skills", "projects", "summary"}


def run_formatting_test(doc: ExtractedDocument, profile: CandidateProfileData, ats: ATSProfile) -> TestResult:
    lay = doc.layout
    rules = ats.formatting_rules
    issues: list[Issue] = []

    def add(kind: str, severity: str, message: str) -> None:
        issues.append(Issue(type=kind, severity=severity, message=message))  # type: ignore[arg-type]

    if lay.get("image_based"):
        add("IMAGE_BASED", "error", "The document appears to be image-based (scanned). Most parsers cannot read it; "
                                    "export a text-based PDF or DOCX.")
    if lay.get("text_boxes"):
        add("TEXT_BOXES", "error", f"{lay['text_boxes']} text box(es) found. Text inside text boxes is frequently "
                                   "skipped by parsers; move it into normal paragraphs.")
    if lay.get("multi_column_pages"):
        add("MULTI_COLUMN", "warning", "Multi-column layout detected. Parsers may read columns out of order; "
                                       "a single-column layout is safer.")
    if lay.get("tables"):
        add("TABLES", "warning", f"{lay['tables']} table(s) detected. Tables for core content are a parsing risk "
                                 "for some ATS products.")
    if lay.get("images"):
        add("IMAGES", "warning", f"{lay['images']} image(s)/icon(s) found. Photos, logos and icons carry no parsable "
                                 "text and can confuse layout detection.")
    if (lay.get("graphics") or 0) > 8:
        add("GRAPHICS", "info", "Decorative graphics (lines, shapes, skill bars) detected; keep them minimal.")

    hf = " ".join(lay.get("header_footer_text") or [])
    if hf:
        hf_emails = set(EMAIL_RE.findall(hf))
        body_emails = set(EMAIL_RE.findall(doc.text))
        hf_digits = re.findall(r"\+?\d[\d\s\-()]{8,}\d", hf)
        if (hf_emails and not hf_emails & body_emails) or (hf_digits and not profile.contact.phone):
            add("HEADER_CONTACT", "warning", "Contact information appears only in the header/footer. Move critical "
                                             "contact fields into the document body.")
        else:
            add("HEADER_FOOTER_TEXT", "info", "Text found in header/footer; ensure nothing important lives only there.")

    symbols = max(lay.get("unusual_symbols") or 0, unusual_symbol_count(doc.text))
    if symbols > 5:
        add("UNUSUAL_SYMBOLS", "warning", f"{symbols} unusual symbols/icon glyphs found; use standard bullets (•, -).")

    found = set(profile.sections_found) & STANDARD_SECTIONS
    if len(found) < 2:
        add("NONSTANDARD_HEADINGS", "warning", "Few standard section headings detected. Use conventional headings "
                                               "such as Experience, Education, Skills, Projects.")

    min_font = lay.get("min_font_size")
    if min_font is not None and min_font < 8 and (lay.get("small_font_ratio") or 0) > 0.1:
        add("SMALL_FONT", "warning", f"Very small text (down to {min_font}pt) in a significant part of the document.")

    words = len(doc.text.split())
    per_page = words / max(doc.page_count, 1)
    # Only PDFs have real page geometry; DOCX/TXT page counts are estimates.
    if doc.file_type == "pdf" and per_page < 120 and not lay.get("image_based"):
        add("LOW_DENSITY", "info", "Low text density per page (extreme whitespace or large graphics).")
    if per_page > 1000:
        add("HIGH_DENSITY", "info", "Very dense pages; consider tightening content for readability.")

    penalty = sum(rules.get(i.type, 0) for i in issues)
    score = max(0.0, 100.0 - penalty)
    status = "FAIL" if any(i.severity == "error" for i in issues) else "WARN" if any(i.severity == "warning" for i in issues) else "PASS"
    return TestResult(name="formatting_compatibility", status=status, score=score,
                      critical=any(i.type in ("IMAGE_BASED", "TEXT_BOXES") for i in issues),
                      severity="error" if status == "FAIL" else "warning" if status == "WARN" else "info",
                      details={"layout": {k: v for k, v in lay.items() if k not in ("header_footer_text", "text_box_text")},
                               "words": words, "pages": doc.page_count},
                      issues=issues)


def run_length_test(doc: ExtractedDocument, profile: CandidateProfileData) -> TestResult:
    """No universal one-page rule: guidance depends on experience."""
    years = profile.total_experience_months / 12
    pages = doc.page_count
    words = len(doc.text.split())
    suggested = 1 if years < 3 else 2 if years < 10 else 3
    issues = []
    status = "PASS"
    if pages > suggested + 1:
        status = "WARN"
        issues.append(Issue(type="LENGTH", severity="info",
                            message=f"{pages} pages for ~{years:.1f} years of experience; {suggested}-{suggested + 1} "
                                    "pages is typical. Consider trimming less relevant content."))
    if words < 150:
        status = "WARN"
        issues.append(Issue(type="LENGTH", severity="warning", message="Very little content; key information may be missing."))
    return TestResult(name="length", status=status, score=100.0 if status == "PASS" else 80.0,
                      details={"pages": pages, "words": words, "suggested_pages": suggested}, issues=issues)
