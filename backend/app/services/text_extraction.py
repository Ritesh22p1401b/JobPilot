"""Text + layout extraction for PDF / DOCX / TXT resumes.

The extracted text intentionally mimics what a simple ATS parser "sees": body text in reading
order (top-to-bottom, left-to-right), with header/footer text reported separately.
"""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field

SUPPORTED_TYPES = {"pdf", "docx", "txt"}


class ExtractionError(ValueError):
    pass


@dataclass
class ExtractedDocument:
    file_type: str
    text: str
    page_count: int = 1
    layout: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def detect_file_type(filename: str, data: bytes) -> str:
    """Validate by magic bytes, not just the extension."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                if "word/document.xml" in zf.namelist():
                    return "docx"
        except zipfile.BadZipFile as exc:
            raise ExtractionError("Corrupted DOCX/ZIP file") from exc
        raise ExtractionError("ZIP file is not a Word document")
    if ext == "txt":
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            try:
                data.decode("cp1252")
            except UnicodeDecodeError as exc:
                raise ExtractionError("Text file is not valid UTF-8") from exc
        if b"\x00" in data[:4096]:
            raise ExtractionError("Binary content in text file")
        return "txt"
    raise ExtractionError("Unsupported file type. Upload a PDF, DOCX or TXT resume.")


def extract(filename: str, data: bytes) -> ExtractedDocument:
    file_type = detect_file_type(filename, data)
    if file_type == "pdf":
        doc = _extract_pdf(data)
    elif file_type == "docx":
        doc = _extract_docx(data)
    else:
        doc = _extract_txt(data)
    # Count icon glyphs before cleaning replaces them with bullets.
    doc.layout["unusual_symbols"] = unusual_symbol_count(doc.text)
    doc.text = clean_text(doc.text)
    if len(doc.text.strip()) < 50:
        doc.warnings.append("Very little text could be extracted; the document may be image-based.")
    return doc


_BULLET_CHARS = "•●▪■◦○◆◇►▸‣⁃∙·➢➤✓✔-*–"


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    # Private-use-area glyphs (icon fonts) become a generic bullet.
    text = re.sub(r"[-]", "• ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def unusual_symbol_count(text: str) -> int:
    count = 0
    for ch in text:
        if "" <= ch <= "" or (unicodedata.category(ch) == "So" and ch not in _BULLET_CHARS):
            count += 1
    return count


# ------------------------------------------------------------------------------------------ PDF
def _extract_pdf(data: bytes) -> ExtractedDocument:
    import fitz  # PyMuPDF

    try:
        pdf = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ExtractionError("Could not open PDF") from exc
    if pdf.needs_pass:
        raise ExtractionError("Password-protected PDFs are not supported")

    body_lines: list[str] = []
    header_footer: list[str] = []
    images = 0
    drawings = 0
    tables = 0
    font_sizes: list[float] = []
    multi_column_pages = 0
    raw_chars = 0

    for page in pdf:
        width, height = page.rect.width, page.rect.height
        images += len(page.get_images(full=True))
        try:
            drawings += sum(1 for d in page.get_drawings() if d.get("fill") is not None or len(d.get("items", [])) > 2)
        except Exception:  # noqa: BLE001
            pass
        try:
            tables += len(page.find_tables().tables)
        except Exception:  # noqa: BLE001
            pass

        blocks = [b for b in page.get_text("blocks") if b[6] == 0 and b[4].strip()]
        top_zone, bottom_zone = height * 0.06, height * 0.94
        body_blocks = []
        for b in blocks:
            x0, y0, x1, y1, text = b[0], b[1], b[2], b[3], b[4]
            raw_chars += len(text)
            if y1 <= top_zone or y0 >= bottom_zone:
                header_footer.append(text.strip())
            else:
                body_blocks.append((x0, y0, x1, y1, text))

        # Naive parser reading order: sort by vertical position then horizontal.
        body_blocks.sort(key=lambda b: (round(b[1] / 3), b[0]))
        for b in body_blocks:
            body_lines.append(b[4].strip())

        line_boxes: list[tuple] = []
        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                text = "".join(s.get("text", "") for s in line.get("spans", []))
                x0, y0, x1, y1 = line.get("bbox", (0, 0, 0, 0))
                if text.strip() and top_zone < y0 and y1 < bottom_zone:
                    line_boxes.append((x0, y0, x1, y1, text))
                for span in line.get("spans", []):
                    if span.get("text", "").strip():
                        font_sizes.append(round(float(span.get("size", 0)), 1))
        if _has_columns(line_boxes, width):
            multi_column_pages += 1

    layout = {
        "images": images,
        "graphics": drawings,
        "tables": tables,
        "multi_column_pages": multi_column_pages,
        "header_footer_text": header_footer,
        "min_font_size": min(font_sizes) if font_sizes else None,
        "median_font_size": sorted(font_sizes)[len(font_sizes) // 2] if font_sizes else None,
        "small_font_ratio": round(sum(1 for s in font_sizes if s < 8.5) / len(font_sizes), 3) if font_sizes else 0,
        "text_boxes": 0,
        "raw_char_count": raw_chars,
    }
    doc = ExtractedDocument("pdf", "\n".join(body_lines), page_count=pdf.page_count, layout=layout)
    if raw_chars < 50 and images:
        doc.warnings.append("PDF appears to be image-based (scanned). Text cannot be reliably parsed without OCR.")
        layout["image_based"] = True
    return doc


def _has_columns(blocks: list[tuple], page_width: float) -> bool:
    """Detect side-by-side text stacks.

    Blocks are clustered by left edge. Two stacks form columns when they are horizontally apart,
    the left stack is confined to the left of the right stack (unlike single-column bullets, which
    span the page), and both stacks share a substantial vertical range. Right-aligned dates next
    to job titles do not qualify because the full-width bullets break the confinement test.
    """
    clusters: list[list[tuple]] = []
    for b in sorted(blocks, key=lambda b: b[0]):
        if clusters and b[0] - clusters[-1][-1][0] <= 8:
            clusters[-1].append(b)
        else:
            clusters.append([b])
    stacks = [c for c in clusters if len(c) >= 3]
    for i, left in enumerate(stacks):
        for right in stacks[i + 1:]:
            x2 = min(b[0] for b in right)
            if x2 - max(b[0] for b in left) < page_width * 0.2:
                continue
            others_left = [b for c in clusters if c is not right and min(x[0] for x in c) < x2 for b in c]
            confined = sum(1 for b in others_left if b[2] <= x2 + 2) / max(len(others_left), 1)
            if confined < 0.8:
                continue
            ly = (min(b[1] for b in left), max(b[3] for b in left))
            ry = (min(b[1] for b in right), max(b[3] for b in right))
            if min(ly[1], ry[1]) - max(ly[0], ry[0]) > 100:
                return True
    return False


# ----------------------------------------------------------------------------------------- DOCX
def _extract_docx(data: bytes) -> ExtractedDocument:
    import docx
    from docx.oxml.ns import qn

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:
        raise ExtractionError("Could not open DOCX") from exc

    lines: list[str] = []
    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            text = "".join(t.text or "" for t in child.iter(qn("w:t")))
            if _is_list_paragraph(child, qn) and text.strip():
                text = "• " + text
            lines.append(text)
        elif child.tag == qn("w:tbl"):
            for row in child.iter(qn("w:tr")):
                cells = []
                for cell in row.iter(qn("w:tc")):
                    cells.append(" ".join("".join(t.text or "" for t in p.iter(qn("w:t"))) for p in cell.iter(qn("w:p"))))
                lines.append(" | ".join(c.strip() for c in cells if c.strip()))

    header_footer: list[str] = []
    columns = 1
    for section in document.sections:
        for part in (section.header, section.footer):
            try:
                header_footer.extend(p.text.strip() for p in part.paragraphs if p.text.strip())
                for tbl in part.tables:
                    for row in tbl.rows:
                        header_footer.extend(c.text.strip() for c in row.cells if c.text.strip())
            except Exception:  # noqa: BLE001
                pass
        cols = section._sectPr.find(qn("w:cols"))
        if cols is not None and cols.get(qn("w:num")):
            columns = max(columns, int(cols.get(qn("w:num"))))

    xml = document.element.xml
    text_boxes = xml.count("w:txbxContent")
    font_sizes = [run.font.size.pt for p in document.paragraphs for run in p.runs if run.font.size is not None]
    layout = {
        "images": len(document.inline_shapes) + xml.count("<wp:anchor"),
        "graphics": xml.count("<wps:wsp") + xml.count("<v:shape"),
        "tables": len(document.tables),
        "multi_column_pages": 1 if columns > 1 else 0,
        "header_footer_text": header_footer,
        "min_font_size": min(font_sizes) if font_sizes else None,
        "median_font_size": sorted(font_sizes)[len(font_sizes) // 2] if font_sizes else None,
        "small_font_ratio": round(sum(1 for s in font_sizes if s < 8.5) / len(font_sizes), 3) if font_sizes else 0,
        "text_boxes": text_boxes,
    }
    text = "\n".join(lines)
    # Text-box content is invisible to many parsers; surface separately.
    if text_boxes:
        tb_text = re.findall(r"<w:txbxContent>(.*?)</w:txbxContent>", xml, flags=re.S)
        layout["text_box_text"] = [re.sub(r"<[^>]+>", "", t).strip() for t in tb_text]
    return ExtractedDocument("docx", text, page_count=_estimate_pages(text), layout=layout)


def _is_list_paragraph(p_elem, qn) -> bool:  # type: ignore[no-untyped-def]
    ppr = p_elem.find(qn("w:pPr"))
    if ppr is None:
        return False
    if ppr.find(qn("w:numPr")) is not None:
        return True
    style = ppr.find(qn("w:pStyle"))
    return style is not None and "List" in (style.get(qn("w:val")) or "")


def _extract_txt(data: bytes) -> ExtractedDocument:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    return ExtractedDocument("txt", text, page_count=_estimate_pages(text), layout={"plain_text": True})


def _estimate_pages(text: str) -> int:
    words = len(text.split())
    return max(1, round(words / 550 + 0.49))
