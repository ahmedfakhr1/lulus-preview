/* The menu book.
   Pages are real HTML, paginated from the menu data at the current screen size.
   Phone: one page at a time. Wide screens (900px and up): a two-page spread.
   While a page turns only transform and opacity change; nothing is measured per frame. */
(function () {
  'use strict';

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

  /* ------------------------------------------------------------ state */
  var S = {
    service: 'evening', mode: 'single', W: 0, H: 0, fs: 16,
    pages: [], seq: [], pos: 0, secs: []
  };
  var turn = null, busy = false, raf = 0, ready = false;

  /* ------------------------------------------------------------ DOM scaffold */
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-roledescription', 'book');
  stage.setAttribute('aria-label', 'Menu');
  stage.innerHTML =
    '<div class="slot slot-l"><div class="slot-pg"></div><i class="cast"></i></div>' +
    '<div class="slot slot-r"><div class="slot-pg"></div><i class="cast"></i></div>' +
    '<div class="leaf"><div class="face face-f"><i class="sh"></i></div><div class="face face-b"><i class="sh"></i></div></div>';
  var slotL = stage.querySelector('.slot-l'), slotR = stage.querySelector('.slot-r');
  var castL = slotL.querySelector('.cast'), castR = slotR.querySelector('.cast');
  var leaf = stage.querySelector('.leaf');
  var faceF = leaf.querySelector('.face-f'), faceB = leaf.querySelector('.face-b');
  var shF = faceF.querySelector('.sh'), shB = faceB.querySelector('.sh');

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
  /* Evening from 17:00 to 04:59 in Cairo, Morning from 05:00 to 16:59; a choice made in this visit is kept */
  function defaultService() {
    var saved = store('lulus-svc');
    if (saved === 'morning' || saved === 'evening') return saved;
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
  function runHTML(title) { return '<div class="run">' + esc(title) + ', <i>continued</i></div>'; }

  /* ------------------------------------------------------------ layout */
  function layout() {
    var cw = root.clientWidth, ch = root.clientHeight;
    var spread = window.innerWidth >= 900 && window.innerHeight >= 480;
    var mx = spread ? 28 : 10, my = spread ? 18 : 8;
    var H = Math.floor(ch - 2 * my);
    var maxW = spread ? (cw - 2 * mx) / 2 : (cw - 2 * mx);
    var W = Math.floor(Math.min(maxW, H * 0.74));
    S.mode = spread ? 'spread' : 'single';
    S.W = Math.max(200, W);
    S.H = Math.max(240, H);
    S.fs = Math.max(12.5, Math.min(20, S.W / 22.5, S.H / 24));
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

    /* no lonely last page: borrow from the one before when both stay within the page */
    var n = pages.length;
    if (n > 1) {
      var last = pages[n - 1], prev = pages[n - 2];
      while (last.items.length < 3 && prev.items.length > 3) {
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
      if (S.fs < 10.5) break;
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

  function frame(t) {
    leaf.style.transform = 'rotateY(' + (-180 * t).toFixed(2) + 'deg)';
    var s = Math.sin(Math.PI * t);
    var spread = S.mode === 'spread';
    shF.style.opacity = t < 0.5 ? (0.85 * s).toFixed(3) : 0;
    shB.style.opacity = spread && t >= 0.5 ? (0.85 * s).toFixed(3) : 0;
    castR.style.opacity = t < 0.5 ? Math.sin(Math.PI * 2 * t).toFixed(3) : 0;
    castL.style.opacity = spread && t > 0.5 ? Math.sin(Math.PI * (2 * t - 1)).toFixed(3) : 0;
    if (turn && turn.a !== turn.b) {
      var p = turn.fwd ? t : 1 - t;
      stage.style.transform = 'translate3d(' + (turn.a + (turn.b - turn.a) * p).toFixed(2) + 'px,0,0)';
    }
  }

  function easeInOut(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }

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
    if (commit) S.pos = turn.to;
    turn = null; busy = false;
    showStatic();
    afterChange();
  }

  function goTo(pos, opts) {
    pos = clamp(pos, 0, lastPos());
    if (busy) return;
    if (pos === S.pos) { afterChange(); return; }
    if (!ready) { S.pos = pos; showStatic(); afterChange(); return; }
    if (reduced() || (opts && opts.instant)) { fadeTo(pos, opts && opts.instant); return; }
    busy = true;
    stage.setAttribute('data-motion', 'turn');
    setupTurn(S.pos, pos);
    var far = Math.abs(pos - S.pos) > 1;
    runTo(turn.fwd ? 1 : 0, far ? 900 : 760, easeInOut, finishTurn);
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
    if (busy) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: e.timeStamp, vx: 0, active: false };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { drag = null; swallowClick(); return; }
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
    if (!d.active) return;
    swallowClick();
    if (d.soft) {
      if (Math.abs(d.lastX - d.x0) > 40) step(d.fwd ? 1 : -1);
      return;
    }
    if (!turn) return;
    var progress = turn.fwd ? turn.t : 1 - turn.t;
    var vdir = turn.fwd ? -d.vx : d.vx;
    var commit = (progress > 0.32 || vdir > 0.45) && vdir > -0.45;
    var target = turn.fwd ? (commit ? 1 : 0) : (commit ? 0 : 1);
    var rest = Math.abs(target - turn.t);
    runTo(target, 180 + 420 * rest, easeOut, finishTurn);
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
    if (busy) return;
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
    b.addEventListener('click', function () { setService(b.getAttribute('data-svc')); });
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
  function setService(svc) {
    if (svc === S.service) return;
    S.service = svc;
    store('lulus-svc', svc);
    cancelAnimationFrame(raf); turn = null; busy = false;
    build();
    S.pos = posOf(targetPage('contents'));
    showStatic();
    afterChange();
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
    if (r.service !== S.service) {
      S.service = r.service; store('lulus-svc', r.service);
      cancelAnimationFrame(raf); turn = null; busy = false;
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
    var onToc = vp.some(function (p) { return p.kind === 'toc' || (p.kind === 'end' && p.blocks); });
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
      var p = vp[i];
      if (p.kind === 'sec') return { kind: 'sec', sec: p.sec, item: p.from };
      if (p.kind === 'toc' || p.kind === 'cover' || p.kind === 'back') return { kind: p.kind };
    }
    return { kind: 'cover' };
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
    var key = root.clientWidth + 'x' + root.clientHeight + ':' + window.innerWidth;
    if (!force && key === lastKey) return;
    lastKey = key;
    var a = ready ? anchor() : null;
    cancelAnimationFrame(raf); turn = null; busy = false; drag = null;
    build();
    if (a) restore(a);
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
    lastKey = '';
    build();
    S.pos = posOf(targetPage(r.target) || S.pages[0]);
    showStatic();
    ready = true;
    lastKey = root.clientWidth + 'x' + root.clientHeight + ':' + window.innerWidth;
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
    busy: function () { return busy; }
  };
})();
