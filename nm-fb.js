/* Nautica Mare · versione sul sito proprio
   I dati stanno su Firebase (Google) invece che su Claude. Offre all'app la stessa interfaccia
   (db, user, assets, downloads) e aggiunge: accesso con email e password, approvazione dei nuovi
   colleghi, ruoli, foto salvate nel database, sincronizzazione che legge solo ciò che è cambiato. */
(function () {
  'use strict';
  var CFG = window.NM_FIREBASE_CONFIG || null;
  var COLLS = ['barche', 'lavori', 'scadenze', 'dipendenti', 'conferme', 'impostazioni', 'magazzino', 'movimenti', 'vari', 'modelli',
    'checkBarca', 'checklist', 'opModelli', 'operazioni', 'mezzi', 'attrezzatura', 'programma', 'cariche', 'posti', 'richieste'];
  var RUOLI = { base: 'Dipendente', editor: 'Può cancellare', admin: 'Amministratore' };
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
    '#nmfb .box{width:100%;max-width:400px}#nmfb .logo{display:block;width:78%;max-width:300px;margin:22px auto 26px}' +
    '#nmfb h2{font-size:1.35rem;margin:0 0 6px}#nmfb p{color:#b9bccb;margin:0 0 14px}#nmfb label{display:block;font-size:.9rem;color:#b9bccb;margin:12px 0 6px}' +
    '#nmfb input{width:100%;box-sizing:border-box;font:inherit;font-size:17px;padding:13px 14px;border-radius:12px;border:1px solid #33355a;background:#12114a;color:#fff;outline:none}' +
    '#nmfb input:focus{border-color:#2f8ff0}#nmfb .btn{display:block;width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:#2f8ff0;color:#fff;font:inherit;font-weight:600;font-size:17px;cursor:pointer}' +
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
    '#nmtoast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 90px);transform:translateX(-50%);z-index:100000;background:#2b2c33;color:#fff;padding:10px 16px;border-radius:12px;font:15px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.4)}';
  function ensureCss() { if (!$('#nmfb-css')) { var st = document.createElement('style'); st.id = 'nmfb-css'; st.textContent = CSS; document.head.appendChild(st); } }
  function logoSrc() { var l = document.getElementById('logo-src'); return l ? l.getAttribute('src') : ''; }
  function overlay(html) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { overlay(html); }, { once: true }); return null; }
    ensureCss();
    var o = $('#nmfb'); if (!o) { o = document.createElement('div'); o.id = 'nmfb'; document.body.appendChild(o); }
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
  var auth = firebase.auth(); auth.languageCode = 'it';
  var fs = firebase.firestore();
  try { fs.settings({ cacheSizeBytes: 100 * 1024 * 1024, ignoreUndefinedProperties: true, merge: true }); } catch (e) { }
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () { }); } catch (e) { }
  var FV = firebase.firestore.FieldValue, TS = firebase.firestore.Timestamp;

  var READY_RES, READY = new Promise(function (r) { READY_RES = r; });
  var ME = null, UT = {}, UT_UNSUB = null, ME_UNSUB = null, registering = false, started = false;

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
    if (!fullDue) q = q.where('_ts', '>=', TS.fromMillis(L.ts - 5000));
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
  function emit(L) { var s = snapOf(L); L.subs.slice().forEach(function (x) { try { x.next(s); } catch (e) { console.error(e); } }); }
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
  function write(name, id, kind, data) {
    var L = live(name), r = fs.collection(name).doc(id), ts = FV.serverTimestamp(), p;
    L.pend = L.pend || {};
    if (kind === 'set') {
      var x = enc(clone(data) || {}); x._ts = ts; p = r.set(x); L.map[id] = clone(data); L.pend[id] = 'set';
    } else if (kind === 'update') {
      if (L.ready && !L.map[id]) return Promise.reject({ code: 'not_found', message: 'Elemento non trovato' });
      var u = {}, d = data || {};
      Object.keys(d).forEach(function (k) { var v = d[k]; u[k] = (v && v.__delete__) ? FV.delete() : enc(clone(v)); });
      u._ts = ts; p = r.update(u);
      var m = Object.assign({}, L.map[id] || {});
      Object.keys(d).forEach(function (k) { if (d[k] && d[k].__delete__) delete m[k]; else m[k] = clone(d[k]); });
      L.map[id] = m; L.pend[id] = 'set';
    } else {
      p = r.set({ _del: true, _ts: ts }); delete L.map[id]; L.pend[id] = 'del';
    }
    p.then(function () { if (L.pend) delete L.pend[id]; }, function () { if (L.pend) delete L.pend[id]; });
    emit(L); save(L);
    return settle(p, L);
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
    me: function () { return Promise.resolve({ id: ME.uid, name: ME.nome || '', isOwner: ME.ruolo === 'admin' }); },
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
        await settle(fs.collection('foto').doc(id).set({ data: url, creato: nowISO(), da: ME ? ME.uid : '', _ts: FV.serverTimestamp() }));
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
  function showLogin(msg) {
    var o = overlay('<h2>Accedi</h2><p>Entra con l’email e la password del tuo account del cantiere.</p>' +
      '<form id="nm-login"><label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="nm-pw">Password</label><input id="nm-pw" type="password" autocomplete="current-password" required>' +
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
    var o = overlay('<h2>Crea il tuo account</h2><p>Dopo la registrazione un amministratore deve approvarti. Il primo che si registra diventa amministratore.</p>' +
      '<form id="nm-reg"><label for="nm-nm">Nome (come ti vedranno i colleghi)</label><input id="nm-nm" type="text" autocomplete="given-name" required maxlength="40">' +
      '<label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="nm-pw">Password (almeno 6 caratteri)</label><input id="nm-pw" type="password" autocomplete="new-password" required minlength="6">' +
      '<button class="btn" type="submit">Crea account</button><div class="err" id="nm-err"></div></form><button class="lnk" id="nm-gologin">Ho già un account: accedi</button>');
    var f = $('#nm-reg', o);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); busy(f, true); $('#nm-err').textContent = '';
      var nome = $('#nm-nm').value.trim(), email = $('#nm-em').value.trim(), pw = $('#nm-pw').value;
      registering = true;
      auth.createUserWithEmailAndPassword(email, pw).then(function (cr) {
        return createProfile(cr.user, nome, email);
      }).then(function () { registering = false; watchMe(auth.currentUser); }, function (er) { registering = false; busy(f, false); $('#nm-err').textContent = authErr(er); });
    });
    $('#nm-gologin', o).onclick = function () { showLogin(); };
  }
  function createProfile(u, nome, email) {
    var cfg = fs.collection('config').doc('inizializzato'), me = fs.collection('utenti').doc(u.uid);
    return cfg.get({ source: 'server' }).then(function (c) {
      var base = { nome: nome, email: email, creato: nowISO(), modificato: nowISO() };
      if (c.exists) return me.set(Object.assign(base, { stato: 'in_attesa', ruolo: 'base' }));
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
      if (x.stato === 'attivo') {
        var was = ME; ME = x;
        if (!started) { started = true; hideOverlay(); READY_RES(); afterStart(); }
        else if (was && was.ruolo !== x.ruolo) location.reload();
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
      var m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); UT = m; if ($('#nmpan')) renderPanel();
    }, function () { });
    // il nome nella scheda lavoro
    var D = live('dipendenti');
    D.start.then(function () { return whenReady(D, 15000); }).then(function () {
      if (ME && !D.map[ME.uid]) write('dipendenti', ME.uid, 'set', { nome: ME.nome || '', modificato: nowISO() }).catch(function () { });
    });
  }

  /* ---------- pannelli: utenti e permessi, il mio account ---------- */
  var PAN = null;
  function altroRows() {
    if (!ME) return [];
    var rows = [];
    if (ME.ruolo === 'admin') {
      var n = Object.keys(UT).filter(function (id) { return UT[id].stato === 'in_attesa'; }).length;
      rows.push(['utenti', 'users', n ? 'soon' : '', 'Utenti e permessi', 'Approva i colleghi e decidi chi può cancellare', n ? '<span class="pill soon">' + n + (n === 1 ? ' in attesa' : ' in attesa') + '</span>' : '']);
    }
    rows.push(['account', 'out', '', 'Il mio account', (ME.email || '') + ' · ' + (RUOLI[ME.ruolo] || ''), '']);
    return rows;
  }
  function open(k) { PAN = k; renderPanel(); }
  function closePanel() { PAN = null; var p = $('#nmpan'); if (p) p.remove(); }
  function oldPeople() {
    var D = LIVE.dipendenti ? LIVE.dipendenti.map : {};
    return Object.keys(D).filter(function (id) { return !UT[id]; }).map(function (id) { return { id: id, nome: D[id].nome || id }; });
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
        '<p class="note">«Cambia password» ti manda un’email con il link. Uscendo, da questo telefono vengono tolti i dati salvati per lavorare senza campo.</p>';
    } else if (PAN === 'utenti' && ME.ruolo === 'admin') {
      var ids = Object.keys(UT), by = function (st) { return ids.filter(function (id) { return (UT[id].stato || '') === st; }).sort(function (a, b) { return String(UT[a].nome || '').localeCompare(String(UT[b].nome || ''), 'it'); }); };
      var olds = oldPeople();
      var row = function (id) {
        var u = UT[id], self = id === ME.uid, a = '';
        if (u.stato === 'in_attesa') a = '<button class="b pri" data-nm="ok" data-id="' + id + '">Approva</button><button class="b red" data-nm="no" data-id="' + id + '">Rifiuta</button>';
        else if (u.stato === 'attivo') a = self ? '<span class="note" style="margin:0">Sei tu</span>' :
          '<select data-nm="ruolo" data-id="' + id + '">' + Object.keys(RUOLI).map(function (r) { return '<option value="' + r + '"' + (u.ruolo === r ? ' selected' : '') + '>' + RUOLI[r] + '</option>'; }).join('') + '</select>' +
          '<button class="b red" data-nm="block" data-id="' + id + '">Sospendi</button>';
        else a = '<button class="b" data-nm="ok" data-id="' + id + '">Riattiva</button>';
        if (olds.length && u.stato !== 'bloccato') a += '<select data-nm="link" data-id="' + id + '"><option value="">Collega ai dati vecchi…</option>' + olds.map(function (o) { return '<option value="' + esc(o.id) + '">È ' + esc(o.nome) + '</option>'; }).join('') + '</select>';
        return '<div class="u"><div class="nm">' + esc(u.nome || '(senza nome)') + (u.stato === 'attivo' ? '<span class="pill">' + esc(RUOLI[u.ruolo] || u.ruolo) + '</span>' : '') + '</div><div class="em">' + esc(u.email || '') + '</div><div class="acts">' + a + '</div></div>';
      };
      var sec = function (t, list) { return list.length ? '<h4>' + t + ' (' + list.length + ')</h4><div class="grp">' + list.map(row).join('') + '</div>' : ''; };
      h = '<div class="top"><button class="back" data-nm="close">‹ Indietro</button><h3>Utenti e permessi</h3><span style="min-width:64px"></span></div>' +
        sec('In attesa di approvazione', by('in_attesa')) + sec('Attivi', by('attivo')) + sec('Sospesi', by('bloccato')) +
        '<p class="note"><b>Dipendente</b>: usa tutta l’app, ma non cancella dal programma. <b>Può cancellare</b>: anche le cancellazioni riservate. <b>Amministratore</b>: in più approva i colleghi e cambia i permessi.</p>' +
        (olds.length ? '<p class="note"><b>Collega ai dati vecchi</b>: dopo aver ripristinato la copia presa da Claude, scegli chi era quella persona. Mansioni, ore e giornate confermate passano al nuovo account.</p>' : '') +
        '<p class="note">Per far entrare un collega mandagli il link dell’app: si registra da solo e compare qui sopra, in attesa.</p>';
    } else { closePanel(); return; }
    p.innerHTML = h;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#nmpan [data-nm]'); if (!t || t.tagName === 'SELECT') return;
    var k = t.getAttribute('data-nm'), id = t.getAttribute('data-id');
    if (k === 'close') closePanel();
    else if (k === 'out') logout();
    else if (k === 'pw') auth.sendPasswordResetEmail(ME.email).then(function () { toast('Ti ho mandato l’email per cambiare la password.'); }, function (er) { toast(authErr(er)); });
    else if (k === 'ok') setUser(id, { stato: 'attivo' }).then(function () { toast('Fatto: ' + (UT[id] && UT[id].nome || '') + ' può entrare.'); });
    else if (k === 'no') { if (confirm('Rifiutare la richiesta di ' + (UT[id] && UT[id].nome || '') + '?')) setUser(id, { stato: 'bloccato' }); }
    else if (k === 'block') { if (confirm('Sospendere ' + (UT[id] && UT[id].nome || '') + '? Non potrà più entrare finché non lo riattivi.')) setUser(id, { stato: 'bloccato' }); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.closest || !t.closest('#nmpan') || !t.getAttribute('data-nm')) return;
    var k = t.getAttribute('data-nm'), id = t.getAttribute('data-id');
    if (k === 'ruolo') setUser(id, { ruolo: t.value }).then(function () { toast('Permessi aggiornati.'); });
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

  /* ---------- quello che vede l'app ---------- */
  window.__NM_FB = {
    use: function (name) {
      return READY.then(function () { return name === 'db' ? DB : name === 'user' ? USER : name === 'assets' ? ASSETS : name === 'downloads' ? DL : null; });
    },
    photoSrc: function (id) { if (PH[id]) return PH[id]; if (started) loadPhoto(id); else READY.then(function () { loadPhoto(id); }); return GIF0; },
    altroRows: altroRows,
    open: open
  };
})();
