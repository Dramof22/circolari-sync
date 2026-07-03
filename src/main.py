from pathlib import Path
from bs4 import BeautifulSoup
from datetime import date
import re
import json

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = PROJECT_ROOT / "config.json"
CARTELLA_PUBLIC = PROJECT_ROOT / "public"

NOME_APP = "CircolariSync"

PAROLE_EVENTI = {
    "collegio dei docenti": "Collegio dei Docenti",
    "collegio docenti": "Collegio dei Docenti",
    "consigli delle classi": "Consiglio di Classe",
    "consigli di classe": "Consiglio di Classe",
    "consiglio di classe": "Consiglio di Classe",
    "formazione": "Formazione",
    "scrutinio": "Scrutinio",
    "scrutini": "Scrutinio",
    "riunione": "Riunione",
    "dipartimento": "Dipartimento",
    "ricevimento genitori": "Ricevimento Genitori",
    "convocazione": "Convocazione",
    "convocato": "Convocazione",
    "convocata": "Convocazione",
    "uscita didattica": "Uscita Didattica",
    "scadenza": "Scadenza Importante",
}

MESI = {
    "gennaio": 1,
    "febbraio": 2,
    "marzo": 3,
    "aprile": 4,
    "maggio": 5,
    "giugno": 6,
    "luglio": 7,
    "agosto": 8,
    "settembre": 9,
    "ottobre": 10,
    "novembre": 11,
    "dicembre": 12,
}


def leggi_file(percorso):
    with open(percorso, "r", encoding="utf-8") as file:
        return file.read()


def scrivi_file(percorso, contenuto):
    with open(percorso, "w", encoding="utf-8") as file:
        file.write(contenuto)


def salva_json(percorso, dati):
    with open(percorso, "w", encoding="utf-8") as file:
        json.dump(dati, file, ensure_ascii=False, indent=2)


def carica_config():
    with open(CONFIG_FILE, "r", encoding="utf-8") as file:
        return json.load(file)


def pulisci_testo(testo):
    return " ".join(testo.split())


def estrai_testo_da_html(html):
    soup = BeautifulSoup(html, "html.parser")
    testo = soup.get_text(separator=" ")
    return pulisci_testo(testo)


def trova_link_circolari(html):
    soup = BeautifulSoup(html, "html.parser")
    link_trovati = []

    for link in soup.find_all("a"):
        testo = link.get_text(strip=True)
        indirizzo = link.get("href")

        link_trovati.append({
            "titolo": testo,
            "indirizzo": indirizzo
        })

    return link_trovati


def riconosci_tipo_evento(testo):
    testo_minuscolo = testo.lower()

    for parola, tipo_evento in PAROLE_EVENTI.items():
        if parola in testo_minuscolo:
            return tipo_evento

    return None


def trova_data_evento(testo):
    testo_minuscolo = testo.lower()

    frasi_senza_data = [
        "la data e l'orario saranno comunicati successivamente",
        "data e orario saranno comunicati successivamente",
        "saranno comunicati successivamente",
        "sarà comunicata successivamente",
        "verrà comunicata successivamente",
    ]

    for frase in frasi_senza_data:
        if frase in testo_minuscolo:
            return None

    modello = r"(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})"
    risultati = re.findall(modello, testo_minuscolo)

    if not risultati:
        return None

    giorno, mese_testo, anno = risultati[-1]

    return date(int(anno), MESI[mese_testo], int(giorno))


def trova_orari(testo):
    testo_minuscolo = testo.lower()

    modello = r"dalle\s+ore\s+(\d{1,2})[:.](\d{2})\s+alle\s+ore\s+(\d{1,2})[:.](\d{2})"
    risultato = re.search(modello, testo_minuscolo)

    if not risultato:
        return None, None

    ora_inizio = f"{risultato.group(1).zfill(2)}:{risultato.group(2)}"
    ora_fine = f"{risultato.group(3).zfill(2)}:{risultato.group(4)}"

    return ora_inizio, ora_fine


def trova_luogo(testo):
    testo_minuscolo = testo.lower()

    modello = r"presso\s+(?:l'|la\s+|il\s+)?([^,.]+)"
    risultato = re.search(modello, testo, flags=re.IGNORECASE)

    if risultato:
        return pulisci_testo(risultato.group(1))

    if "videoconferenza" in testo_minuscolo:
        return "Videoconferenza"

    return None


def valuta_sicurezza(tipo_evento, data_evento, ora_inizio):
    if tipo_evento and data_evento and ora_inizio:
        return "sicuro"

    if tipo_evento:
        return "dubbio"

    return "ignora"


def crea_motivo_dubbio(data_evento, ora_inizio):
    motivi = []

    if not data_evento:
        motivi.append("manca la data dell'evento")

    if not ora_inizio:
        motivi.append("manca l'orario di inizio")

    if not motivi:
        return "informazioni da verificare"

    return ", ".join(motivi)


