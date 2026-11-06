/* Nautica Mare · versione sul sito proprio
   I dati stanno su Firebase (Google) invece che su Claude. Offre all'app la stessa interfaccia
   (db, user, assets, downloads) e aggiunge: accesso con email e password, approvazione dei nuovi
   colleghi, ruoli, foto salvate nel database, sincronizzazione che legge solo ciò che è cambiato. */
(function () {
  'use strict';
  var CFG = window.NM_FIREBASE_CONFIG || null;
  var COLLS = ['barche', 'lavori', 'scadenze', 'dipendenti', 'conferme', 'impostazioni', 'magazzino', 'movimenti', 'vari', 'modelli',
    'checkBarca', 'checklist', 'opModelli', 'operazioni', 'mezzi', 'attrezzatura', 'deposito', 'programma', 'cariche', 'posti', 'richieste', 'rifiuti', 'ritiri', 'scadCantiere', 'preventivi', 'assenze', 'kit', 'inventari', 'giri', 'cronometri', 'ditte', 'pin', 'controlliMezzi', 'richiesteCliente', 'verbali', 'componenti', 'barattoli'];
  var RUOLI = { base: 'Dipendente', editor: 'Dipendente', admin: 'Amministratore', cliente: 'Cliente' }; // «editor» era «Può cancellare»: ora vale come Dipendente
  var FULL_EVERY = 7 * 864e5;            // una rilettura completa a settimana per sicurezza
  var GIF0 = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  /* ---------- piccoli aiuti ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function nowISO() { return new Date().toISOString(); }
  function rid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Firestore non accetta liste dentro liste: le avvolgo e le srotolo in lettura
  function enc(v) {
    if (Array.isArray(v)) return v.map(function (x) { return Array.isArray(x) ? { _a: enc(x) } : enc(x); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { if (v[k] !== undefined) o[k] = enc(v[k]); }); return o; }
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      var ks = Object.keys(v);
      if (ks.length === 1 && ks[0] === '_a' && Array.isArray(v._a)) return dec(v._a);
      var o = {}; ks.forEach(function (k) { o[k] = dec(v[k]); }); return o;
    }
    return v;
  }
  function strip(x) {
    if (!x) return x;
    var o = {}; Object.keys(x).forEach(function (k) { if (k !== '_ts' && k !== '_del') o[k] = x[k]; });
    return dec(clone(o));
  }
  function errOf(e) {
    var c = (e && e.code) || 'unknown';
    var m = { 'permission-denied': 'permission_denied', 'unavailable': 'unavailable', 'resource-exhausted': 'quota_exceeded', 'invalid-argument': 'invalid_argument', 'not-found': 'not_found' };
    return { code: m[c] || String(c).replace(/^firestore\//, '').replace(/-/g, '_'), message: (e && e.message) || '' };
  }

  /* ---------- archivio sul dispositivo (IndexedDB) ---------- */
  var IDB = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res) {
        try {
          var r = indexedDB.open('nautica-mare', 1);
          r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('colls')) d.createObjectStore('colls'); if (!d.objectStoreNames.contains('foto')) d.createObjectStore('foto'); };
          r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
      return dbp;
    }
    function tx(store, mode, fn) {
      return open().then(function (d) {
        if (!d) return null;
        return new Promise(function (res) {
          try { var t = d.transaction(store, mode), q = fn(t.objectStore(store)); t.oncomplete = function () { res(q && q.result); }; t.onerror = t.onabort = function () { res(null); }; }
          catch (e) { res(null); }
        });
      });
    }
    return {
      get: function (s, k) { return tx(s, 'readonly', function (o) { return o.get(k); }); },
      put: function (s, k, v) { return tx(s, 'readwrite', function (o) { return o.put(v, k); }); },
      del: function (s, k) { return tx(s, 'readwrite', function (o) { return o.delete(k); }); },
      keys: function (s) { return tx(s, 'readonly', function (o) { return o.getAllKeys(); }); },
      clear: function () { return Promise.all([tx('colls', 'readwrite', function (o) { return o.clear(); }), tx('foto', 'readwrite', function (o) { return o.clear(); })]); }
    };
  })();

  /* ---------- schermata di accesso ---------- */
  var CSS = '#nmfb{position:fixed;inset:0;z-index:99999;background:#06002e;color:#f4f5f7;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;overflow-y:auto;padding:calc(env(safe-area-inset-top) + 28px) 18px 32px}' +
    '#nmfb .box{width:100%;max-width:400px}#nmfb .logo{display:block;width:78%;max-width:300px;margin:22px auto 26px}#nmfb.load{justify-content:center;padding:24px}#nmfb.load .box{position:relative;max-width:none}#nmfb.load .logo{width:84%;max-width:440px;margin:0 auto}#nmfb.load .spin{position:absolute;left:50%;top:100%;margin:28px 0 0 -17px}' +
    '#nmfb h2{font-size:1.35rem;margin:0 0 6px}#nmfb p{color:#b9bccb;margin:0 0 14px}#nmfb label{display:block;font-size:.9rem;color:#b9bccb;margin:12px 0 6px}' +
    '#nmfb input{width:100%;box-sizing:border-box;font:inherit;font-size:17px;padding:13px 14px;border-radius:12px;border:1px solid #33355a;background:#12114a;color:#fff;outline:none}' +
    '#nmfb input:focus{border-color:#2f8ff0}#nmfb .btn{display:block;width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:#2f8ff0;color:#fff;font:inherit;font-weight:600;font-size:17px;cursor:pointer}' +
    '#nmfb .pw{position:relative}#nmfb .pw input{padding-right:54px}' +
    '#nmfb .eye{position:absolute;right:3px;top:50%;transform:translateY(-50%);width:48px;height:44px;margin:0;padding:0;border:0;border-radius:10px;background:none;color:#b9bccb;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '#nmfb .eye svg{width:22px;height:22px}#nmfb .eye[aria-pressed="true"]{color:#8cc2ff}' +
    '#nmfb .btn[disabled]{opacity:.6}#nmfb .lnk{display:block;width:100%;margin-top:12px;background:none;border:0;color:#8cc2ff;font:inherit;padding:8px;cursor:pointer}' +
    '#nmfb .err{color:#ff8a80;min-height:1.3em;margin-top:10px;font-size:.95rem}#nmfb .ok{color:#7fe0a0}#nmfb .card{background:#12114a;border:1px solid #33355a;border-radius:14px;padding:16px;margin-top:6px}' +
    '#nmfb .spin{width:34px;height:34px;border-radius:50%;border:3px solid #33355a;border-top-color:#2f8ff0;margin:30px auto;animation:nmspin 1s linear infinite}@keyframes nmspin{to{transform:rotate(360deg)}}' +
    /* pannelli (utenti, account) */
    '#nmpan{position:fixed;inset:0;z-index:99998;background:var(--bg,#0e0e10);color:var(--text,#f4f5f7);overflow-y:auto;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;padding:calc(env(safe-area-inset-top) + 8px) 16px 40px}' +
    '#nmpan .top{display:flex;align-items:center;gap:8px;height:52px;position:sticky;top:0;background:inherit;z-index:2}#nmpan .top h3{flex:1;text-align:center;margin:0;font-size:1.05rem}' +
    '#nmpan .back{background:none;border:0;color:#2f8ff0;font:inherit;font-size:1rem;padding:8px 4px;cursor:pointer;min-width:64px;text-align:left}' +
    '#nmpan h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#9a9daa;margin:22px 4px 8px}' +
    '#nmpan .grp{background:#1b1c20;border:1px solid #2a2c31;border-radius:14px;overflow:hidden}#nmpan .u{padding:14px;border-top:1px solid #2a2c31}#nmpan .u:first-child{border-top:0}' +
    '#nmpan .nm{font-weight:600}#nmpan .em{color:#9a9daa;font-size:.9rem;word-break:break-all}#nmpan .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
    '#nmpan button.b{border:1px solid #2a2c31;background:#26272d;color:#f4f5f7;border-radius:10px;padding:9px 12px;font:inherit;font-size:.92rem;cursor:pointer}' +
    '#nmpan button.b.pri{background:#2f8ff0;border-color:#2f8ff0;color:#fff}#nmpan button.b.red{color:#ff8a80}#nmpan select{font:inherit;font-size:.92rem;padding:8px 10px;border-radius:10px;background:#26272d;color:#f4f5f7;border:1px solid #2a2c31}' +
    '#nmpan .pill{display:inline-block;font-size:.78rem;padding:2px 8px;border-radius:99px;background:#26272d;color:#c9ccd6;margin-left:6px}#nmpan .note{color:#9a9daa;font-size:.9rem;margin:10px 4px}' +
    '#nmfb .opt{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #33355a;border-radius:12px;margin-top:8px;font-size:16px;color:#f4f5f7;cursor:pointer}#nmfb .opt input{width:20px;height:20px;padding:0;margin:0;flex:none;accent-color:#2f8ff0}' +
    '#nmfb .bc{margin-top:14px}#nmfb .bh{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}#nmfb .bn{font-size:1.25rem;font-weight:700}#nmfb .bm{color:#b9bccb;font-size:.95rem}' +
    '#nmfb .st{flex:none;font-size:.8rem;font-weight:600;padding:3px 10px;border-radius:99px;background:#26275e;color:#c9d4ff}#nmfb .st.acqua{background:#0f3b2a;color:#7fe0a0}#nmfb .st.lav{background:#3d2f0b;color:#ffcf6b}' +
    '#nmfb .where{display:flex;gap:12px;align-items:center;border-radius:12px;padding:10px 12px;margin-top:12px}#nmfb .where b{display:block;font-size:1.02rem}#nmfb .where small{display:block;font-size:.85rem;opacity:.85}#nmfb .where.msv{background:rgba(95,208,184,.14);color:#7fe3cc}#nmfb .where.nm{background:#1b1a66;color:#f4f5f7}#nmfb .where.porto{background:rgba(140,194,255,.14);color:#a9d1ff}#nmfb .where.terzi{background:rgba(201,182,255,.14);color:#d6c8ff}#nmfb .dv-ic{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center}#nmfb .dv-ic svg{width:72%;height:72%}#nmfb .dv-ic.msv{background:rgba(95,208,184,.16);color:#5fd0b8}#nmfb .dv-ic.msv svg{width:86%;height:86%}#nmfb .dv-ic.porto{background:rgba(140,194,255,.15);color:#8cc2ff}#nmfb .dv-ic.terzi{background:rgba(201,182,255,.15);color:#c9b6ff}#nmfb .dv-ic.nm{background:radial-gradient(circle at 50% 38%,#24237a,#0e0d45 75%);box-shadow:inset 0 0 0 2px #d5d9e2,inset 0 0 0 3.2px #7d8596,0 1px 2px rgba(0,0,0,.4)}#nmfb .dv-ic.nm i{display:block;width:72%;height:30%;background:#fff;-webkit-mask:url(data:image/png;base64,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) center/contain no-repeat;mask:url(data:image/png;base64,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) center/contain no-repeat}#nmfb.cli .bt .where{grid-column:span 2;margin-top:0}' +
    '#nmfb .kv{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #2a2c5c;padding:10px 0;font-size:.95rem}#nmfb .kv span{color:#b9bccb}#nmfb .kv b{text-align:right;font-weight:600}' +
    '#nmfb .rqb{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}#nmfb .rqbtn{flex:1;min-width:140px;padding:10px;border-radius:10px;border:1px solid #3a3d7a;background:transparent;color:inherit;font:inherit;font-weight:600}' +
    '#nmrc{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center}#nmrc .box{background:#14163a;color:#eef;width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:18px 16px 24px;font-family:inherit}' +
    '#nmrc h3{margin:0 0 12px}#nmrc label{display:block;margin:0 0 12px;font-size:.9rem}#nmrc input,#nmrc textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border-radius:8px;border:1px solid #3a3d7a;background:#0d0f2a;color:inherit;font:inherit;font-size:16px}' +
    '#nmrc .row2{display:flex;justify-content:space-between;gap:10px}#nmrc .pri{padding:10px 18px;border-radius:10px;border:0;background:#2ec4a6;color:#062;font-weight:700;font:inherit}#nmrc .lnk{background:none;border:0;color:#9ab;font:inherit}#nmrc .err{color:#ff8a80}' +
    '#nmfb .crt{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;margin:12px 0 4px;border-bottom:1px solid #2a2c5c}#nmfb .crt::-webkit-scrollbar{display:none}#nmfb .crt button{flex:none;background:none;border:0;border-bottom:3px solid transparent;margin-bottom:-1px;color:#b9bccb;font:inherit;font-weight:600;font-size:.92rem;padding:9px 10px;cursor:pointer}#nmfb .crt button[aria-selected="true"]{color:#fff;border-color:#2ec4b6}' +
    '#nmfb .crm{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}#nmfb .crm div{background:linear-gradient(160deg,#1a3e62,#12114a);border:1px solid #33355a;border-radius:12px;padding:9px 10px}#nmfb .crm .h{display:block;font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:#9a9dc0;font-weight:600;min-height:2.4em}#nmfb .crm b{display:block;font-size:1.4rem;margin-top:2px}#nmfb .crm small{color:#9a9dc0;font-size:.75rem}' +
    '#nmfb .crv{display:flex;justify-content:space-between;align-items:center;margin-top:10px;background:linear-gradient(135deg,#4a3218,#2a2030);border:1px solid #6b4a20;border-radius:12px;padding:10px 12px}#nmfb .crv small{display:block;font-size:.72rem;color:#ffb547;text-transform:uppercase;letter-spacing:.05em;font-weight:600}#nmfb .crv .n{text-align:right}#nmfb .crv .n b{display:block;font-size:1.5rem;color:#ffb547;line-height:1}#nmfb .crv .n small{color:#9a9dc0;text-transform:none;letter-spacing:0;font-weight:500}' +
    '#nmfb .crs{display:flex;gap:14px;align-items:center}#nmfb .crs .r{flex:none;width:76px;height:76px;border-radius:50%;border:7px solid;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center}#nmfb .crs .r b{font-size:1.4rem;line-height:1}#nmfb .crs .r small{font-size:.66rem;color:#9a9dc0}#nmfb .crs .l{flex:1;min-width:0}#nmfb .crs .l div,#nmfb .crg>div{display:flex;justify-content:space-between;gap:8px;font-size:.88rem;margin-top:6px}' +
    '#nmfb i.bar{display:block;height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:3px}#nmfb i.bar i{display:block;height:100%;border-radius:3px}#nmfb .crg{padding:4px 0}#nmfb .crf img{width:76px;height:76px}#nmfb .st.no{background:#4a1e22;color:#ff9c90}' +
    '#nmfb .avb{height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}#nmfb .avb i{display:block;height:100%;background:#2ec4a6;border-radius:4px}' +
    '#nmfb h5{margin:14px 0 6px;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#9a9dc0}#nmfb .lv{display:flex;gap:12px;padding:7px 0;border-top:1px solid #23245a;font-size:.95rem}#nmfb .lv .d{flex:none;width:58px;color:#9a9dc0;font-variant-numeric:tabular-nums}#nmfb .dfo{display:flex;gap:6px;flex:none}#nmfb .dfo img{width:52px;height:52px;object-fit:cover;border-radius:9px;background:#23245a;cursor:zoom-in}#nmfb .dfo img.big{position:fixed;inset:0;margin:auto;width:auto;height:auto;max-width:94vw;max-height:80vh;z-index:5;border-radius:12px;box-shadow:0 0 0 100vmax rgba(0,0,0,.7);cursor:zoom-out}' +
    '#nmfb .oy{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px}#nmfb .oy button{padding:5px 13px;border-radius:99px;border:1px solid #3a3d7a;background:none;color:#b9bccb;font:inherit;font-size:.85rem;cursor:pointer}#nmfb .oy button[aria-pressed="true"]{background:#2f8ff0;border-color:#2f8ff0;color:#fff}' +
    '#nmfb .odn{display:flex;justify-content:center;margin:6px 0 4px}#nmfb .oc{display:flex;width:100%;align-items:center;gap:10px;padding:9px 0;border:0;border-top:1px solid #23245a;background:none;color:inherit;font:inherit;font-size:.95rem;text-align:left;cursor:pointer}#nmfb .oc i{width:11px;height:11px;border-radius:3px;flex:none}#nmfb .oc span{flex:1}#nmfb .oc b{white-space:nowrap;font-variant-numeric:tabular-nums}#nmfb .oc small{color:#8a8db0;width:12px}' +
    '#nmfb .ors{padding:0 0 6px 12px;border-left:3px solid;margin:0 0 8px 4px}#nmfb .ors .lv{font-size:.9rem;border-top:0;padding:5px 0}#nmfb .ors .lv .d{width:52px}#nmfb .ors .on{display:block;color:#9a9dc0;font-size:.82rem;margin-top:1px}#nmfb .lv .oh{margin-left:auto;padding-left:8px;white-space:nowrap;color:#c9d4ff;font-variant-numeric:tabular-nums}#nmfb .otot{display:flex;justify-content:space-between;padding:10px 0 2px;border-top:2px solid #3a3d7a;font-weight:700}' +
    '#nmfb .gd{margin-top:18px;color:#b9bccb;font-size:.95rem}#nmfb .gd summary{color:#8cc2ff;cursor:pointer;padding:8px 0}#nmfb .gd ul{margin:4px 0 0;padding-left:20px}#nmfb .gd li{margin:6px 0}' +
    /* area cliente su computer e tablet: schede delle barche in alto e riquadri su 2 o 3 colonne (sul telefono non cambia nulla) */
    '#nmfb .btabs{display:none}@media (min-width:768px) and (min-height:500px){#nmfb.cli .box{max-width:1180px}#nmfb.cli .logo{width:220px;margin:6px 0 18px}' +
    '#nmfb.cli .btabs{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 14px;border-bottom:1px solid #2a2c5c}#nmfb.cli .btabs button{background:none;border:0;border-bottom:3px solid transparent;margin-bottom:-1px;color:#b9bccb;font:inherit;font-weight:700;font-size:1.05rem;padding:10px 16px;cursor:pointer;text-align:left}' +
    '#nmfb.cli .btabs button[aria-selected="true"]{color:#fff;border-color:#2f8ff0}#nmfb.cli .btabs small{display:block;font-weight:500;font-size:.78rem;color:#9a9dc0}' +
    '#nmfb.cli .bc{display:none}#nmfb.cli .bc.on{display:block}#nmfb.cli .bc.full{background:none;border:0;padding:0}' +
    '#nmfb.cli .bt{background:#12114a;border:1px solid #33355a;border-radius:14px;padding:18px 22px;margin-bottom:16px;display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:0 26px;align-items:center}' +
    '#nmfb.cli .bt .kv{border-top:0;flex-direction:column;gap:2px;margin:0!important;padding:4px 0}#nmfb.cli .bt .kv b{text-align:left}' +
    '#nmfb.cli .cg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;grid-auto-flow:row dense;margin-bottom:16px}#nmfb.cli .cso{grid-row:span 2}#nmfb.cli .cs{box-sizing:border-box;background:#12114a;border:1px solid #33355a;border-radius:14px;padding:16px 18px;margin:0}' +
    '#nmfb.cli .cs>h5:first-child{margin-top:0}#nmfb.cli .bc.full>.upd{margin-top:0}#nmfb.cli .lv .d{width:auto;min-width:22px;white-space:nowrap}#nmfb.cli>.box>.lnk{display:inline-block;width:auto;margin-right:14px}}' +
    '@media (min-width:1100px) and (min-height:500px){#nmfb.cli .cg{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
    '#nmfb .upd{color:#8a8db0;font-size:.82rem;margin-top:10px}#nmfb .more{background:none;border:0;color:#8cc2ff;font:inherit;padding:8px 0;cursor:pointer}' +
    '#nmpan .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;width:100%}#nmpan .chip{display:inline-flex;align-items:center;gap:4px;background:#1e3a5f;color:#d6e8ff;border-radius:99px;padding:4px 4px 4px 10px;font-size:.9rem}' +
    '#nmpan .chip button{background:none;border:0;color:#d6e8ff;font-size:1.1rem;line-height:1;padding:2px 6px;cursor:pointer}' +
    /* computer e tablet: il pannello lascia libero il menù a sinistra dell'app (largo 236px) */
    '@media (min-width:768px) and (min-height:500px){#nmpan{left:236px}}' +
    '#nmatt{position:fixed;bottom:calc(env(safe-area-inset-bottom) + 76px);right:10px;left:10px;z-index:100001;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}' +
    '#nmatt .it{pointer-events:auto;position:relative;max-width:420px;width:100%;box-sizing:border-box;background:#2b2c33;color:#fff;border-radius:14px;padding:10px 40px 10px 14px;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}#nmatt .x{position:absolute;top:4px;right:4px;width:32px;height:32px;border:0;background:none;color:#c9cbe0;font-size:20px;line-height:1;cursor:pointer}' +
    '#nmatt .it b{display:block}#nmatt .it span{color:#c9cbe0}#nmattv{width:100%;text-align:left}#nmattv .ar{display:block;padding:10px 0;border-top:1px solid #2a2d55}#nmattv .ar:first-child{border-top:0}#nmattv .ar b{display:block}#nmattv .ar div{color:#b7bad8;font-size:.9rem}' +
    /* modifiche in attesa di rete: piccola icona in alto a destra, sotto la barra (giallo = da inviare, verde = inviate) */
    '#nmpend{position:fixed;top:calc(env(safe-area-inset-top) + 46px);right:10px;z-index:99990;display:flex;align-items:center;gap:4px;height:25px;padding:0 8px;border:1px solid rgba(255,200,90,.5);background:rgba(40,30,8,.94);color:#ffd27a;border-radius:99px;font:700 12px/1 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}' +
    '#nmpend svg{width:15px;height:15px;flex:none}#nmpend[data-s="ok"]{border-color:rgba(90,220,150,.5);background:rgba(8,40,26,.94);color:#7fe0a0}' +
    '@media (min-width:1024px) and (min-height:500px){#nmpend{top:10px;right:190px;height:38px;padding:0 14px;gap:7px;font-size:16px}#nmpend svg{width:22px;height:22px}}' +
    '#nmtoast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 90px);transform:translateX(-50%);z-index:100000;background:#2b2c33;color:#fff;padding:10px 16px;border-radius:12px;font:15px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.4)}';
  function ensureCss() { if (!$('#nmfb-css')) { var st = document.createElement('style'); st.id = 'nmfb-css'; st.textContent = CSS; document.head.appendChild(st); } }
  function logoSrc() { var l = document.getElementById('logo-src'); return l ? l.getAttribute('src') : ''; }
  function overlay(html) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { overlay(html); }, { once: true }); return null; }
    ensureCss();
    var o = $('#nmfb'); if (!o) { o = document.createElement('div'); o.id = 'nmfb'; document.body.appendChild(o); }
    o.className = html === '<div class="spin"></div>' ? 'load' : ''; // caricamento: logo al centro dello schermo come nella schermata d'avvio, rotellina sotto
    o.innerHTML = '<div class="box">' + (logoSrc() ? '<img class="logo" alt="Nautica Mare" src="' + logoSrc() + '">' : '<h2>Nautica Mare</h2>') + html + '</div>';
    return o;
  }
  function hideOverlay() { var o = $('#nmfb'); if (o) o.remove(); }
  function toast(t) {
    ensureCss(); var d = $('#nmtoast'); if (d) d.remove();
    d = document.createElement('div'); d.id = 'nmtoast'; d.textContent = t; document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 3800);
  }

  if (!CFG || !CFG.apiKey || /INSERISCI/.test(CFG.apiKey) || typeof firebase === 'undefined') {
    window.__NM_FB = { use: function () { return new Promise(function () { }); }, photoSrc: function () { return GIF0; }, altroRows: function () { return []; }, open: function () { } };
    var showCfg = function () {
      overlay(typeof firebase === 'undefined'
        ? '<h2>Nessuna connessione</h2><p>Per il primo avvio serve internet. Controlla la connessione e riapri l’app.</p><button class="btn" onclick="location.reload()">Riprova</button>'
        : '<h2>Quasi pronta</h2><p>Manca il collegamento al database Firebase del cantiere. Va inserito una sola volta nel file <b>config.js</b> del sito.</p>');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showCfg); else showCfg();
    return;
  }

  /* ---------- Firebase ---------- */
  firebase.initializeApp(CFG);
  /* App Check: dimostra a Google che le richieste all'AI arrivano dal nostro sito (obbligatorio per AI Logic dal 2/11/2026).
     Sta su un'app Firebase a parte ('ai'), usata solo per il gettone dell'AI: così accesso e dati non lo aspettano mai,
     anche se reCAPTCHA non si carica (senza campo, blocco pubblicità…). Si accende solo la prima volta che serve, a pagina caricata.
     Per le prove fuori dal sito: localStorage 'nm_appcheck_debug' = gettone di debug registrato nella console. */
  var ACK = window.NM_APPCHECK || {}, AC_P = null;
  function appCheckToken() {
    if (!ACK.siteKey || !firebase.appCheck) return Promise.resolve('');
    if (!AC_P) AC_P = new Promise(function (res) {
      if (document.body) res(); else document.addEventListener('DOMContentLoaded', function () { res(); });
    }).then(function () {
      var dbg = null; try { dbg = localStorage.getItem('nm_appcheck_debug'); } catch (e) { }
      if (dbg) self.FIREBASE_APPCHECK_DEBUG_TOKEN = dbg === 'true' ? true : dbg;
      var ac = firebase.appCheck(firebase.initializeApp(CFG, 'ai'));
      ac.activate(ACK.tipo === 'enterprise' ? new firebase.appCheck.ReCaptchaEnterpriseProvider(ACK.siteKey) : new firebase.appCheck.ReCaptchaV3Provider(ACK.siteKey), false); // niente rinnovo automatico: il gettone si chiede solo quando si usa l’AI (meno verifiche, restano nella quota gratis)
      return ac;
    }).catch(function (e) { console.warn('App Check', e); return null; });
    return AC_P.then(function (ac) {
      if (!ac) { AC_P = null; return ''; }
      var t = ac.getToken(false).then(function (r) { return r && r.token || ''; }, function (e) { console.warn('App Check', e); return ''; });
      return Promise.race([t, new Promise(function (r) { setTimeout(function () { r(''); }, 15000); })]); // mai bloccare l’AI più di 15 secondi
    });
  }
  var auth = firebase.auth(); auth.languageCode = 'it';
  var fs = firebase.firestore();
  try { fs.settings({ cacheSizeBytes: 100 * 1024 * 1024, ignoreUndefinedProperties: true, merge: true }); } catch (e) { }
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () { }); } catch (e) { }
  var FV = firebase.firestore.FieldValue, TS = firebase.firestore.Timestamp;

  var READY_RES, READY = new Promise(function (r) { READY_RES = r; });
  var ME = null, UT = {}, UT_UNSUB = null, ME_UNSUB = null, registering = false, started = false, CLIENTE = false;

  /* ---------- collezioni vive: archivio locale + solo ciò che è cambiato ---------- */
  var LIVE = {};
  function live(name) {
    if (LIVE[name]) return LIVE[name];
    var L = LIVE[name] = { name: name, map: {}, ts: 0, full: 0, ready: false, subs: [], waiters: [] };
    L.start = READY.then(function () { return IDB.get('colls', name); }).then(function (saved) {
      if (saved && saved.docs) { L.map = saved.docs; L.ts = saved.ts || 0; L.full = saved.full || 0; markReady(L); emit(L); }
      listen(L);
    });
    return L;
  }
  function markReady(L) { if (!L.ready) { L.ready = true; L.waiters.splice(0).forEach(function (f) { f(); }); } }
  function whenReady(L, ms) { return L.ready ? Promise.resolve() : new Promise(function (r) { L.waiters.push(r); setTimeout(r, ms || 15000); }); }
  function listen(L) {
    if (L.unsub) { L.unsub(); L.unsub = null; }
    var fullDue = !L.full || !L.ts || Date.now() - L.full > FULL_EVERY;
    var q = fs.collection(L.name);
    // PIN del tablet: chi non è amministratore né tablet legge solo il suo (vedi firestore.rules), sempre per intero
    if (L.name === 'pin' && !(ME && (ME.ruolo === 'admin' || ME.tablet))) { fullDue = true; q = q.where('utente', '==', ME ? ME.uid : '-'); }
    else if (!fullDue) q = q.where('_ts', '>=', TS.fromMillis(L.ts - 5000));
    var first = true;
    L.unsub = q.onSnapshot(function (snap) {
      if (first && fullDue) {
        var m = {};
        snap.docs.forEach(function (d) { var x = d.data({ serverTimestamps: 'estimate' }); track(L, x, d); if (!x._del) m[d.id] = strip(x); });
        Object.keys(L.pend || {}).forEach(function (id) { if (L.pend[id] === 'del') delete m[id]; else if (L.map[id]) m[id] = L.map[id]; });
        L.map = m; L.full = Date.now();
      } else {
        snap.docChanges().forEach(function (ch) {
          var id = ch.doc.id;
          if (ch.type === 'removed') { delete L.map[id]; return; }
          var x = ch.doc.data({ serverTimestamps: 'estimate' }); track(L, x, ch.doc);
          if (x._del) delete L.map[id]; else L.map[id] = strip(x);
        });
      }
      first = false; markReady(L); save(L); emit(L);
    }, function (err) {
      var e = errOf(err);
      L.subs.forEach(function (s) { if (s.err) try { s.err(e); } catch (x) { } });
      if (e.code === 'permission_denied') return;
      setTimeout(function () { listen(L); }, 4000);
    });
  }
  function track(L, x, d) { if (x && x._ts && x._ts.toMillis && !(d.metadata && d.metadata.hasPendingWrites)) L.ts = Math.max(L.ts, x._ts.toMillis()); }
  function save(L) {
    clearTimeout(L.st);
    L.st = setTimeout(function () { IDB.put('colls', L.name, { docs: L.map, ts: L.ts, full: L.full }); }, 500);
  }
  function snapOf(L) {
    var docs = Object.keys(L.map).map(function (id) { var d = L.map[id]; return { id: id, exists: true, data: function () { return clone(d); }, metadata: { fromCache: false } }; });
    return { docs: docs, size: docs.length, empty: !docs.length };
  }
  function emit(L) {
    var s = snapOf(L); L.subs.slice().forEach(function (x) { try { x.next(s); } catch (e) { console.error(e); errScrivi(e); } });
    if (/^(barche|lavori|posti|deposito|impostazioni|preventivi|scadenze|componenti|attrezzatura|verbali|vari|cariche)$/.test(L.name)) schedulePortale();
  }
  function docSnap(id, d) { return { id: id, exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }

  // la scrittura parte subito sul dispositivo; il server conferma dopo (anche senza campo)
  function settle(p, L) {
    return new Promise(function (res, rej) {
      var done = false;
      p.then(function () { if (!done) { done = true; res(); } }, function (e) {
        var x = errOf(e);
        if (!done) { done = true; rej(x); }
        else { toast('Una modifica non è stata salvata (' + x.code + '). Ricarico i dati.'); }
        if (L) { L.full = 0; listen(L); }
      });
      setTimeout(function () { if (!done) { done = true; res(); } }, 1200);
    });
  }
  var DELG = { id: '', t: 0 };
  function write(name, id, kind, data) {
    var L = live(name), r = fs.collection(name).doc(id), ts = FV.serverTimestamp(), p, prev0 = L.map[id] ? clone(L.map[id]) : null;
    L.pend = L.pend || {};
    if (kind === 'set') {
      data = Object.assign({}, data || {});
      // chi l'ha aggiunto: serve per sapere chi può cancellarlo. Si conserva quando si riscrive.
      var prev = L.map[id];
      if (prev && prev.creatoDa) data.creatoDa = prev.creatoDa;
      else if (!prev && L.ready && !data.creatoDa && ME && name !== 'portale') { data.creatoDa = chi(); if (AS) data.via = ME.uid; }
      var x = enc(clone(data)); x._ts = ts; p = r.set(x); L.map[id] = clone(data); L.pend[id] = 'set';
    } else if (kind === 'update') {
      if (L.ready && !L.map[id]) return Promise.reject({ code: 'not_found', message: 'Elemento non trovato' });
      var u = {}, d = data || {};
      Object.keys(d).forEach(function (k) { var v = d[k]; u[k] = (v && v.__delete__) ? FV.delete() : enc(clone(v)); });
      u._ts = ts; p = r.update(u);
      var m = Object.assign({}, L.map[id] || {});
      Object.keys(d).forEach(function (k) { if (d[k] && d[k].__delete__) delete m[k]; else m[k] = clone(d[k]); });
      L.map[id] = m; L.pend[id] = 'set';
    } else {
      var old = L.map[id];
      if (!canDel(name, old)) return Promise.reject({ code: 'permission_denied', message: 'Può cancellarlo solo un amministratore' });
      if (old) { // una copia va nel cestino, nella stessa scrittura
        var b = fs.batch();
        if (Date.now() - DELG.t > 3000) DELG.id = rid('g'); DELG.t = Date.now(); // cancellate di seguito (una barca con i suoi lavori): stesso gruppo
        b.set(fs.collection('cestino').doc(rid('c')), { coll: name, docId: id, dati: enc(clone(old)), gruppo: DELG.id, da: ME.uid, daNome: (ME.nome || '') + (AS ? ' (tablet, ' + ((UT[AS] && UT[AS].nome) || '') + ')' : ''), il: nowISO(), _ts: ts });
        b.set(r, { _del: true, _ts: ts }); p = b.commit();
      } else p = r.set({ _del: true, _ts: ts });
      delete L.map[id]; L.pend[id] = 'del';
    }
    p.then(function () { if (L.pend) delete L.pend[id]; }, function () { if (L.pend) delete L.pend[id]; });
    pendAdd(p);
    attScrittura(name, kind === 'delete' ? 'cancella' : prev0 ? 'modifica' : 'aggiunge', data || prev0);
    emit(L); save(L);
    return settle(p, L);
  }
  // chi può cancellare: l'amministratore tutto; gli altri ciò che hanno aggiunto loro, le proprie mansioni della
  // scheda, le proprie giornate confermate, le proprie richieste di ferie non ancora decise, e i posti al porto.
  // Le stesse regole stanno in firestore.rules.
  // Tablet condiviso: l'account segnato «tablet» lavora a nome di chi ha scritto il suo PIN (AS); quello che aggiunge resta suo, con «via» = il tablet
  var AS = null;
  function chi() { return AS || (ME && ME.uid); }
  function canDel(name, d) {
    if (!ME) return false;
    if (ME.ruolo === 'admin') return true;
    if (!d) return false;
    if (name === 'posti') return true;
    if (name !== 'assenze' && (AS ? d.via === ME.uid : d.creatoDa === ME.uid)) return true; // l'ha aggiunto chi cancella (dal tablet: ciò che è stato aggiunto dal tablet)
    if (name === 'lavori') return d.fonte === 'scheda' && d.utente === chi();
    if (name === 'conferme') return d.utente === chi();
    if (name === 'assenze') return d.utente === chi() && d.stato === 'richiesta';
    return false;
  }
  function ref(name, id) {
    return {
      id: id,
      get: function () {
        var L = live(name);
        return whenReady(L, 8000).then(function () {
          if (L.ready) return docSnap(id, L.map[id] || null);
          return fs.collection(name).doc(id).get().then(function (d) { var x = d.exists ? d.data() : null; return docSnap(id, x && !x._del ? strip(x) : null); }, function (e) { throw errOf(e); });
        });
      },
      set: function (data) { return write(name, id, 'set', data); },
      update: function (data) { return write(name, id, 'update', data); },
      delete: function () { return write(name, id, 'delete'); },
      onSnapshot: function (next, err) { return collection(name).onSnapshot(function () { next(docSnap(id, live(name).map[id] || null)); }, err); }
    };
  }
  function collection(name) {
    return {
      onSnapshot: function (next, err) {
        var L = live(name), s = { next: next, err: err }; L.subs.push(s);
        if (L.ready) setTimeout(function () { if (L.subs.indexOf(s) >= 0) next(snapOf(L)); }, 0);
        return function () { L.subs = L.subs.filter(function (x) { return x !== s; }); };
      },
      get: function () { var L = live(name); return L.start.then(function () { return whenReady(L, 15000); }).then(function () { return snapOf(L); }); },
      doc: function (id) { return ref(name, id || fs.collection(name).doc().id); }
    };
  }
  var DB = {
    collection: collection,
    doc: function (path) { var p = String(path).split('/'); return ref(p[0], p[1]); }
  };

  /* ---------- persone ---------- */
  var USER = {
    id: function () { return Promise.resolve(ME && ME.uid); },
    me: function () { var a = String(window.NM_AVVISI_A || '').trim().toLowerCase(); return Promise.resolve({ id: ME.uid, name: ME.nome || '', isOwner: ME.ruolo === 'admin', creatore: !!a && String(ME.email || '').toLowerCase() === a }); },
    isOwner: function () { return !!ME && ME.ruolo === 'admin'; },
    canEdit: function () { return Promise.resolve(!!ME && (ME.ruolo === 'admin' || ME.ruolo === 'editor')); },
    can: function (n) { return Promise.resolve(n === 'data.write' ? true : null); },
    profiles: function (ids) {
      var o = {}; (ids || []).forEach(function (id) { var u = UT[id]; o[id] = { id: id, name: u ? (u.nome || '') : '', avatarUrl: '' }; });
      return Promise.resolve(o);
    },
    search: function (q) {
      q = String(q || '').toLowerCase();
      return Promise.resolve(Object.keys(UT).filter(function (id) { return UT[id].stato === 'attivo' && (!q || String(UT[id].nome || '').toLowerCase().indexOf(q) >= 0); })
        .map(function (id) { return { id: id, name: UT[id].nome || '' }; }));
    }
  };

  /* ---------- foto: compresse e salvate nel database ---------- */
  var PH = {}, PH_LOADING = {}, PH_MISS = {};
  function blobToDataUrl(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(b); }); }
  function shrink(blob, max, q) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b || blob); }, 'image/jpeg', q);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(blob); };
      img.src = url;
    });
  }
  function patchImgs(id, url) { document.querySelectorAll('img[data-blob="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]').forEach(function (im) { if (im.getAttribute('src') !== url) im.setAttribute('src', url); }); }
  function loadPhoto(id) {
    if (PH[id] || PH_LOADING[id] || PH_MISS[id]) return; PH_LOADING[id] = true;
    IDB.get('foto', id).then(function (u) {
      if (u) return u;
      return fs.collection('foto').doc(id).get().then(function (d) { var x = d.exists ? d.data() : null; if (x && x.data && !x._del) { IDB.put('foto', id, x.data); return x.data; } return null; });
    }).then(function (u) { delete PH_LOADING[id]; if (u) { PH[id] = u; patchImgs(id, u); } else PH_MISS[id] = true; }, function () { delete PH_LOADING[id]; PH_MISS[id] = true; });
  }
  var ASSETS = {
    upload: function (blob) {
      return (async function () {
        var b = blob;
        if (b.size > 450 * 1024) b = await shrink(b, 1400, 0.72);
        if (b.size > 650 * 1024) b = await shrink(b, 1100, 0.6);
        if (b.size > 700 * 1024) throw { code: 'too_large', message: 'Foto troppo grande' };
        var url = await blobToDataUrl(b), id = rid('f');
        // con la foto, una scheda leggera in «fotoInfo» (quanto pesa): così lo spazio si conta senza scaricare le foto
        var fb = fs.batch(), cr = nowISO(), da = ME ? chi() : '';
        fb.set(fs.collection('foto').doc(id), { data: url, creato: cr, da: da, _ts: FV.serverTimestamp() });
        fb.set(fs.collection('fotoInfo').doc(id), { kb: Math.ceil(url.length / 1024), creato: cr, da: da, _ts: FV.serverTimestamp() });
        var fp = fb.commit(); pendAdd(fp);
        await settle(fp);
        PH[id] = url; IDB.put('foto', id, url);
        return { id: id, url: url, sizeBytes: b.size, contentType: 'image/jpeg' };
      })();
    },
    delete: function (id) { delete PH[id]; IDB.del('foto', id); return settle(fs.collection('foto').doc(id).set({ _del: true, _ts: FV.serverTimestamp() })); },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); }
  };

  /* ---------- file da salvare (copia dei dati) ---------- */
  var DL = {
    save: function (o) {
      return (async function () {
        var name = o.filename || 'file', data = o.data;
        var type = /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv' : /\.txt$/i.test(name) ? 'text/plain' : 'application/octet-stream';
        var blob = data instanceof Blob ? data : new Blob([data], { type: type });
        var mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (mobile && navigator.canShare) {
          try {
            var file = new File([blob], name, { type: blob.type || type });
            if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return { status: 'saved' }; }
          } catch (e) { if (e && e.name === 'AbortError') throw { code: 'declined', message: 'Annullato' }; }
        }
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
        return { status: 'saved' };
      })();
    }
  };

  /* ---------- accesso, registrazione, attesa ---------- */
  var AUTH_MSG = {
    'auth/invalid-credential': 'Email o password sbagliate.', 'auth/wrong-password': 'Email o password sbagliate.', 'auth/user-not-found': 'Nessun account con questa email: registrati.',
    'auth/invalid-login-credentials': 'Email o password sbagliate.', 'auth/email-already-in-use': 'Esiste già un account con questa email: accedi.',
    'auth/weak-password': 'La password deve avere almeno 6 caratteri.', 'auth/invalid-email': 'Email non valida.', 'auth/missing-password': 'Scrivi la password.',
    'auth/network-request-failed': 'Nessuna connessione. Riprova quando hai campo.', 'auth/too-many-requests': 'Troppi tentativi: riprova tra qualche minuto.'
  };
  function authErr(e) { return AUTH_MSG[e && e.code] || ('Non è andata: ' + ((e && (e.code || e.message)) || 'errore')); }
  function busy(form, on) { form.querySelectorAll('button').forEach(function (b) { b.disabled = on; }); }
  // campo password con l'occhio per vederla mentre si scrive
  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';
  function pwField(id, auto, extra) {
    return '<div class="pw"><input id="' + id + '" type="password" autocomplete="' + auto + '" autocapitalize="off" autocorrect="off" spellcheck="false" required' + (extra || '') + '>' +
      '<button type="button" class="eye" data-eye="' + id + '" aria-label="Mostra la password" aria-pressed="false">' + EYE + '</button></div>';
  }
  // tenere il cursore nel campo quando si tocca l'occhio (così la tastiera non si chiude)
  document.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('#nmfb .eye')) e.preventDefault(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#nmfb .eye'); if (!b) return;
    var inp = document.getElementById(b.getAttribute('data-eye')); if (!inp) return;
    var show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.innerHTML = show ? EYE_OFF : EYE;
    b.setAttribute('aria-label', show ? 'Nascondi la password' : 'Mostra la password');
    b.setAttribute('aria-pressed', String(show));
  });
  function showLogin(msg) {
    var o = overlay('<h2>Accedi</h2><p>Entra con l’email e la password del tuo account del cantiere.</p>' +
      '<form id="nm-login"><label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="nm-pw">Password</label>' + pwField('nm-pw', 'current-password') +
      '<button class="btn" type="submit">Accedi</button><div class="err" id="nm-err">' + esc(msg || '') + '</div></form>' +
      '<button class="lnk" id="nm-goreg">Prima volta? Crea il tuo account</button><button class="lnk" id="nm-goreset">Password dimenticata</button>');
    var f = $('#nm-login', o);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); busy(f, true); $('#nm-err').textContent = '';
      auth.signInWithEmailAndPassword($('#nm-em').value.trim(), $('#nm-pw').value).catch(function (er) { busy(f, false); $('#nm-err').textContent = authErr(er); });
    });
    $('#nm-goreg', o).onclick = showRegister; $('#nm-goreset', o).onclick = showReset;
  }
  function showRegister() {
    var o = overlay('<h2>Crea il tuo account</h2><p>Dopo la registrazione il cantiere deve approvarti: appena lo fa, puoi entrare.</p>' +
      '<form id="nm-reg"><label>Chi sei?</label><label class="opt"><input type="radio" name="nm-tipo" value="staff" checked> Lavoro al cantiere</label>' +
      '<label class="opt"><input type="radio" name="nm-tipo" value="cliente"> Sono un cliente</label>' +
      '<label for="nm-nm">Nome e cognome</label><input id="nm-nm" type="text" autocomplete="name" required maxlength="60">' +
      '<label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="nm-pw">Password (almeno 6 caratteri)</label>' + pwField('nm-pw', 'new-password', ' minlength="6"') +
      '<button class="btn" type="submit">Crea account</button><div class="err" id="nm-err"></div></form><button class="lnk" id="nm-gologin">Ho già un account: accedi</button>');
    var f = $('#nm-reg', o);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); busy(f, true); $('#nm-err').textContent = '';
      var nome = $('#nm-nm').value.trim(), email = $('#nm-em').value.trim(), pw = $('#nm-pw').value;
      var tipo = (f.querySelector('input[name="nm-tipo"]:checked') || {}).value === 'cliente' ? 'cliente' : 'staff';
      registering = true;
      auth.createUserWithEmailAndPassword(email, pw).then(function (cr) {
        return createProfile(cr.user, nome, email, tipo);
      }).then(function () { registering = false; watchMe(auth.currentUser); }, function (er) { registering = false; busy(f, false); $('#nm-err').textContent = authErr(er); });
    });
    $('#nm-gologin', o).onclick = function () { showLogin(); };
  }
  function createProfile(u, nome, email, tipo) {
    var cfg = fs.collection('config').doc('inizializzato'), me = fs.collection('utenti').doc(u.uid);
    return cfg.get({ source: 'server' }).then(function (c) {
      var base = { nome: nome, email: email, tipo: tipo === 'cliente' ? 'cliente' : 'staff', creato: nowISO(), modificato: nowISO() };
      if (c.exists || tipo === 'cliente') return me.set(Object.assign(base, { stato: 'in_attesa', ruolo: 'base' }));
      var b = fs.batch();
      b.set(me, Object.assign(base, { stato: 'attivo', ruolo: 'admin' }));
      b.set(cfg, { da: u.uid, il: nowISO() });
      return b.commit().catch(function () { return me.set(Object.assign(base, { stato: 'in_attesa', ruolo: 'base' })); });
    });
  }
  function showReset() {
    var o = overlay('<h2>Password dimenticata</h2><p>Ti mandiamo un’email con il link per sceglierne una nuova.</p>' +
      '<form id="nm-rs"><label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required>' +
      '<button class="btn" type="submit">Mandami il link</button><div class="err" id="nm-err"></div></form><button class="lnk" id="nm-gologin">Torna all’accesso</button>');
    var f = $('#nm-rs', o);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); busy(f, true);
      auth.sendPasswordResetEmail($('#nm-em').value.trim()).then(function () { $('#nm-err').innerHTML = '<span class="ok">Fatto: controlla la posta (anche lo spam).</span>'; busy(f, false); },
        function (er) { busy(f, false); $('#nm-err').textContent = authErr(er); });
    });
    $('#nm-gologin', o).onclick = function () { showLogin(); };
  }
  function showWait(u) {
    var o = overlay('<h2>Richiesta inviata</h2><div class="card"><p style="margin:0">Ciao <b>' + esc(u.nome || '') + '</b>, il tuo account è in attesa. Un amministratore del cantiere deve approvarlo: appena lo fa, l’app si apre da sola.</p></div>' +
      '<button class="lnk" id="nm-out">Esci</button>');
    $('#nm-out', o).onclick = logout;
  }
  function showBlocked() {
    var o = overlay('<h2>Accesso sospeso</h2><p>Il tuo account non è attivo. Parla con un amministratore del cantiere.</p><button class="lnk" id="nm-out">Esci</button>');
    $('#nm-out', o).onclick = logout;
  }
  function logout() {
    var ask = $('#nmfb') ? true : confirm('Vuoi uscire? Su questo telefono verranno tolti i dati salvati per lavorare senza campo.');
    if (!ask) return;
    Promise.resolve(IDB.clear()).then(function () { return auth.signOut(); }).then(function () {
      try { fs.terminate().then(function () { return fs.clearPersistence(); }).finally(function () { location.reload(); }); } catch (e) { location.reload(); }
    });
  }
  function watchMe(u) {
    if (ME_UNSUB) { ME_UNSUB(); ME_UNSUB = null; }
    overlay('<div class="spin"></div>');
    ME_UNSUB = fs.collection('utenti').doc(u.uid).onSnapshot(function (d) {
      if (!d.exists) {
        if (registering) return;
        createProfile(u, (u.email || '').split('@')[0], u.email || '').catch(function () { });
        return;
      }
      var x = d.data(); x.uid = u.uid; x.email = x.email || u.email;
      if (x.stato === 'attivo' && x.ruolo === 'cliente') { if (started) { location.reload(); return; } ME = x; showCliente(x); return; }
      if (CLIENTE) { location.reload(); return; }
      if (x.stato === 'attivo') {
        var was = ME; ME = x;
        if (!started) { started = true; hideOverlay(); READY_RES(); afterStart(); }
        else if (was && (was.ruolo !== x.ruolo || !!was.tablet !== !!x.tablet)) location.reload();
      } else if (started) location.reload();
      else if (x.stato === 'bloccato') showBlocked();
      else showWait(x);
    }, function (e) {
      if (!started) showLogin('Non riesco a leggere il tuo account (' + errOf(e).code + '). Riprova.');
    });
  }
  var DOM = new Promise(function (r) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r, { once: true }); else r(); });
  auth.onAuthStateChanged(function (u) {
    DOM.then(function () {
      if (!u) { if (started) { location.reload(); return; } showLogin(); return; }
      if (!registering) watchMe(u);
    });
  });
  function boot() { if (!started && !$('#nmfb')) overlay('<div class="spin"></div>'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  function afterStart() {
    UT_UNSUB = fs.collection('utenti').onSnapshot(function (s) {
      var m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); UT = m; if ($('#nmpan')) renderPanel(); schedulePortale();
    }, function () { });
    // il nome nella scheda lavoro
    var D = live('dipendenti');
    D.start.then(function () { return whenReady(D, 15000); }).then(function () {
      if (ME && !D.map[ME.uid]) write('dipendenti', ME.uid, 'set', { nome: ME.nome || '', modificato: nowISO() }).catch(function () { });
    });
    if (ME && ME.ruolo === 'admin') { setTimeout(purgeCestino, 5000); setTimeout(pulisciSegnaposto, 20000); }
    pendVecchie();
    attEntra(); attAscolta();
    // aperto dal link per portare i dati dall'app di Claude
    if (IMP_KEY) setTimeout(offerImport, 800);
  }

  /* ---------- tablet condiviso: strumento acceso in Altro › Strumenti in più, PIN di 4 cifre (si salva solo l'impronta) ---------- */
  function tabStr() { var L = LIVE.impostazioni, c = L && L.map && L.map.strumenti; return !!(c && !c._del && c.tablet); }
  function pinDi(uid) { var L = LIVE.pin, x = L && L.map && L.map[uid]; return x && !x._del && x.hash ? x : null; }
  async function pinHash(uid, pin) {
    var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nm-pin|' + uid + '|' + pin));
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  async function pinSalva(uid, pin) {
    pin = String(pin || '').trim();
    if (!/^\d{4}$/.test(pin)) { toast('Il PIN è di 4 cifre.'); return; }
    if (/^(\d)\1{3}$/.test(pin) || pin === '1234') { toast('Scegli un PIN meno facile da indovinare.'); return; }
    try { await write('pin', uid, 'set', { utente: uid, hash: await pinHash(uid, pin), modificato: nowISO() }); toast('PIN salvato.'); renderPanel(); } catch (e) { toast('Non riuscito: ' + errOf(e).code); }
  }

  /* ---------- pannelli: utenti e permessi, il mio account ---------- */
  var PAN = null;
  function altroRows() {
    if (!ME) return [];
    var rows = [];
    if (ME.ruolo === 'admin') {
      var n = Object.keys(UT).filter(function (id) { return UT[id].stato === 'in_attesa'; }).length;
      rows.push(['utenti', 'users', n ? 'soon' : '', 'Utenti e permessi', 'Approva i colleghi e decidi i permessi', n ? '<span class="pill soon">' + n + (n === 1 ? ' in attesa' : ' in attesa') + '</span>' : '']);
    }
    if (ME.ruolo === 'admin') rows.push(['cestino', 'trash', '', 'Cestino', 'Ciò che è stato cancellato negli ultimi 60 giorni: si può recuperare', '']);
    rows.push(['account', 'out', '', 'Il mio account', (ME.email || '') + ' · ' + (RUOLI[ME.ruolo] || ''), '']);
    return rows;
  }
  function open(k) { PAN = k; if (k === 'cestino') CEST = null; renderPanel(); }

  /* ---------- cestino (solo amministratori) ---------- */
  var CEST = null, CEST_DAYS = 60;
  var CEST_NOMI = { barche: 'Barca', lavori: 'Lavoro o mansione', scadenze: 'Scadenza', vari: 'Varo o alaggio', magazzino: 'Ricambio', movimenti: 'Movimento di magazzino',
    operazioni: 'Servizio', opModelli: 'Gruppo di servizi', mezzi: 'Mezzo', conferme: 'Giornata confermata', posti: 'Posto al porto', attrezzatura: 'Attrezzatura', deposito: 'Roba in deposito', componenti: 'Componente a bordo', barattoli: 'Barattolo aperto', programma: 'Programma',
    cariche: 'Carica batterie', richieste: 'Richiesta', richiesteCliente: 'Richiesta del cliente', verbali: 'Verbale', rifiuti: 'Rifiuto', ritiri: 'Ritiro rifiuti', scadCantiere: 'Scadenza del cantiere', preventivi: 'Preventivo', assenze: 'Ferie o permesso', kit: 'Kit ricambi', inventari: 'Inventario', giri: 'Giro di controllo', cronometri: 'Cronometro', ditte: 'Ditta esterna',
    checklist: 'Checklist', modelli: 'Modello di checklist', checkBarca: 'Lista della barca', dipendenti: 'Dipendente', impostazioni: 'Impostazione' };
  function cestCutoff() { return new Date(Date.now() - CEST_DAYS * 864e5).toISOString(); }
  function purgeCestino() { // toglie per sempre ciò che è nel cestino da più di 60 giorni
    return fs.collection('cestino').where('il', '<', cestCutoff()).limit(200).get().then(function (s) {
      if (!s.size) return; var b = fs.batch(); s.docs.forEach(function (d) { b.delete(d.ref); }); return b.commit();
    }).catch(function () { });
  }
  function loadCestino() {
    CEST = { loading: true, items: [] };
    purgeCestino().then(function () { return fs.collection('cestino').orderBy('il', 'desc').limit(400).get(); }).then(function (s) {
      var cut = cestCutoff(), items = s.docs.map(function (d) { var x = d.data(); x.id = d.id; x.dati = dec(x.dati || {}); return x; }).filter(function (x) { return x.il >= cut; });
      // raggruppo ciò che è stato cancellato insieme
      var groups = [];
      items.forEach(function (x) {
        var g = groups[groups.length - 1];
        if (g && g.da === x.da && (x.gruppo ? x.gruppo === g.gruppo : Date.parse(g.last) - Date.parse(x.il) < 15000)) { g.items.push(x); g.last = x.il; } else groups.push({ da: x.da, daNome: x.daNome, gruppo: x.gruppo, il: x.il, last: x.il, items: [x] });
      });
      CEST = { items: items, groups: groups }; renderPanel();
    }, function (e) { CEST = { err: errOf(e).code, items: [] }; renderPanel(); });
  }
  function cestLabel(x) { var d = x.dati || {}; return String(d.nome || d.titolo || d.tipo || d.descr || d.cliente || d.data || x.docId).slice(0, 80); }
  function cestinoHtml() {
    if (!CEST || CEST.loading) return '<div class="spin" style="width:28px;height:28px;border-radius:50%;border:3px solid #33355a;border-top-color:#2f8ff0;margin:30px auto;animation:nmspin 1s linear infinite"></div>';
    if (CEST.err) return '<p class="note">Non riesco a leggere il cestino (' + esc(CEST.err) + '). Se hai appena aggiornato le regole del database, riprova tra un minuto.</p>';
    if (!CEST.groups.length) return '<p class="note">Il cestino è vuoto.</p>';
    return '<div class="grp">' + CEST.groups.map(function (g, i) {
      var first = g.items[g.items.length - 1], when = new Date(g.il).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      var main = g.items.filter(function (x) { return x.coll === 'barche'; })[0] || first;
      var extra = g.items.length > 1 ? ' e altre ' + (g.items.length - 1) + (g.items.length === 2 ? ' cosa' : ' cose') : '';
      return '<div class="u"><div class="nm">' + esc(cestLabel(main)) + '<span class="pill">' + esc(CEST_NOMI[main.coll] || main.coll) + '</span></div>' +
        '<div class="em">' + esc(extra ? 'Insieme' + extra : '') + (extra ? ' · ' : '') + 'cancellato da ' + esc(g.daNome || (UT[g.da] && UT[g.da].nome) || 'qualcuno') + ' · ' + esc(when) + '</div>' +
        '<div class="acts"><button class="b pri" data-nm="rec" data-id="' + i + '">Recupera</button></div></div>';
    }).join('') + '</div>';
  }
  async function recuperaGruppo(i) {
    var g = CEST && CEST.groups && CEST.groups[i]; if (!g) return;
    var busy = g.items.filter(function (x) { return live(x.coll).map[x.docId]; });
    if (busy.length && !confirm(busy.length === 1 ? 'Nel frattempo è stato creato di nuovo un elemento con lo stesso posto: lo sostituisco con quello recuperato?' : busy.length + ' elementi sono stati ricreati nel frattempo: li sostituisco con quelli recuperati?')) return;
    var ok = 0, fail = 0;
    for (var k = 0; k < g.items.length; k++) {
      var x = g.items[k];
      if (COLLS.indexOf(x.coll) < 0) { fail++; continue; } // si recuperano solo i dati del cantiere, mai profili o impostazioni di sistema
      try { await write(x.coll, x.docId, 'set', x.dati); await settle(fs.collection('cestino').doc(x.id).delete()); ok++; } catch (e) { fail++; }
    }
    toast(fail ? 'Recuperate ' + ok + ', ' + fail + ' non riuscite: riprova.' : ok === 1 ? 'Recuperato' : 'Recuperate ' + ok + ' cose');
    for (var j = 0; j < g.items.length; j++) { var y = g.items[j]; if (y.coll === 'barche' && y.dati && y.dati.unione && live('barche').map[y.docId]) await annullaUnione(y.docId, y.dati); }
    CEST = null; renderPanel();
  }
  // una barca recuperata che era stata unita a un'altra: si rimette tutto com'era prima dell'unione
  async function annullaUnione(dId, d) {
    var u = d.unione, B = live('barche').map, nome = (B[u.in] && B[u.in].nome) || u.nome || 'l’altra barca';
    if (B[u.in] && confirm('«' + (d.nome || 'Questa barca') + '» era stata unita a «' + nome + '». Annullo l’unione? Rimetto qui lavori, scadenze e il resto che le avevo spostato, e riporto la scheda «' + nome + '» com’era prima dell’unione (le modifiche fatte dopo a quella scheda si perdono).')) {
      var ok = 0, fail = 0;
      for (var i = 0; i < (u.spostati || []).length; i++) {
        var m = u.spostati[i]; if (!m || COLLS.indexOf(m.c) < 0) continue;
        var cur = live(m.c).map[m.id], up = {}; if (!cur) continue;
        if ('b' in m) up.barcaId = m.b;
        if (m.ab) up.altreBarche = m.ab;
        if (m.c === 'posti') up.modificato = nowISO();
        try { await write(m.c, m.id, 'update', up); ok++; } catch (e) { fail++; }
      }
      try { await write('barche', u.in, 'set', u.prima); } catch (e) { fail++; }
      (u.clienti || []).forEach(function (uid) { var x = UT[uid]; if (!x) return; var bb = (x.barche || []).slice(); if (bb.indexOf(dId) < 0) bb.push(dId); setUser(uid, { barche: bb }).catch(function () { }); });
      toast(fail ? 'Unione annullata in parte: ' + fail + ' cose non riuscite.' : 'Unione annullata: le due schede sono di nuovo separate.');
    }
    try { await write('barche', dId, 'update', { unione: { __delete__: true } }); } catch (e) { }
  }
  // clienti collegati a una barca (per l'unione di due schede)
  function clientiBarca(bid) { return Object.keys(UT).filter(function (id) { return (UT[id].barche || []).indexOf(bid) >= 0; }); }
  function spostaClienti(da, a) {
    return Promise.all(clientiBarca(da).map(function (id) {
      var bb = []; (UT[id].barche || []).forEach(function (b) { b = b === da ? a : b; if (bb.indexOf(b) < 0) bb.push(b); });
      return setUser(id, { barche: bb });
    }));
  }
  // barca venduta: i clienti scelti non vedono più questa barca nel portale
  function staccaClienti(bid, ids) {
    return Promise.all((ids || []).filter(function (id) { return UT[id]; }).map(function (id) { return setUser(id, { barche: (UT[id].barche || []).filter(function (b) { return b !== bid; }) }); }));
  }
  function nomeUtente(id) { var u = UT[id] || {}; return u.nome || u.email || id; }
  function closePanel() { PAN = null; var p = $('#nmpan'); if (p) p.remove(); }
  // sul computer il menù a sinistra resta visibile: toccando una sua voce il pannello si chiude
  document.addEventListener('click', function (e) { if ($('#nmpan') && e.target.closest && e.target.closest('#tabs [data-act]')) closePanel(); }, true);
  function oldPeople() {
    var D = LIVE.dipendenti ? LIVE.dipendenti.map : {};
    return Object.keys(D).filter(function (id) { return !UT[id]; }).map(function (id) { return { id: id, nome: D[id].nome || id }; });
  }
  // Avviso «schede lavoro sotto le 8 ore»: di chi si controllano le ore (impostazioni/schede.chi; senza lista = in automatico)
  function schChi() { var L = LIVE.impostazioni, c = L && L.map && L.map.schede; return c && !c._del && Array.isArray(c.chi) ? c.chi : null; }
  function schAuto() {
    var L = LIVE.lavori ? LIVE.lavori.map : {}, m = {}, lim = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    Object.keys(L).forEach(function (k) { var l = L[k]; if (l && !l._del && l.fonte === 'scheda' && l.utente && l.data >= lim && !l.annullata) m[l.utente] = 1; });
    return m;
  }
  function schOn(id) { var c = schChi(); return c ? c.indexOf(id) >= 0 : !!schAuto()[id]; }
  function schSalva(chi, msg) {
    return write('impostazioni', 'schede', 'set', { chi: chi, modificato: nowISO(), da: ME.uid }).then(function () { toast(msg); renderPanel(); }, function (e) { toast('Non riuscito: ' + errOf(e).code); renderPanel(); });
  }
  function renderPanel() {
    if (!PAN) return;
    ensureCss();
    var p = $('#nmpan'); if (!p) { p = document.createElement('div'); p.id = 'nmpan'; document.body.appendChild(p); }
    var h = '';
    if (PAN === 'account') {
      h = '<div class="top"><button class="back" data-nm="close">‹ Indietro</button><h3>Il mio account</h3><span style="min-width:64px"></span></div>' +
        '<div class="grp"><div class="u"><div class="nm">' + esc(ME.nome || '') + '</div><div class="em">' + esc(ME.email || '') + '</div><div class="note" style="margin:6px 0 0">Ruolo: ' + esc(RUOLI[ME.ruolo] || ME.ruolo) + '</div>' +
        '<div class="acts"><button class="b" data-nm="pw">Cambia password</button><button class="b red" data-nm="out">Esci</button></div></div></div>' +
        '<p class="note">«Cambia password» ti manda un’email con il link. Uscendo, da questo telefono vengono tolti i dati salvati per lavorare senza campo.</p>' +
        (tabStr() && ME.ruolo !== 'cliente' && !ME.tablet ? '<h4>PIN per il tablet</h4><div class="grp"><div class="u"><div class="em">' + (pinDi(ME.uid) ? 'Hai già un PIN: scrivine uno nuovo per cambiarlo.' : 'Sul tablet dell’officina tocchi il tuo nome e scrivi questo PIN.') + '</div>' +
          '<div class="acts"><input id="nm-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 cifre" style="width:110px"><button class="b pri" data-nm="pin" data-id="' + ME.uid + '">Salva PIN</button>' +
          (pinDi(ME.uid) ? '<button class="b red" data-nm="pin-no" data-id="' + ME.uid + '">Togli</button>' : '') + '</div></div></div>' : '');
    } else if (PAN === 'utenti' && ME.ruolo === 'admin') {
      var ids = Object.keys(UT), by = function (st) { return ids.filter(function (id) { return (UT[id].stato || '') === st; }).sort(function (a, b) { return String(UT[a].nome || '').localeCompare(String(UT[b].nome || ''), 'it'); }); };
      var olds = oldPeople();
      var B = LIVE.barche ? LIVE.barche.map : {};
      var bname = function (bid) { return B[bid] ? (B[bid].nome || 'Barca') : 'Barca eliminata'; };
      var row = function (id) {
        var u = UT[id], self = id === ME.uid, a = '', isCl = u.ruolo === 'cliente';
        if (u.stato === 'in_attesa') a = '<button class="b pri" data-nm="ok" data-id="' + id + '">' + (u.tipo === 'cliente' ? 'Approva come cliente' : 'Approva') + '</button><button class="b red" data-nm="no" data-id="' + id + '">Rifiuta</button>';
        else if (u.stato === 'attivo') a = self ? '<span class="note" style="margin:0">Sei tu</span>' :
          '<select data-nm="ruolo" data-id="' + id + '">' + ['base', 'admin', 'cliente'].map(function (r) { return '<option value="' + r + '"' + ((u.ruolo === 'editor' ? 'base' : u.ruolo) === r ? ' selected' : '') + '>' + RUOLI[r] + '</option>'; }).join('') + '</select>' +
          '<button class="b red" data-nm="block" data-id="' + id + '">Sospendi</button>' +
          (tabStr() && !isCl ? '<button class="b' + (u.tablet ? ' pri' : '') + '" data-nm="tab" data-id="' + id + '">' + (u.tablet ? 'È il tablet condiviso' : 'Usa come tablet condiviso') + '</button>' +
            (u.tablet ? '' : '<button class="b" data-nm="pin-a" data-id="' + id + '">' + (pinDi(id) ? 'Cambia PIN tablet' : 'Metti PIN tablet') + '</button>') : '');
        else a = '<button class="b" data-nm="ok" data-id="' + id + '">Riattiva</button>';
        if (u.stato === 'attivo' && !isCl && !u.tablet) a += '<button class="b' + (schOn(id) ? ' pri' : '') + '" data-nm="sch" data-id="' + id + '">' + (schOn(id) ? '✓ Ore controllate' : 'Ore non controllate') + '</button>';
        if (isCl && u.stato === 'attivo') {
          var mine = u.barche || [], others = Object.keys(B).filter(function (b) { return mine.indexOf(b) < 0; }).sort(function (x, y) { return bname(x).localeCompare(bname(y), 'it'); });
          a += '<div class="chips">' + (mine.length ? mine.map(function (b) { return '<span class="chip">' + esc(bname(b)) + '<button data-nm="unb" data-id="' + id + '" data-b="' + esc(b) + '" aria-label="Togli">×</button></span>'; }).join('') : '<span class="note" style="margin:0">Nessuna barca collegata</span>') + '</div>' +
            '<select data-nm="addb" data-id="' + id + '"><option value="">+ Collega una sua barca…</option>' + others.map(function (b) { return '<option value="' + esc(b) + '">' + esc(bname(b) + (B[b].modello ? ' · ' + B[b].modello : '')) + '</option>'; }).join('') + '</select>';
        }
        if (olds.length && u.stato !== 'bloccato' && !isCl && u.tipo !== 'cliente') a += '<select data-nm="link" data-id="' + id + '"><option value="">Collega ai dati vecchi…</option>' + olds.map(function (o) { return '<option value="' + esc(o.id) + '">È ' + esc(o.nome) + '</option>'; }).join('') + '</select>';
        return '<div class="u"><div class="nm">' + esc(u.nome || '(senza nome)') + (u.stato === 'attivo' ? '<span class="pill">' + esc(RUOLI[u.ruolo] || u.ruolo) + '</span>' : u.stato === 'in_attesa' ? '<span class="pill">' + (u.tipo === 'cliente' ? 'Cliente' : 'Lavora al cantiere') + '</span>' : '') + '</div><div class="em">' + esc(u.email || '') + '</div><div class="acts">' + a + '</div></div>';
      };
      var sec = function (t, list) { return list.length ? '<h4>' + t + ' (' + list.length + ')</h4><div class="grp">' + list.map(row).join('') + '</div>' : ''; };
      h = '<div class="top"><button class="back" data-nm="close">‹ Indietro</button><h3>Utenti e permessi</h3><span style="min-width:64px"></span></div>' +
        sec('In attesa di approvazione', by('in_attesa')) + sec('Cantiere', by('attivo').filter(function (id) { return UT[id].ruolo !== 'cliente'; })) +
        sec('Clienti', by('attivo').filter(function (id) { return UT[id].ruolo === 'cliente'; })) + sec('Sospesi', by('bloccato')) +
        '<p class="note"><b>Ore controllate</b>: per l’avviso «schede lavoro sotto le 8 ore» in primo piano si controllano solo queste persone. ' + (schChi() ? 'Le hai scelte tu: tocca il tasto per cambiare. <button class="b" data-nm="sch-auto">Torna in automatico</button>' : 'Ora è in automatico (chi ha scritto una scheda nell’ultimo mese): tocca il tasto di una persona per scegliere tu.') + '</p>' +
        '<p class="note"><b>Dipendente</b>: usa tutta l’app; cancella solo ciò che ha aggiunto, modifica solo le proprie mansioni e richieste di ferie. <b>Amministratore</b>: in più cancella tutto, vede il cestino, approva le ferie e i colleghi e cambia i permessi. ' +
        '<b>Cliente</b>: vede solo le barche che gli colleghi, con stato, posto e lavori eseguiti' + (strOnFb('orecliente') ? '; vede anche le ore di lavoro per tipo, con il testo delle mansioni e il nome di chi le ha fatte (solo giornate confermate)' : ', senza ore né nomi dei dipendenti (si accendono da Altro › Strumenti in più › Ore di lavoro al cliente)') + '.</p>' +
        (olds.length ? '<p class="note"><b>Collega ai dati vecchi</b>: dopo aver ripristinato la copia presa da Claude, scegli chi era quella persona. Mansioni, ore e giornate confermate passano al nuovo account.</p>' : '') +
        '<p class="note">Per far entrare un collega mandagli il link dell’app: si registra da solo e compare qui sopra, in attesa.</p>';
    } else if (PAN === 'cestino' && ME.ruolo === 'admin') {
      h = '<div class="top"><button class="back" data-nm="close">‹ Indietro</button><h3>Cestino</h3><span style="min-width:64px"></span></div>' + cestinoHtml() +
        '<p class="note">Qui finisce tutto ciò che viene cancellato, con chi l’ha cancellato e quando. Dopo 60 giorni sparisce per sempre. Le cose cancellate insieme (per esempio una barca con i suoi lavori) si recuperano insieme.</p>';
      if (!CEST) loadCestino();
    } else { closePanel(); return; }
    p.innerHTML = h;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#nmpan [data-nm]'); if (!t || t.tagName === 'SELECT') return;
    var k = t.getAttribute('data-nm'), id = t.getAttribute('data-id');
    if (k === 'close') closePanel();
    else if (k === 'rec') { t.disabled = true; recuperaGruppo(+id); }
    else if (k === 'out') logout();
    else if (k === 'pw') auth.sendPasswordResetEmail(ME.email).then(function () { toast('Ti ho mandato l’email per cambiare la password.'); }, function (er) { toast(authErr(er)); });
    else if (k === 'ok') {
      var u0 = UT[id] || {}, f0 = { stato: 'attivo' };
      if (u0.stato === 'in_attesa' && u0.tipo === 'cliente') { f0.ruolo = 'cliente'; f0.barche = []; } // le barche le collega l'amministratore
      setUser(id, f0).then(function () { toast(f0.ruolo === 'cliente' ? 'Fatto: ora collega le sue barche qui sotto.' : 'Fatto: ' + (u0.nome || '') + ' può entrare.'); });
    }
    else if (k === 'unb') { var ub = (UT[id].barche || []).filter(function (b) { return b !== t.getAttribute('data-b'); }); setUser(id, { barche: ub }); }
    else if (k === 'no') { if (confirm('Rifiutare la richiesta di ' + (UT[id] && UT[id].nome || '') + '?')) setUser(id, { stato: 'bloccato' }); }
    else if (k === 'tab') { var ut = !UT[id].tablet; if (!ut || confirm('Questo account diventa il tablet condiviso: chi lo apre trova «Chi lavora adesso?» e lavora a nome di chi scrive il suo PIN. Continuo?')) setUser(id, { tablet: ut }).then(function () { toast(ut ? 'Fatto: è il tablet condiviso.' : 'Non è più il tablet condiviso.'); renderPanel(); }); }
    else if (k === 'sch') { var sc = (schChi() || Object.keys(schAuto())).slice(), si = sc.indexOf(id); if (si >= 0) sc.splice(si, 1); else sc.push(id); schSalva(sc, si >= 0 ? 'Ore di ' + nomeUtente(id) + ' non più controllate.' : 'Ore di ' + nomeUtente(id) + ' controllate.'); }
    else if (k === 'sch-auto') schSalva(null, 'Di nuovo in automatico.');
    else if (k === 'pin-a') { var pa = prompt('PIN di 4 cifre per il tablet di ' + ((UT[id] && UT[id].nome) || '') + ':'); if (pa != null) pinSalva(id, pa); }
    else if (k === 'pin') pinSalva(id, ($('#nm-pin') || {}).value || '');
    else if (k === 'pin-no') { if (confirm('Togliere il tuo PIN? Sul tablet non comparirai più.')) write('pin', id, 'update', { hash: '', modificato: nowISO() }).then(function () { toast('PIN tolto.'); renderPanel(); }, function () { toast('Non riuscito.'); }); }
    else if (k === 'block') { if (confirm('Sospendere ' + (UT[id] && UT[id].nome || '') + '? Non potrà più entrare finché non lo riattivi.')) setUser(id, { stato: 'bloccato' }); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.closest || !t.closest('#nmpan') || !t.getAttribute('data-nm')) return;
    var k = t.getAttribute('data-nm'), id = t.getAttribute('data-id');
    if (k === 'ruolo') {
      if ((t.value === 'cliente') !== (UT[id].ruolo === 'cliente') && !confirm(t.value === 'cliente' ? 'Diventa cliente: non vedrà più l’app del cantiere, solo le sue barche. Continuo?' : 'Non sarà più cliente: vedrà tutta l’app del cantiere. Continuo?')) { t.value = UT[id].ruolo; return; }
      setUser(id, { ruolo: t.value }).then(function () { toast('Permessi aggiornati.'); });
    }
    else if (k === 'addb' && t.value) { var ab = (UT[id].barche || []).concat([t.value]); setUser(id, { barche: ab }).then(function () { toast('Barca collegata.'); }); }
    else if (k === 'link' && t.value) {
      var old = t.value, olds = oldPeople().filter(function (o) { return o.id === old; })[0];
      if (!confirm('Le mansioni, le ore e le giornate di ' + (olds ? olds.nome : old) + ' passano a ' + (UT[id] && UT[id].nome || '') + '. Continuo?')) { t.value = ''; return; }
      t.disabled = true; toast('Sto collegando i dati…');
      relink(old, id).then(function (n) { toast('Fatto: ' + n + ' elementi collegati.'); renderPanel(); }, function () { toast('Collegamento non riuscito. Riprova.'); renderPanel(); });
    }
  });
  function setUser(id, f) { f.modificato = nowISO(); return fs.collection('utenti').doc(id).update(f).catch(function (e) { toast('Non riuscito: ' + errOf(e).code); throw e; }); }
  function swap(v, a, b) {
    if (typeof v === 'string') return v === a ? b : v;
    if (Array.isArray(v)) return v.map(function (x) { return swap(x, a, b); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k.split(a).join(b)] = swap(v[k], a, b); }); return o; }
    return v;
  }
  async function relink(oldId, newId) {
    var n = 0;
    for (var i = 0; i < COLLS.length; i++) {
      var L = live(COLLS[i]); await L.start; await whenReady(L, 20000);
      var ids = Object.keys(L.map);
      for (var j = 0; j < ids.length; j++) {
        var id = ids[j], d = L.map[id], nd = swap(d, oldId, newId), nid = id.split(oldId).join(newId);
        if (nid !== id) {
          if (!(COLLS[i] === 'dipendenti' && L.map[nid])) await write(COLLS[i], nid, 'set', nd);
          await write(COLLS[i], id, 'delete'); n++;
        } else if (JSON.stringify(nd) !== JSON.stringify(d)) { await write(COLLS[i], id, 'set', nd); n++; }
      }
    }
    return n;
  }

  /* ---------- area cliente ---------- */
  var CL = { unsubs: [], docs: {}, all: {}, req: [], oy: {}, oc: {}, tab: '', st: {} };
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function dataCorta(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return ''; var y = +m[1], cy = new Date().getFullYear(); return (+m[3]) + ' ' + MESI[+m[2] - 1] + (y !== cy ? ' ’' + String(y).slice(2) : ''); }
  function dataLunga(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + ' ' + MESI[+m[2] - 1] + ' ' + m[1] : ''; }
  function quando(iso) { var t = new Date(iso); if (isNaN(t)) return ''; var p2 = function (n) { return (n < 10 ? '0' : '') + n; }; return t.getDate() + ' ' + MESI[t.getMonth()] + ' ' + t.getFullYear() + ' alle ' + p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function showCliente(x) {
    CLIENTE = true; ME = ME || x; attEntra();
    var ids = (x.barche || []).slice(0, 20);
    CL.unsubs.forEach(function (f) { f(); }); CL.unsubs = []; CL.ids = ids;
    ids.forEach(function (id) {
      CL.unsubs.push(fs.collection('portale').doc(id).onSnapshot(function (d) { CL.docs[id] = d.exists ? d.data() : null; renderCliente(); },
        function () { CL.docs[id] = null; renderCliente(); }));
    });
    // le proprie richieste al cantiere (idea 4): le regole fanno leggere solo quelle con cliente = me
    CL.unsubs.push(fs.collection('richiesteCliente').where('cliente', '==', ME.uid).onSnapshot(function (q) {
      CL.req = q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (r) { return !r._del; }).sort(function (a, b) { return String(b.creato || '').localeCompare(String(a.creato || '')); });
      renderCliente();
    }, function () { CL.req = []; }));
    renderCliente();
  }
  /* ---------- Richieste del cliente dal portale (idea 4, Strumenti in più › richieste) ----------
     «Vorrei il varo il…» e «Segnala un problema» (con foto): vanno in richiesteCliente; il cantiere le vede in
     Altro › Richieste dei clienti e risponde. Il cliente vede inviata → ricevuta → confermata (o non possibile). */
  var RQ_ST = { inviata: ['Inviata', ''], vista: ['Ricevuta', 'lav'], confermata: ['Confermata', 'acqua'], no: ['Non possibile', ''] };
  function rqCard(bid) {
    var mie = CL.req.filter(function (r) { return r.barcaId === bid && r.tipo !== 'lavoro'; }).slice(0, 6);
    return '<h5>Chiedi al cantiere</h5><div class="rqb"><button class="rqbtn" data-cl="rq" data-t="varo" data-id="' + esc(bid) + '">Vorrei il varo il…</button><button class="rqbtn" data-cl="rq" data-t="problema" data-id="' + esc(bid) + '">Segnala un problema</button></div>' +
      mie.map(function (r) {
        var st = RQ_ST[r.stato] || RQ_ST.inviata;
        return '<div class="lv" style="align-items:flex-start"><span style="flex:1">' + esc(r.tipo === 'varo' ? 'Varo il ' + dataLunga(r.data) : r.tipo === 'lavoro' ? 'Lavoro: ' + String(r.testo || '').slice(0, 60) : 'Problema: ' + String(r.testo || '').slice(0, 60)) +
          (r.risposta ? '<br><small>Il cantiere: ' + esc(r.risposta) + '</small>' : '') + '</span><span class="st ' + st[1] + '">' + st[0] + '</span></div>';
      }).join('');
  }
  function scCard(bid, d) {
    var L = d.scadenze || []; if (!L.length) return '';
    var mie = CL.req.filter(function (r) { return r.barcaId === bid && r.tipo === 'lavoro'; });
    return '<h5>Scadenze della tua barca</h5>' + L.map(function (s) {
      var gia = mie.find(function (r) { return r.scadId === s.id && r.stato !== 'no'; }), st = gia ? RQ_ST[gia.stato] || RQ_ST.inviata : null;
      return '<div class="lv" style="align-items:center"><span style="flex:1">' + esc(s.tipo) + (s.modello ? ' <small>(' + esc(s.modello) + ')</small>' : '') + '<br><small' + (s.scaduta ? ' style="color:#ff8a80"' : '') + '>' + esc((s.scaduta ? 'Scaduta il ' : 'Scade il ') + dataLunga(s.data)) + '</small>' + (gia && gia.risposta ? '<br><small>Il cantiere: ' + esc(gia.risposta) + '</small>' : '') + '</span>' +
        (gia ? '<span class="st ' + st[1] + '">' + st[0] + '</span>' : '<button class="rqbtn" style="flex:0 0 auto;min-width:0" data-cl="rqs" data-id="' + esc(bid) + '" data-s="' + esc(s.id) + '">Richiedi il lavoro</button>') + '</div>';
    }).join('');
  }
  async function rqScad(bid, sid, btn) {
    var d = CL.docs[bid] || {}, s = (d.scadenze || []).find(function (x) { return x.id === sid; }); if (!s) return;
    btn.disabled = true; btn.textContent = 'Invio…';
    try {
      await fs.collection('richiesteCliente').doc(rid('r')).set({ cliente: ME.uid, nome: ME.nome || '', barcaId: bid, tipo: 'lavoro', data: s.data, testo: s.tipo + (s.modello ? ' (' + s.modello + ')' : ''), scadId: sid, foto: [], stato: 'inviata', creato: nowISO() });
      toast('Richiesta inviata al cantiere');
    } catch (e) { btn.disabled = false; btn.textContent = 'Richiedi il lavoro'; toast('Non sono riuscito a inviarla: controlla la connessione e riprova.'); }
  }
  function rqForm(bid, tipo) {
    var d = CL.docs[bid] || {}, o = document.createElement('div'); o.id = 'nmrc'; var x = $('#nmrc'); if (x) x.remove();
    var oggi = new Date().toISOString().slice(0, 10);
    o.innerHTML = '<div class="box"><h3>' + esc(tipo === 'varo' ? 'Vorrei il varo' : 'Segnala un problema') + ' · ' + esc(d.nome || 'Barca') + '</h3>' +
      (tipo === 'varo' ? '<label>Il giorno<input id="rq-d" type="date" min="' + oggi + '"></label>' : '') +
      '<label>' + (tipo === 'varo' ? 'Note (facoltative)' : 'Cosa succede') + '<textarea id="rq-t" rows="4" maxlength="1500" placeholder="' + (tipo === 'varo' ? 'es. mattina presto, serve anche il pieno' : 'es. la pompa di sentina parte da sola') + '"></textarea></label>' +
      (tipo === 'problema' ? '<label>Foto (fino a 3, facoltative)<input id="rq-f" type="file" accept="image/*" multiple></label>' : '') +
      '<p id="rq-e" class="err" hidden></p><div class="row2"><button class="lnk" data-rq="x">Annulla</button><button class="pri" data-rq="ok">Invia</button></div></div>';
    document.body.appendChild(o);
    o.addEventListener('click', async function (e) {
      var t = e.target.closest && e.target.closest('[data-rq]'); if (!t && e.target !== o) return;
      if (!t || t.getAttribute('data-rq') === 'x') { o.remove(); return; }
      var er = $('#rq-e'), dt = tipo === 'varo' ? ($('#rq-d').value || '') : '', tx = String($('#rq-t').value || '').trim().slice(0, 1500), fi = $('#rq-f');
      if (tipo === 'varo' && !dt) { er.textContent = 'Scegli il giorno.'; er.hidden = false; return; }
      if (tipo === 'problema' && !tx) { er.textContent = 'Scrivi cosa succede.'; er.hidden = false; return; }
      t.disabled = true; t.textContent = 'Invio…';
      try {
        var foto = [], files = fi && fi.files ? Array.prototype.slice.call(fi.files, 0, 3) : [];
        for (var i = 0; i < files.length; i++) {
          var b = await shrink(files[i], 1400, 0.72); if (b.size > 650 * 1024) b = await shrink(b, 1100, 0.6); if (b.size > 700 * 1024) continue;
          var fid = rid('f'); await fs.collection('foto').doc(fid).set({ data: await blobToDataUrl(b), creato: nowISO(), da: ME.uid, portale: bid }); foto.push(fid);
        }
        await fs.collection('richiesteCliente').doc(rid('r')).set({ cliente: ME.uid, nome: ME.nome || '', barcaId: bid, tipo: tipo, data: dt, testo: tx, foto: foto, stato: 'inviata', creato: nowISO() });
        o.remove(); toast('Richiesta inviata al cantiere');
      } catch (err) { t.disabled = false; t.textContent = 'Invia'; er.textContent = 'Non sono riuscito a inviarla: controlla la connessione e riprova.'; er.hidden = false; }
    });
  }
  // dove si trova la barca, con la sua icona (5/11/2026): stessa scelta della scheda barca nel gestionale
  var DOVE_I = { msv: '<svg aria-hidden="true" viewBox="6 -1 36 50"><defs><mask id="MSK"><rect x="0" y="-2" width="48" height="52" fill="#fff"/><g fill="none" stroke="#000" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"><path d="M27.3 11.8c-.2 2.4-.9 4.5-2.2 5.8-.6.6-1.4.8-2.2.8h-3"/><path d="M20.4 27.2l.2 6.2" stroke-width=".6"/><path d="M24.8 27.6v5.6" stroke-width=".7"/></g></mask></defs><g fill="currentColor" mask="url(#MSK)"><path transform="rotate(-12 25.6 9.4)" d="M23.4 2.6c.8-1.3 2.6-1.9 4.1-1.3.7-.4 1.6-.2 1.9.5.6.1 1 .8.7 1.4.4.6.2 1.4-.3 1.8.1 1.4-.4 2.8-1.4 3.6l.1 2-3.3.2-.4-1.6c-.7.2-1.4.1-1.9-.4l-.1-.9c-.4-.1-.6-.5-.4-.8-.3-.2-.3-.6-.1-.8l-.2-.5c-.5-.1-.7-.6-.4-1l.9-1.2c-.1-.4 0-.7.8-1z"/><path d="M23.2 10c2.4-.4 4.7 0 5.7 1.4 1 1.6 1 6.4 1.1 10.4l.5 4.4c.1.6-.3 1-.9 1H20.2c-.6 0-1-.5-.9-1.1l1.1-6.4c-1-.5-1.6-1.5-1.5-2.7l.2-2.8c.3-2.3 1.8-3.8 4.1-4.2z"/><path d="M20.6 27h4.9l.1 5.9h-5zM25 27h4.5l.3 5.9H25z"/><path d="M20.1 32.4h5.6v2.3h-5.8zM25 32.4h5.2l.2 2.3H25z"/><path d="M21.4 34.6h2.9l-.2 3.6h-2.5zM26.2 34.6h2.8l-.3 3.6h-2.3z"/><path d="M21.6 37.8h2.5v1.5h-4.2c-.3 0-.4-.4-.1-.6zM26.4 37.8h2.3l.1 1.5h-3.9c-.3 0-.4-.4-.1-.6z"/></g><path fill="currentColor" d="M13.6 39.6c0-.5.4-.8.9-.8h19c.5 0 .9.3.9.8 0 .3-.1.6-.4.8l-2 1.7c-.4.4-1 .6-1.6.6H17.6c-.6 0-1.2-.2-1.6-.6l-2-1.7c-.3-.2-.4-.5-.4-.8z"/><g fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="1.9" d="M5 45.4c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6"/><path stroke-width="1.5" opacity=".55" d="M11 48.4c1.6 0 1.6-1.3 3.2-1.3s1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3"/></g></svg>', nm: '<i></i>', porto: '<svg aria-hidden="true" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="6.4" r="3.2" stroke-width="2.4"/><path stroke-width="2.8" d="M24 9.6v27"/><path stroke-width="2.6" d="M17.6 15.2h12.8"/><path stroke-width="2.8" d="M11 26.4c.6 6.4 6.3 10.4 13 10.4s12.4-4 13-10.4"/></g><g fill="currentColor"><path d="M8.2 28.2l2.6-5.4 3.4 5z"/><path d="M39.8 28.2l-2.6-5.4-3.4 5z"/></g><g fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="1.9" d="M5 43.6c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6"/><path stroke-width="1.5" opacity=".55" d="M11 46.8c1.6 0 1.6-1.3 3.2-1.3s1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3"/></g></svg>', terzi: '<svg aria-hidden="true" viewBox="0 0 48 48"><path fill="currentColor" fill-rule="evenodd" d="M4.5 40.5V24.2C4.5 13.6 13.2 6 24 6s19.5 7.6 19.5 18.2v16.3c0 .8-.6 1.5-1.4 1.5H5.9c-.8 0-1.4-.7-1.4-1.5zM12.5 42V27.2c0-.8.6-1.4 1.4-1.4h20.2c.8 0 1.4.6 1.4 1.4V42z"/><g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".75"><path d="M14.5 30h19M14.5 34h19M14.5 38h19"/></g><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".45" d="M9.6 19.4C12.4 13.6 17.8 10.4 24 10.4s11.6 3.2 14.4 9"/><path fill="currentColor" d="M2 43h44v2.2H2z" opacity=".55"/></svg>' }, DOVE_N = 0;
  function doveIcoCl(k) { var m = 'dvc' + (++DOVE_N); return '<span class="dv-ic ' + k + '">' + DOVE_I[k].replace(/MSK/g, m) + '</span>'; }
  function doveCl(d) {
    var st = d.stato || 'In rimessaggio', terra = st === 'In rimessaggio' || st === 'In lavorazione';
    var k = ['msv', 'nm', 'porto', 'terzi'].indexOf(d.dove) >= 0 ? d.dove : (st === 'In acqua' || (d.porto && !terra)) ? 'msv' : 'nm';
    var pz = (d.porto && d.porto.posto) || d.posto || '', t, sub = '';
    if (k === 'msv') {
      t = 'Porto di San Vincenzo' + (pz ? ' · posto ' + pz : '');
      if (d.porto && (d.porto.contratto || d.porto.fino)) sub = 'Contratto ' + [d.porto.contratto, d.porto.fino ? 'fino al ' + dataLunga(d.porto.fino) : ''].filter(Boolean).join(' · ');
    } else if (k === 'nm') { t = 'Al cantiere Nautica Mare'; sub = st === 'In lavorazione' ? 'In lavorazione' : st === 'In rimessaggio' ? 'A terra, in rimessaggio' : st === 'Consegnata' ? 'Consegnata' : ''; }
    else { t = [d.doveNome, d.doveLuogo].filter(Boolean).join(' · ') || (k === 'porto' ? 'Altro porto' : 'Cantiere di altri'); sub = k === 'porto' ? 'In un altro porto' : 'In un altro cantiere'; }
    return '<div class="where ' + k + '">' + doveIcoCl(k) + '<div><b>' + esc(t) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div></div>';
  }
  /* Cruscotto della barca nel portale (6/11/2026): schede Cruscotto, Motori, Attrezzatura, Scadenze, Deposito,
     Foto e storia, Lavori fatti, come nella scheda barca del gestionale ma senza le cose interne. */
  var CR_TABS = [['cr', 'Cruscotto'], ['mo', 'Motori'], ['at', 'Attrezzatura'], ['sc', 'Scadenze'], ['de', 'Deposito'], ['fo', 'Foto e storia'], ['la', 'Lavori fatti']];
  function crCol(lv) { return lv === 'late' ? '#ff6b5e' : lv === 'soon' ? '#ffb547' : '#2ec4b6'; }
  function crPct(p) { return p >= 85 ? '#4ade9b' : p >= 60 ? '#ffb547' : '#ff6b5e'; }
  function crBody(id, d, cs, img, x) {
    var c = d.cr, scC = scCard(id, d), scL = (c.scad || []).filter(function (s) { return !(d.scadenze || []).some(function (y) { return y.tipo === s.t && (y.modello || '') === s.m; }); });
    var foto = (c.foto || []).length || (c.verbali || []).length || (c.vari || []).length;
    var tabs = CR_TABS.filter(function (t) { return t[0] === 'sc' ? c.scadOn && (scC || scL.length) : t[0] === 'de' ? c.deOn : t[0] === 'fo' ? foto : true; });
    var cur = CL.st[id]; if (!tabs.some(function (t) { return t[0] === cur; })) cur = 'cr';
    var h = '<div class="crt" role="tablist">' + tabs.map(function (t) { return '<button role="tab" data-cl="st" data-id="' + esc(id) + '" data-t="' + t[0] + '" aria-selected="' + (t[0] === cur) + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var nf = function (n) { return n == null ? '–' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
    var tiles = (c.motori || []).map(function (m) { return [m.n, m.m, m.o]; }).concat((c.gen || []).map(function (g) { return ['Generatore', g.m, g.o]; }));
    var cOre = tiles.length ? '<div class="crm">' + tiles.map(function (t) { return '<div><span class="h">' + esc(t[0]) + (t[1] ? '<br>' + esc(t[1]) : '') + '</span><b>' + nf(t[2]) + '</b><small>ore</small></div>'; }).join('') + '</div>' +
      (c.oreAgg ? '<div class="upd" style="margin-top:6px">Ore lette il ' + esc(dataLunga(c.oreAgg)) + '</div>' : '') : '';
    var cVaro = '';
    if (c.varo) { var dv = Math.round((Date.parse(c.varo) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5); cVaro = '<div class="crv"><div><small>Varo</small><b>' + esc(dataLunga(c.varo)) + '</b></div><div class="n"><b>' + (dv < 0 ? '–' : dv) + '</b><small>' + (dv === 1 ? 'giorno' : 'giorni') + '</small></div></div>'; }
    var cStato = c.stato ? '<h5>Stato della barca</h5><div class="crs"><div class="r" style="border-color:' + crPct(c.stato.tot) + '"><b>' + c.stato.tot + '</b><small>su 100</small></div><div class="l">' +
      c.stato.voci.map(function (v) { return '<div><span>' + esc(v.t) + '</span><span>' + v.p + '%</span></div><i class="bar"><i style="width:' + v.p + '%;background:' + crPct(v.p) + '"></i></i>'; }).join('') + '</div></div>' : '';
    var cTag = (c.tagliandi || []).length ? '<h5>Prossimi tagliandi</h5>' + c.tagliandi.map(function (t) { return '<div class="crg"><div><span>' + esc(t.t) + (t.m ? ' <small>(' + esc(t.m) + ')</small>' : '') + '</span><span style="color:' + crCol(t.lv) + '">' + esc(t.txt) + '</span></div><i class="bar"><i style="width:' + t.u + '%;background:' + crCol(t.lv) + '"></i></i></div>'; }).join('') : '';
    var cMot = '<h5>Motori e generatore</h5>' + (tiles.length ? (c.motori || []).map(function (m) { return '<div class="lv"><span style="flex:1">' + esc(m.n) + '<br><small>' + esc([m.m, m.cv != null ? m.cv + ' cv' : ''].filter(Boolean).join(' · ')) + '</small></span><b>' + nf(m.o) + ' h</b></div>'; }).join('') +
      (c.gen || []).map(function (g) { return '<div class="lv"><span style="flex:1">Generatore<br><small>' + esc(g.m) + '</small></span><b>' + nf(g.o) + ' h</b></div>'; }).join('') : '<p style="margin:4px 0 0">Nessun motore segnato.</p>');
    var cSto = '';
    var P = c.orePts || [];
    if (P.length >= 2) {
      var x0 = Date.parse(P[0].d), x1 = Date.parse(P[P.length - 1].d), ys = P.map(function (p) { return p.o; }), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      var X = function (d0) { return x1 > x0 ? (Date.parse(d0) - x0) / (x1 - x0) * 290 + 5 : 150; }, Y = function (o) { return y1 > y0 ? 85 - (o - y0) / (y1 - y0) * 75 : 50; };
      cSto = '<h5>Storico delle ore</h5><svg viewBox="0 0 300 92" style="width:100%;height:auto;display:block"><polyline fill="none" stroke="#2ec4b6" stroke-width="2.5" points="' + P.map(function (p) { return X(p.d).toFixed(1) + ',' + Y(p.o).toFixed(1); }).join(' ') + '"/>' +
        P.map(function (p) { return '<circle cx="' + X(p.d).toFixed(1) + '" cy="' + Y(p.o).toFixed(1) + '" r="3" fill="#2ec4b6"/>'; }).join('') + '</svg><div class="upd" style="display:flex;justify-content:space-between;margin-top:2px"><span>' + esc(dataCorta(P[0].d)) + ' · ' + nf(P[0].o) + ' h</span><span>' + esc(dataCorta(P[P.length - 1].d)) + ' · ' + nf(P[P.length - 1].o) + ' h</span></div>';
    }
    var ST = { buono: ['Buono', 'acqua'], sistemare: ['Da sistemare', 'lav'], sostituire: ['Da sostituire', 'no'] };
    var cAttr = (c.attr || []).length ? '<h5>Attrezzatura di bordo</h5>' + c.attr.map(function (a) { var s = ST[a.st]; return '<div class="lv" style="align-items:center"><span style="flex:1">' + esc(a.t) + (a.s ? '<br><small>' + esc(a.s) + '</small>' : '') + '</span>' + (s ? '<span class="st ' + s[1] + '">' + s[0] + '</span>' : '') + '</div>'; }).join('') : '';
    var cComp = (c.comp || []).length ? '<h5>Componenti a bordo</h5>' + c.comp.map(function (a) { return '<div class="lv"><span style="flex:1">' + esc(a.t) + (a.s || a.g ? '<br><small>' + esc([a.s, a.g ? 'garanzia fino al ' + dataLunga(a.g) : ''].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></div>'; }).join('') : '';
    var cBatt = c.batt ? '<h5>Batterie</h5><div class="lv" style="align-items:center"><span style="flex:1">' + c.batt.n + (c.batt.n === 1 ? ' batteria' : ' batterie') + '<br><small>' + (c.batt.d == null ? 'carica non ancora segnata' : 'caricate ' + (c.batt.d === 0 ? 'oggi' : c.batt.d === 1 ? 'ieri' : c.batt.d + ' giorni fa')) + '</small></span>' + (c.batt.late ? '<span class="st lav">Da caricare</span>' : '<span class="st acqua">Cariche</span>') + '</div>' : '';
    var cScL = scL.length ? '<h5>' + (scC ? 'Più avanti' : 'Scadenze della tua barca') + '</h5>' + scL.map(function (s) { return '<div class="lv"><span style="flex:1">' + esc(s.t) + (s.m ? ' <small>(' + esc(s.m) + ')</small>' : '') + '<br><small style="color:' + crCol(s.lv) + '">' + esc(s.txt) + '</small></span></div>'; }).join('') : '';
    var cFoto = (c.foto || []).length ? '<h5>Foto della barca</h5><div class="dfo crf">' + c.foto.map(img).join('') + '</div>' : '';
    var cVb = (c.verbali || []).length ? '<h5>Verbali di ingresso e uscita</h5>' + c.verbali.map(function (v) { return '<div class="lv" style="flex-wrap:wrap"><span class="d">' + esc(dataCorta(v.d)) + '</span><span style="flex:1">' + (v.t === 'uscita' ? 'Uscita (varo)' : 'Ingresso (alaggio)') + (v.o ? ' · ' + esc(v.o) + ' ore motore' : '') + '</span>' + ((v.foto || []).length ? '<span class="dfo" style="width:100%">' + v.foto.map(img).join('') + '</span>' : '') + '</div>'; }).join('') : '';
    var cVa = (c.vari || []).length ? '<h5>Vari e alaggi</h5>' + c.vari.map(function (v) { return '<div class="lv"><span class="d">' + esc(dataCorta(v.d)) + '</span><span>' + esc(v.t) + '</span></div>'; }).join('') : '';
    var g = '';
    if (cur === 'cr') g = cs(cOre + cVaro + (cOre || cVaro ? '' : '<p style="margin:0">Le ore dei motori e il varo compaiono qui quando il cantiere li segna.</p>')) + cs(cStato) + cs(cTag) + cs(d.richieste ? rqCard(id) : '') + x.av;
    else if (cur === 'mo') g = cs(cMot) + cs(cSto) + cs(cTag);
    else if (cur === 'at') g = cs(cAttr) + cs(cComp) + cs(cBatt) + (cAttr || cComp || cBatt ? '' : cs('<p style="margin:0">Il cantiere non ha ancora segnato attrezzatura e componenti.</p>'));
    else if (cur === 'sc') g = cs(scC) + cs(cScL);
    else if (cur === 'de') g = cs(x.depo || '<h5>In deposito al cantiere</h5><p style="margin:4px 0 0">Niente in deposito.</p>');
    else if (cur === 'fo') g = cs(cFoto) + cs(cVb) + cs(cVa);
    else g = cs(oreCard(id, d), 'cso') + cs(x.lav);
    return h + '<div class="cg">' + g + '</div>';
  }
  function renderCliente() {
    if (!CLIENTE || !ME) return;
    var h = '<h2>Ciao ' + esc(String(ME.nome || '').split(' ')[0]) + '</h2><p>La tua barca al cantiere Nautica Mare, sempre aggiornata.</p>';
    if (!CL.ids.length) h += '<div class="card"><p style="margin:0">Il cantiere sta collegando la tua barca al tuo account. Appena fatto, la trovi qui.</p></div>';
    // computer e tablet: una scheda per barca in alto e sotto i riquadri; sul telefono le barche restano una sotto l'altra
    var tab = CL.ids.indexOf(CL.tab) >= 0 ? CL.tab : CL.ids[0];
    if (CL.ids.length > 1) h += '<div class="btabs" role="tablist">' + CL.ids.map(function (id) {
      var d = CL.docs[id] || {}, st = d.stato || '', sub = [st, d.porto ? 'posto ' + d.porto.posto : ''].filter(Boolean).join(' · ');
      return '<button role="tab" data-cl="tab" data-id="' + esc(id) + '" aria-selected="' + (id === tab) + '">' + esc(d.nome || 'Barca') + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
    CL.ids.forEach(function (id) {
      var d = CL.docs[id], on = id === tab ? ' on' : '';
      var cs = function (x, c) { return x ? '<div class="cs' + (c ? ' ' + c : '') + '">' + x + '</div>' : ''; };
      if (d === undefined) { h += '<div class="card bc' + on + '"><div class="spin" style="margin:10px auto"></div></div>'; return; }
      if (!d) { h += '<div class="card bc' + on + '"><p style="margin:0">Stiamo preparando i dati di questa barca: tra poco li vedi qui.</p></div>'; return; }
      var st = d.stato || 'In rimessaggio', cls = st === 'In acqua' ? 'acqua' : st === 'In lavorazione' ? 'lav' : '';
      var lav = d.lavori || [], open = CL.all[id], show = open ? lav : lav.slice(0, 8);
      var img = function (f) { if (!PH[f]) setTimeout(function () { loadPhoto(f); }, 0); return '<img alt="" data-blob="' + esc(f) + '" src="' + esc(PH[f] || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=') + '">'; };
      var cDepo = (d.deposito || []).length ? '<h5>In deposito al cantiere</h5>' + d.deposito.map(function (x) {
          return '<div class="lv" style="align-items:center"><span style="flex:1">' + esc(x.cosa) + (x.quanti > 1 ? ' ×' + x.quanti : '') + '</span>' +
            ((x.foto || []).length ? '<span class="dfo">' + x.foto.map(img).join('') + '</span>' : '') + '</div>';
        }).join('') : '';
      var cAv = (d.avanzamento || []).map(function (a) {
          var f = a.voci.filter(function (v) { return v.s === 'fatto'; }).length, pc = Math.round(f / a.voci.length * 100);
          return cs('<h5>' + esc(a.fine ? 'Lavori finiti' : 'Lavori in corso') + ': ' + esc(a.titolo) + (a.numero ? ' (n. ' + esc(a.numero) + ')' : '') + '</h5>' +
            '<div class="avb" aria-label="' + pc + '% fatto"><i style="width:' + pc + '%"></i></div><div class="upd" style="margin:4px 0 6px">Fatti ' + f + ' su ' + a.voci.length + ' (' + pc + '%)</div>' +
            a.voci.map(function (v) { return '<div class="lv"><span class="d">' + (v.s === 'fatto' ? '✅' : v.s === 'in_corso' ? '🔧' : '⬜') + '</span><span>' + esc(v.t) + (v.s === 'in_corso' ? ' <small>(in corso)</small>' : '') + '</span></div>'; }).join(''));
        }).join('');
      var cLav = '<h5>Lavori eseguiti</h5>' +
        (lav.length ? show.map(function (l) { return '<div class="lv"><span class="d">' + esc(dataCorta(l.data)) + '</span><span>' + esc(l.titolo) + '</span></div>'; }).join('') +
          (lav.length > 8 ? '<button class="more" data-cl="more" data-id="' + esc(id) + '">' + (open ? 'Mostra meno' : 'Mostra tutti (' + lav.length + ')') + '</button>' : '')
          : '<p style="margin:4px 0 0">Ancora nessun lavoro registrato.</p>');
      var body;
      if (d.cr) body = crBody(id, d, cs, img, { depo: cDepo, av: cAv, lav: cLav });
      else body = '<div class="cg">' + cs(cDepo) + cAv + cs(scCard(id, d)) + cs(d.richieste ? rqCard(id) : '') + cs(oreCard(id, d), 'cso') + cs(cLav) + '</div>';
      h += '<div class="card bc full' + on + '"><div class="bt"><div class="bh"><div><div class="bn">' + esc(d.nome || 'Barca') + '</div><div class="bm">' + esc([d.modello, d.lunghezza ? String(d.lunghezza).replace('.', ',') + ' m' : ''].filter(Boolean).join(' · ')) + '</div></div>' +
        '<span class="st ' + cls + '">' + esc(st) + '</span></div>' +
        doveCl(d) + '</div>' + body +
        (d.aggiornato ? '<div class="upd">Aggiornato il ' + esc(quando(d.aggiornato)) + '</div>' : '') + '</div>';
    });
    h += '<details class="gd"><summary>? Come funziona questa pagina</summary><ul>' +
      '<li>Per ogni tua barca vedi lo stato (in rimessaggio, in lavorazione, in acqua, consegnata) e dove si trova: al cantiere o al suo posto in porto.</li>' +
      (CL.ids.some(function (id) { return CL.docs[id] && CL.docs[id].cr; }) ? '<li>Sotto il nome della barca ci sono le schede: Cruscotto (ore dei motori, giorni al varo, stato della barca e prossimi tagliandi), Motori (ore, storico e tagliandi), Attrezzatura (dotazioni, componenti e batterie), Scadenze, Deposito, Foto e storia e Lavori fatti. Alcune compaiono solo se il cantiere le mostra.</li>' : '') +
      '<li>Sotto ci sono le cose tue che il cantiere tiene in deposito (tender, cuscini, tendalini…), con le foto, e i lavori eseguiti, con la data.</li>' +
      (CL.ids.some(function (id) { return CL.docs[id] && CL.docs[id].ore; }) ? '<li>In «Ore di lavoro» vedi quante ore ha lavorato il cantiere sulla tua barca, divise per tipo di lavoro: tocca un tipo per leggere giorno per giorno cosa è stato fatto, come l’ha scritto chi ci ha lavorato, con il suo nome. Ci sono le giornate già confermate dal dipendente. Sopra scegli l’anno.</li>' : '') +
      '<li>Se il cantiere sta facendo i lavori di un preventivo, vedi quali sono fatti e quali mancano.</li>' +
      '<li>Con «Chiedi al cantiere» puoi chiedere il varo per un giorno o segnalare un problema con le foto: sotto vedi se è stata ricevuta e confermata.</li>' +
      '<li>Se il cantiere li mostra, vedi anche le scadenze della barca (tagliando, antivegetativa, zattera…): con «Richiedi il lavoro» lo chiedi al cantiere senza telefonare.</li>' +
      '<li>La pagina si aggiorna da sola pochi secondi dopo ogni modifica del cantiere.</li>' +
      '<li>Se manca una barca o qualcosa non torna, chiama il cantiere.</li></ul></details>';
    h += '<button class="lnk" data-cl="pw">Cambia password</button><button class="lnk" data-cl="out">Esci</button>';
    var o = $('#nmfb'), y = o ? o.scrollTop : 0;
    o = overlay(h); if (o) { o.classList.add('cli'); o.scrollTop = y; }
  }
  // ore di lavoro: torta per tipo di lavoro (categoria) e, toccando un tipo, le sue mansioni con le ore
  var OCOL = { 'Motore': '#ffb547', 'Elettrico ed elettronica': '#ff7a90', 'Impianti di bordo': '#c08cff', 'Carena e antivegetativa': '#2f8ff0', 'Carrozzeria e lucidatura': '#2ec4a6',
    'Coperta e attrezzatura': '#e8d75a', 'Varo e alaggio': '#6fd3ff', 'Trasferimento': '#ff9a5c', 'Rimessaggio': '#9fe07f', 'Gestione cantiere': '#d48cc8', 'Altro': '#8a8db0' };
  function oreH(n) { return String(Math.round(n * 10) / 10).replace('.', ',') + ' h'; }
  function oreCard(id, d) {
    var all = d.ore; if (!all) return '';
    if (!all.length) return '<h5>Ore di lavoro</h5><p style="margin:4px 0 0">Ancora nessuna ora di lavoro segnata.</p>';
    var anni = []; all.forEach(function (r) { var a = String(r.d).slice(0, 4); if (anni.indexOf(a) < 0) anni.push(a); }); anni.sort().reverse();
    var y = CL.oy[id]; if (y !== 'tutto' && anni.indexOf(y) < 0) y = anni[0];
    var rs = y === 'tutto' ? all : all.filter(function (r) { return String(r.d).slice(0, 4) === y; });
    var g = {}, tot = 0; rs.forEach(function (r) { var c = OCOL[r.c] ? r.c : 'Altro'; (g[c] = g[c] || { c: c, h: 0, r: [] }).h += r.h; g[c].r.push(r); tot += r.h; });
    var cats = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.h - a.h || a.c.localeCompare(b.c, 'it'); });
    var R = 52, C = 2 * Math.PI * R, off = 0, gap = cats.length > 1 ? 2 : 0;
    var arcs = cats.map(function (x) { var l = x.h / tot * C, s = '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + OCOL[x.c] + '" stroke-width="22" stroke-dasharray="' + Math.max(l - gap, 0.5).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"/>'; off += l; return s; }).join('');
    var aperta = CL.oc[id];
    var h = '<h5>Ore di lavoro</h5>' +
      (anni.length > 1 ? '<div class="oy">' + anni.slice(0, 4).map(function (a) { return '<button data-cl="oy" data-id="' + esc(id) + '" data-y="' + a + '" aria-pressed="' + (y === a) + '">' + a + '</button>'; }).join('') +
        '<button data-cl="oy" data-id="' + esc(id) + '" data-y="tutto" aria-pressed="' + (y === 'tutto') + '">Tutto</button></div>' : '') +
      '<div class="odn"><svg width="150" height="150" viewBox="0 0 140 140" role="img" aria-label="' + esc(oreH(tot)) + ' di lavoro"><circle r="' + R + '" cx="70" cy="70" fill="none" stroke="#23245a" stroke-width="22"/>' + arcs +
      '<text x="70" y="68" text-anchor="middle" fill="#fff" font-size="21" font-weight="700">' + esc(oreH(tot)) + '</text><text x="70" y="87" text-anchor="middle" fill="#9a9dc0" font-size="12">' + (y === 'tutto' ? 'in tutto' : 'nel ' + y) + '</text></svg></div>' +
      cats.map(function (x) {
        var op = aperta === x.c;
        return '<button class="oc" data-cl="oc" data-id="' + esc(id) + '" data-c="' + esc(x.c) + '" aria-expanded="' + op + '"><small>' + (op ? '▾' : '▸') + '</small><i style="background:' + OCOL[x.c] + '"></i><span>' + esc(x.c) + '</span><b>' + esc(oreH(x.h)) + '</b></button>' +
          (op ? '<div class="ors" style="border-color:' + OCOL[x.c] + '">' + x.r.map(function (r) { return '<div class="lv"><span class="d">' + esc(dataCorta(r.d)) + '</span><span>' + esc(r.t) + (r.n ? '<small class="on">' + esc(r.n) + '</small>' : '') + '</span><span class="oh">' + esc(oreH(r.h)) + '</span></div>'; }).join('') + '</div>' : '');
      }).join('') +
      '<div class="otot"><span>' + (y === 'tutto' ? 'Totale' : 'Totale ' + y) + '</span><span>' + esc(oreH(tot)) + '</span></div>' +
      '<div class="upd" style="margin-top:4px">Tocca un tipo di lavoro per vedere giorno per giorno cosa è stato fatto.</div>';
    return h;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#nmfb [data-cl]'); if (!t) return;
    var k = t.getAttribute('data-cl');
    if (k === 'out') logout();
    else if (k === 'pw') auth.sendPasswordResetEmail(ME.email).then(function () { toast('Ti ho mandato l’email per cambiare la password.'); }, function (er) { toast(authErr(er)); });
    else if (k === 'tab') { CL.tab = t.getAttribute('data-id'); renderCliente(); var b0 = $('#nmfb .btabs'); if (b0) b0.scrollIntoView({ block: 'nearest' }); }
    else if (k === 'st') { CL.st[t.getAttribute('data-id')] = t.getAttribute('data-t'); renderCliente(); }
    else if (k === 'more') { var id = t.getAttribute('data-id'); CL.all[id] = !CL.all[id]; renderCliente(); }
    else if (k === 'oy') { CL.oy[t.getAttribute('data-id')] = t.getAttribute('data-y'); CL.oc[t.getAttribute('data-id')] = null; renderCliente(); }
    else if (k === 'oc') { var oi = t.getAttribute('data-id'), oc = t.getAttribute('data-c'); CL.oc[oi] = CL.oc[oi] === oc ? null : oc; renderCliente(); }
    else if (k === 'rq') rqForm(t.getAttribute('data-id'), t.getAttribute('data-t'));
    else if (k === 'rqs') rqScad(t.getAttribute('data-id'), t.getAttribute('data-s'), t);
  });

  document.addEventListener('click', function (e) { var im = e.target.closest && e.target.closest('#nmfb .dfo img'); if (im) im.classList.toggle('big'); });
  // Il cantiere prepara per ogni barca collegata a un cliente un riepilogo (ore e nomi dei dipendenti solo con «Ore di lavoro al cliente» acceso)
  var PT_T = null;
  function schedulePortale() { if (!started || !ME || ME.ruolo === 'cliente') return; clearTimeout(PT_T); PT_T = setTimeout(syncPortale, 4000); }
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(function (k) { return x[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + stable(x[k]); }).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  function linkedBoats() {
    var s = {}; Object.keys(UT).forEach(function (id) { var u = UT[id]; if (u.ruolo === 'cliente' && u.stato === 'attivo') (u.barche || []).forEach(function (b) { s[b] = 1; }); });
    return Object.keys(s);
  }
  function portaleOf(bid) {
    var b = (LIVE.barche ? LIVE.barche.map : {})[bid]; if (!b) return null;
    var L = LIVE.lavori ? LIVE.lavori.map : {}, P = LIVE.posti ? LIVE.posti.map : {};
    var ore = orePortale(bid); // con le ore accese le mansioni della scheda lavoro stanno lì, con le loro ore, e non si ripetono nei lavori eseguiti
    var lav = Object.keys(L).map(function (k) { return L[k]; }).filter(function (l) { return (l.barcaId === bid || (l.altreBarche || []).indexOf(bid) >= 0) && l.stato === 'fatto' && !l.annullata && !(ore && l.fonte === 'scheda'); })
      .sort(function (a, c) { return String(c.data || '').localeCompare(String(a.data || '')) || String(c.creato || '').localeCompare(String(a.creato || '')); })
      .slice(0, 100).map(function (l) { return { data: l.data || '', titolo: l.titolo || 'Lavoro' }; });
    var pid = Object.keys(P).filter(function (k) { return P[k].barcaId === bid && k.indexOf('-') < 0; })[0], p = pid ? P[pid] : null;
    return { nome: b.nome || '', modello: b.modello || '', lunghezza: b.lunghezza || null, stato: b.stato || '', posto: b.posto || '',
      dove: ['msv', 'nm', 'porto', 'terzi'].indexOf(b.dove) >= 0 ? b.dove : '', doveNome: b.doveNome || '', doveLuogo: b.doveLuogo || '',
      porto: p ? { posto: pid, contratto: p.contratto || '', fino: p.fino || '' } : null, lavori: lav, ore: ore, deposito: depoPortale(bid), avanzamento: avPortale(bid), richieste: strOnFb('richieste'), scadenze: scadPortale(bid), cr: crPortale(bid) };
  }
  // cruscotto della scheda barca (6/11/2026): lo prepara il gestionale (index.html, __sbPortale) con i dati già caricati;
  // le scadenze solo con «Scadenze ricordate al cliente» acceso, il deposito solo con «Roba del cliente in deposito»
  function crPortale(bid) {
    var f = window.__sbPortale; if (typeof f !== 'function') return null;
    try { var c = f(bid); if (!c) return null; c.scadOn = strOnFb('scadcliente'); if (!c.scadOn) c.scad = []; c.deOn = strOnFb('deposito'); return c; } catch (e) { return null; }
  }
  // ore di lavoro al cliente (Strumenti in più › orecliente, spento di base): le mansioni della scheda lavoro
  // con il testo come l'ha scritto il dipendente, la categoria, le ore e il nome di chi l'ha fatta.
  // Solo le giornate già confermate dal dipendente (conferme/{utente}_{giorno}); contano solo sulla barca
  // principale della mansione (le «altre barche coinvolte» non ricevono le ore).
  function orePortale(bid) {
    if (!strOnFb('orecliente')) return null;
    var L = LIVE.lavori ? LIVE.lavori.map : {}, CF = LIVE.conferme ? LIVE.conferme.map : {};
    var conf = function (l) { var c = CF[l.utente + '_' + String(l.data).slice(0, 10)]; return !!(c && !c._del); };
    var h = function (l) { var n = parseFloat(String(l.oreLavoro == null ? '' : l.oreLavoro).replace(',', '.')); return isFinite(n) ? n : 0; };
    return Object.keys(L).map(function (k) { return L[k]; }).filter(function (l) { return l.fonte === 'scheda' && l.barcaId === bid && !l.annullata && !l.daSegnare && !l._del && /^\d{4}-\d{2}-\d{2}/.test(l.data || '') && h(l) > 0 && l.utente && conf(l); })
      .sort(function (a, c) { return String(c.data).localeCompare(String(a.data)) || String(c.creato || '').localeCompare(String(a.creato || '')); })
      .slice(0, 800).map(function (l) { return { d: String(l.data).slice(0, 10), t: String(l.titolo || 'Lavoro').slice(0, 300), c: l.categoria || 'Altro', h: Math.round(h(l) * 100) / 100, n: String((UT[l.utente] || {}).nome || '').slice(0, 60) }; });
  }
  // scadenze ricordate al cliente (idea X63, Strumenti in più › scadcliente): solo tipo, modello e data,
  // quelle scadute da meno di 90 giorni e quelle dei prossimi 60
  function scadPortale(bid) {
    if (!strOnFb('scadcliente')) return [];
    var SC = LIVE.scadenze ? LIVE.scadenze.map : {}, oggi = nowISO().slice(0, 10), da = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), a = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    return Object.keys(SC).map(function (k) { return Object.assign({ id: k }, SC[k]); }).filter(function (s) { return s.barcaId === bid && !s.fatta && !s._del && s.data && s.data >= da && s.data <= a; })
      .sort(function (x, y) { return String(x.data).localeCompare(String(y.data)); }).slice(0, 12)
      .map(function (s) { return { id: s.id, tipo: s.tipo || 'Scadenza', modello: s.modello || '', data: s.data, scaduta: s.data < oggi }; });
  }
  function strOnFb(k) { var I = LIVE.impostazioni ? LIVE.impostazioni.map : {}, st = I.strumenti; return !!(st && !st._del && st[k] === true); }
  // avanzamento dei lavori dei preventivi accettati (idea P5, Strumenti in più › avanzamento): solo titoli e fatto/non fatto
  function avPortale(bid) {
    var I = LIVE.impostazioni ? LIVE.impostazioni.map : {}, st = I.strumenti;
    if (!st || st._del || st.avanzamento !== true) return [];
    var PV = LIVE.preventivi ? LIVE.preventivi.map : {}, L = LIVE.lavori ? LIVE.lavori.map : {}, lim = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    return Object.keys(PV).map(function (k) { return PV[k]; }).filter(function (p) { return p.barcaId === bid && p.stato === 'accettato' && (p.lavIds || []).length; })
      .map(function (p) {
        var vs = p.lavIds.map(function (id) { return L[id]; }).filter(function (l) { return l && !l.annullata; });
        var ultimo = vs.reduce(function (m, l) { return l.stato === 'fatto' && (l.data || '') > m ? l.data : m; }, '');
        return { titolo: p.titolo || 'Lavori', numero: p.numero || '', voci: vs.map(function (l) { return { t: l.titolo || 'Lavoro', s: l.stato === 'fatto' ? 'fatto' : l.stato === 'in_corso' ? 'in_corso' : 'da_fare' }; }), fine: vs.every(function (l) { return l.stato === 'fatto'; }) ? ultimo : '' };
      })
      .filter(function (a) { return a.voci.length && (!a.fine || a.fine >= lim); }).slice(0, 10);
  }
  // roba del cliente in deposito: cosa, quanti e foto (dove è riposta e le note restano al cantiere)
  function depoPortale(bid) {
    var I = LIVE.impostazioni ? LIVE.impostazioni.map : {}, st = I.strumenti;
    if (!st || st._del || st.deposito !== true) return []; // Altro › Strumenti in più: spento di base
    var D = LIVE.deposito ? LIVE.deposito.map : {};
    return Object.keys(D).map(function (k) { return D[k]; }).filter(function (x) { return x.barcaId === bid && x.stato !== 'restituito'; })
      .sort(function (a, c) { return String(a.cosa || '').localeCompare(String(c.cosa || ''), 'it'); })
      .slice(0, 40).map(function (x) { return { cosa: x.cosa || '', quanti: x.quanti || null, foto: (x.foto || []).slice(0, 4) }; });
  }
  function fotoDi(s) {
    var o = []; (s && s.deposito || []).forEach(function (x) { (x.foto || []).forEach(function (f) { o.push(f); }); });
    var c = s && s.cr; if (c) { (c.foto || []).forEach(function (f) { o.push(f); }); (c.verbali || []).forEach(function (v) { (v.foto || []).forEach(function (f) { o.push(f); }); }); }
    return o;
  }
  async function syncPortale() {
    var ids = linkedBoats(); if (!ids.length) return;
    var need = ['barche', 'lavori', 'posti', 'deposito', 'impostazioni', 'portale', 'preventivi', 'scadenze', 'conferme', 'componenti', 'attrezzatura', 'vari'];
    for (var i = 0; i < need.length; i++) { var L = live(need[i]); await L.start; await whenReady(L, 15000); }
    var cur = LIVE.portale.map;
    ids.forEach(function (bid) {
      var s = portaleOf(bid); if (!s) return;
      var c = cur[bid] ? Object.assign({}, cur[bid]) : null; if (c) delete c.aggiornato;
      if (c && stable(c) === stable(s)) return;
      s.aggiornato = nowISO();
      write('portale', bid, 'set', s).catch(function () { });
      // le foto del portale le può aprire il cliente di questa barca (regole: foto.portale tra le sue barche)
      var prima = fotoDi(c);
      fotoDi(s).forEach(function (f) { if (prima.indexOf(f) < 0) fs.collection('foto').doc(f).update({ portale: bid }).catch(function () { }); });
    });
  }

  /* ---------- dati portati dall'app di Claude: link con la chiave, una volta sola ----------
     Il pacchetto sul sito è cifrato (AES-GCM): senza la chiave, che sta solo nel link, non si legge.
     Aggiunge solo ciò che nel sito non c'è e non c'è mai stato; quello che c'è non viene toccato. */
  var IMP_FILE = 'dati-claude.enc', IMP_ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  var IMP_NOMI = { barche: ['barca', 'barche'], lavori: ['lavorazione o mansione', 'lavorazioni e mansioni'], scadenze: ['scadenza', 'scadenze'], vari: ['varo o alaggio', 'vari e alaggi'],
    magazzino: ['voce di magazzino', 'voci di magazzino'], movimenti: ['carico o scarico', 'carichi e scarichi'], operazioni: ['servizio di cantiere', 'servizi di cantiere'],
    opModelli: ['gruppo dei servizi', 'gruppi dei servizi'], mezzi: ['mezzo o carrello', 'mezzi e carrelli'], conferme: ['giornata confermata', 'giornate confermate'],
    dipendenti: ['nome dei dipendenti', 'nomi dei dipendenti'], impostazioni: ['misure della mappa', 'misure della mappa'], posti: ['posto al porto', 'posti al porto'],
    attrezzatura: ['attrezzatura di bordo', 'attrezzature di bordo'], deposito: ['cosa in deposito', 'cose in deposito'], componenti: ['componente a bordo', 'componenti a bordo'], barattoli: ['barattolo aperto', 'barattoli aperti'], programma: ['voce del programma', 'voci del programma'], cariche: ['carica delle batterie', 'cariche delle batterie'],
    richieste: ['richiesta', 'richieste'], checklist: ['checklist', 'checklist'], checkBarca: ['lista per barca', 'liste per barca'], modelli: ['modello di checklist', 'modelli di checklist'],
    giri: ['giro di controllo', 'giri di controllo'], cronometri: ['cronometro', 'cronometri'], ditte: ['ditta esterna', 'ditte esterne'] };
  var IMP_KEY = null, IMP = null;
  function impHash() {
    var m = /[#&]importa=([A-Za-z0-9_-]{40,})/.exec(location.hash || '');
    try {
      if (m) { IMP_KEY = m[1]; sessionStorage.setItem('nm-importa', IMP_KEY); history.replaceState(null, '', location.pathname + location.search); }
      else IMP_KEY = IMP_KEY || sessionStorage.getItem('nm-importa');
    } catch (e) { if (m) IMP_KEY = m[1]; }
    return !!m;
  }
  impHash();
  // link aperto con l'app già aperta nella stessa scheda
  window.addEventListener('hashchange', function () { if (impHash() && started && ME && !CLIENTE) offerImport(); });
  function impForget() { IMP_KEY = null; try { sessionStorage.removeItem('nm-importa'); } catch (e) { } }
  function b64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function impLoad() {
    var r; try { r = await fetch(IMP_FILE, { cache: 'no-store' }); } catch (e) { throw { code: 'rete' }; }
    if (r.status === 404) throw { code: 'manca' };
    if (!r.ok) throw { code: 'rete' };
    var buf = new Uint8Array(await r.arrayBuffer()), plain;
    try {
      var key = await crypto.subtle.importKey('raw', b64u(IMP_KEY), { name: 'AES-GCM' }, false, ['decrypt']);
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
    } catch (e) { throw { code: 'chiave' }; }
    var data = JSON.parse(new TextDecoder().decode(plain));
    if (!data || data.app !== 'Nautica Mare' || !data.collezioni) throw { code: 'chiave' };
    return data;
  }
  async function impMissing(data) {
    var list = [];
    COLLS.forEach(function (name) {
      var src = data.collezioni[name]; if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (id) {
        var d = src[id];
        if (IMP_ID.test(id) && d && typeof d === 'object' && !Array.isArray(d) && !(name === 'impostazioni' && id !== 'mappa')) list.push({ c: name, id: id });
      });
    });
    var out = [];
    for (var i = 0; i < list.length; i += 10) {
      var part = await Promise.all(list.slice(i, i + 10).map(function (x) {
        return fs.collection(x.c).doc(x.id).get({ source: 'server' }).then(function (d) { return d.exists ? null : x; });
      }));
      part.forEach(function (x) { if (x) out.push(x); });
    }
    return out;
  }
  function impCount(list) {
    var n = {}; list.forEach(function (x) { n[x.c] = (n[x.c] || 0) + 1; });
    return COLLS.filter(function (c) { return n[c]; }).map(function (c) { var w = IMP_NOMI[c] || [c, c]; return n[c] + ' ' + (n[c] === 1 ? w[0] : w[1]); });
  }
  function impScreen(html) {
    var o = overlay('<h2>Dati dall’app di Claude</h2>' + html);
    if (o) o.onclick = function (e) {
      var t = e.target.closest && e.target.closest('[data-imp]'); if (!t) return;
      var k = t.getAttribute('data-imp');
      if (k === 'chiudi') { hideOverlay(); }
      else if (k === 'fine') { impForget(); hideOverlay(); }
      else if (k === 'riprova') offerImport();
      else if (k === 'via') runImport();
    };
    return o;
  }
  async function offerImport() {
    if (!IMP_KEY || !ME) return;
    if (ME.ruolo !== 'admin') { toast('Solo un amministratore può importare i dati dall’app di Claude.'); return; }
    impScreen('<div class="spin"></div><p style="text-align:center">Apro i dati…</p>');
    try {
      var data = await impLoad();
      var fatto = await fs.collection('impostazioni').doc('importClaude').get({ source: 'server' });
      var list = await impMissing(data);
      IMP = { data: data, list: list };
      var qd = data.creata ? quando(data.creata) : '';
      if (!list.length) {
        impScreen('<div class="card"><p style="margin:0">' + (fatto.exists ? 'L’importazione è già stata fatta: ' : '') + 'nel sito c’è già tutto quello che c’era nell’app di Claude.</p></div>' +
          '<button class="btn" data-imp="fine">Apri l’app</button>');
        return;
      }
      var io = data.io && data.io.id && data.io.id !== ME.uid && !UT[data.io.id] ? data.io : null;
      impScreen('<p>Copia presa dall’app di Claude' + (qd ? (/^(8|11) /.test(qd) ? ' l’' : ' il ') + esc(qd) : '') + '. Nel sito mancano:</p>' +
        '<div class="card">' + impCount(list).map(function (s) { return '<div class="kv" style="border-top:0;padding:4px 0"><b style="text-align:left">' + esc(s) + '</b></div>'; }).join('') + '</div>' +
        '<p style="margin-top:14px">Quello che c’è già nel sito non viene toccato.' + (io ? ' Le mansioni, le ore e le giornate di <b>' + esc(io.nome || 'chi usava l’app') + '</b> passano al tuo account.' : '') + '</p>' +
        '<button class="btn" data-imp="via">Importa</button><button class="lnk" data-imp="chiudi">Non ora</button>');
    } catch (e) {
      var c = e && e.code;
      if (c === 'manca') { impForget(); impScreen('<div class="card"><p style="margin:0">Il pacchetto con i dati non è più sul sito: l’importazione è già stata fatta.</p></div><button class="btn" data-imp="fine">Apri l’app</button>'); }
      else if (c === 'chiave') { impForget(); impScreen('<div class="card"><p style="margin:0">Il link non è completo, quindi i dati non si aprono. Riapri il link intero.</p></div><button class="btn" data-imp="fine">Apri l’app</button>'); }
      else impScreen('<div class="card"><p style="margin:0">Serve internet per importare i dati. Riprova quando hai campo.</p></div><button class="btn" data-imp="riprova">Riprova</button><button class="lnk" data-imp="chiudi">Non ora</button>');
    }
  }
  async function runImport() {
    if (!IMP) return;
    var data = IMP.data, list = IMP.list, done = 0, fail = 0;
    var prog = function (t) { var p = $('#nm-imp-p'); if (p) p.textContent = t; };
    impScreen('<div class="spin"></div><p style="text-align:center" id="nm-imp-p">Importo…</p>');
    for (var i = 0; i < list.length; i += 8) {
      await Promise.all(list.slice(i, i + 8).map(function (x) {
        return write(x.c, x.id, 'set', data.collezioni[x.c][x.id]).then(function () { done++; }, function () { fail++; });
      }));
      prog('Importo ' + (done + fail) + ' di ' + list.length + '…');
    }
    var linked = 0, io = data.io && data.io.id && data.io.id !== ME.uid && !UT[data.io.id] ? data.io : null;
    if (io && !fail) { prog('Collego i dati al tuo account…'); try { linked = await relink(io.id, ME.uid); } catch (e) { fail++; } }
    if (!fail) { try { await write('impostazioni', 'importClaude', 'set', { il: nowISO(), da: ME.uid, voci: done, collegati: linked, copia: data.creata || '' }); } catch (e) { } }
    IMP = null;
    impScreen(fail
      ? '<div class="card"><p style="margin:0">Importate ' + done + ' voci, ' + fail + ' non riuscite. Riapri il link per riprovare: rimette solo quelle che mancano.</p></div><button class="btn" data-imp="chiudi">Apri l’app</button>'
      : '<div class="card"><p style="margin:0" class="ok"><b>Fatto!</b></p><p style="margin:6px 0 0">Ho importato ' + done + (done === 1 ? ' voce' : ' voci') + ' dall’app di Claude' + (io ? ' e le ho collegate al tuo account' : '') + '.</p></div>' +
        '<button class="btn" data-imp="fine">Apri l’app</button>');
  }


  /* ---------- attività: chi entra e cosa fa ----------
     Ognuno scrive le proprie azioni in «attivita»; le leggono solo gli amministratori (firestore.rules).
     Gli avvisi arrivano solo all'account scritto in config.js (NM_AVVISI_A), mentre ha l'app aperta;
     quando la riapre vede chi è entrato mentre non c'era. Si tiene 60 giorni. */
  var ATT = { entrato: false, vista: '', last: {}, uns: null, voci: {} }, ATT_DAYS = 60;
  function attIo() { var a = window.NM_AVVISI_A; return !!(ME && ME.ruolo === 'admin' && a && String(ME.email || '').toLowerCase() === String(a).trim().toLowerCase()); }
  function attDisp() { return /iPhone|iPad|Android|Mobi/i.test(navigator.userAgent) ? 'telefono' : 'computer'; }
  function attScrivi(cosa) {
    if (!ME || !ME.uid || attIo()) return;
    var k = cosa, t = Date.now();
    if (ATT.last[k] && t - ATT.last[k] < 60000) return; // la stessa cosa ripetuta subito (salvataggi di fila) conta una volta
    ATT.last[k] = t;
    fs.collection('attivita').add({ uid: ME.uid, nome: (ME.nome || ME.email || '') + (AS ? ' come ' + ((UT[AS] && UT[AS].nome) || '?') : ''), cosa: String(cosa).slice(0, 200), il: nowISO(), disp: attDisp(), _ts: FV.serverTimestamp() }).catch(function () { });
  }
  function attEntra() { if (ATT.entrato || !ME) return; ATT.entrato = true; attScrittura.ok = true; attScrivi(CLIENTE ? 'è entrato nell’area clienti' : 'è entrato nell’app'); }
  function attVista(n) { if (!started || !n || n === ATT.vista) return; ATT.vista = n; attScrivi('apre ' + n); }
  function attScrittura(name, verbo, d) {
    if (!attScrittura.ok || name === 'dipendenti' || name === 'portale') return;
    d = d || {};
    var nome = d.nome || d.titolo || d.descrizione || d.testo || d.cliente || '';
    attScrivi(verbo + ' ' + (CEST_NOMI[name] || name).toLowerCase() + (nome ? ' «' + String(nome).slice(0, 60) + '»' : ''));
  }
  function attOra(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function attSoloOra(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
  function attAscolta() {
    if (!attIo() || ATT.uns) return;
    var KEY = 'nm-att-visto-' + ME.uid, visto = null;
    try { visto = localStorage.getItem(KEY); } catch (e) { }
    var cut = new Date(Date.now() - ATT_DAYS * 864e5).toISOString();
    if (!visto || visto < cut) visto = new Date(Date.now() - 864e5).toISOString(); // la prima volta: le ultime 24 ore
    setTimeout(function () { fs.collection('attivita').where('il', '<', cut).limit(300).get().then(function (s) { if (!s.size) return; var b = fs.batch(); s.docs.forEach(function (d) { b.delete(d.ref); }); return b.commit(); }).catch(function () { }); }, 8000);
    var primo = true;
    if (window.Notification && Notification.permission === 'default') try { Notification.requestPermission(); } catch (e) { }
    ATT.uns = fs.collection('attivita').where('il', '>', visto).orderBy('il').onSnapshot(function (s) {
      var nuove = [];
      s.docChanges().forEach(function (c) { if (c.type === 'added') { var x = c.doc.data(); if (x.uid !== ME.uid) nuove.push(x); } });
      if (nuove.length) { try { localStorage.setItem(KEY, nuove[nuove.length - 1].il); } catch (e) { } }
      if (primo) { primo = false; if (nuove.length) attRiepilogo(nuove); return; }
      nuove.forEach(attAvvisa);
    }, function () { ATT.uns = null; });
  }
  // avviso in diretta: uno per persona, con le sue ultime azioni
  function attAvvisa(x) {
    var v = ATT.voci[x.uid] = (ATT.voci[x.uid] || []).concat(attSoloOra(x.il) + ' ' + x.cosa).slice(-4);
    var tit = x.nome + (x.disp ? ' · ' + x.disp : ''), body = v.slice().reverse().join('\n');
    ensureCss();
    var box = $('#nmatt'); if (!box) { box = document.createElement('div'); box.id = 'nmatt'; document.body.appendChild(box); }
    var el = box.querySelector('[data-u="' + x.uid + '"]');
    if (!el) { el = document.createElement('div'); el.className = 'it'; el.setAttribute('data-u', x.uid);  box.appendChild(el); }
    el.innerHTML = '<button type="button" class="x" aria-label="Chiudi">×</button><b>' + esc(tit) + '</b><span>' + esc(attSoloOra(x.il) + ' · ' + x.cosa) + '</span>';
    el.querySelector('.x').onclick = function () { clearTimeout(el._t); el.remove(); };
    clearTimeout(el._t); el._t = setTimeout(function () { el.remove(); }, 60000); // resta un minuto
    if (document.hidden && window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.getRegistration().then(function (r) {
        if (r) r.showNotification(tit, { body: body, tag: 'nm-att-' + x.uid, renotify: true, icon: './icon-192.png', badge: './icon-192.png', data: { url: './' } });
        else new Notification(tit, { body: body, tag: 'nm-att-' + x.uid });
      }).catch(function () { });
    }
  }
  // all'apertura: chi è entrato mentre non c'eri, una riga per persona
  function attRiepilogo(list) {
    var per = {}, ord = [];
    list.forEach(function (x) { var p = per[x.uid]; if (!p) { p = per[x.uid] = { nome: x.nome, disp: {}, da: x.il, a: x.il, cose: [] }; ord.push(x.uid); } p.a = x.il; p.disp[x.disp] = 1; p.cose.push(attSoloOra(x.il) + ' ' + x.cosa); });
    ord.sort(function (a, b) { return per[b].a < per[a].a ? -1 : 1; });
    var h = '<h3 style="margin:0 0 4px;align-self:flex-start">Mentre non c’eri</h3><p style="margin:0 0 10px;color:#9a9dc0;align-self:flex-start">Chi è entrato nell’app e cosa ha fatto.</p><div id="nmattv">' + ord.map(function (u) {
      var p = per[u], c = p.cose.slice(-12), more = p.cose.length - c.length;
      return '<div class="ar"><b>' + esc(p.nome) + '</b><div>' + esc(attOra(p.da) + (p.da !== p.a ? ' – ' + attSoloOra(p.a) : '') + ' · ' + Object.keys(p.disp).filter(Boolean).join(', ')) + '</div>' +
        '<div>' + (more > 0 ? esc('…e altre ' + more + ' azioni prima') + '<br>' : '') + c.map(esc).join('<br>') + '</div></div>';
    }).join('') + '</div><button class="btn" id="nmattok" style="margin-top:14px">Ho visto</button>';
    var o = overlay(h); if (!o) return;
    $('#nmattok').onclick = hideOverlay;
  }

  /* ---------- errori dell'app: arrivano all'amministratore insieme alle attività ----------
     Se l'app si blocca sul telefono di qualcuno, l'errore finisce in «attivita» (avviso in diretta e «Mentre non c'eri»).
     Solo errori del nostro codice, ognuno una volta per apertura, al massimo 5. */
  var ERR = { visti: {}, n: 0 };
  function errScrivi(e, dove) {
    try {
      if (!ME || !started || ERR.n >= 5) return;
      var msg = String((e && (e.message || e.code)) || e || '').slice(0, 120); if (!msg) return;
      var riga = /(index\.html|nm-fb\.js):(\d+)/.exec(String((e && e.stack) || dove || ''));
      var k = msg + (riga ? riga[0] : ''); if (ERR.visti[k]) return; ERR.visti[k] = true; ERR.n++;
      attScrivi('⚠ errore nell’app' + (ATT.vista ? ' (in ' + ATT.vista + ')' : '') + ': ' + msg + (riga ? ' · ' + riga[1] + ' riga ' + riga[2] : ''));
    } catch (x) { }
  }
  window.addEventListener('error', function (ev) {
    if (!ev || !ev.filename || ev.filename.indexOf(location.origin) !== 0) return; // estensioni del browser e librerie esterne: non nostri
    errScrivi(ev.error || ev.message, ev.filename.split('/').pop() + ':' + ev.lineno);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    if (r instanceof Error && /index\.html|nm-fb\.js/.test(String(r.stack || ''))) errScrivi(r); // i rifiuti di Firebase (rete, permessi) li gestisce già l'app
  });

  /* ---------- modifiche in attesa di rete ----------
     Senza campo le modifiche restano sul telefono e partono da sole: una piccola icona in alto a destra con il numero
     di quelle che mancano. Con il campo compare solo se l'invio dura più di 3 secondi (campo debole). */
  var PEND = { n: 0, vecchie: false, t: null, fatto: 0 };
  var PEND_IC = { // icone: senza rete, da inviare, inviate
    off: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.52"/><path d="M2 8.82a15 15 0 0 1 4.18-2.64"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="m2 2 20 20"/>',
    su: '<path d="M12 13v8"/><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="m8 17 4-4 4 4"/>',
    ok: '<path d="m17 15-5.5 5.5L9 18"/><path d="M5 17.74A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.74"/>'
  };
  function pendIc(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + PEND_IC[k] + '</svg>'; }
  function pendAdd(p) {
    PEND.n++; pendShow();
    var fine = function () { PEND.n = Math.max(0, PEND.n - 1); if (!PEND.n) PEND.fatto = Date.now(); pendShow(); };
    p.then(fine, fine);
  }
  // modifiche rimaste dall'ultima volta (app chiusa senza campo): Firebase le manda appena può
  function pendVecchie() {
    var ok = false;
    try { fs.waitForPendingWrites().then(function () { ok = true; if (PEND.vecchie) { PEND.vecchie = false; PEND.fatto = Date.now(); pendShow(); } }, function () { }); } catch (e) { return; }
    setTimeout(function () { if (!ok) { PEND.vecchie = true; pendShow(); } }, 3000);
  }
  function pendShow() {
    clearTimeout(PEND.t);
    // le modifiche con il campo partono in un attimo: l'icona compare solo se aspettano più di 3 secondi
    PEND.t = setTimeout(pendDraw, PEND.n || PEND.vecchie ? (navigator.onLine === false ? 300 : 3000) : 0);
  }
  function pendDraw() {
    if (!document.body) return;
    var el = $('#nmpend'), off = navigator.onLine === false, n = PEND.n;
    if (!n && !PEND.vecchie) {
      if (el && el.getAttribute('data-s') !== 'ok' && Date.now() - PEND.fatto < 4000) {
        el.setAttribute('data-s', 'ok'); el.innerHTML = pendIc('ok'); el.setAttribute('aria-label', 'Modifiche inviate'); el.title = 'Modifiche inviate';
        setTimeout(function () { var e2 = $('#nmpend'); if (e2 && e2.getAttribute('data-s') === 'ok') e2.remove(); }, 2500);
      } else if (el && el.getAttribute('data-s') !== 'ok') el.remove();
      return;
    }
    ensureCss();
    if (!el) {
      el = document.createElement('button'); el.type = 'button'; el.id = 'nmpend'; document.body.appendChild(el);
      el.onclick = function () {
        var k = el.getAttribute('data-s');
        toast(k === 'ok' ? 'Tutte le modifiche sono state inviate.' : (k === 'off' ? 'Sei senza rete. ' : 'Il campo è debole: le modifiche stanno partendo. ') + 'Restano salvate sul telefono, anche se chiudi l’app, e partono da sole appena torna il campo.');
      };
    }
    var t = (off ? 'Senza rete' : 'Invio in corso') + (n ? ': ' + n + (n === 1 ? ' modifica da inviare' : ' modifiche da inviare') : ': modifiche da inviare');
    el.setAttribute('data-s', off ? 'off' : 'su'); el.setAttribute('aria-label', t); el.title = t;
    el.innerHTML = pendIc(off ? 'off' : 'su') + (n ? '<b>' + n + '</b>' : '');
  }
  window.addEventListener('online', pendShow); window.addEventListener('offline', pendShow);

  /* ---------- segnaposto delle voci cancellate ----------
     Cancellare scrive { _del: true } al posto della voce, così gli altri telefoni lo sanno. Dopo 60 giorni
     tutti l'hanno saputo (chi resta fuori più a lungo rilegge tutto comunque, vedi FULL_EVERY): si toglie del tutto.
     Lo fa l'amministratore, una volta a settimana, senza che si veda. */
  async function pulisciSegnaposto() {
    try {
      var K = 'nm-segnaposto', last = 0; try { last = +localStorage.getItem(K) || 0; } catch (e) { }
      if (Date.now() - last < 7 * 864e5) return;
      var cut = Date.now() - CEST_DAYS * 864e5, tolte = 0;
      for (var i = 0; i < COLLS.length + 1; i++) {
        var c = COLLS[i] || 'foto';
        var s = await fs.collection(c).where('_del', '==', true).limit(400).get();
        var vecchi = s.docs.filter(function (d) { var t = d.get('_ts'); return t && t.toMillis && t.toMillis() < cut; });
        for (var j = 0; j < vecchi.length; j += 400) {
          var b = fs.batch(); vecchi.slice(j, j + 400).forEach(function (d) { b.delete(d.ref); }); await b.commit();
        }
        tolte += vecchi.length;
      }
      try { localStorage.setItem(K, String(Date.now())); } catch (e) { }
      var prima = await fs.collection('impostazioni').doc('pulizia').get();
      await write('impostazioni', 'pulizia', 'set', { il: nowISO(), tolte: tolte, totale: ((prima.exists && prima.get('totale')) || 0) + tolte });
    } catch (e) { }
  }

  /* ---------- spazio e foto (solo amministratori, in «Copia dei dati») ----------
     Le foto stanno nel database (raccolta «foto»): il piano gratuito di Firebase ha 1 GB in tutto.
     «fotoInfo» tiene quanto pesa ogni foto. Le foto di prima si contano una volta scaricandole (giroFoto).
     Una foto è «non più usata» se nessuna voce, nemmeno nel cestino, la nomina più. */
  var FOTO_GB = 1;
  async function fotoInfoAll() { var s = await fs.collection('fotoInfo').get(); var m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); return m; }
  async function fotoSpazio() {
    var info = await fotoInfoAll(), conta = await fs.collection('impostazioni').doc('fotoConta').get(), n = 0, kb = 0;
    Object.keys(info).forEach(function (id) { n++; kb += info[id].kb || 0; });
    var dati = 0; COLLS.forEach(function (c) { var L = LIVE[c]; if (L) dati += JSON.stringify(L.map).length; });
    return { n: n, mb: kb / 1024, datiMb: dati / 1048576, limiteMb: FOTO_GB * 1024, contate: conta.exists ? conta.data() : null };
  }
  // ogni testo scritto nei dati, compreso il cestino: le foto si nominano con il loro codice
  async function testiUsati() {
    var ok = await Promise.all(COLLS.map(function (c) { var L = live(c); return L.start.then(function () { return whenReady(L, 20000); }).then(function () { return L.ready; }); }));
    if (ok.indexOf(false) >= 0) throw { code: 'non_pronto', message: 'Dati non ancora caricati' };
    var set = {}, dove = {};
    function giro(v, etichetta) {
      if (typeof v === 'string') { if (v.length < 40) { set[v] = true; if (etichetta && !dove[v]) dove[v] = etichetta; } }
      else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { giro(v[k], etichetta); });
    }
    function nomeBarca(id) { var b = LIVE.barche.map[id]; return b ? b.nome || 'Barca senza nome' : ''; }
    COLLS.forEach(function (c) {
      Object.keys(LIVE[c].map).forEach(function (id) {
        var d = LIVE[c].map[id];
        giro(d, c === 'barche' ? d.nome || 'Barca senza nome' : d.barcaId ? nomeBarca(d.barcaId) || (CEST_NOMI[c] || c) : (CEST_NOMI[c] || c));
      });
    });
    var cs = await fs.collection('cestino').get();
    cs.docs.forEach(function (d) { giro(dec(d.get('dati') || {}), 'Nel cestino'); });
    return { set: set, dove: dove };
  }
  async function fotoNonUsate() {
    var info = await fotoInfoAll(), u = await testiUsati(), cut = new Date(Date.now() - 2 * 864e5).toISOString(), list = [];
    // le foto degli ultimi 2 giorni restano: potrebbero essere in una scheda non ancora salvata
    Object.keys(info).forEach(function (id) { if (!u.set[id] && String(info[id].creato || '') < cut) list.push({ id: id, kb: info[id].kb || 0 }); });
    return list;
  }
  async function fotoPulisci(list, prog) {
    var fatte = 0;
    for (var i = 0; i < list.length; i += 200) {
      var b = fs.batch();
      list.slice(i, i + 200).forEach(function (x) { b.delete(fs.collection('foto').doc(x.id)); b.delete(fs.collection('fotoInfo').doc(x.id)); IDB.del('foto', x.id); delete PH[x.id]; });
      await b.commit(); fatte = Math.min(list.length, i + 200); if (prog) prog(fatte, list.length);
    }
    return fatte;
  }
  // passa tutte le foto una per volta (a gruppi di 8): scrive quanto pesano e, se serve, le tiene per il file da scaricare
  async function giroFoto(prog, tieni) {
    var info = await fotoInfoAll(), visti = {}, last = null, n = 0, kb = 0, out = [], ID = firebase.firestore.FieldPath.documentId();
    for (;;) {
      var q = fs.collection('foto').orderBy(ID).limit(8); if (last) q = q.startAfter(last);
      var s = await q.get(); if (!s.size) break;
      var b = fs.batch(), nb = 0;
      s.docs.forEach(function (d) {
        var x = d.data();
        if (x._del || !x.data) { b.delete(d.ref); nb++; return; } // segnaposto di foto già tolte
        n++; visti[d.id] = true; var k = Math.ceil(String(x.data).length / 1024); kb += k;
        if (!info[d.id]) { b.set(fs.collection('fotoInfo').doc(d.id), { kb: k, creato: x.creato || '', da: x.da || '', _ts: FV.serverTimestamp() }); nb++; }
        if (tieni) out.push({ id: d.id, data: x.data, creato: x.creato || '' });
      });
      if (nb) await b.commit();
      last = s.docs[s.docs.length - 1];
      if (prog) prog(n, kb / 1024);
    }
    // schede di foto che non ci sono più: via, così il conto torna preciso
    var orfane = Object.keys(info).filter(function (id) { return !visti[id]; });
    for (var i = 0; i < orfane.length; i += 400) { var bo = fs.batch(); orfane.slice(i, i + 400).forEach(function (id) { bo.delete(fs.collection('fotoInfo').doc(id)); }); await bo.commit(); }
    await write('impostazioni', 'fotoConta', 'set', { il: nowISO(), n: n, mb: Math.round(kb / 102.4) / 10 });
    return out;
  }
  // il file zip, senza comprimere (le foto sono già compresse): a parti da 150 MB per non riempire la memoria del telefono
  var CRC_T = null;
  function crc32(u) {
    if (!CRC_T) { CRC_T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var r = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) r = CRC_T[(r ^ u[i]) & 255] ^ (r >>> 8); return (r ^ 0xFFFFFFFF) >>> 0;
  }
  function dosOra(iso) { var d = new Date(iso); if (isNaN(d) || d.getFullYear() < 1980) d = new Date(); return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()]; }
  function zip(files) { // files: [{ nome, dati: Uint8Array, il }]
    var parti = [], dir = [], off = 0, te = new TextEncoder();
    files.forEach(function (f) {
      var nm = te.encode(f.nome), crc = crc32(f.dati), t = dosOra(f.il), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, t[0], true); h.setUint16(12, t[1], true); h.setUint32(14, crc, true);
      h.setUint32(18, f.dati.length, true); h.setUint32(22, f.dati.length, true); h.setUint16(26, nm.length, true);
      parti.push(h.buffer, nm, f.dati);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, t[0], true); c.setUint16(14, t[1], true); c.setUint32(16, crc, true);
      c.setUint32(20, f.dati.length, true); c.setUint32(24, f.dati.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      dir.push(c.buffer, nm); off += 30 + nm.length + f.dati.length;
    });
    var dl = dir.reduce(function (a, x) { return a + x.byteLength; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, dl, true); e.setUint32(16, off, true);
    return new Blob(parti.concat(dir, [e.buffer]), { type: 'application/zip' });
  }
  async function fotoFile(prog) {
    var u = await testiUsati(), foto = await giroFoto(prog, true), MAX = 150 * 1048576, parti = [], cur = [], tot = 0, usati = {};
    function chiudi() { if (cur.length) { parti.push({ blob: zip(cur), n: cur.length }); cur = []; tot = 0; } }
    foto.forEach(function (f) {
      var b64 = String(f.data).replace(/^data:[^,]*,/, ''), bin = atob(b64), dati = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) dati[i] = bin.charCodeAt(i);
      var cart = String(u.dove[f.id] || 'Senza barca').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Senza nome';
      var base = cart + '/' + (String(f.creato).slice(0, 10) || 'senza-data') + '_' + f.id, nome = base + '.jpg';
      for (var k = 2; usati[nome]; k++) nome = base + '-' + k + '.jpg'; usati[nome] = true;
      if (tot + dati.length > MAX) chiudi();
      cur.push({ nome: nome, dati: dati, il: f.creato }); tot += dati.length; f.data = null;
    });
    chiudi();
    return parti.map(function (p, i) { return { blob: p.blob, n: p.n, mb: p.blob.size / 1048576, nome: 'Foto-Nautica-Mare-' + nowISO().slice(0, 10) + (parti.length > 1 ? '-parte-' + (i + 1) : '') + '.zip' }; });
  }
  var FOTO = {
    spazio: function () { return ME && ME.ruolo === 'admin' ? fotoSpazio() : Promise.reject({ code: 'permission_denied' }); },
    conta: function (prog) { return ME && ME.ruolo === 'admin' ? giroFoto(prog, false).then(function () { }) : Promise.reject({ code: 'permission_denied' }); },
    nonUsate: function () { return ME && ME.ruolo === 'admin' ? fotoNonUsate() : Promise.reject({ code: 'permission_denied' }); },
    pulisci: function (list, prog) { return ME && ME.ruolo === 'admin' ? fotoPulisci(list, prog) : Promise.reject({ code: 'permission_denied' }); },
    file: function (prog) { return ME && ME.ruolo === 'admin' ? fotoFile(prog) : Promise.reject({ code: 'permission_denied' }); },
    salva: function (p) { return DL.save({ filename: p.nome, data: p.blob }); },
    pulizia: function () { var L = live('impostazioni'); return L.map.pulizia || null; }
  };

  /* ---------- quello che vede l'app ---------- */
  window.__NM_FB = {
    use: function (name) {
      return READY.then(function () { return name === 'db' ? DB : name === 'user' ? USER : name === 'assets' ? ASSETS : name === 'downloads' ? DL : null; });
    },
    photoSrc: function (id) { if (PH[id]) return PH[id]; if (started) loadPhoto(id); else READY.then(function () { loadPhoto(id); }); return GIF0; },
    altroRows: altroRows,
    appCheckToken: appCheckToken,
    open: open,
    vista: attVista,
    clientiBarca: clientiBarca,
    spostaClienti: spostaClienti,
    staccaClienti: staccaClienti,
    nomeUtente: nomeUtente,
    foto: FOTO,
    tablet: {
      si: function () { return !!(ME && ME.tablet && ME.stato === 'attivo' && ME.ruolo !== 'cliente') && tabStr(); },
      come: function (uid) { AS = uid || null; attScrivi(uid ? 'sul tablet lavora ' + ((UT[uid] && UT[uid].nome) || '') : 'sul tablet: ha finito'); },
      chi: chi,
      prova: function (uid, pin) { var x = pinDi(uid); return x ? pinHash(uid, pin).then(function (h) { return h === x.hash; }) : Promise.resolve(false); },
      persone: function () { var L = LIVE.pin, m = (L && L.map) || {}; return Object.keys(m).filter(function (id) { return pinDi(id) && UT[id] && UT[id].stato === 'attivo' && UT[id].ruolo !== 'cliente' && !UT[id].tablet; }).map(function (id) { return { id: id, nome: UT[id].nome || '' }; }); }
    }
  };
})();
