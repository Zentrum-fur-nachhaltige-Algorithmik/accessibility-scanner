#!/usr/bin/env python3
"""
Local Nougat wrapper for PDF → Mathpix-markdown extraction.

Usage:
  python nougat_extract.py <pdf_path>

Output: JSON to stdout with { pages: [{ pageIndex, markdown }] }

Requires: pip install nougat-ocr torch
"""

import sys
import json
import argparse
import tempfile
import os

def extract(pdf_path):
    try:
        from nougat import NougatModel
        from nougat.utils.dataset import LazyDataset
        from nougat.postprocessing import markdown_compatible
        import torch
        from pathlib import Path
    except ImportError as e:
        return {"error": f"nougat not installed: {e}. Run: pip install nougat-ocr torch"}

    try:
        # Load model
        model = NougatModel.from_pretrained("facebook/nougat-base")
        if torch.cuda.is_available():
            model = model.to("cuda")
        model.eval()

        # Create dataset from PDF
        dataset = LazyDataset(
            pdf_path,
            model.encoder.prepare_input,
            None,
        )

        pages = []
        from torch.utils.data import DataLoader
        dataloader = DataLoader(dataset, batch_size=1, shuffle=False)

        for i, sample in enumerate(dataloader):
            if torch.cuda.is_available():
                sample = sample.to("cuda")

            with torch.no_grad():
                output = model.inference(image_tensors=sample)

            for j, page_md in enumerate(output["predictions"]):
                page_md = markdown_compatible(page_md)
                pages.append({
                    "pageIndex": i + j,
                    "markdown": page_md,
                })

        return {"pages": pages}

    except Exception as e:
        return {"error": f"Nougat extraction failed: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description="Nougat PDF extractor")
    parser.add_argument("pdf_path", help="Path to PDF file")
    args = parser.parse_args()

    if not os.path.exists(args.pdf_path):
        print(json.dumps({"error": f"PDF not found: {args.pdf_path}"}))
        sys.exit(1)

    result = extract(args.pdf_path)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
