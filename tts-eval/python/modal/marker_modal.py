#!/usr/bin/env python3
"""
Modal GPU function for Marker PDF extraction.

Usage:
  # Direct invocation
  python marker_modal.py <pdf_path>

  # Base64 mode (called from Node.js adapter)
  cat pdf_base64.txt | python marker_modal.py --base64

Requires: pip install modal
"""

import sys
import json
import argparse
import base64
import tempfile
import os

try:
    import modal
except ImportError:
    print(json.dumps({"error": "modal not installed. Run: pip install modal"}))
    sys.exit(1)

app = modal.App("marker-extractor")

marker_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("marker-pdf", "torch", "torchvision")
)


@app.function(
    image=marker_image,
    gpu="T4",
    timeout=600,
    memory=8192,
)
def extract_with_marker(pdf_bytes: bytes) -> dict:
    """Run Marker on a PDF file using Modal GPU."""
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        pdf_path = f.name

    try:
        model_dict = create_model_dict()
        converter = PdfConverter(artifact_dict=model_dict)
        rendered = converter(pdf_path)
        markdown = rendered.markdown

        # Split into pages
        page_parts = markdown.split("<!--page break-->")
        if len(page_parts) <= 1:
            page_parts = markdown.split("\n---\n")

        pages = []
        for i, part in enumerate(page_parts):
            content = part.strip()
            if content:
                pages.append({"pageIndex": i, "markdown": content})

        if not pages:
            pages = [{"pageIndex": 0, "markdown": markdown}]

        return {"pages": pages}
    finally:
        os.unlink(pdf_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf_path", nargs="?", help="Path to PDF file")
    parser.add_argument("--base64", action="store_true", help="Read base64 PDF from stdin")
    args = parser.parse_args()

    if args.base64:
        pdf_bytes = base64.b64decode(sys.stdin.read().strip())
    elif args.pdf_path:
        with open(args.pdf_path, "rb") as f:
            pdf_bytes = f.read()
    else:
        print(json.dumps({"error": "Provide pdf_path or --base64"}))
        sys.exit(1)

    with modal.enable_output():
        with app.run():
            result = extract_with_marker.remote(pdf_bytes)

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
