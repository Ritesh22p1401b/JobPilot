"""Minimal, dependency-free HTML -> structured plain text conversion for job descriptions."""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser

_BLOCK = {"p", "div", "br", "ul", "ol", "tr", "table", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6",
          "header", "footer", "blockquote", "hr"}
_HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}


class _Converter(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "li":
            self.parts.append("\n• ")
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in _BLOCK or tag == "li" or tag in _HEADINGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(content: str | None) -> str:
    if not content:
        return ""
    raw = html.unescape(content) if "&lt;" in content else content
    if "<" not in raw:
        return re.sub(r"\n{3,}", "\n\n", raw).strip()
    conv = _Converter()
    conv.feed(raw)
    text = "".join(conv.parts).replace(" ", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    out: list[str] = []
    for ln in lines:
        if ln in ("•", ""):
            if out and out[-1] != "":
                out.append("")
            continue
        out.append(ln)
    return "\n".join(out).strip()