def crea_evento_ics(evento):
    data_senza_trattini = evento["data"].replace("-", "")
    ora_inizio_senza_duepunti = evento["ora_inizio"].replace(":", "") + "00"
    ora_fine_senza_duepunti = evento["ora_fine"].replace(":", "") + "00"

    data_ora_inizio = data_senza_trattini + "T" + ora_inizio_senza_duepunti
    data_ora_fine = data_senza_trattini + "T" + ora_fine_senza_duepunti

    descrizione = (
        "Evento estratto automaticamente da CircolariSync. "
        "Verificare sempre la circolare originale. "
        "CircolariSync non sostituisce le comunicazioni ufficiali della scuola. "
        f"Fonte: {evento['circolare']}. "
        f"Link: {evento['link']}. "
        f"Sicurezza: {evento['sicurezza']}."
    )

    testo_ics = ""
    testo_ics += "BEGIN:VEVENT\n"
    testo_ics += f"UID:{evento['link']}-{evento['data']}-{evento['ora_inizio']}@circolari-sync\n"
    testo_ics += f"DTSTART;TZID=Europe/Rome:{data_ora_inizio}\n"
    testo_ics += f"DTEND;TZID=Europe/Rome:{data_ora_fine}\n"
    testo_ics += f"SUMMARY:{evento['titolo']}\n"
    testo_ics += f"DESCRIPTION:{descrizione}\n"

    if evento["luogo"]:
        testo_ics += f"LOCATION:{evento['luogo']}\n"

    testo_ics += f"URL:{evento['link']}\n"
    testo_ics += "END:VEVENT\n"

    return testo_ics


def crea_calendario_ics(eventi_sicuri, nome_scuola):
    testo_ics = ""
    testo_ics += "BEGIN:VCALENDAR\n"
    testo_ics += "VERSION:2.0\n"
    testo_ics += "PRODID:-//CircolariSync//IT\n"
    testo_ics += "CALSCALE:GREGORIAN\n"
    testo_ics += "METHOD:PUBLISH\n"
    testo_ics += f"X-WR-CALNAME:Circolari — {nome_scuola}\n"
    testo_ics += "X-WR-TIMEZONE:Europe/Rome\n"

    for evento in eventi_sicuri:
        testo_ics += crea_evento_ics(evento)

    testo_ics += "END:VCALENDAR\n"

    return testo_ics


def crea_card_evento(evento):
    luogo_html = ""
    if evento["luogo"]:
        luogo_html = f"<p><strong>Luogo:</strong> {evento['luogo']}</p>"

    return f"""
    <article class="card evento-sicuro">
      <div class="badge badge-ok">Evento sicuro</div>
      <h3>{evento['titolo']}</h3>
      <p><strong>Data:</strong> {evento['data']}</p>
      <p><strong>Orario:</strong> {evento['ora_inizio']} - {evento['ora_fine']}</p>
      {luogo_html}
      <p><strong>Fonte:</strong> {evento['circolare']}</p>
      <p><a href="../demo_site/{evento['link']}">Apri circolare originale</a></p>
    </article>
    """


def crea_card_dubbio(evento):
    data = evento["data"] if evento["data"] else "non trovata"
    ora = evento["ora_inizio"] if evento["ora_inizio"] else "non trovata"

    return f"""
    <article class="card evento-dubbio">
      <div class="badge badge-warning">Da verificare</div>
      <h3>{evento['titolo']}</h3>
      <p><strong>Data:</strong> {data}</p>
      <p><strong>Ora:</strong> {ora}</p>
      <p><strong>Motivo:</strong> {evento['motivo_dubbio']}</p>
      <p><strong>Fonte:</strong> {evento['circolare']}</p>
      <p><a href="../demo_site/{evento['link']}">Apri circolare originale</a></p>
    </article>
    """


