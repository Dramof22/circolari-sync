#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, date, timedelta
from pathlib import Path
from urllib.parse import urljoin


DATE_RE = re.compile(r'\b(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})\b')

# Orari tipo 16:30, 15.30, ore16.45, ore 18.45.
# Gli orari vengono cercati dopo avere rimosso le date dal testo,
# così 12.01.2021 non diventa per errore 12:01.
TIME_RE = re.compile(r'\b(?:ore\s*)?(\d{1,2})[:\.](\d{2})\b', re.I)

EVENT_HINTS = re.compile(
    r'\b(convocat|incontro|riunione|assemblea|collegio|consiglio|scrutini|programmazione|sportello|evento|corso|open day|orientamento)\b',
    re.I
)

BAD_CONTEXT = re.compile(
    r'\b(prot\.?|protocollo|c\.m\.|c\.f\.|codice|tel|fax|pec|email|sito internet)\b',
    re.I
)


def fetch_text_url(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def find_pdfs(archive_url, limit):
    html = fetch_text_url(archive_url)
    pdfs = []
    for m in re.finditer(r'href=["\']([^"\']+\.pdf(?:\?[^"\']*)?)["\']', html, re.I):
        pdf = urljoin(archive_url, m.group(1))
        if pdf not in pdfs:
            pdfs.append(pdf)
    return pdfs[:limit]


def run_ocr(pdf_url, pages, lang):
    cmd = [
        sys.executable,
        "tools/ocr-pdf.py",
        pdf_url,
        "--pages",
        str(pages),
        "--lang",
        lang,
    ]
    result = subprocess.run(
        cmd,
        cwd=Path(__file__).resolve().parents[1],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=180,
    )
    return result.stdout


def parse_date(d, m, y):
    d = int(d)
    m = int(m)
    y = int(y)
    if y < 100:
        y += 2000
    try:
        return date(y, m, d)
    except ValueError:
        return None


def clean_line(line):
    line = re.sub(r'\s+', ' ', line).strip()
    return line


def best_title(lines, index):
    candidates = []

    for offset in range(-3, 4):
        j = index + offset
        if 0 <= j < len(lines):
            line = clean_line(lines[j])
            if not line:
                continue
            if len(line) < 8:
                continue
            if BAD_CONTEXT.search(line):
                continue
            score = 0
            if EVENT_HINTS.search(line):
                score += 5
            if "oggetto" in line.lower():
                score += 4
            if DATE_RE.search(line):
                score += 1
            if TIME_RE.search(line):
                score += 1
            score += min(len(line), 120) / 120
            candidates.append((score, line))

    if not candidates:
        return "Evento da circolare OCR"

    candidates.sort(reverse=True, key=lambda x: x[0])
    title = candidates[0][1]

    title = re.sub(r'^\s*oggetto\s*[:\-]\s*', '', title, flags=re.I)
    return title[:180]


def extract_times_without_dates(text):
    text_without_dates = DATE_RE.sub(" ", text)
    return list(TIME_RE.finditer(text_without_dates))


def looks_like_publication_date_line(line):
    low = line.lower()

    if "ottaviano" in low and DATE_RE.search(line):
        if not EVENT_HINTS.search(line) and not extract_times_without_dates(line):
            return True

    if re.search(r'\bprot\.?\b|\bprotocollo\b', low) and DATE_RE.search(line):
        if not EVENT_HINTS.search(line):
            return True

    if re.search(r'\bdirigente scolastic[ao]\b', low) and DATE_RE.search(line):
        if not EVENT_HINTS.search(line):
            return True

    return False


def extract_events(text, pdf_url):
    raw_lines = [clean_line(x) for x in text.splitlines()]
    lines = [x for x in raw_lines if x]

    events = []

    for i, line in enumerate(lines):
        dates = list(DATE_RE.finditer(line))
        if not dates:
            continue

        if looks_like_publication_date_line(line):
            continue

        nearby_lines = lines[max(0, i-2): min(len(lines), i+3)]
        nearby = " ".join(nearby_lines)

        # Evita righe che sembrano solo protocollo o intestazione, salvo presenza di indizi evento
        if BAD_CONTEXT.search(nearby) and not EVENT_HINTS.search(nearby):
            continue

        times = extract_times_without_dates(nearby)
        times_same_line = extract_times_without_dates(line)
        has_event_hint = EVENT_HINTS.search(nearby) is not None
        has_event_hint_same_line = EVENT_HINTS.search(line) is not None

        # Accetta una data solo se:
        # - nella stessa riga o nel contesto vicino c'è un orario reale;
        # - oppure c'è un indizio evento nella stessa riga.
        # Questo evita di prendere date di pubblicazione vicine a un evento vero.
        if not times and not has_event_hint_same_line:
            continue

        # Se la riga contiene solo luogo/data, scartala anche se vicino c'è un evento.
        if not times_same_line and not has_event_hint_same_line:
            if re.search(r'\bottaviano\b', line, re.I):
                continue

        for dm in dates:
            event_date = parse_date(dm.group(1), dm.group(2), dm.group(3))
            if not event_date:
                continue

            start_time = None
            end_time = None

            if times:
                start_time = f"{int(times[0].group(1)):02d}:{int(times[0].group(2)):02d}"
            if len(times) >= 2:
                end_time = f"{int(times[1].group(1)):02d}:{int(times[1].group(2)):02d}"

            title = best_title(lines, i)

            events.append({
                "title": title,
                "date": event_date.isoformat(),
                "startTime": start_time,
                "endTime": end_time,
                "source": pdf_url,
                "line": line,
            })

    # deduplica
    seen = set()
    unique = []
    for ev in events:
        key = (ev["title"], ev["date"], ev.get("startTime"), ev.get("endTime"))
        if key not in seen:
            seen.add(key)
            unique.append(ev)

    return unique



def ics_escape(value):
    value = str(value or "")
    value = value.replace("\\", "\\\\")
    value = value.replace(";", "\\;")
    value = value.replace(",", "\\,")
    value = value.replace("\n", "\\n")
    return value


def format_ics_datetime(day_iso, time_value=None, default_hour=9):
    y, m, d = [int(x) for x in day_iso.split("-")]
    if time_value:
        hh, mm = [int(x) for x in time_value.split(":")]
    else:
        hh, mm = default_hour, 0
    return f"{y:04d}{m:02d}{d:02d}T{hh:02d}{mm:02d}00"


def build_ics(events, calendar_name="CircolariSync OCR locale"):
    now = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CircolariSync//OCR Locale//IT",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{ics_escape(calendar_name)}",
    ]

    for idx, ev in enumerate(events, 1):
        start = format_ics_datetime(ev["date"], ev.get("startTime"), 9)

        if ev.get("endTime"):
            end = format_ics_datetime(ev["date"], ev.get("endTime"), 10)
        elif ev.get("startTime"):
            sh, sm = [int(x) for x in ev["startTime"].split(":")]
            base = datetime.fromisoformat(ev["date"]) + timedelta(hours=sh, minutes=sm)
            end_dt = base + timedelta(hours=1)
            end = end_dt.strftime("%Y%m%dT%H%M%S")
        else:
            base = datetime.fromisoformat(ev["date"]) + timedelta(hours=9)
            end_dt = base + timedelta(hours=1)
            end = end_dt.strftime("%Y%m%dT%H%M%S")

        uid_source = ev.get("source", "") + "|" + ev.get("title", "") + "|" + ev.get("date", "") + "|" + (ev.get("startTime") or "") + "|" + (ev.get("endTime") or "")
        uid_hash = hashlib.sha1(uid_source.encode("utf-8")).hexdigest()
        uid = uid_hash + "@circolari-sync-ocr-local"

        description = ev.get("line") or ""
        source = ev.get("source") or ""
        if source:
            description = (description + "\n\nPDF: " + source).strip()

        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now}",
            f"DTSTART:{start}",
            f"DTEND:{end}",
            f"SUMMARY:{ics_escape(ev.get('title') or 'Evento da circolare OCR')}",
            f"DESCRIPTION:{ics_escape(description)}",
            "END:VEVENT",
        ])

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def main():
    ap = argparse.ArgumentParser(description="OCR locale gratuito su archivio circolari PDF")
    ap.add_argument("archive_url", help="URL archivio circolari")
    ap.add_argument("--limit", type=int, default=5, help="Numero massimo PDF da leggere")
    ap.add_argument("--pages", type=int, default=2, help="Numero pagine PDF da OCRizzare")
    ap.add_argument("--lang", default="ita+eng", help="Lingue Tesseract")
    ap.add_argument("--json", action="store_true", help="Stampa JSON")
    ap.add_argument("--ics", help="Salva un file calendario .ics")
    args = ap.parse_args()

    pdfs = find_pdfs(args.archive_url, args.limit)

    all_events = []
    report = {
        "archiveUrl": args.archive_url,
        "pdfsFound": len(pdfs),
        "pdfsAnalyzed": 0,
        "events": [],
    }

    for idx, pdf in enumerate(pdfs, 1):
        print(f"OCR PDF {idx}/{len(pdfs)}: {pdf}", file=sys.stderr)
        try:
            text = run_ocr(pdf, args.pages, args.lang)
            report["pdfsAnalyzed"] += 1
            events = extract_events(text, pdf)
            all_events.extend(events)
        except Exception as e:
            print(f"Errore OCR su {pdf}: {e}", file=sys.stderr)

    all_events.sort(key=lambda e: (e["date"], e.get("startTime") or "99:99", e["title"]))
    report["events"] = all_events

    if args.ics:
        ics_text = build_ics(all_events)
        Path(args.ics).write_text(ics_text, encoding="utf-8")
        print(f"ICS salvato in: {args.ics}", file=sys.stderr)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print()
        print("=== RISULTATO OCR ARCHIVIO ===")
        print("Archivio:", report["archiveUrl"])
        print("PDF trovati/analizzati:", report["pdfsFound"], "/", report["pdfsAnalyzed"])
        print("Eventi candidati:", len(report["events"]))
        print()

        for ev in report["events"]:
            time_part = ""
            if ev.get("startTime"):
                time_part += " " + ev["startTime"]
            if ev.get("endTime"):
                time_part += "-" + ev["endTime"]

            print(f"- {ev['date']}{time_part} | {ev['title']}")
            print(f"  Riga: {ev['line']}")
            print(f"  PDF: {ev['source']}")
            print()


if __name__ == "__main__":
    main()
