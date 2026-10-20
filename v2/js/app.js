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

  /* ---- reveal on scroll ---- */
  var rv = document.querySelectorAll('.rv');
  if (rv.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
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

    var open = function () { if (!dlg.open) dlg.showModal(); };
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('[data-reserve]') : null;
      if (a) { e.preventDefault(); open(); }
    });
    if (location.hash === '#reserve') open();
    dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

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
