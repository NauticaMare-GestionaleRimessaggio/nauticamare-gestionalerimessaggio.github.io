# Nautica Mare

Il gestionale del cantiere Nautica Mare (San Vincenzo): barche, lavori, scheda lavoro, programma, scadenze, mappa del cantiere, porto, magazzino.

- **Sito:** si apre da qualsiasi telefono, tablet o computer. Su iPhone: Safari › Condividi › «Aggiungi alla schermata Home». Su Android: Chrome › menu › «Installa app».
- **Dati:** Firebase (Firestore) del cantiere, condivisi in tempo reale. Le regole di accesso sono in `firestore.rules`.
- **Accesso:** email e password. Chi si registra resta in attesa finché un amministratore non lo approva (Altro › Utenti e permessi).

File principali: `index.html` (l'app), `nm-fb.js` (collegamento a Firebase), `config.js` (indirizzo del progetto Firebase), `sw.js` e `manifest.webmanifest` (installazione e avvio senza campo).
