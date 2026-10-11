/* Fa partire l'app anche senza campo e la rende installabile.
   Le pagine del sito: prima la rete (così gli aggiornamenti arrivano subito), se manca il campo la copia salvata.
   Librerie esterne (Firebase, mappa 3D, caratteri): la copia salvata, aggiornata in background.
   I dati non passano di qui: li gestisce Firebase. */
var V = 'nm-v1';
var CORE = ['./', './index.html', './nm-fb.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
var LIBS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|cdnjs\.cloudflare\.com\/|cdn\.jsdelivr\.net\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (u.origin === self.location.origin) {
    e.respondWith(fetch(r).then(function (res) {
      if (res.ok) { var cp = res.clone(); caches.open(V).then(function (c) { c.put(r, cp); }); }
      return res;
    }).catch(function () { return caches.match(r).then(function (m) { return m || caches.match('./index.html'); }); }));
    return;
  }
  if (LIBS.test(r.url)) {
    e.respondWith(caches.open(V).then(function (c) {
      return c.match(r).then(function (m) {
        var net = fetch(r).then(function (res) { if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res; }).catch(function () { return m; });
        return m || net;
      });
    }));
  }
});
