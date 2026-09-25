"""Deterministic resume parser: plain text -> CandidateProfileData.

Everything extracted here is taken verbatim (or normalised) from the resume text; nothing is inferred
about the candidate beyond what the document states. Target-role suggestions are explicitly labelled
as suggestions derived from titles/skills.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.schemas.profile import (
    CandidateProfileData,
    CertificationEntry,
    Contact,
    EducationEntry,
    ExperienceEntry,
    ProjectEntry,
    SkillEntry,
)
from app.services.dates import SINGLE_DATE_RE, find_date_range, merged_months, parse_date_token
from app.services.skill_normalizer import (
    extract_skills,
    extract_soft_skills,
    normalize_skill,
    skill_category,
    unique_skills,
)

SECTION_ALIASES: dict[str, list[str]] = {
    "summary": ["summary", "professional summary", "profile", "profile summary", "objective", "career objective",
                "about me", "about", "professional profile", "career summary", "overview"],
    "skills": ["skills", "technical skills", "core skills", "key skills", "core competencies", "competencies",
               "technologies", "tech stack", "technical expertise", "skills and tools", "skills & tools",
               "tools and technologies", "tools & technologies", "areas of expertise", "expertise"],
    "experience": ["experience", "work experience", "professional experience", "employment history",
                   "employment", "work history", "career history", "relevant experience", "industry experience"],
    "internships": ["internships", "internship", "internship experience", "internships and training", "training"],
    "education": ["education", "academic background", "academics", "educational qualifications",
                  "education and training", "qualifications", "academic qualifications"],
    "projects": ["projects", "personal projects", "academic projects", "key projects", "selected projects",
                 "project experience", "side projects", "notable projects"],
    "certifications": ["certifications", "certificates", "certification", "licenses and certifications",
                       "licenses & certifications", "courses", "courses and certifications", "online courses"],
    "achievements": ["achievements", "awards", "honors", "honours", "awards and achievements",
                     "accomplishments", "awards & achievements"],
    "publications": ["publications", "research", "papers"],
    "languages": ["languages", "spoken languages", "language proficiency"],
    "interests": ["interests", "hobbies", "hobbies and interests"],
    "volunteer": ["volunteer", "volunteering", "volunteer experience", "extracurricular activities",
                  "extra curricular activities", "leadership", "positions of responsibility", "activities"],
}
_HEADING_LOOKUP = {alias: section for section, aliases in SECTION_ALIASES.items() for alias in aliases}

TITLE_KEYWORDS = [
    "engineer", "developer", "intern", "analyst", "scientist", "manager", "consultant", "lead", "architect",
    "designer", "specialist", "associate", "researcher", "assistant", "trainee", "fellow", "administrator",
    "programmer", "officer", "director", "head", "founder", "co-founder", "freelancer", "freelance", "technician",
    "executive", "coordinator", "tutor", "instructor", "member", "sde", "swe", "mlops", "devops", "apprentice",
]
_TITLE_RE = re.compile(r"\b(" + "|".join(re.escape(k) for k in TITLE_KEYWORDS) + r")s?\b", re.IGNORECASE)

KNOWN_PLACES = {
    "india", "remote", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "new delhi", "noida",
    "gurgaon", "gurugram", "chennai", "kolkata", "ahmedabad", "jaipur", "lucknow", "indore", "chandigarh",
    "kochi", "coimbatore", "bhopal", "nagpur", "patna", "varanasi", "usa", "united states", "uk",
    "united kingdom", "london", "new york", "san francisco", "seattle", "berlin", "toronto", "singapore",
    "dubai", "canada", "germany", "australia", "sydney", "hybrid", "onsite", "on-site", "uttar pradesh",
    "maharashtra", "karnataka", "telangana", "tamil nadu", "west bengal", "gujarat", "rajasthan", "kerala",
    "haryana", "bihar", "madhya pradesh", "ca", "ny", "wa", "tx",
}

DEGREE_PATTERNS: list[tuple[str, str]] = [
    (r"\bPh\.?\s?D\.?\b|\bDoctor(?:ate)? of [A-Z][A-Za-z ]+", "doctorate"),
    (r"\bM\.?\s?Tech\b|\bM\.?E\.?(?=\s|,|$)|\bM\.?S\.?(?=\s|,|$)|\bM\.?Sc\.?\b|\bMCA\b|\bMBA\b|\bM\.?Com\b|"
     r"\bM\.?A\.?(?=\s|,|$)|\bMaster(?:'s|s)?(?: of| in|\b)[A-Za-z .&]*", "master"),
    (r"\bB\.?\s?Tech\b|\bB\.?E\.?(?=\s|,|$)|\bB\.?S\.?(?=\s|,|$)|\bB\.?Sc\.?\b|\bBCA\b|\bBBA\b|\bB\.?Com\b|"
     r"\bB\.?A\.?(?=\s|,|$)|\bBachelor(?:'s|s)?(?: of| in|\b)[A-Za-z .&]*", "bachelor"),
    (r"\bAssociate(?:'s)? Degree\b|\bAssociate of [A-Za-z ]+", "associate"),
    (r"\bDiploma\b[A-Za-z .&]*|\bPolytechnic\b", "diploma"),
    (r"\bHigh School\b|\bSenior Secondary\b|\bHigher Secondary\b|\bHSC\b|\bSSC\b|\b12th\b|\b10th\b|"
     r"\bClass X(?:II)?\b|\bIntermediate\b|\bCBSE\b|\bICSE\b", "high_school"),
]
INSTITUTION_RE = re.compile(
    r"[^,|\n]*\b(University|Universit[äa]t|Institute|College|School|Academy|IIT|NIT|IIIT|BITS|Vidyalaya|"
    r"Polytechnic|Vidyapeeth|Mahavidyalaya)\b[^,|\n]*",
    re.IGNORECASE,
)
GRADE_RE = re.compile(
    r"(?:(?:C?GPA|CPI|SGPA|Percentage|Grade|Score)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*(?:/\s*\d{1,3}(?:\.\d+)?)?%?))"
    r"|(\d{2}(?:\.\d{1,2})?\s*%)",
    re.IGNORECASE,
)

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<![\w])(\+?\d{1,3}[\s\-.]?)?(\(?\d{2,5}\)?[\s\-.]?)?\d{3,5}[\s\-.]?\d{3,5}(?![\w])")
URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:[A-Za-z0-9\-]+\.)+(?:com|in|io|dev|me|ai|org|net|co|app|tech|xyz|site|page|so)"
    r"(?:/[^\s|,;)]*)?",
    re.IGNORECASE,
)
BULLET_RE = re.compile(r"^\s*(?:[•●▪■◦○◆◇►▸‣⁃∙·➢➤✓✔*]|-(?=\s)|–(?=\s)|\d{1,2}[.)](?=\s))\s*")

DOMAIN_KEYWORDS = {
    "fintech": ["fintech", "banking", "payments", "financial services", "trading", "insurance"],
    "healthcare": ["healthcare", "medical", "clinical", "hospital", "health tech", "healthtech", "pharma"],
    "e-commerce": ["e-commerce", "ecommerce", "retail", "marketplace"],
    "edtech": ["edtech", "education technology", "e-learning", "learning platform"],
    "saas": ["saas", "b2b software"],
    "logistics": ["logistics", "supply chain", "fleet"],
    "legal": ["legal tech", "legaltech", "contracts"],
    "hr-tech": ["recruitment", "hiring platform", "hr tech", "applicant tracking"],
    "media": ["media", "content platform", "streaming"],
    "cybersecurity": ["cybersecurity", "security operations", "threat detection"],
}


@dataclass
class ParseResult:
    profile: CandidateProfileData
    warnings: list[str] = field(default_factory=list)
    section_lines: dict[str, list[str]] = field(default_factory=dict)


def _heading_key(line: str) -> str | None:
    cleaned = BULLET_RE.sub("", line).strip().rstrip(":").strip()
    if not cleaned or len(cleaned) > 45 or len(cleaned.split()) > 5:
        return None
    key = re.sub(r"[^a-z& ]", "", cleaned.lower()).strip()
    key = re.sub(r"\s+", " ", key)
    if key in _HEADING_LOOKUP:
        return _HEADING_LOOKUP[key]
    # Qualified headings such as "AI / ML PROJECTS" or "Relevant Work Experience:".
    styled = cleaned.isupper() or line.rstrip().endswith(":") or cleaned.istitle()
    words = key.split()
    if styled and len(words) <= 4:
        for n in (3, 2, 1):
            tail = " ".join(words[-n:])
            if len(words) > n and tail in _HEADING_LOOKUP and tail not in ("about", "training", "expertise", "leadership"):
                return _HEADING_LOOKUP[tail]
    return None


def split_sections(text: str) -> tuple[list[str], dict[str, list[str]]]:
    header: list[str] = []
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        key = _heading_key(line)
        if key:
            current = key
            sections.setdefault(key, [])
            continue
        if current is None:
            header.append(line)
        else:
            sections[current].append(line)
    return header, sections


def is_bullet(line: str) -> bool:
    return bool(BULLET_RE.match(line))


def strip_bullet(line: str) -> str:
    return BULLET_RE.sub("", line).strip()


# ------------------------------------------------------------------------------------ contact
def parse_contact(header: list[str], full_text: str) -> Contact:
    contact = Contact()
    search_zone = "\n".join(header) if header else "\n".join(full_text.split("\n")[:12])
    emails = EMAIL_RE.findall(search_zone) or EMAIL_RE.findall(full_text)
    contact.email = emails[0] if emails else None

    phone_zone = search_zone if contact.email or header else full_text
    for m in PHONE_RE.finditer(phone_zone):
        digits = re.sub(r"\D", "", m.group(0))
        if 10 <= len(digits) <= 15 and not re.fullmatch(r"(19|20)\d{2}(19|20)\d{2}", digits):
            contact.phone = m.group(0).strip()
            break

    links: list[str] = []
    for line in (search_zone + "\n" + full_text).split("\n"):
        for m in URL_RE.finditer(line):
            url = m.group(0).rstrip(".")
            if "@" in line[max(0, m.start() - 1): m.start() + 1] or (contact.email and url in contact.email):
                continue
            if url not in links:
                links.append(url)
    for url in links:
        low = url.lower()
        if "linkedin.com" in low and not contact.linkedin:
            contact.linkedin = url
        elif "github.com" in low and not contact.github and _is_profile_url(low, "github.com"):
            contact.github = url
        elif any(h in low for h in ("linkedin.com", "github.com")):
            continue
        elif not contact.portfolio and url in search_zone:
            contact.portfolio = url
        elif url in search_zone and url not in contact.other_links:
            contact.other_links.append(url)

    contact.name = _find_name(header or full_text.split("\n")[:5])
    contact.location = _find_location(header)
    return contact


def _is_profile_url(url: str, host: str) -> bool:
    path = url.split(host, 1)[1].strip("/")
    return bool(path) and "/" not in path


def _find_name(lines: list[str]) -> str | None:
    for line in lines[:4]:
        candidate = re.split(r"[|•·]", line)[0].strip()
        if not candidate or any(ch.isdigit() for ch in candidate) or "@" in candidate or "http" in candidate.lower():
            continue
        words = candidate.split()
        if not (2 <= len(words) <= 5):
            continue
        if not all(re.fullmatch(r"[A-Za-z][A-Za-z.'\-]*", w) for w in words):
            continue
        if _heading_key(candidate) or _TITLE_RE.search(candidate):
            continue
        return candidate.title() if candidate.isupper() else candidate
    return None


def _find_location(header: list[str]) -> str | None:
    for line in header[:6]:
        for seg in re.split(r"\s*[|•·]\s*|\s{2,}|\t", line):
            seg = seg.strip(" ,")
            if not seg or "@" in seg or re.search(r"\d{5,}", seg) or "http" in seg.lower() or ".com" in seg.lower():
                continue
            low = seg.lower()
            parts = [p.strip() for p in low.split(",")]
            if any(p in KNOWN_PLACES for p in parts) and len(seg) <= 60:
                return seg
            if re.fullmatch(r"[A-Z][A-Za-z .'\-]+,\s*[A-Z][A-Za-z .'\-]+", seg) and len(seg.split()) <= 5:
                return seg
    return None


# ------------------------------------------------------------------------------ entry parsing
@dataclass
class _RawEntry:
    header: list[str] = field(default_factory=list)
    bullets: list[str] = field(default_factory=list)

    def has_date(self) -> bool:
        return any(find_date_range(h) or SINGLE_DATE_RE.search(h) for h in self.header)


def group_entries(lines: list[str]) -> list[_RawEntry]:
    entries: list[_RawEntry] = []
    current: _RawEntry | None = None
    pending: list[str] = []

    def close() -> None:
        nonlocal current
        if current and (current.header or current.bullets):
            entries.append(current)
        current = None

    for line in lines:
        if is_bullet(line):
            text = strip_bullet(line)
            if not text:
                continue
            if pending or current is None:
                close()
                current = _RawEntry(header=pending)
                pending = []
            current.bullets.append(text)
            continue

        has_range = find_date_range(line) is not None
        sentence_like = len(line.split()) > 9 or (line.endswith(".") and len(line.split()) > 5)
        if has_range and not sentence_like:
            if current and not current.bullets and not pending and not current.has_date() and len(current.header) < 3:
                current.header.append(line)
            else:
                close()
                current = _RawEntry(header=[*pending, line])
                pending = []
        elif current is not None and not pending and sentence_like:
            current.bullets.append(line)
        elif current is not None and not pending and current.bullets and line[:1].islower():
            current.bullets[-1] = f"{current.bullets[-1]} {line}"
        elif current is not None and not current.bullets and not pending and len(current.header) < 3:
            current.header.append(line)
        else:
            pending.append(line)
    if pending:
        close()
        current = _RawEntry(header=pending)
    close()
    return entries


def _segments(text: str) -> list[str]:
    parts = re.split(r"\s*(?:\||–|—|\s-\s|@|\bat\b|,|\t|\s{3,})\s*", text)
    return [p.strip(" ,;:()") for p in parts if p and p.strip(" ,;:()")]


def _is_place(seg: str) -> bool:
    low = seg.lower().strip()
    return low in KNOWN_PLACES or any(p.strip() in KNOWN_PLACES for p in low.split(","))


def parse_experience(lines: list[str], internship_section: bool, start_index: int = 1) -> list[ExperienceEntry]:
    out: list[ExperienceEntry] = []
    for i, raw in enumerate(group_entries(lines), start=start_index):
        header_text = "  |  ".join(raw.header)
        start = end = None
        current = False
        dr = find_date_range(header_text)
        if dr:
            start, end, current, span = dr
            header_wo_dates = header_text[: span[0]] + " " + header_text[span[1]:]
        else:
            single = SINGLE_DATE_RE.search(header_text)
            if single:
                start = parse_date_token(single.group("date"))
                header_wo_dates = header_text[: single.start()] + header_text[single.end():]
            else:
                header_wo_dates = header_text
        segs = [s for s in _segments(header_wo_dates) if s and not re.fullmatch(r"[\W\d]+", s)]
        title = company = location = None
        for s in segs:
            if title is None and _TITLE_RE.search(s) and len(s.split()) <= 8:
                title = s
            elif location is None and _is_place(s):
                location = s
            elif company is None and len(s.split()) <= 8:
                company = s
        if title is None and company is None and not raw.bullets:
            continue
        text_for_skills = header_text + "\n" + "\n".join(raw.bullets)
        is_intern = internship_section or bool(title and re.search(r"\bintern(ship)?\b|\btrainee\b|\bapprentice\b", title, re.I))
        out.append(
            ExperienceEntry(
                id=f"exp_{i}",
                company=company,
                title=title,
                location=location,
                start_date=start,
                end_date=end,
                current=current,
                is_internship=is_intern,
                bullets=raw.bullets,
                skills=unique_skills(extract_skills(text_for_skills)),
                raw_header=header_text,
            )
        )
    return out


def parse_projects(lines: list[str]) -> list[ProjectEntry]:
    out: list[ProjectEntry] = []
    for i, raw in enumerate(group_entries(lines), start=1):
        header_text = " | ".join(raw.header)
        bullets = list(raw.bullets)
        if not header_text and bullets:
            # "• Project Name: description" style
            first = bullets.pop(0)
            if ":" in first[:60]:
                header_text, rest = first.split(":", 1)
                bullets.insert(0, rest.strip())
            else:
                header_text = first
        url = None
        m = URL_RE.search(header_text)
        if m:
            url = m.group(0)
        dr = find_date_range(header_text)
        start = end = None
        if dr:
            start, end, _cur, span = dr
            header_text_clean = header_text[: span[0]] + header_text[span[1]:]
        else:
            header_text_clean = header_text
        name_part = re.split(r"\s*(?:\||–|—|\s-\s|:|\()\s*", header_text_clean)[0].strip()
        if url and url in name_part:
            name_part = name_part.replace(url, "").strip()
        name = name_part or f"Project {i}"
        description = None
        rest = header_text_clean[len(name_part):].strip(" |:-–—()") if name_part else ""
        if rest and not (url and rest == url):
            description = rest
        out.append(
            ProjectEntry(
                id=f"proj_{i}",
                name=name[:200],
                description=description,
                url=url,
                start_date=start,
                end_date=end,
                bullets=bullets,
                skills=unique_skills(extract_skills(header_text + "\n" + "\n".join(bullets))),
            )
        )
    return out


def parse_education(lines: list[str]) -> list[EducationEntry]:
    entries: list[EducationEntry] = []
    cur: EducationEntry | None = None
    idx = 0
    for line in lines:
        text = strip_bullet(line)
        degree_match = None
        level = None
        for pattern, lvl in DEGREE_PATTERNS:
            m = re.search(pattern, text)
            if m:
                degree_match, level = m, lvl
                break
        inst = INSTITUTION_RE.search(text)
        start_new = cur is None or (degree_match and cur.degree) or (inst and cur.institution and not degree_match and cur.degree)
        if start_new and (degree_match or inst):
            idx += 1
            cur = EducationEntry(id=f"edu_{idx}", raw=text)
            entries.append(cur)
        elif cur is None:
            continue
        else:
            cur.raw = f"{cur.raw} | {text}" if cur.raw else text
        if degree_match and not cur.degree:
            degree = degree_match.group(0).strip(" ,.-")
            cur.degree = degree
            cur.degree_level = level  # type: ignore[assignment]
            after = text[degree_match.end():]
            fm = re.match(r"\s*(?:in|of|,|-|–|\()\s*([A-Z][A-Za-z &/]+)", after)
            if fm and not INSTITUTION_RE.fullmatch(fm.group(1)):
                cur.field = fm.group(1).strip()
            elif " in " in degree:
                cur.field = degree.split(" in ", 1)[1].strip()
        if inst and not cur.institution:
            cur.institution = inst.group(0).strip(" ,.-|")
        dr = find_date_range(text)
        if dr:
            cur.start_date, cur.end_date = dr[0], dr[1]
        elif not cur.end_date:
            sd = SINGLE_DATE_RE.search(text)
            if sd:
                cur.end_date = parse_date_token(sd.group("date"), is_end=True)
        gm = GRADE_RE.search(text)
        if gm and not cur.grade:
            cur.grade = (gm.group(1) or gm.group(2) or "").strip()
    return entries


def parse_certifications(lines: list[str]) -> list[CertificationEntry]:
    out: list[CertificationEntry] = []
    for i, line in enumerate((strip_bullet(x) for x in lines), start=1):
        if not line or len(line) < 4:
            continue
        date_m = SINGLE_DATE_RE.search(line)
        date = parse_date_token(date_m.group("date")) if date_m else None
        body = line[: date_m.start()] + line[date_m.end():] if date_m else line
        parts = [p.strip(" ,-–—|()") for p in re.split(r"\s[-–—|]\s|\bby\b|\(", body) if p.strip(" ,-–—|()")]
        name = parts[0] if parts else body.strip()
        issuer = parts[1] if len(parts) > 1 else None
        out.append(CertificationEntry(id=f"cert_{i}", name=name[:255], issuer=issuer, date=date))
    return out


def parse_skill_lines(lines: list[str]) -> list[tuple[str, bool]]:
    """Return (skill, known) pairs from a Skills section, keeping unknown-but-listed items."""
    out: list[tuple[str, bool]] = []
    seen: set[str] = set()
    for line in lines:
        body = strip_bullet(line)
        if ":" in body[:40]:
            body = body.split(":", 1)[1]
        for item in re.split(r"[,|;•·]|\s/\s", body):
            item = item.strip(" .()[]")
            if not item or len(item) > 40 or len(item.split()) > 4:
                continue
            canonical = normalize_skill(item)
            if canonical:
                if canonical not in seen:
                    seen.add(canonical)
                    out.append((canonical, True))
            else:
                mentions = unique_skills(extract_skills(item, list_context=True))
                if mentions:
                    for m in mentions:
                        if m not in seen:
                            seen.add(m)
                            out.append((m, True))
                elif re.fullmatch(r"[A-Za-z0-9.+#/\- ]{2,40}", item) and item.lower() not in seen:
                    seen.add(item.lower())
                    out.append((item, False))
    return out


# ------------------------------------------------------------------------------------ targets
def suggest_target_roles(skills: set[str], titles: list[str]) -> list[str]:
    roles: list[str] = []
    ai = {"Machine Learning", "Deep Learning", "PyTorch", "TensorFlow", "scikit-learn", "Natural Language Processing"}
    llm = {"Large Language Models", "RAG", "LangChain", "LlamaIndex", "AI Agents", "Prompt Engineering", "LLM Fine-tuning"}
    backend = {"FastAPI", "Django", "Flask", "Node.js", "Spring Boot", "Express.js", "REST APIs", "PostgreSQL"}
    frontend = {"React", "Next.js", "Vue.js", "Angular"}
    data = {"Pandas", "SQL", "Power BI", "Tableau", "Data Analysis", "Excel"}
    data_eng = {"Apache Spark", "Airflow", "ETL", "Kafka", "dbt"}
    if len(skills & llm) >= 2:
        roles += ["AI Engineer", "LLM Engineer", "Generative AI Engineer"]
    if len(skills & ai) >= 2:
        roles += ["Machine Learning Engineer", "AI Engineer"]
    if len(skills & backend) >= 2:
        roles += ["Backend Developer", "Python Developer" if "Python" in skills else "Software Engineer"]
    if len(skills & frontend) >= 1 and len(skills & backend) >= 1:
        roles.append("Full Stack Developer")
    elif len(skills & frontend) >= 2:
        roles.append("Frontend Developer")
    if len(skills & data_eng) >= 2:
        roles.append("Data Engineer")
    if len(skills & data) >= 3:
        roles.append("Data Analyst")
    for t in titles:
        clean = re.sub(r"\b(intern(ship)?|trainee|junior|jr\.?|senior|sr\.?)\b", "", t, flags=re.I).strip(" -,")
        if clean and len(clean.split()) <= 5 and _TITLE_RE.search(clean):
            roles.append(clean.title() if clean.islower() else clean)
    return list(dict.fromkeys(roles))[:8]


# --------------------------------------------------------------------------------------- main
def parse_resume(text: str) -> ParseResult:
    warnings: list[str] = []
    header, sections = split_sections(text)
    contact = parse_contact(header, text)

    profile = CandidateProfileData(contact=contact)
    profile.sections_found = list(sections.keys())
    if not sections:
        warnings.append("No standard section headings were detected (e.g. Experience, Education, Skills).")

    if "summary" in sections:
        profile.summary = " ".join(strip_bullet(x) for x in sections["summary"])[:2000]

    experience = parse_experience(sections.get("experience", []), internship_section=False)
    experience += parse_experience(
        sections.get("internships", []), internship_section=True, start_index=len(experience) + 1
    )
    profile.experience = experience
    profile.education = parse_education(sections.get("education", []))
    profile.projects = parse_projects(sections.get("projects", []))
    profile.certifications = parse_certifications(sections.get("certifications", []))
    profile.achievements = [strip_bullet(x) for x in sections.get("achievements", [])]
    profile.languages = [
        s.strip() for line in sections.get("languages", []) for s in re.split(r"[,|•]", strip_bullet(line)) if s.strip()
    ]

    # Skills: explicit list + ontology mentions everywhere, recording where each is evidenced.
    skill_sections: dict[str, list[str]] = {}
    known_flag: dict[str, bool] = {}
    for skill, known in parse_skill_lines(sections.get("skills", [])):
        skill_sections.setdefault(skill, []).append("skills")
        known_flag[skill] = known
    section_texts = {
        "summary": profile.summary or "",
        "experience": "\n".join(
            "\n".join([e.raw_header or "", *e.bullets]) for e in profile.experience
        ),
        "projects": "\n".join("\n".join([p.name, p.description or "", *p.bullets]) for p in profile.projects),
        "education": "\n".join(sections.get("education", [])),
        "certifications": "\n".join(sections.get("certifications", [])),
    }
    for section_name, body in section_texts.items():
        for skill in unique_skills(extract_skills(body)):
            skill_sections.setdefault(skill, [])
            if section_name not in skill_sections[skill]:
                skill_sections[skill].append(section_name)
            known_flag.setdefault(skill, True)
    for extra in ("achievements", "volunteer", "publications"):
        for skill in unique_skills(extract_skills("\n".join(sections.get(extra, [])))):
            skill_sections.setdefault(skill, [])
            if extra not in skill_sections[skill]:
                skill_sections[skill].append(extra)
            known_flag.setdefault(skill, True)
    profile.skills = [
        SkillEntry(name=name, category=skill_category(name) if known_flag.get(name) else "other",
                   sections=secs, known=known_flag.get(name, True))
        for name, secs in skill_sections.items()
    ]

    full_time = [(e.start_date, e.end_date) for e in profile.experience if not e.is_internship]
    interns = [(e.start_date, e.end_date) for e in profile.experience if e.is_internship]
    profile.total_experience_months = merged_months(full_time)
    profile.internship_months = merged_months(interns)
    profile.job_titles = list(dict.fromkeys(e.title for e in profile.experience if e.title))
    lowered = text.lower()
    profile.domains = [d for d, kws in DOMAIN_KEYWORDS.items() if any(k in lowered for k in kws)]
    profile.soft_skills = extract_soft_skills(text)
    profile.target_roles = suggest_target_roles(profile.skill_names(), profile.job_titles)

    if not contact.email:
        warnings.append("No email address was found.")
    if not contact.name:
        warnings.append("Candidate name could not be identified with confidence.")
    if sections.get("experience") and not profile.experience:
        warnings.append("An Experience section exists but no entries could be parsed.")
    for e in profile.experience:
        if not e.start_date:
            warnings.append(f"No dates found for experience entry '{e.title or e.company}'.")
    if not profile.skills:
        warnings.append("No skills were identified.")
    return ParseResult(profile=profile, warnings=warnings, section_lines=sections)
