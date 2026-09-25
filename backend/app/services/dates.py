"""Resume/JD date parsing: month-year normalisation and experience-interval arithmetic."""

from __future__ import annotations

import re
from datetime import date

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
    "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
_MONTH_NAMES = "|".join(sorted(MONTHS, key=len, reverse=True))

DATE_TOKEN = (
    rf"(?:(?:{_MONTH_NAMES})\.?,?\s*'?\d{{2,4}}"  # Jan 2024, January, 2024, Jan '24
    r"|\d{1,2}\s*[/.\-]\s*(?:19|20)\d{2}"  # 01/2024
    r"|(?:19|20)\d{2}\s*[/.\-]\s*\d{1,2}(?!\d)"  # 2024-01
    r"|(?:19|20)\d{2})"  # 2024
)
PRESENT = r"(?:present|current|currently|now|ongoing|till\s+date|to\s+date|today)"
DATE_RANGE_RE = re.compile(
    rf"(?P<start>{DATE_TOKEN})\s*(?:-|–|—|to|until|till|→|~)\s*(?P<end>{DATE_TOKEN}|{PRESENT})",
    re.IGNORECASE,
)
SINGLE_DATE_RE = re.compile(rf"(?<![\d/])(?P<date>{DATE_TOKEN})(?![\d/])", re.IGNORECASE)


def parse_date_token(token: str, is_end: bool = False) -> str | None:
    """Normalise a date token to YYYY-MM. Returns None for 'present'."""
    token = token.strip().lower().replace("'", " ")
    if re.fullmatch(PRESENT, token, flags=re.IGNORECASE):
        return None
    m = re.match(rf"({_MONTH_NAMES})\.?,?\s*(\d{{2,4}})", token)
    if m:
        month = MONTHS[m.group(1)]
        year = int(m.group(2))
        if year < 100:
            year += 2000 if year < 50 else 1900
        return f"{year:04d}-{month:02d}"
    m = re.match(r"(\d{1,2})\s*[/.\-]\s*((?:19|20)\d{2})", token)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"{int(m.group(2)):04d}-{int(m.group(1)):02d}"
    m = re.match(r"((?:19|20)\d{2})\s*[/.\-]\s*(\d{1,2})", token)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}"
    m = re.match(r"((?:19|20)\d{2})", token)
    if m:
        return f"{int(m.group(1)):04d}-{12 if is_end else 1:02d}"
    return None


def find_date_range(text: str) -> tuple[str | None, str | None, bool, tuple[int, int]] | None:
    """Return (start, end, is_current, span) for the first date range in text."""
    m = DATE_RANGE_RE.search(text)
    if not m:
        return None
    start = parse_date_token(m.group("start"))
    end_raw = m.group("end")
    end = parse_date_token(end_raw, is_end=True)
    current = end is None and re.fullmatch(PRESENT, end_raw.strip(), flags=re.IGNORECASE) is not None
    return start, end, current, m.span()


def to_month_index(value: str) -> int:
    year, month = value.split("-")
    return int(year) * 12 + int(month) - 1


def months_between(start: str | None, end: str | None, today: date | None = None) -> int:
    if not start:
        return 0
    today = today or date.today()
    end_idx = to_month_index(end) if end else today.year * 12 + today.month - 1
    return max(0, end_idx - to_month_index(start) + 1)


def merged_months(intervals: list[tuple[str | None, str | None]], today: date | None = None) -> int:
    """Total months covered by possibly-overlapping intervals."""
    today = today or date.today()
    now_idx = today.year * 12 + today.month - 1
    spans = []
    for start, end in intervals:
        if not start:
            continue
        s = to_month_index(start)
        e = to_month_index(end) if end else now_idx
        if e >= s:
            spans.append((s, e))
    spans.sort()
    total = 0
    cur_s: int | None = None
    cur_e = -1
    for s, e in spans:
        if cur_s is None:
            cur_s, cur_e = s, e
        elif s <= cur_e + 1:
            cur_e = max(cur_e, e)
        else:
            total += cur_e - cur_s + 1
            cur_s, cur_e = s, e
    if cur_s is not None:
        total += cur_e - cur_s + 1
    return total
