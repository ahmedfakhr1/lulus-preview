/* Counts what visitors do, without cookies and without anything that names a person: one small message per
   page view and per tap on Reserve, Call, Directions, WhatsApp, Instagram, the app links, the Morning/Evening
   switch and the page zoom. Sent to /api/hit on the site itself (src/worker.js), which adds the phone type,
   country and city. Only on the live site. */
(function () {
  if (!/^https:$/.test(location.protocol) || /localhost|127\.0\.0\.1|github\.io$/.test(location.hostname)) { window.LULUS_TRACK = function () {}; return; }
  var path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  var kind = path === '/m' ? 'qr' : path === '/menu' ? 'menu' : path === '/' ? 'home' : 'other';
  var ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
  if (ref === location.hostname) ref = '';
  function send(e, d) {
    var doc = document.documentElement;
    var body = JSON.stringify({ e: e, d: d || '', p: kind, mood: doc.getAttribute('data-mood') || '', season: doc.getAttribute('data-season') || '', ref: ref });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/hit', new Blob([body], { type: 'text/plain' }))) return;
      fetch('/api/hit', { method: 'POST', body: body, keepalive: true }).catch(function () {});
    } catch (err) {}
  }
  window.LULUS_TRACK = send;
  send('view');
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('[data-cfg],[data-track]');
    if (a) send(a.getAttribute('data-track') || a.getAttribute('data-cfg'), kind);
  }, true);
})();
