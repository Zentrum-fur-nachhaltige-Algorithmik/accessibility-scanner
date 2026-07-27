#!/usr/bin/env python3
"""
Modal GPU function for Nougat PDF extraction.

Usage:
  # Direct invocation (for testing)
  python nougat_modal.py <pdf_path>

  # Base64 mode (called from Node.js adapter)
  cat pdf_base64.txt | python nougat_modal.py --base64

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

app = modal.App("nougat-extractor")

nougat_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("nougat-ocr", "torch", "torchvision")
)


@app.function(
    image=nougat_image,
    gpu="T4",
    timeout=600,
    memory=8192,
)
def extract_with_nougat(pdf_bytes: bytes) -> dict:
    """Run Nougat on a PDF file using Modal GPU."""
    import torch
    from nougat import NougatModel
    from nougat.utils.dataset import LazyDataset
    from nougat.postprocessing import markdown_compatible
    from torch.utils.data import DataLoader

    # Write PDF to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        pdf_path = f.name

    try:
        model = NougatModel.from_pretrained("facebook/nougat-base")
        model = model.to("cuda")
        model.eval()

        dataset = LazyDataset(pdf_path, model.encoder.prepare_input, None)
        dataloader = DataLoader(dataset, batch_size=1, shuffle=False)

        pages = []
        for i, sample in enumerate(dataloader):
            sample = sample.to("cuda")
            with torch.no_grad():
                output = model.inference(image_tensors=sample)
            for j, page_md in enumerate(output["predictions"]):
                page_md = markdown_compatible(page_md)
                pages.append({"pageIndex": i + j, "markdown": page_md})

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
            result = extract_with_nougat.remote(pdf_bytes)

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
