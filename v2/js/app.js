/* Shared behaviour: header bar, reveal, reserve sheet, app links, season preview links. */
(function () {
  'use strict';
  var body = document.body;
  var L = window.LULUS || { today: '', preview: '' };
  var WA = body.getAttribute('data-wa') || '';

  /* ---- header bar: appears once the hero has scrolled away (home only) ---- */
  var bar = document.getElementById('bar');
  var hero = document.getElementById('top');
  if (bar && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      bar.classList.toggle('on', !es[0].isIntersecting || es[0].intersectionRatio < 0.12);
    }, { threshold: [0, 0.12, 0.3] }).observe(hero);
  } else if (bar) {
    bar.classList.add('on');
  }

  /* ---- every photo is fetched and decoded up front, so nothing appears bit by bit while scrolling.
     On the first visit a short veil (the logo and a hairline that fills) covers the page until the photos
     are ready, for at most 2.5 s (that cap lives in <head>, so a slow script cannot hold it); a tap or any key lifts it at once. */
  var docEl = document.documentElement;
  var veil = document.getElementById('veil');
  /* only the photos on screen for this season: other seasons' frames are hidden and stay unfetched */
  var photos = Array.prototype.slice.call(document.querySelectorAll('main img, .foot img')).filter(function (img) { return img.getClientRects().length > 0; });
  function ready(img) {
    var loaded = img.complete && img.naturalWidth ? Promise.resolve() : new Promise(function (res) {
      img.addEventListener('load', res, { once: true });
      img.addEventListener('error', res, { once: true });
    });
    return loaded.then(function () { return img.decode ? img.decode().catch(function () {}) : null; });
  }
  var allReady = Promise.all(photos.map(ready));
  if (veil && docEl.classList.contains('veiled')) {
    var bar2 = document.getElementById('veil-bar');
    var done = 0, lifted = false;
    photos.forEach(function (img) {
      ready(img).then(function () { done += 1; if (bar2) bar2.style.transform = 'scaleX(' + (done / photos.length).toFixed(3) + ')'; });
    });
    var lift = function () {
      if (lifted) return;
      lifted = true;
      if (!docEl.classList.contains('veiled')) return;  // the 2.5 s cap in <head> already lifted it
      try { localStorage.setItem('lulus-veil', '1'); } catch (e) {}
      veil.classList.add('out');
      docEl.classList.remove('veiled');
      setTimeout(function () { veil.classList.remove('out'); }, 900);
      document.removeEventListener('keydown', lift);
    };
    allReady.then(function () { setTimeout(lift, 260); });
    setTimeout(lift, 2500);
    veil.addEventListener('click', lift);
    document.addEventListener('keydown', lift);
  }

  /* ---- reveal on scroll ---- */
  var rv = document.querySelectorAll('.rv');
  if (rv.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          // a frame with two photos keeps being watched: its slow cross-fade runs only while it is on screen
          if (e.target.classList.contains('duo')) { e.target.classList.toggle('live', e.isIntersecting); if (e.isIntersecting) e.target.classList.add('in'); return; }
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      rv.forEach(function (el) { io.observe(el); });
    } else {
      rv.forEach(function (el) { el.classList.add('in'); });
    }
  }

  /* ---- app store links: send each phone to its own store ---- */
  var ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua);
  document.querySelectorAll('[data-app]').forEach(function (a) {
    var u = isAndroid ? body.getAttribute('data-play') : body.getAttribute('data-appstore');
    if (u) a.setAttribute('href', u);
  });

  /* ---- keep a previewed season when moving between pages ---- */
  if (L.preview) {
    document.querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href');
      if (!/^(index\.html|menu\.html)/.test(h)) return;
      var parts = h.split('#');
      var base = parts[0];
      if (base.indexOf('season=') === -1) base += (base.indexOf('?') === -1 ? '?' : '&') + 'season=' + encodeURIComponent(L.preview);
      a.setAttribute('href', base + (parts.length > 1 ? '#' + parts[1] : ''));
    });
  }

  /* ---- reserve sheet ---- */
  var dlg = document.getElementById('reserve');
  var form = document.getElementById('reserve-form');
  if (dlg && form && typeof dlg.showModal === 'function') {
    var fName = form.elements.name, fDate = form.elements.date, fTime = form.elements.time;
    var out = document.getElementById('r-guests');
    var guests = 2;
    if (L.today) fDate.min = L.today;

    var showErr = function (input, on) {
      var e = document.getElementById(input.id + '-e');
      input.setAttribute('aria-invalid', on ? 'true' : 'false');
      if (e) e.hidden = !on;
    };
    var check = function (input) {
      var ok = input.value.trim() !== '';
      if (ok && input === fDate && L.today && input.value < L.today) ok = false;
      showErr(input, !ok);
      return ok;
    };
    [fName, fDate, fTime].forEach(function (i) {
      i.addEventListener('blur', function () { check(i); });
      i.addEventListener('input', function () { if (i.getAttribute('aria-invalid') === 'true') check(i); });
    });

    /* the date picker follows the browser's language (mm/dd on US English); show the choice day first as well */
    var dayFirst = document.getElementById('r-date-d');
    var showDay = function () {
      var v = fDate.value;
      dayFirst.textContent = v ? new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(v + 'T00:00:00Z')) : '';
    };
    fDate.addEventListener('input', showDay);
    fDate.addEventListener('change', showDay);

    var open = function () { if (!dlg.open) dlg.showModal(); };
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('[data-reserve]') : null;
      if (a) { e.preventDefault(); open(); }
    });
    if (location.hash === '#reserve') open();
    dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

    /* on a phone the sheet follows a downward swipe and closes past a short distance, like a system sheet */
    var y0 = null, dy = 0;
    dlg.addEventListener('touchstart', function (e) {
      if (window.innerWidth >= 900 || dlg.scrollTop > 0 || e.touches.length !== 1 || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0; dlg.style.transition = 'none';
    }, { passive: true });
    dlg.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      dlg.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
    }, { passive: true });
    dlg.addEventListener('touchend', function () {
      if (y0 === null) return;
      y0 = null;
      dlg.style.transition = 'transform 0.25s ease-out';
      if (dy > 90) { dlg.style.transform = 'translateY(100%)'; setTimeout(function () { dlg.close(); dlg.style.transform = ''; dlg.style.transition = ''; }, 230); }
      else dlg.style.transform = '';
    });

    form.querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        guests = Math.max(1, Math.min(20, guests + parseInt(b.getAttribute('data-step'), 10)));
        out.textContent = guests;
      });
    });

    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var fmtDate = function (v) {
      var p = v.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    };
    var fmtTime = function (v) {
      var p = v.split(':'); var h = +p[0]; var m = p[1];
      return ((h % 12) || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = [check(fName), check(fDate), check(fTime)].every(Boolean);
      if (!ok) { var bad = form.querySelector('[aria-invalid="true"]'); if (bad) bad.focus(); return; }
      var msg = 'Hello LÜLU’S, I’d like to reserve a table.\n' +
        'Name: ' + fName.value.trim() + '\n' +
        'Date: ' + fmtDate(fDate.value) + '\n' +
        'Time: ' + fmtTime(fTime.value) + '\n' +
        'Guests: ' + guests;
      var url = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);
      var w = window.open(url, '_blank');
      if (w) { try { w.opener = null; } catch (err) {} } else { location.href = url; }
      dlg.close();
    });
  }
})();