def crea_index_html(eventi_sicuri, eventi_dubbi, nome_scuola):
    cards_sicuri = "\n".join(crea_card_evento(evento) for evento in eventi_sicuri)
    cards_dubbi = "\n".join(crea_card_dubbio(evento) for evento in eventi_dubbi)

    if not cards_sicuri:
        cards_sicuri = "<p>Nessun evento sicuro trovato.</p>"

    if not cards_dubbi:
        cards_dubbi = "<p>Nessun evento dubbio trovato.</p>"

    html = f"""
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>{NOME_APP}</title>
  <style>
    * {{
      box-sizing: border-box;
    }}

    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      background: #ffffff;
      color: #172033;
    }}

    header {{
      background: #0b5ed7;
      color: white;
      padding: 48px 24px;
    }}

    .container {{
      max-width: 1050px;
      margin: 0 auto;
    }}

    header h1 {{
      margin: 0;
      font-size: 44px;
      letter-spacing: -1px;
    }}

    header p {{
      margin-top: 12px;
      font-size: 19px;
      opacity: 0.95;
      max-width: 720px;
    }}

    main {{
      padding: 32px 24px 60px;
    }}

    .notice {{
      background: #eef5ff;
      border: 1px solid #cfe2ff;
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 28px;
      line-height: 1.5;
    }}

    .calendar-box {{
      background: #f8fbff;
      border: 1px solid #d9e8ff;
      border-radius: 22px;
      padding: 24px;
      margin-bottom: 34px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: center;
      flex-wrap: wrap;
    }}

    .button {{
      display: inline-block;
      background: #0b5ed7;
      color: white;
      text-decoration: none;
      padding: 14px 20px;
      border-radius: 999px;
      font-weight: 700;
    }}

    .section-title {{
      margin-top: 38px;
      margin-bottom: 16px;
      font-size: 26px;
    }}

    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
    }}

    .card {{
      border-radius: 22px;
      padding: 22px;
      border: 1px solid #e6eaf0;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      background: white;
    }}

    .card h3 {{
      margin-top: 12px;
      margin-bottom: 14px;
      font-size: 22px;
    }}

    .card p {{
      margin: 8px 0;
      line-height: 1.45;
    }}

    .card a {{
      color: #0b5ed7;
      font-weight: 700;
    }}

    .evento-sicuro {{
      border-top: 6px solid #0b5ed7;
    }}

    .evento-dubbio {{
      border-top: 6px solid #f2b705;
      background: #fffaf0;
    }}

    .badge {{
      display: inline-block;
      padding: 7px 11px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
    }}

    .badge-ok {{
      background: #e7f1ff;
      color: #084298;
    }}

    .badge-warning {{
      background: #fff3cd;
      color: #664d03;
    }}

    footer {{
      border-top: 1px solid #e6eaf0;
      padding: 24px;
      color: #5b667a;
      font-size: 14px;
    }}
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>{NOME_APP}</h1>
      <p>Legge le circolari pubbliche della scuola e genera un calendario aggiornabile.</p>
      <p><strong>{nome_scuola}</strong></p>
    </div>
  </header>

  <main>
    <div class="container">

      <div class="notice">
        <strong>Attenzione:</strong>
        CircolariSync legge solo comunicazioni pubbliche e genera eventi in modo automatico.
        Non sostituisce il registro elettronico, il sito ufficiale della scuola o le comunicazioni ufficiali.
        Verificare sempre la circolare originale.
      </div>

      <section class="calendar-box">
        <div>
          <h2>Calendario aggiornabile</h2>
          <p>Gli eventi sicuri vengono inseriti nel file calendario. Gli eventi dubbi restano fuori e vanno controllati.</p>
        </div>
        <a class="button" href="calendar.ics">Scarica calendario .ics</a>
      </section>

      <h2 class="section-title">Eventi sicuri</h2>
      <section class="grid">
        {cards_sicuri}
      </section>

      <h2 class="section-title">Eventi dubbi da verificare</h2>
      <section class="grid">
        {cards_dubbi}
      </section>

    </div>
  </main>

  <footer>
    <div class="container">
      Demo locale di CircolariSync — progettata per insegnanti italiani.
    </div>
  </footer>
</body>
</html>
"""

    return html


def main():
    config = carica_config()

    nome_scuola = config["school_name"]
    pagina_circolari = PROJECT_ROOT / config["circulars_page"]

    CARTELLA_PUBLIC.mkdir(exist_ok=True)

    html = leggi_file(pagina_circolari)
    circolari = trova_link_circolari(html)

    eventi_sicuri = []
    eventi_dubbi = []

    for circolare in circolari:
        percorso_circolare = pagina_circolari.parent / circolare["indirizzo"]
        html_circolare = leggi_file(percorso_circolare)
        testo_circolare = estrai_testo_da_html(html_circolare)

        tipo_evento = riconosci_tipo_evento(testo_circolare)
        data_evento = trova_data_evento(testo_circolare)
        ora_inizio, ora_fine = trova_orari(testo_circolare)
        luogo = trova_luogo(testo_circolare)

        sicurezza = valuta_sicurezza(tipo_evento, data_evento, ora_inizio)

        evento = {
            "titolo": tipo_evento,
            "circolare": circolare["titolo"],
            "data": str(data_evento) if data_evento else None,
            "ora_inizio": ora_inizio,
            "ora_fine": ora_fine,
            "luogo": luogo,
            "link": circolare["indirizzo"],
            "sicurezza": sicurezza,
        }

        if sicurezza == "sicuro":
            eventi_sicuri.append(evento)
        elif sicurezza == "dubbio":
            evento["motivo_dubbio"] = crea_motivo_dubbio(data_evento, ora_inizio)
            eventi_dubbi.append(evento)

    calendario = crea_calendario_ics(eventi_sicuri, nome_scuola)
    index_html = crea_index_html(eventi_sicuri, eventi_dubbi, nome_scuola)

    scrivi_file(CARTELLA_PUBLIC / "calendar.ics", calendario)
    scrivi_file(CARTELLA_PUBLIC / "index.html", index_html)
    salva_json(CARTELLA_PUBLIC / "events.json", eventi_sicuri)
    salva_json(CARTELLA_PUBLIC / "dubbi.json", eventi_dubbi)

    print("CircolariSync completato!")
    print("Scuola:", nome_scuola)
    print("File creati:")
    print("- public/index.html")
    print("- public/calendar.ics")
    print("- public/events.json")
    print("- public/dubbi.json")
    print()
    print("Eventi sicuri:", len(eventi_sicuri))
    print("Eventi dubbi:", len(eventi_dubbi))


main()