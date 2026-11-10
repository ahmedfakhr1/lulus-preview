/* Keeps the menu usable with weak or no signal.
   Pages: try the network first (up to 4 s), fall back to the copy saved on the phone.
   Files with a ?v= code never change, so they come straight from the phone once saved.
   Photos, fonts and the menu pages' art: shown from the phone at once, refreshed in the background. */
var CACHE = 'lulus-1';
var BASE = self.registration.scope;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(['', 'menu', 'm'].map(function (p) {
      var url = BASE + p;
      return fetch(url).then(function (r) {
        if (!r.ok) return;
        return r.clone().text().then(function (html) {
          var refs = [], re = /(?:src|href)="([^"#]+\.(?:js|css|webmanifest|woff2|svg|png|webp)(?:\?v=[^"]*)?)"/g, m;
          while ((m = re.exec(html))) refs.push(new URL(m[1], url).href);
          return c.put(url, r).then(function () {
            return Promise.all(refs.filter(function (u) { return u.indexOf(BASE) === 0; }).map(function (u) { return c.add(u).catch(function () {}); }));
          });
        });
      }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromNetwork(req, c) {
  return fetch(req).then(function (r) { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.url.indexOf(BASE) !== 0) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(function (c) {
      var net = fromNetwork(req, c);
      var slow = new Promise(function (res) { setTimeout(res, 4000); }).then(function () { return c.match(req, { ignoreSearch: true }); });
      return Promise.race([net.catch(function () { return null; }), slow]).then(function (r) {
        return r || c.match(req, { ignoreSearch: true }).then(function (m) { return m || net; });
      });
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit && /[?&]v=/.test(req.url)) return hit;
      var net = fromNetwork(req, c).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
