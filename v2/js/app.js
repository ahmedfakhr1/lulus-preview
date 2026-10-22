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

  /* ---- gallery lightbox: a photo full on the page, the rest of the season's gallery a swipe away ----
     It opens from the photo's own place on the page and closes back into it; swipe, arrows or the keys move along,
     a swipe down or a tap on the dark ground closes. Only transform and opacity move; reduced motion fades. */
  var room = document.getElementById('room');
  if (room && document.createElement('dialog').showModal) {
    var ICON = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>'; };
    var lb = document.createElement('dialog');
    lb.className = 'lb';
    lb.setAttribute('aria-label', 'Photo gallery');
    lb.innerHTML = '<div class="lb-bg"></div><div class="lb-stage"></div><p class="lb-n" aria-live="polite"></p>' +
      '<button class="x lb-x" type="button" aria-label="Close">' + ICON('M18 6l-12 12M6 6l12 12') + '</button>' +
      '<button class="lb-nav lb-prev" type="button" aria-label="Previous photo">' + ICON('M15 6l-6 6l6 6') + '</button>' +
      '<button class="lb-nav lb-next" type="button" aria-label="Next photo">' + ICON('M9 6l6 6l-6 6') + '</button>';
    document.body.appendChild(lb);
    var lbBg = lb.querySelector('.lb-bg'), lbStage = lb.querySelector('.lb-stage'), lbN = lb.querySelector('.lb-n');
    var lbPrev = lb.querySelector('.lb-prev'), lbNext = lb.querySelector('.lb-next');
    var shots = [], at = 0, cur = null, closing = false, d0 = null;
    var EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
    var calm = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || !lb.animate; };
    var collect = function () {
      shots = [];
      Array.prototype.forEach.call(room.querySelectorAll('.fr'), function (f) {
        var im = f.querySelector('img');
        if (im && f.getClientRects().length) shots.push({ box: f.querySelector('.fr-in'), src: im.currentSrc || im.src, alt: im.alt });
      });
    };
    var make = function (i) {
      var im = document.createElement('img');
      im.className = 'lb-img'; im.alt = shots[i].alt; im.draggable = false; im.src = shots[i].src;
      lbStage.appendChild(im);
      return im;
    };
    var whenReady = function (im, fn) {
      if (im.complete && im.naturalWidth) fn();
      else { im.addEventListener('load', fn, { once: true }); im.addEventListener('error', fn, { once: true }); }
    };
    var label = function () {
      lbN.textContent = (at + 1) + ' / ' + shots.length;
      lbPrev.disabled = !shots[at - 1]; lbNext.disabled = !shots[at + 1];
      [at - 1, at + 1].forEach(function (k) { if (shots[k]) { var p = new Image(); p.src = shots[k].src; } });
    };
    /* the transform that lays the full photo exactly over its thumbnail */
    var toThumb = function (im, box) {
      var t = box.getBoundingClientRect(), f = im.getBoundingClientRect();
      if (!f.width || t.bottom < 0 || t.top > window.innerHeight) return null;
      im.style.transformOrigin = '0 0';
      return 'translate(' + (t.left - f.left) + 'px,' + (t.top - f.top) + 'px) scale(' + (t.width / f.width) + ',' + (t.height / f.height) + ')';
    };
    var openAt = function (i) {
      collect();
      if (!shots[i]) return;
      at = i; closing = false;
      document.documentElement.classList.add('lb-open');
      lb.showModal();
      cur = make(at); label();
      lb.classList.add('on');
      var im = cur;
      whenReady(im, function () {
        if (calm()) { if (lb.animate) im.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 }); return; }
        var from = toThumb(im, shots[at].box);
        if (from) im.animate([{ transform: from }, { transform: 'none' }], { duration: 460, easing: EASE });
        else im.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
      });
    };
    var go = function (d, dragX) {
      var n = at + d;
      if (!shots[n] || closing) return;
      at = n;
      var old = cur; cur = make(at); label();
      if (calm()) { if (old) old.remove(); return; }
      var dist = Math.min(80, window.innerWidth * 0.12);
      cur.animate([{ opacity: 0, transform: 'translateX(' + (d * dist) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
      if (old) {
        var a = old.animate([{ opacity: 1, transform: 'translateX(' + (dragX || 0) + 'px)' }, { opacity: 0, transform: 'translateX(' + (-d * dist) + 'px)' }], { duration: 300, easing: EASE, fill: 'forwards' });
        a.onfinish = function () { old.remove(); };
      }
    };
    var close = function () {
      if (closing || !lb.open) return;
      closing = true;
      lbBg.style.opacity = '';
      lb.classList.remove('on');
      var done = function () { try { lb.close(); } catch (e) {} };
      if (calm() || !cur) { setTimeout(done, 120); return; }
      cur.style.transform = '';
      var back = toThumb(cur, shots[at].box);
      var a = back ? cur.animate([{ transform: 'none' }, { transform: back }], { duration: 400, easing: EASE, fill: 'forwards' })
                   : cur.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      a.onfinish = done;
    };
    lb.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    lb.addEventListener('close', function () {
      var box = shots[at] && shots[at].box;
      lbStage.innerHTML = ''; cur = null; closing = false; d0 = null;
      lb.classList.remove('on'); lbBg.style.opacity = '';
      document.documentElement.classList.remove('lb-open');
      if (box) box.focus({ preventScroll: true });
    });
    lb.querySelector('.lb-x').addEventListener('click', close);
    lbPrev.addEventListener('click', function () { go(-1); });
    lbNext.addEventListener('click', function () { go(1); });
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });

    /* a finger or the mouse moves the photo: sideways to turn to the next, down to put it away */
    lbStage.addEventListener('pointerdown', function (e) {
      if (e.button || !cur) return;
      d0 = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, dy: 0, mode: '' };
    });
    lbStage.addEventListener('pointermove', function (e) {
      if (!d0 || e.pointerId !== d0.id || !cur) return;
      d0.dx = e.clientX - d0.x; d0.dy = e.clientY - d0.y;
      if (!d0.mode) {
        if (Math.abs(d0.dx) < 8 && Math.abs(d0.dy) < 8) return;
        d0.mode = Math.abs(d0.dx) > Math.abs(d0.dy) ? 'x' : 'y';
        try { lbStage.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (d0.mode === 'x') {
        var edge = (d0.dx > 0 && !shots[at - 1]) || (d0.dx < 0 && !shots[at + 1]);
        cur.style.transform = 'translateX(' + (d0.dx * (edge ? 0.25 : 1)).toFixed(1) + 'px)';
      } else {
        cur.style.transform = 'translateY(' + d0.dy.toFixed(1) + 'px)';
        lbBg.style.opacity = Math.max(0.15, 1 - Math.abs(d0.dy) / 420).toFixed(2);
      }
    });
    var release = function (e) {
      if (!d0 || e.pointerId !== d0.id) return;
      var s = d0; d0 = null;
      if (!s.mode) { if (e.target === lbStage) close(); return; }
      var v = s.dx / Math.max(1, e.timeStamp - s.t);
      var held = cur.style.transform;
      cur.style.transform = '';
      if (s.mode === 'x') {
        var d = (s.dx < -50 || v < -0.5) ? 1 : (s.dx > 50 || v > 0.5) ? -1 : 0;
        if (d && shots[at + d]) { go(d, s.dx); return; }
        cur.animate([{ transform: held || 'none' }, { transform: 'none' }], { duration: 320, easing: EASE });
      } else if (Math.abs(s.dy) > 110) {
        close();
      } else {
        lbBg.style.opacity = '';
        cur.animate([{ transform: held || 'none' }, { transform: 'none' }], { duration: 320, easing: EASE });
      }
    };
    lbStage.addEventListener('pointerup', release);
    lbStage.addEventListener('pointercancel', release);

    /* every photo on show is a button: Enter or Space opens it like a tap */
    Array.prototype.forEach.call(room.querySelectorAll('.fr'), function (f) {
      var im = f.querySelector('img'), box = f.querySelector('.fr-in');
      if (!im || !box) return;
      var open = function () {
        /* let go of the press at once, so the photo grows from where the frame really is */
        box.classList.remove('press'); box.classList.add('rel');
        collect();
        for (var i = 0; i < shots.length; i++) if (shots[i].box === box) { openAt(i); break; }
        requestAnimationFrame(function () { box.classList.remove('rel'); });
        if (navigator.vibrate) { try { navigator.vibrate(6); } catch (e) {} }
      };
      /* a finger resting on a photo makes it give a little, as a button does; a scroll lifts it again */
      var held = 0, px = 0, py = 0;
      var lift = function () { clearTimeout(held); box.classList.remove('press'); };
      box.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button) return;
        px = e.clientX; py = e.clientY;
        clearTimeout(held);
        held = setTimeout(function () { box.classList.add('press'); }, 60);
      });
      box.addEventListener('pointermove', function (e) {
        if (Math.abs(e.clientX - px) > 10 || Math.abs(e.clientY - py) > 10) lift();
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { box.addEventListener(t, lift); });
      box.setAttribute('role', 'button'); box.tabIndex = 0; box.setAttribute('aria-haspopup', 'dialog');
      box.setAttribute('aria-label', 'Open photo: ' + im.alt);
      box.addEventListener('click', open);
      box.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
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
