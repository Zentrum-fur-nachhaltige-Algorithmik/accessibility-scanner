#!/usr/bin/env python3
"""
Local Marker wrapper for PDF → Markdown extraction.

Usage:
  python marker_extract.py <pdf_path>

Output: JSON to stdout with { pages: [{ pageIndex, markdown }] }

Requires: pip install marker-pdf
"""

import sys
import json
import argparse
import os

def extract(pdf_path):
    try:
        from marker.converters.pdf import PdfConverter
        from marker.models import create_model_dict
    except ImportError as e:
        return {"error": f"marker not installed: {e}. Run: pip install marker-pdf"}

    try:
        # Initialize models
        model_dict = create_model_dict()
        converter = PdfConverter(artifact_dict=model_dict)

        # Convert PDF
        rendered = converter(pdf_path)
        markdown = rendered.markdown

        # Split into pages — marker uses <!--page break--> markers
        page_parts = markdown.split("<!--page break-->")
        if len(page_parts) <= 1:
            # Try alternative page break markers
            page_parts = markdown.split("\n---\n")

        pages = []
        for i, part in enumerate(page_parts):
            content = part.strip()
            if content:
                pages.append({
                    "pageIndex": i,
                    "markdown": content,
                })

        # If no page breaks detected, return as single page
        if not pages:
            pages = [{"pageIndex": 0, "markdown": markdown}]

        return {"pages": pages}

    except Exception as e:
        return {"error": f"Marker extraction failed: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description="Marker PDF extractor")
    parser.add_argument("pdf_path", help="Path to PDF file")
    args = parser.parse_args()

    if not os.path.exists(args.pdf_path):
        print(json.dumps({"error": f"PDF not found: {args.pdf_path}"}))
        sys.exit(1)

    result = extract(args.pdf_path)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
