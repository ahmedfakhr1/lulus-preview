/* The menu book.
   Pages are real HTML, paginated from the menu data at the current screen size.
   Phone held upright: one page at a time. Wide screens (900px and up) and short landscape screens
   (a phone on its side): a two-page spread. Morning and Evening restyle the whole page.
   While a page turns only transform and opacity change; nothing is measured per frame. */
(function () {
  'use strict';

  var doc = document.documentElement;
  var root = document.getElementById('book');
  var stage = document.getElementById('stage');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var tocBtn = document.getElementById('toc');
  var countEl = document.getElementById('count');
  var svcBtns = Array.prototype.slice.call(document.querySelectorAll('#bnav [data-svc]'));
  var liveEl = document.getElementById('live');
  var DATA = JSON.parse(document.getElementById('menu-data').textContent);
  var LU = window.LULUS || { season: { id: 'default', name: '' }, today: '' };
  var SEASON = LU.season;
  var LOGO = document.body.getAttribute('data-logo') || 'img/logo.png';
  var FOOT = document.body.getAttribute('data-footnote') || '';
  var WA = document.body.getAttribute('data-wa') || '';
  var RESERVE_URL = 'https://wa.me/' + WA + '?text=' + encodeURIComponent('Hello LÜLU’S, I’d like to reserve a table.');

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function reduced() { return mqReduce.matches; }
  /* a phone on its side: short and wide. The same rule drives the compact styles in book.css. */
  var mqCompact = window.matchMedia ? window.matchMedia('(max-height: 479px) and (orientation: landscape)') : { matches: false };

  /* ------------------------------------------------------------ state */
  var S = {
    service: 'evening', mode: 'single', W: 0, H: 0, fs: 16,
    pages: [], seq: [], pos: 0, secs: [],
    keep: null   /* where the reader was before the screen changed shape, until the next page turn */
  };
  var turn = null, busy = false, raf = 0, ready = false, switching = false;

  /* ------------------------------------------------------------ DOM scaffold */
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-roledescription', 'book');
  stage.setAttribute('aria-label', 'Menu');
  stage.innerHTML =
    '<div class="slot slot-l"><div class="slot-pg"></div><i class="cast"></i></div>' +
    '<div class="slot slot-r"><div class="slot-pg"></div><i class="cast"></i></div>' +
    '<div class="leaf"><div class="face face-f"><i class="sh"></i><i class="cv"></i></div><div class="face face-b"><i class="sh"></i><i class="cv"></i></div></div>';
  var slotL = stage.querySelector('.slot-l'), slotR = stage.querySelector('.slot-r');
  var castL = slotL.querySelector('.cast'), castR = slotR.querySelector('.cast');
  var leaf = stage.querySelector('.leaf');
  var faceF = leaf.querySelector('.face-f'), faceB = leaf.querySelector('.face-b');
  var shF = faceF.querySelector('.sh'), shB = faceB.querySelector('.sh');
  var cvF = faceF.querySelector('.cv'), cvB = faceB.querySelector('.cv');

  var meas = document.createElement('div');
  meas.className = 'measure';
  meas.innerHTML = '<div class="pg"><div class="pg-in"><div class="blocks"></div></div></div>';
  root.appendChild(meas);
  var mIn = meas.querySelector('.pg-in');
  var mBlocks = meas.querySelector('.blocks');

  /* ------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) { return Number(n).toLocaleString('en-US'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function cairoHour() {
    try {
      return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(new Date()), 10) % 24;
    } catch (e) { return new Date().getHours(); }
  }
  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }
  /* Evening from 17:00 to 04:59 in Cairo, Morning from 05:00 to 16:59; a choice made in this visit is kept.
     season.js (in the head) has already decided this, so the first paint has the right colours. */
  function defaultService() {
    var saved = store('lulus-svc');
    if (saved === 'morning' || saved === 'evening') return saved;
    if (LU.service === 'morning' || LU.service === 'evening') return LU.service;
    var h = cairoHour();
    return h >= 5 && h < 17 ? 'morning' : 'evening';
  }

  /* ------------------------------------------------------------ data -> sections */
  function sectionsFor(service) {
    var out = [];
    DATA.sections.forEach(function (sec) {
      var items = [];
      sec.items.forEach(function (it) {
        if (it.service !== 'both' && it.service !== service) return;
        if (it.season && it.season !== SEASON.id) return;
        items.push(it);
      });
      if (items.length) out.push({ id: sec.id, title: sec.title, note: sec.note || '', items: items });
    });
    return out;
  }
  function hasSection(id, service) {
    return sectionsFor(service).some(function (s) { return s.id === id; });
  }

  /* ------------------------------------------------------------ block markup */
  function itemHTML(it) {
    return '<div class="it"><div class="it-top"><span class="it-name">' + esc(it.name) +
      (it.season ? '<span class="it-tag">Seasonal</span>' : '') + '</span>' +
      (it.price != null ? '<span class="it-price">' + money(it.price) + '</span>' : '') + '</div>' +
      (it.desc ? '<div class="it-desc">' + esc(it.desc) + '</div>' : '') + '</div>';
  }
  function headHTML(sec) {
    return '<div class="sec-head"><h2>' + esc(sec.title) + '</h2><i class="rule"></i>' +
      (sec.note ? '<p class="note">' + esc(sec.note) + '</p>' : '') + '</div>';
  }
  /* a page that carries on a section shows only the section's name, small, above the items */
  function runHTML(title) { return '<div class="run">' + esc(title) + '</div>'; }

  /* ------------------------------------------------------------ layout */
  function layout() {
    var compact = !!mqCompact.matches;
    root.classList.toggle('compact', compact);
    var cw = root.clientWidth, ch = root.clientHeight;
    var spread = compact || (window.innerWidth >= 900 && window.innerHeight >= 480);
    var mx = compact ? 6 : spread ? 28 : 10, my = compact ? 5 : spread ? 18 : 8;
    var H = Math.floor(ch - 2 * my);
    var maxW = spread ? (cw - 2 * mx) / 2 : (cw - 2 * mx);
    /* on its side a phone has width to spare, so the pages get a squarer shape and fit more lines across */
    var W = Math.floor(Math.min(maxW, H * (compact ? 1.04 : 0.74)));
    S.compact = compact;
    S.mode = spread ? 'spread' : 'single';
    S.W = Math.max(200, W);
    S.H = Math.max(240, H);
    S.fs = compact ? 14 : Math.max(12.5, Math.min(20, S.W / 22.5, S.H / 24));
  }
  function applyVars() {
    root.style.setProperty('--pw', S.W + 'px');
    root.style.setProperty('--ph', S.H + 'px');
    root.style.setProperty('--sw', (S.mode === 'spread' ? S.W * 2 : S.W) + 'px');
    root.style.setProperty('--fs', S.fs.toFixed(2) + 'px');
    root.style.setProperty('--persp', Math.round(S.W * 3.4) + 'px');
    stage.classList.toggle('single', S.mode === 'single');
  }

  /* ------------------------------------------------------------ pagination */
  function capacity() {
    var cs = getComputedStyle(mIn);
    return mIn.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  }
  function heightOf(html) {
    mBlocks.innerHTML = html;
    return mBlocks.getBoundingClientRect().height;
  }
  function fits(htmls, cap) {
    mBlocks.innerHTML = htmls.join('');
    return mBlocks.getBoundingClientRect().height <= cap + 0.5;
  }

  /* Split one list of blocks into pages. Items are atomic: they never split.
     Returns null when a single block cannot fit a page at this type size. */
  function flow(headHtml, contHtml, entries, cap) {
    var head = { html: headHtml, h: heightOf(headHtml) };
    var cont = { html: contHtml, h: heightOf(contHtml) };
    var blocks = entries.map(function (e) { return { html: e.html, h: heightOf(e.html), ref: e.ref }; });
    var i;
    for (i = 0; i < blocks.length; i++) {
      if (head.h + blocks[i].h > cap || cont.h + blocks[i].h > cap) return null;
    }
    var pages = [], cur = { lead: head, items: [], h: head.h };
    blocks.forEach(function (b) {
      if (cur.items.length && cur.h + b.h > cap + 0.5) {
        pages.push(cur);
        cur = { lead: cont, items: [], h: cont.h };
      }
      cur.items.push(b); cur.h += b.h;
    });
    pages.push(cur);

    /* no lonely last page: a last page of one item, or of two after a page of five or more, borrows from
       the one before while both stay within the page */
    var n = pages.length;
    if (n > 1) {
      var last = pages[n - 1], prev = pages[n - 2];
      while (prev.items.length > 3 && (last.items.length < 2 || (last.items.length < 3 && prev.items.length > 4))) {
        var mv = prev.items[prev.items.length - 1];
        if (last.h + mv.h > cap) break;
        prev.items.pop(); prev.h -= mv.h;
        last.items.unshift(mv); last.h += mv.h;
      }
    }

    /* verify with the real browser layout; push the last block on if a page still overflows */
    for (i = 0; i < pages.length; i++) {
      var pg = pages[i];
      var guard = 0;
      while (guard++ < 200 && !fits([pg.lead.html].concat(pg.items.map(function (b) { return b.html; })), cap)) {
        if (pg.items.length <= 1) return null;
        var spill = pg.items.pop();
        if (i + 1 >= pages.length) pages.push({ lead: cont, items: [], h: cont.h });
        pages[i + 1].items.unshift(spill);
      }
    }
    return pages;
  }

  function paginate() {
    var cap = capacity();
    var secs = sectionsFor(S.service);
    var pages = [];
    var secPages = [];
    var no = 0;
    for (var si = 0; si < secs.length; si++) {
      var sec = secs[si];
      var entries = sec.items.map(function (it, idx) { return { html: itemHTML(it), ref: idx }; });
      var fl = flow(headHTML(sec), runHTML(sec.title), entries, cap);
      if (!fl) return null;
      fl.forEach(function (p, k) {
        no += 1;
        secPages.push({
          kind: 'sec', sec: sec.id, title: sec.title, no: no, first: k === 0,
          from: p.items.length ? p.items[0].ref : 0,
          to: p.items.length ? p.items[p.items.length - 1].ref : 0,
          blocks: [p.lead.html].concat(p.items.map(function (b) { return b.html; }))
        });
      });
    }
    S.secs = secs.map(function (s) {
      var first = secPages.filter(function (p) { return p.sec === s.id; })[0];
      return { id: s.id, title: s.title, no: first ? first.no : 0 };
    });

    /* contents */
    var tocHead = '<div class="toc-head"><h2>Contents</h2><i class="rule"></i></div>';
    var rows = S.secs.map(function (s) {
      return { html: '<button class="toc-row" type="button" data-goto="' + esc(s.id) + '"><span class="t">' + esc(s.title) +
        '</span><span class="lead"></span><span class="n">' + s.no + '</span></button>', ref: s.id };
    });
    /* on a spread the left page carries the title, the right page the list */
    var spreadMode = S.mode === 'spread';
    var tfl = flow(spreadMode ? '' : tocHead, runHTML('Contents'), rows, cap);
    if (!tfl) return null;
    var tocPages = tfl.map(function (p, k) {
      return { kind: 'toc', first: k === 0, blocks: [p.lead.html].concat(p.items.map(function (b) { return b.html; })) };
    });

    pages.push({ kind: 'cover' });
    pages.push(spreadMode ? { kind: 'end', blocks: [tocHead] } : { kind: 'end' });
    tocPages.forEach(function (p) { pages.push(p); });
    secPages.forEach(function (p) { pages.push(p); });
    if (pages.length % 2 === 0) pages.push({ kind: 'blank' });
    pages.push({ kind: 'back' });
    pages.forEach(function (p, i) { p.i = i; });
    S.pages = pages;
    S.seq = pages.filter(function (p) { return p.kind !== 'end' && p.kind !== 'blank'; });
    S.seq.forEach(function (p, i) { p.s = i; });
    return pages;
  }

  function build() {
    layout();
    for (var tries = 0; tries < 16; tries++) {
      applyVars();
      if (paginate()) return;
      S.fs -= 0.6;
      if (S.fs < (S.compact ? 12.5 : 10.5)) break;
    }
  }

  /* ------------------------------------------------------------ page elements */
  function logoImg(cls, size) {
    return '<img class="' + cls + '" src="' + esc(LOGO) + '" width="' + size + '" height="' + size + '" alt="LÜLU’S">';
  }
  function elFor(p) {
    if (p.el) return p.el;
    var el = document.createElement('section');
    el.className = 'pg pg-' + p.kind;
    if (p.kind === 'cover') {
      el.setAttribute('aria-label', 'Cover');
      el.innerHTML = '<div class="cover-in">' + logoImg('cover-logo', 150) +
        '<p class="cover-t">Menu</p>' +
        '<p class="cover-s">' + esc(SEASON.name || '') + '</p>' +
        '<button class="cover-open" type="button" data-act="next">Open the menu</button></div>';
    } else if (p.kind === 'back') {
      el.setAttribute('aria-label', 'Back cover');
      el.innerHTML = '<div class="back-in">' + logoImg('', 56) +
        '<p>' + esc(FOOT) + '</p>' +
        '<div class="back-links"><button class="back-btn" type="button" data-goto="contents">Contents</button>' +
        '<a class="back-btn" href="' + esc(RESERVE_URL) + '" data-reserve>Reserve a table</a></div></div>';
    } else if (p.kind === 'end' && !p.blocks) {
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<div class="end-in">' + logoImg('', 56).replace('alt="LÜLU’S"', 'alt=""') + '</div>';
    } else if (p.kind === 'blank') {
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.setAttribute('aria-label', p.kind === 'toc' || p.kind === 'end' ? 'Contents' : p.title + ', page ' + p.no);
      el.innerHTML = '<div class="pg-in"><div class="blocks">' + p.blocks.join('') + '</div></div>' +
        (p.no ? '<span class="pg-no">' + p.no + '</span>' : '');
    }
    p.el = el;
    return el;
  }

  /* ------------------------------------------------------------ positions */
  function lastPos() { return S.mode === 'single' ? S.seq.length - 1 : S.pages.length / 2; }
  function pageAt(i) { return S.pages[i] || null; }
  function pagesAtPos(pos) {
    if (S.mode === 'single') return { l: null, r: S.seq[pos] || null };
    return { l: pos >= 1 ? pageAt(2 * pos - 1) : null, r: pageAt(2 * pos) };
  }
  function posOf(page) {
    if (!page) return 0;
    if (S.mode === 'single') {
      if (page.s === undefined) { var k = page.i; while (k < S.pages.length && S.pages[k].s === undefined) k++; page = S.pages[k] || S.seq[S.seq.length - 1]; }
      return page.s;
    }
    return Math.ceil(page.i / 2);
  }
  function shiftOf(pos) {
    if (S.mode !== 'spread') return 0;
    if (pos === 0) return -S.W / 2;
    if (pos === S.pages.length / 2) return S.W / 2;
    return 0;
  }
  function firstOf(pred) {
    for (var i = 0; i < S.pages.length; i++) if (pred(S.pages[i])) return S.pages[i];
    return null;
  }
  function visiblePages() { var pp = pagesAtPos(S.pos); return [pp.l, pp.r].filter(Boolean); }

  /* ------------------------------------------------------------ painting pages into slots */
  function clearBox(box) { while (box.firstChild) box.removeChild(box.firstChild); }
  function clearFace(face) {
    var c = face.firstElementChild;
    if (c && c.classList.contains('pg')) face.removeChild(c);
  }
  function putSlot(slot, page) {
    var box = slot.firstElementChild;
    clearBox(box);
    if (page) { box.appendChild(elFor(page)); slot.classList.add('has'); } else slot.classList.remove('has');
  }
  function putFace(face, page) {
    if (page) face.insertBefore(elFor(page), face.firstChild);
  }
  function clearAll() {
    clearBox(slotL.firstElementChild); clearBox(slotR.firstElementChild);
    clearFace(faceF); clearFace(faceB);
  }

  function showStatic() {
    clearAll();
    var pp = pagesAtPos(S.pos);
    putSlot(slotL, pp.l); putSlot(slotR, pp.r);
    leaf.classList.remove('on');
    castL.style.opacity = 0; castR.style.opacity = 0;
    stage.style.transform = 'translate3d(' + shiftOf(S.pos) + 'px,0,0)';
  }

  /* ------------------------------------------------------------ the turn */
  function setupTurn(from, to) {
    var fwd = to > from;
    clearAll();
    if (S.mode === 'single') {
      var a = S.seq[from], b = S.seq[to];
      putSlot(slotL, null);
      putSlot(slotR, fwd ? b : a);
      putFace(faceF, fwd ? a : b);
    } else {
      var l, r, front, back;
      if (fwd) { l = pageAt(2 * from - 1); front = pageAt(2 * from); back = pageAt(2 * to - 1); r = pageAt(2 * to); }
      else { l = pageAt(2 * to - 1); front = pageAt(2 * to); back = pageAt(2 * from - 1); r = pageAt(2 * from); }
      putSlot(slotL, l); putSlot(slotR, r);
      putFace(faceF, front); putFace(faceB, back);
    }
    turn = { from: from, to: to, fwd: fwd, t: fwd ? 0 : 1, a: shiftOf(from), b: shiftOf(to), target: 0 };
    leaf.classList.add('on');
    frame(turn.t);
  }

  /* One frame of the turn, t from 0 (flat on the right) to 1 (flat on the left).
     Besides the swing the leaf lifts a little towards the reader and sways, a soft band of light
     travels across it as it curves, and its shadow grows on the page underneath, then falls away.
     Only transform and opacity are written. */
  function frame(t) {
    var s = Math.sin(Math.PI * t);
    var spread = S.mode === 'spread';
    var lift = S.W * 0.036 * s;
    var sway = (turn && !turn.fwd ? -1 : 1) * 1.6 * Math.sin(2 * Math.PI * t);
    leaf.style.transform = 'translateZ(' + lift.toFixed(1) + 'px) rotateY(' + (-180 * t).toFixed(2) + 'deg) skewY(' + sway.toFixed(2) + 'deg)';
    shF.style.opacity = t < 0.5 ? (0.8 * Math.pow(s, 1.15)).toFixed(3) : 0;
    shB.style.opacity = spread && t >= 0.5 ? (0.8 * Math.pow(s, 1.15)).toFixed(3) : 0;
    /* the band of light: from the spine to the free edge while the leaf rises, back across the other face while it lands */
    var kF = clamp(t * 2, 0, 1), kB = clamp(t * 2 - 1, 0, 1);
    cvF.style.opacity = t < 0.5 ? (Math.sin(Math.PI * kF)).toFixed(3) : 0;
    cvF.style.transform = 'translate3d(' + ((-1 + 2 * kF) * 100).toFixed(1) + '%,0,0)';
    cvB.style.opacity = spread && t >= 0.5 ? (Math.sin(Math.PI * kB)).toFixed(3) : 0;
    cvB.style.transform = 'translate3d(' + ((-1 + 2 * kB) * 100).toFixed(1) + '%,0,0)';
    /* shadow thrown on the page underneath: it widens while the leaf climbs, fades as it passes upright */
    var cR = t < 0.5 ? Math.sin(Math.PI * clamp(t * 2, 0, 1)) : 0;
    var cL = spread && t > 0.5 ? Math.sin(Math.PI * clamp(t * 2 - 1, 0, 1)) : 0;
    castR.style.opacity = cR.toFixed(3);
    castR.style.transform = 'scaleX(' + (0.35 + 0.65 * clamp(t * 2.2, 0, 1)).toFixed(3) + ')';
    castL.style.opacity = cL.toFixed(3);
    castL.style.transform = 'scaleX(' + (0.35 + 0.65 * clamp((1 - t) * 2.2, 0, 1)).toFixed(3) + ')';
    if (turn && turn.a !== turn.b) {
      var p = turn.fwd ? t : 1 - t;
      stage.style.transform = 'translate3d(' + (turn.a + (turn.b - turn.a) * p).toFixed(2) + 'px,0,0)';
    }
  }

  /* cubic-bezier easing, like CSS: x is the share of the time, the result the share of the way */
  function bezier(x1, y1, x2, y2) {
    function bx(u) { var v = 1 - u; return 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u; }
    function by(u) { var v = 1 - u; return 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, u = x;
      for (var i = 0; i < 24; i++) {
        var d = bx(u) - x;
        if (Math.abs(d) < 1e-5) break;
        if (d > 0) hi = u; else lo = u;
        u = (lo + hi) / 2;
      }
      return by(u);
    };
  }
  /* a page is lifted slowly, swings through, and settles: gentle start, brisk middle, long soft landing */
  var easeTurn = bezier(0.42, 0, 0.24, 1);
  /* after a drag: carries on from the finger's own speed and eases to rest (never a snap) */
  function easeRelease(m0) {
    return function (k) { return (k * k * k - 2 * k * k + k) * m0 + (-2 * k * k * k + 3 * k * k); };
  }
  var TURN_MS = 880, FAR_MS = 980;

  function runTo(target, ms, ease, onDone) {
    cancelAnimationFrame(raf);
    turn.target = target;
    var t0 = turn.t, start = null;
    function step(ts) {
      if (start === null) start = ts;
      var k = Math.min(1, (ts - start) / ms);
      turn.t = t0 + (target - t0) * ease(k);
      frame(turn.t);
      if (k < 1) raf = requestAnimationFrame(step); else onDone();
    }
    raf = requestAnimationFrame(step);
  }

  function finishTurn() {
    var commit = turn.fwd ? turn.target === 1 : turn.target === 0;
    if (commit) { S.pos = turn.to; S.keep = null; }
    turn = null; busy = false;
    showStatic();
    afterChange();
  }

  function goTo(pos, opts) {
    pos = clamp(pos, 0, lastPos());
    if (busy || switching) return;
    S.keep = null;
    if (pos === S.pos) { afterChange(); return; }
    if (!ready) { S.pos = pos; showStatic(); afterChange(); return; }
    if (reduced() || (opts && opts.instant)) { fadeTo(pos, opts && opts.instant); return; }
    busy = true;
    stage.setAttribute('data-motion', 'turn');
    setupTurn(S.pos, pos);
    var far = Math.abs(pos - S.pos) > 1;
    runTo(turn.fwd ? 1 : 0, far ? FAR_MS : TURN_MS, easeTurn, finishTurn);
  }
  function step(d) { goTo(S.pos + d); }

  function fadeTo(pos, instant) {
    stage.setAttribute('data-motion', 'fade');
    if (instant || !stage.animate) { S.pos = pos; showStatic(); afterChange(); return; }
    busy = true;
    var a = stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
    a.onfinish = function () {
      S.pos = pos; showStatic(); afterChange();
      var b = stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
      a.cancel();
      b.onfinish = function () { busy = false; };
      b.oncancel = function () { busy = false; };
    };
  }

  /* ------------------------------------------------------------ gestures */
  var drag = null, suppressClick = false, framePending = false;

  /* a drag is never also a tap: the click that follows a drag is ignored */
  function swallowClick() {
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 350);
  }

  function onDown(e) {
    if (busy || switching) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: e.timeStamp, vx: 0, active: false,
             trail: [[e.timeStamp, e.clientX]] };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id || drag.dead) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      /* an upright drag is a scroll, never a turn; the click that ends it is ignored too */
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { drag.dead = true; swallowClick(); return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      var fwd = dx < 0, to = S.pos + (fwd ? 1 : -1);
      if (to < 0 || to > lastPos()) { drag = null; swallowClick(); return; }
      if (reduced()) { drag.active = true; drag.soft = true; drag.fwd = fwd; return; }
      drag.active = true; drag.fwd = fwd;
      busy = true;
      stage.setAttribute('data-motion', 'turn');
      setupTurn(S.pos, to);
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    }
    var dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.vx = 0.7 * drag.vx + 0.3 * ((e.clientX - drag.lastX) / dt);
    drag.lastX = e.clientX; drag.lastT = e.timeStamp;
    drag.trail.push([e.timeStamp, e.clientX]);
    if (drag.trail.length > 12) drag.trail.shift();
    if (drag.soft || !turn) return;
    var span = S.mode === 'single' ? S.W * 0.85 : S.W * 0.95;
    var p = clamp((drag.fwd ? -dx : dx) / span, 0, 1);
    turn.t = drag.fwd ? p : 1 - p;
    if (!framePending) {
      framePending = true;
      requestAnimationFrame(function () { framePending = false; if (turn && drag) frame(turn.t); });
    }
  }
  function onUp(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    if (d.dead) { swallowClick(); return; }
    if (!d.active) return;
    /* the finger's speed over its last 100 ms */
    var tr = d.trail, tEnd = tr[tr.length - 1][0], k0 = tr.length - 1;
    while (k0 > 0 && tEnd - tr[k0 - 1][0] <= 100) k0--;
    if (k0 < tr.length - 1) d.vx = (tr[tr.length - 1][1] - tr[k0][1]) / Math.max(1, tEnd - tr[k0][0]);
    swallowClick();
    if (d.soft) {
      if (Math.abs(d.lastX - d.x0) > 40) step(d.fwd ? 1 : -1);
      return;
    }
    if (!turn) return;
    var progress = turn.fwd ? turn.t : 1 - turn.t;
    var vdir = turn.fwd ? -d.vx : d.vx;           /* px per ms in the direction of turning */
    var commit = (progress > 0.32 || vdir > 0.45) && vdir > -0.45;
    var target = turn.fwd ? (commit ? 1 : 0) : (commit ? 0 : 1);
    var rest = Math.abs(target - turn.t);
    /* the time left is in proportion to the distance left; the finger's own speed sets how briskly it starts */
    var span = S.mode === 'single' ? S.W * 0.85 : S.W * 0.95;
    var toward = commit ? vdir : -vdir;
    var v0 = clamp(toward, 0, 3) / span;           /* turn-units per ms */
    var ms = clamp(rest * TURN_MS, 240, TURN_MS);
    var m0 = rest > 0.001 ? clamp(v0 * ms / rest, 0, 2.2) : 0;
    runTo(target, ms, easeRelease(m0), finishTurn);
  }
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('lostpointercapture', function () { /* the pointerup already finished the drag */ });

  function visibleBounds() {
    var rects = [];
    [slotL, slotR].forEach(function (s) { if (s.classList.contains('has')) rects.push(s.getBoundingClientRect()); });
    if (!rects.length) return stage.getBoundingClientRect();
    return { left: Math.min.apply(null, rects.map(function (r) { return r.left; })), right: Math.max.apply(null, rects.map(function (r) { return r.right; })) };
  }

  stage.addEventListener('click', function (e) {
    if (suppressClick) { e.preventDefault(); return; }
    var b = e.target.closest ? e.target.closest('button, a') : null;
    if (b) { act(b, e); return; }
    if (busy || switching) return;
    var vb = visibleBounds();
    var zone = Math.max(60, S.W * 0.28);
    if (e.clientX < vb.left + zone) step(-1);
    else if (e.clientX > vb.right - zone) step(1);
  });

  function act(b, e) {
    var g = b.getAttribute('data-goto');
    if (g) { e.preventDefault(); goSection(g); return; }
    var a = b.getAttribute('data-act');
    if (a === 'next') { step(1); return; }
    if (a === 'prev') { step(-1); return; }
  }

  prevBtn.addEventListener('click', function () { step(-1); });
  nextBtn.addEventListener('click', function () { step(1); });
  tocBtn.addEventListener('click', function () { goSection('contents'); });
  svcBtns.forEach(function (b) {
    b.addEventListener('click', function () { setService(b.getAttribute('data-svc'), b); });
  });

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('dialog[open]')) return;
    var k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); step(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); step(-1); }
    else if (k === 'Home') { e.preventDefault(); goTo(0); }
    else if (k === 'End') { e.preventDefault(); goTo(lastPos()); }
    else if (k === 'Escape') { goSection('contents'); }
  });

  /* ------------------------------------------------------------ navigation by name */
  function targetPage(id) {
    if (id === 'cover') return S.pages[0];
    if (id === 'contents') return firstOf(function (p) { return p.kind === 'toc'; });
    return firstOf(function (p) { return p.kind === 'sec' && p.sec === id; });
  }
  function goSection(id) {
    var p = targetPage(id);
    if (p) goTo(posOf(p));
  }
  /* Morning and Evening are also the look of the page: light paper by day, walnut and night by evening.
     The colours live in book.css under html[data-mood]; this sets the mood and the browser's bar colour. */
  function paintMood(svc) {
    doc.setAttribute('data-mood', svc);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && LU.desks) meta.setAttribute('content', LU.desks[svc]);
  }

  /* the change itself: new menu, new colours, back to the contents page */
  function applyService(svc) {
    S.keep = null;
    S.service = svc;
    store('lulus-svc', svc);
    cancelAnimationFrame(raf); turn = null; busy = false;
    paintMood(svc);
    build();
    S.pos = posOf(targetPage('contents'));
    showStatic();
    afterChange();
  }

  /* The switch: the new look spreads out in a circle from the button that was pressed (a view
     transition, as on the first version of the site). Without view transitions the page cross-fades;
     with reduced motion it simply changes. */
  function setService(svc, origin) {
    if (svc === S.service || switching) return;
    if (!ready || reduced()) { applyService(svc); return; }
    var btn = origin || svcBtns.filter(function (b) { return b.getAttribute('data-svc') === svc; })[0];
    if (document.startViewTransition && btn) {
      var r = btn.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      switching = true;
      doc.classList.add('vt');
      var done = function () { switching = false; doc.classList.remove('vt'); };
      var tr;
      try { tr = document.startViewTransition(function () { applyService(svc); }); } catch (err) { done(); applyService(svc); return; }
      tr.ready.then(function () {
        doc.animate(
          { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + end + 'px at ' + x + 'px ' + y + 'px)'] },
          { duration: 1000, easing: 'cubic-bezier(0.65, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      }).catch(function () {});
      tr.finished.then(done, done);
      return;
    }
    if (!stage.animate) { applyService(svc); return; }
    switching = true;
    var out = stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
    out.onfinish = function () {
      applyService(svc);
      out.cancel();
      var back = stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
      back.onfinish = back.oncancel = function () { switching = false; };
    };
  }

  /* ------------------------------------------------------------ hash */
  function parseHash() {
    var h = '';
    try { h = decodeURIComponent((location.hash || '').replace(/^#/, '')).toLowerCase(); } catch (e) {}
    return h;
  }
  function hashFor() {
    var vp = visiblePages();
    for (var i = 0; i < vp.length; i++) if (vp[i].kind === 'sec') return vp[i].sec;
    for (var j = 0; j < vp.length; j++) if (vp[j].kind === 'toc') return S.service;
    return '';
  }
  function writeHash() {
    var h = hashFor();
    if (parseHash() === h) return;
    try { history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : '')); } catch (e) {}
  }
  /* returns { service, target } for a hash, or null */
  function resolveHash(h) {
    if (!h || h === 'cover') return { service: S.service, target: 'cover' };
    if (h === 'morning' || h === 'evening') return { service: h, target: 'contents' };
    if (h === 'contents') return { service: S.service, target: 'contents' };
    var order = [S.service, S.service === 'morning' ? 'evening' : 'morning'];
    for (var i = 0; i < order.length; i++) if (hasSection(h, order[i])) return { service: order[i], target: h };
    return { service: S.service, target: 'contents' };
  }
  function applyHash(animate) {
    var r = resolveHash(parseHash());
    S.keep = null;
    if (r.service !== S.service) {
      S.service = r.service; store('lulus-svc', r.service);
      cancelAnimationFrame(raf); turn = null; busy = false;
      paintMood(r.service);
      build();
      S.pos = posOf(targetPage(r.target) || S.pages[0]);
      showStatic(); afterChange();
      return;
    }
    var p = targetPage(r.target);
    if (!p) return;
    if (animate) goTo(posOf(p)); else { S.pos = posOf(p); showStatic(); afterChange(); }
  }
  window.addEventListener('hashchange', function () {
    if (parseHash() !== hashFor()) applyHash(true);
  });

  /* ------------------------------------------------------------ interface state */
  function afterChange() {
    prevBtn.disabled = S.pos <= 0;
    nextBtn.disabled = S.pos >= lastPos();
    var vp = visiblePages();
    var onToc = vp.some(function (p) { return (p.kind === 'toc' && p.first) || (p.kind === 'end' && p.blocks); });
    tocBtn.disabled = onToc;
    var nums = vp.filter(function (p) { return p.kind === 'sec'; }).map(function (p) { return p.no; });
    var total = S.pages.filter(function (p) { return p.kind === 'sec'; }).length;
    countEl.textContent = nums.length ? (nums.length > 1 ? nums[0] + '-' + nums[nums.length - 1] : nums[0]) + ' / ' + total : '';
    svcBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-svc') === S.service)); });
    writeHash();
    var label;
    if (nums.length) { var sp = vp.filter(function (p) { return p.kind === 'sec'; })[0]; label = sp.title + ', page ' + nums.join(' and ') + ' of ' + total; }
    else if (onToc) label = 'Contents, ' + S.service + ' menu';
    else label = vp.some(function (p) { return p.kind === 'cover'; }) ? 'Cover' : 'Back cover';
    liveEl.textContent = label;
    stage.setAttribute('data-pos', S.pos);
  }

  /* ------------------------------------------------------------ resize */
  function anchor() {
    var vp = visiblePages();
    for (var i = 0; i < vp.length; i++) {
      if (vp[i].kind === 'sec') return { kind: 'sec', sec: vp[i].sec, item: vp[i].from };
    }
    for (var j = 0; j < vp.length; j++) {
      var p = vp[j];
      if (p.kind === 'toc' || p.kind === 'cover' || p.kind === 'back') return { kind: p.kind };
    }
    return { kind: 'cover' };
  }
  function showing(a) {
    return visiblePages().some(function (p) {
      if (a.kind === 'sec') return p.kind === 'sec' && p.sec === a.sec && p.from <= a.item && a.item <= p.to;
      return p.kind === a.kind;
    });
  }
  function restore(a) {
    var p = null;
    if (a.kind === 'sec') {
      p = firstOf(function (q) { return q.kind === 'sec' && q.sec === a.sec && q.from <= a.item && a.item <= q.to; }) || targetPage(a.sec);
    } else if (a.kind === 'toc') p = targetPage('contents');
    else if (a.kind === 'back') p = S.pages[S.pages.length - 1];
    else p = S.pages[0];
    S.pos = posOf(p || S.pages[0]);
  }
  var resizeTimer = 0, lastKey = '';
  function relayout(force) {
    var key = root.clientWidth + 'x' + root.clientHeight + ':' + window.innerWidth + 'x' + window.innerHeight;
    if (!force && key === lastKey) return;
    lastKey = key;
    var a = ready ? anchor() : null;
    /* turning the phone: a spread shows two pages, but the reader was on one of them; remember which */
    if (a && S.keep && showing(S.keep)) a = S.keep;
    cancelAnimationFrame(raf); turn = null; busy = false; drag = null;
    build();
    if (a) { restore(a); S.keep = a; }
    showStatic();
    afterChange();
  }
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (ready) relayout(false); }, 140);
  }
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(root); else window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* ------------------------------------------------------------ start */
  function start() {
    if (ready) return;
    S.service = defaultService();
    var r = resolveHash(parseHash());
    S.service = r.service;
    paintMood(S.service);
    lastKey = '';
    build();
    S.pos = posOf(targetPage(r.target) || S.pages[0]);
    showStatic();
    ready = true;
    lastKey = root.clientWidth + 'x' + root.clientHeight + ':' + window.innerWidth + 'x' + window.innerHeight;
    afterChange();
    root.classList.add('ready');
    root.setAttribute('data-ready', '1');
  }

  var fontJobs = [];
  if (document.fonts && document.fonts.load) {
    ['400 24px "Bodoni Moda"', 'italic 400 24px "Bodoni Moda"', '400 16px Jost', '500 16px Jost'].forEach(function (f) {
      fontJobs.push(document.fonts.load(f).catch(function () {}));
    });
  }
  var started = false;
  function go() { if (started) return; started = true; start(); }
  Promise.all(fontJobs).then(go);
  setTimeout(go, 1600);
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', function () { if (ready) relayout(true); });
  }

  /* small hook for automated checks */
  window.__lulusBook = {
    pageEls: function () { return S.pages.map(elFor); },
    step: step,
    goTo: goTo,
    pos: function () { return S.pos; },
    mode: function () { return S.mode; },
    size: function () { return { w: S.W, h: S.H, fs: S.fs }; },
    busy: function () { return busy || switching; }
  };
})();
