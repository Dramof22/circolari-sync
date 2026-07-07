#!/usr/bin/env python3
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


def require_command(name):
    if not shutil.which(name):
        print(f"ERRORE: comando mancante: {name}", file=sys.stderr)
        print("Installa con: brew install tesseract tesseract-lang poppler", file=sys.stderr)
        sys.exit(1)


def is_url(value):
    return value.startswith("http://") or value.startswith("https://")


def download_pdf(url, out_path):
    req = urllib.request.Request(url, headers={"User-Agent": "circolari-sync-ocr/0.1"})
    with urllib.request.urlopen(req, timeout=45) as response:
        out_path.write_bytes(response.read())


def clean_text(text):
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def run(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        print("ERRORE comando:", " ".join(cmd), file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)
    return result.stdout


def ocr_pdf(pdf_path, pages, lang):
    with tempfile.TemporaryDirectory(prefix="circolari-ocr-") as tmp:
        tmpdir = Path(tmp)
        image_prefix = tmpdir / "page"

        run([
            "pdftoppm",
            "-f", "1",
            "-l", str(pages),
            "-r", "180",
            "-png",
            str(pdf_path),
            str(image_prefix)
        ])

        images = sorted(tmpdir.glob("page-*.png"))

        if not images:
            print("Nessuna immagine generata dal PDF.", file=sys.stderr)
            return ""

        chunks = []

        for image in images:
            print(f"OCR pagina: {image.name}", file=sys.stderr)
            text = run([
                "tesseract",
                str(image),
                "stdout",
                "-l", lang,
                "--psm", "6"
            ])
            chunks.append(text)

        return clean_text("\n\n".join(chunks))


def main():
    parser = argparse.ArgumentParser(description="OCR gratuito per PDF scannerizzati di circolari scolastiche.")
    parser.add_argument("pdf", help="Percorso locale PDF oppure URL diretto a un PDF")
    parser.add_argument("--pages", type=int, default=2, help="Numero massimo di pagine da leggere. Default: 2")
    parser.add_argument("--lang", default="ita", help="Lingua OCR Tesseract. Default: ita")
    parser.add_argument("--out", default="", help="File di output testo. Se vuoto, stampa a schermo.")
    args = parser.parse_args()

    require_command("pdftoppm")
    require_command("tesseract")

    with tempfile.TemporaryDirectory(prefix="circolari-pdf-") as tmp:
        tmpdir = Path(tmp)

        if is_url(args.pdf):
            pdf_path = tmpdir / "input.pdf"
            print("Scarico PDF...", file=sys.stderr)
            download_pdf(args.pdf, pdf_path)
        else:
            pdf_path = Path(args.pdf).expanduser().resolve()
            if not pdf_path.exists():
                print(f"ERRORE: PDF non trovato: {pdf_path}", file=sys.stderr)
                sys.exit(1)

        text = ocr_pdf(pdf_path, args.pages, args.lang)

        if args.out:
            out_path = Path(args.out)
            out_path.write_text(text, encoding="utf-8")
            print(f"Testo salvato in: {out_path}")
        else:
            print(text)


if __name__ == "__main__":
    main()
