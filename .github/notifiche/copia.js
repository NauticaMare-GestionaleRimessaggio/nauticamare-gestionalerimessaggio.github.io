/* Nautica Mare · copia automatica dei dati
   Gira su GitHub ogni domenica notte (.github/workflows/copia.yml). Legge tutte le raccolte del database
   (le foto no, come nella copia scaricata dall'app) e scrive un file .json nello stesso formato di
   Altro › Copia dei dati, così si recupera con «Recupera ciò che manca». Il file viene poi chiuso con la
   password COPIA_PASSWORD (7-Zip) dal workflow: il repository è pubblico, il file in chiaro non esce mai. */
'use strict';

var fs = require('fs');
var SENZA = ['foto']; // pesanti e già fuori dalla copia dell'app

// i valori speciali di Firestore diventano testo o numeri, come li salva l'app
function semplice(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 2) return { lat: v.latitude, lon: v.longitude };
  if (typeof v.path === 'string' && typeof v.id === 'string' && v.firestore) return v.path;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  if (Array.isArray(v)) return v.map(semplice);
  var o = {}; Object.keys(v).forEach(function (k) { o[k] = semplice(v[k]); }); return o;
}

async function leggi(db) {
  var cols = (await db.listCollections()).map(function (c) { return c.id; }).filter(function (n) { return SENZA.indexOf(n) < 0; }).sort();
  var coll = {}, conteggi = {}, tot = 0;
  for (var i = 0; i < cols.length; i++) {
    var snap = await db.collection(cols[i]).get(), m = {};
    var n = 0;
    snap.forEach(function (d) { if (cols[i] === 'impostazioni' && d.id === 'backup') return; m[d.id] = semplice(d.data()); n++; });
    coll[cols[i]] = m; conteggi[cols[i]] = n; tot += n;
  }
  return { coll: coll, conteggi: conteggi, tot: tot };
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Manca il segreto FIREBASE_SERVICE_ACCOUNT.');
  var admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  var db = admin.firestore(), now = new Date(), r = await leggi(db);
  var file = { app: 'Nautica Mare', tipo: 'Copia dei dati', formato: 1, creata: now.toISOString(), creataDa: 'Copia automatica', voci: r.tot, conteggi: r.conteggi, collezioni: r.coll };
  var nome = 'NauticaMare-copia-' + now.toISOString().slice(0, 10) + '.json';
  fs.writeFileSync(process.argv[2] ? process.argv[2] + '/' + nome : nome, JSON.stringify(file, null, 1));
  // l'app mostra la data dell'ultima copia automatica in Altro › Copia dei dati
  await db.collection('impostazioni').doc('backup').set({ auto: { ultima: now.toISOString(), voci: r.tot } }, { merge: true });
  console.log('Copia pronta: ' + r.tot + ' voci in ' + Object.keys(r.coll).length + ' raccolte.');
  console.log(nome);
}

module.exports = { semplice: semplice };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
