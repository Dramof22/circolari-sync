# CircolariSync

CircolariSync legge le circolari pubbliche della scuola, riconosce eventi utili per i docenti e genera un calendario aggiornabile in formato .ics.

## Demo attuale

Questa prima versione usa una scuola demo locale con alcune circolari finte.

Il programma genera:

- public/index.html
- public/calendar.ics
- public/events.json
- public/dubbi.json

## Cosa fa

- legge una pagina con elenco circolari;
- apre le singole circolari HTML;
- riconosce eventi scolastici;
- estrae data, orario e luogo quando disponibili;
- inserisce nel calendario solo gli eventi sicuri;
- mette gli eventi incompleti nella sezione da verificare.

## Attenzione

CircolariSync legge solo comunicazioni pubbliche.

Non sostituisce il registro elettronico, il sito ufficiale della scuola o le comunicazioni ufficiali.

Gli eventi estratti automaticamente devono sempre essere verificati sulla circolare originale.
