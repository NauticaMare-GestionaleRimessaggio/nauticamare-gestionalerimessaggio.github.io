# Modello per il sito di un'altra azienda

Questi file sono le parti che cambiano da un sito all'altro. Il resto del codice (index.html, nm-fb.js, sw.js, firestore.rules, .github) è lo stesso per tutti.

- `config.js`: le chiavi del progetto Firebase dell'azienda; senza `NM_ASPETTO` l'app parte neutra con la procedura guidata.
- `manifest.webmanifest` e `icon-*.png`: nome e icona dell'app installata sul telefono (neutri).

Nel sito nuovo vanno nella cartella principale, al posto di quelli di Nautica Mare. La cartella `marca/` (loghi di Nautica Mare) e `anteprima.png` non si copiano.
