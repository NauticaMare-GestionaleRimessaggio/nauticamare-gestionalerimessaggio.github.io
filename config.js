/* Collegamento al database Firebase del cantiere (progetto «App rimessaggio nautico»).
   Questi valori non sono segreti: servono al sito per sapere a quale progetto collegarsi.
   La protezione dei dati sta nelle regole del database (firestore.rules). */
window.NM_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAhCYtTl9KBRfDQe_K32K86BZpkXaDoSxo',
  authDomain: 'app-rimessaggio-nautico.firebaseapp.com',
  projectId: 'app-rimessaggio-nautico',
  storageBucket: 'app-rimessaggio-nautico.firebasestorage.app',
  messagingSenderId: '417308637094',
  appId: '1:417308637094:web:c45816f45155ae773d4167'
};

/* Chiave pubblica per le notifiche sul telefono (Firebase › Impostazioni progetto › Cloud Messaging ›
   Certificati push web › «Coppia di chiavi»). Non è segreta. Finché è vuota le notifiche restano spente. */
window.NM_VAPID_KEY = 'BCTv5vIm6qaMMgbGdtg4mDd_cFzgt6eOqjMaaCDab8fBBFp707fbjuyF03ran6OHTzjEZfDX-whaIbcWh6spzok';

/* Chi riceve gli avvisi «chi entra nell'app e cosa fa» (solo un amministratore, mentre ha l'app aperta).
   Le azioni di questo account non vengono registrate. Vuoto = nessun avviso. */
window.NM_AVVISI_A = 'andreatorcini01@gmail.com';
