#!/usr/bin/env python3
"""
PyMuPDF-based PDF text extractor with optional hybrid math detection.

Plain mode: Direct text extraction (no formula awareness).
Hybrid mode: Uses font-name heuristics to detect math spans and wrap them in $...$.

Usage:
  python pymupdf_extract.py <pdf_path>              # plain mode
  python pymupdf_extract.py <pdf_path> --hybrid      # hybrid math detection

Output: JSON to stdout with { pages: [{ pageIndex, markdown }] }
"""

import sys
import json
import argparse

try:
    import pymupdf  # PyMuPDF >= 1.24.0 uses 'pymupdf' import
except ImportError:
    try:
        import fitz as pymupdf  # Older versions use 'fitz'
    except ImportError:
        print(json.dumps({"error": "PyMuPDF not installed. Run: pip install pymupdf>=1.24.0"}), file=sys.stderr)
        sys.exit(1)


# Font prefixes known to be used for mathematical typesetting
MATH_FONT_PREFIXES = (
    "CMMI",       # Computer Modern Math Italic
    "CMSY",       # Computer Modern Symbol
    "CMEX",       # Computer Modern Extra (big operators, brackets)
    "CMR",        # Computer Modern Roman (used in math mode for digits)
    "MTMI",       # MathTime math italic
    "MTSYN",      # MathTime symbols
    "RSFS",       # Ralph Smith's Formal Script
    "EUFM",       # Euler Fraktur Medium
    "MSAM",       # AMS Symbol A
    "MSBM",       # AMS Symbol B
    "STIXMath",   # STIX Math fonts
    "LMMath",     # Latin Modern Math
    "LMMI",       # Latin Modern Math Italic
    "LMSY",       # Latin Modern Symbol
    "LMEX",       # Latin Modern Extra
    "NimbusRom",  # Sometimes used for math in older PDFs
)

# Font names that are definitely NOT math (to reduce false positives)
NON_MATH_FONTS = (
    "CMR5", "CMR6", "CMR7", "CMR8", "CMR9", "CMR10", "CMR12", "CMR17",
    # CMR used in text mode — we handle this with a heuristic below
)


def is_math_font(font_name):
    """Check if a font name indicates mathematical content."""
    if not font_name:
        return False
    # Strip subset prefix (e.g., "ABCDEF+CMMI10" -> "CMMI10")
    if "+" in font_name:
        font_name = font_name.split("+", 1)[1]
    # CMR is ambiguous — used for both text and math digits.
    # Only treat CMR as math if it's a small variant (CMR5-CMR7, used in sub/superscripts)
    if font_name.startswith("CMR"):
        suffix = font_name[3:]
        try:
            size = int(suffix)
            return size <= 7  # Small sizes are typically math sub/superscripts
        except ValueError:
            return False
    return any(font_name.startswith(prefix) for prefix in MATH_FONT_PREFIXES)


def extract_plain(pdf_path):
    """Extract text from PDF using simple text extraction."""
    doc = pymupdf.open(pdf_path)
    pages = []

    for i, page in enumerate(doc):
        text = page.get_text("text")
        # Convert plain text to basic markdown
        markdown = text_to_markdown(text)
        pages.append({"pageIndex": i, "markdown": markdown})

    doc.close()
    return pages


def text_to_markdown(text):
    """Convert plain extracted text to basic markdown structure."""
    lines = text.split("\n")
    result = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            result.append("")
            continue
        result.append(stripped)
    return "\n".join(result)


def extract_hybrid(pdf_path):
    """
    Extract text with font-based math detection.

    Uses page.get_text("dict") to get per-span font information.
    Adjacent math-font spans are merged and wrapped in $...$.

    Limitation: produces glyph sequences, not LaTeX commands.
    e.g., $x + y$ works but $\\frac{x}{y}$ becomes $xy$ or similar.
    """
    doc = pymupdf.open(pdf_path)
    pages = []

    for page_idx, page in enumerate(doc):
        blocks = page.get_text("dict")["blocks"]
        page_parts = []

        for block in blocks:
            if block["type"] != 0:  # Skip image blocks
                continue

            for line in block["lines"]:
                line_parts = []
                math_buffer = []

                for span in line["spans"]:
                    text = span["text"]
                    font = span.get("font", "")

                    if is_math_font(font):
                        math_buffer.append(text)
                    else:
                        # Flush math buffer if we have one
                        if math_buffer:
                            math_text = "".join(math_buffer).strip()
                            if math_text:
                                line_parts.append(f"${math_text}$")
                            math_buffer = []
                        line_parts.append(text)

                # Flush remaining math buffer
                if math_buffer:
                    math_text = "".join(math_buffer).strip()
                    if math_text:
                        line_parts.append(f"${math_text}$")

                line_text = "".join(line_parts).strip()
                if line_text:
                    page_parts.append(line_text)

        markdown = "\n".join(page_parts)
        pages.append({"pageIndex": page_idx, "markdown": markdown})

    doc.close()
    return pages


def main():
    parser = argparse.ArgumentParser(description="PyMuPDF PDF text extractor")
    parser.add_argument("pdf_path", help="Path to PDF file")
    parser.add_argument("--hybrid", action="store_true",
                        help="Enable font-based math detection")
    args = parser.parse_args()

    if args.hybrid:
        pages = extract_hybrid(args.pdf_path)
    else:
        pages = extract_plain(args.pdf_path)

    result = {"pages": pages}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
