(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMenu = !!document.getElementById('mp-morning');
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  /* mood: morning / evening */
  var moodBtns = $$('.mood button');
  function syncMenu(m) {
    $$('[role=tab][data-menu]').forEach(function (t) {
      var on = t.getAttribute('data-menu') === m;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    var pm = $('#mp-morning'), pe = $('#mp-evening');
    if (pm) pm.hidden = m !== 'morning';
    if (pe) pe.hidden = m !== 'evening';
    try { history.replaceState(null, '', m === 'evening' ? '#evening' : location.pathname + location.search); } catch (x) {}
  }
  function syncUI(m) {
    moodBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-set') === m ? 'true' : 'false'); });
    var t = $('meta[name=theme-color]');
    if (t) t.setAttribute('content', m === 'evening' ? '#21150a' : '#f3f1ed');
    if (isMenu) syncMenu(m);
    var track = $('#track');
    if (track) { track.scrollLeft = 0; updateArrows(); }
  }
  function applyMood(m) { root.setAttribute('data-mood', m); syncUI(m); }
  function setMood(m, origin) {
    if (root.getAttribute('data-mood') === m) { syncUI(m); return; }
    try { if (!isMenu) sessionStorage.setItem('lulus-mood', m); } catch (x) {}
    if (!document.startViewTransition || reduce) { applyMood(m); return; }
    var r = (origin || document.body).getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!origin) { x = innerWidth / 2; y = innerHeight / 2; }
    var end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('vt');
    var tr = document.startViewTransition(function () { applyMood(m); });
    tr.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + end + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 1000, easing: 'cubic-bezier(.65,0,.2,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(function () {});
    tr.finished.then(function () { root.classList.remove('vt'); }, function () { root.classList.remove('vt'); });
  }
  moodBtns.forEach(function (b) { b.addEventListener('click', function () { setMood(b.getAttribute('data-set'), b); }); });
  $$('[data-swap]').forEach(function (b) {
    b.addEventListener('click', function () { setMood(root.getAttribute('data-mood') === 'evening' ? 'morning' : 'evening', b); });
  });
  $$('[data-menu]').forEach(function (b) {
    b.addEventListener('click', function () {
      setMood(b.getAttribute('data-menu'), b);
      var card = $('.mhero-card'); if (card && b.getAttribute('data-menu') === 'evening' && b.getAttribute('role') !== 'tab') card.scrollIntoView();
    });
  });
  var mtabs = $$('[role=tab][data-menu]');
  mtabs.forEach(function (t, i) {
    t.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        var n = mtabs[(i + (ev.key === 'ArrowRight' ? 1 : mtabs.length - 1)) % mtabs.length];
        n.focus(); n.click(); ev.preventDefault();
      }
    });
  });
  syncUI(root.getAttribute('data-mood'));
  window.addEventListener('hashchange', function () { if (isMenu && location.hash === '#evening') setMood('evening'); });

  /* drawer */
  var burger = $('.burger'), mnav = $('#mnav');
  function drawer(open) {
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mnav.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }
  burger.addEventListener('click', function () { drawer(!mnav.classList.contains('open')); });
  $$('a', mnav).forEach(function (a) { a.addEventListener('click', function () { drawer(false); }); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && mnav.classList.contains('open')) { drawer(false); burger.focus(); } });
  window.addEventListener('resize', function () { if (innerWidth >= 1000 && mnav.classList.contains('open')) drawer(false); });

  /* reveals */
  var rv = $$('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    rv.forEach(function (el) { io.observe(el); });
  } else { rv.forEach(function (el) { el.classList.add('in'); }); }

  /* fall lineup tabs */
  var dtabs = $$('.drink-tabs [role=tab]');
  function pick(k, focus) {
    dtabs.forEach(function (t) {
      var on = t.getAttribute('data-drink') === k;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    $$('.drink-panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + k; });
    $$('.cup').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-cup') === k); });
  }
  dtabs.forEach(function (t, i) {
    t.addEventListener('click', function () { pick(t.getAttribute('data-drink')); });
    t.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        var n = dtabs[(i + (ev.key === 'ArrowRight' ? 1 : dtabs.length - 1)) % dtabs.length];
        pick(n.getAttribute('data-drink'), true); ev.preventDefault();
      }
    });
  });

  /* photo track */
  var track = $('#track');
  var prev = $('.arr[data-dir="-1"]'), next = $('.arr[data-dir="1"]');
  function updateArrows() {
    if (!track || !prev) return;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  }
  if (track) {
    [prev, next].forEach(function (b) {
      b.addEventListener('click', function () {
        track.scrollBy({ left: Number(b.getAttribute('data-dir')) * Math.max(280, track.clientWidth * 0.7), behavior: reduce ? 'auto' : 'smooth' });
      });
    });
    track.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    var down = false, sx = 0, sl = 0, moved = false;
    track.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      down = true; moved = false; sx = ev.clientX; sl = track.scrollLeft;
    });
    window.addEventListener('pointermove', function (ev) {
      if (!down) return;
      var dx = ev.clientX - sx;
      if (Math.abs(dx) > 4) { moved = true; track.classList.add('drag'); }
      if (moved) track.scrollLeft = sl - dx;
    });
    window.addEventListener('pointerup', function () { if (down) { down = false; track.classList.remove('drag'); } });
    updateArrows();
  }

  /* menu: section chips follow scroll */
  var chips = $$('.chip');
  if (chips.length && 'IntersectionObserver' in window) {
    var map = {};
    chips.forEach(function (c) { map[c.getAttribute('href').slice(1)] = c; });
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (en.isIntersecting) {
          chips.forEach(function (c) { c.classList.remove('on'); c.removeAttribute('aria-current'); });
          var c = map[en.target.id];
          if (c) {
            c.classList.add('on'); c.setAttribute('aria-current', 'true');
            var bar = c.parentNode;
            bar.scrollTo({ left: c.offsetLeft - 24, behavior: reduce ? 'auto' : 'smooth' });
          }
        }
      });
    }, { rootMargin: '-30% 0px -62% 0px' });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) so.observe(s); });
  }
})();
