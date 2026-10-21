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

  /* ------------------------------------------------------------ DOM scaffold
     The turning sheet is drawn flat, with 2D transforms only: the part of the page that has not lifted yet,
     and the lifted part (its back) laid over it, mirrored across the fold. Both sit in one box that is turned
     to the fold and clips at it, so nothing is ever drawn in 3D and nothing reaches past the book. */
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-roledescription', 'book');
  stage.setAttribute('aria-label', 'Menu');
  stage.innerHTML =
    '<div class="slot slot-l"><div class="slot-pg"></div></div>' +
    '<div class="slot slot-r"><div class="slot-pg"></div></div>' +
    '<div class="flip"><div class="flip-o">' +
      '<div class="bed"><i class="fs"></i></div>' +
      '<div class="fold"><div class="face face-f"></div><i class="drop"></i><div class="face face-b"><i class="hl"></i></div></div>' +
    '</div></div>';
  var slotL = stage.querySelector('.slot-l'), slotR = stage.querySelector('.slot-r');
  var flip = stage.querySelector('.flip'), flipO = stage.querySelector('.flip-o');
  var fold = stage.querySelector('.fold'), fsEl = stage.querySelector('.fs');
  var faceF = stage.querySelector('.face-f'), faceB = stage.querySelector('.face-b');
  var dropEl = stage.querySelector('.drop'), hlEl = stage.querySelector('.hl');
  var verso = document.createElement('div');
  verso.className = 'pg pg-verso';
  verso.setAttribute('aria-hidden', 'true');

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
      if (items.length) out.push({ id: sec.id, title: sec.title, note: sec.note || '', photo: sec.photo || null, items: items });
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
  /* a section may open with one photo, a plate across the top of its first page; its box has a fixed shape,
     so pagination never waits for the file */
  function photoHTML(sec) {
    var p = sec.photo;
    return p ? '<figure class="sec-photo"><i class="ph-img" role="img" aria-label="Photo to come"></i></figure>' : '';
  }
  function headHTML(sec) {
    return '<div class="sec-head">' + photoHTML(sec) + '<h2>' + esc(sec.title) + '</h2><i class="rule"></i>' +
      (sec.note ? '<p class="note">' + esc(sec.note) + '</p>' : '') + '</div>';
  }
  /* a page that carries on a section shows only the section's name, small, above the items */
  function runHTML(title) { return '<div class="run">' + esc(title) + '</div>'; }

  // section photos are plain plates for now, nothing to preload

  /* ------------------------------------------------------------ layout */
  function layout() {
    var compact = !!mqCompact.matches;
    root.classList.toggle('compact', compact);
    var cw = root.clientWidth, ch = root.clientHeight;
    var vw = doc.clientWidth || window.innerWidth, vh = doc.clientHeight || window.innerHeight;
    var spread = compact || (vw >= 900 && vh >= 480);
    var mx = compact ? 6 : spread ? 28 : 10, my = compact ? 5 : spread ? 18 : 8;
    var H = Math.floor(ch - 2 * my);
    var maxW = spread ? (cw - 2 * mx) / 2 : (cw - 2 * mx);
    /* on its side a phone has width to spare, so the pages get a squarer shape and fit more lines across */
    var W = Math.floor(Math.min(maxW, H * (compact ? 1.04 : 0.74)));
    S.compact = compact;
    S.mode = spread ? 'spread' : 'single';
    S.W = Math.max(200, W);
    S.H = Math.max(240, H);
    /* the visitor's text size (browser or phone setting) scales the book's type; more text simply makes more pages */
    var tz = clamp((parseFloat(getComputedStyle(doc).fontSize) || 16) / 16, 1, 2);
    S.fs = (compact ? 14 : Math.max(12.5, Math.min(20, S.W / 22.5, S.H / 24))) * tz;
  }
  function applyVars() {
    root.style.setProperty('--pw', S.W + 'px');
    root.style.setProperty('--ph', S.H + 'px');
    root.style.setProperty('--sw', (S.mode === 'spread' ? S.W * 2 : S.W) + 'px');
    root.style.setProperty('--fs', S.fs.toFixed(2) + 'px');
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
    /* the title sits above the list; on a spread the facing page is the seal endpaper */
    var tfl = flow(tocHead, runHTML('Contents'), rows, cap);
    if (!tfl) return null;
    var tocPages = tfl.map(function (p, k) {
      return { kind: 'toc', first: k === 0, blocks: [p.lead.html].concat(p.items.map(function (b) { return b.html; })) };
    });

    pages.push({ kind: 'cover' });
    pages.push({ kind: 'end' });
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
  function putFace(face, el) {
    if (el) face.insertBefore(el, face.firstChild);
  }
  function clearAll() {
    clearBox(slotL.firstElementChild); clearBox(slotR.firstElementChild);
    clearFace(faceF); clearFace(faceB);
  }

  function showStatic() {
    clearAll();
    var pp = pagesAtPos(S.pos);
    putSlot(slotL, pp.l); putSlot(slotR, pp.r);
    flip.classList.remove('on');
    stage.style.transform = 'translate(' + shiftOf(S.pos) + 'px,0)';
  }

  /* ------------------------------------------------------------ the turn
     A turn lifts the outer corner O of the sheet and carries it to the point F. The fold is the line halfway
     between them, at right angles to OF. The part beyond the fold is mirrored across it, so its other side
     shows, lying over the rest of the sheet. All of this is worked out in "peel" coordinates: the spine at
     x = 0 and the sheet lying from 0 to W. A turn forward peels the right-hand sheet to the left; a turn back
     peels the left-hand sheet to the right, which is the same picture seen in a mirror (dir = -1). */
  var I = [1, 0, 0, 1, 0, 0];
  function mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function inv(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    var a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  function css(m) {
    return 'matrix(' + m[0].toFixed(5) + ',' + m[1].toFixed(5) + ',' + m[2].toFixed(5) + ',' + m[3].toFixed(5) + ',' +
      m[4].toFixed(2) + ',' + m[5].toFixed(2) + ')';
  }

  /* The paper is held at the spine, so the corner can only travel where the sheet can reach. */
  function reach(F) {
    var W = S.W, cy = turn.cy, far = Math.hypot(W, S.H);
    for (var i = 0; i < 3; i++) {
      var dx = F.x, dy = F.y - cy, r = Math.hypot(dx, dy);
      if (r > W) { F = { x: dx * W / r, y: cy + dy * W / r }; }
      dx = F.x; dy = F.y - (S.H - cy); r = Math.hypot(dx, dy);
      if (r > far) { F = { x: dx * far / r, y: (S.H - cy) + dy * far / r }; }
    }
    return F;
  }

  function setupTurn(from, to, cy) {
    var fwd = to > from;
    clearAll();
    var up, down;      /* the side of the sheet that faces up before the turn, and the side that lands face up */
    if (S.mode === 'single') {
      var a = S.seq[from], b = S.seq[to];
      putSlot(slotL, null);
      putSlot(slotR, fwd ? b : a);
      /* one page at a time: the back of the sheet is plain paper */
      var holder = fwd ? a : b;
      verso.classList.toggle('ink', holder.kind === 'cover' || holder.kind === 'back');
      up = fwd ? elFor(a) : verso;
      down = fwd ? verso : elFor(b);
    } else {
      var l, r, u, dn;
      if (fwd) { l = pageAt(2 * from - 1); u = pageAt(2 * from); dn = pageAt(2 * to - 1); r = pageAt(2 * to); }
      else { l = pageAt(2 * to - 1); u = pageAt(2 * from - 1); dn = pageAt(2 * to); r = pageAt(2 * from); }
      putSlot(slotL, l); putSlot(slotR, r);
      up = u ? elFor(u) : null; down = dn ? elFor(dn) : null;
    }
    faceF.className = 'face face-f ' + (fwd ? 'rp' : 'lp');
    faceB.className = 'face face-b ' + (fwd ? 'lp' : 'rp');
    putFace(faceF, up); putFace(faceB, down);
    cy = cy === undefined ? S.H : cy;
    var W = S.W;
    turn = {
      from: from, to: to, fwd: fwd, dir: fwd ? 1 : -1, cy: cy, O: { x: W, y: cy }, rest: { x: -W, y: cy },
      L: 2 * Math.ceil(Math.hypot(2 * W, S.H)) + 16,
      U: fwd ? I : [-1, 0, 0, 1, W, 0], D: fwd ? [-1, 0, 0, 1, W, 0] : I,
      X: [fwd ? 1 : -1, 0, 0, 1, 0, 0], B: [1, 0, 0, 1, fwd ? 0 : W, 0],
      a: shiftOf(from), b: shiftOf(to)
    };
    turn.F = { x: W, y: cy };
    flip.style.setProperty('--L', turn.L + 'px');
    flip.classList.toggle('bwd', !fwd);
    flip.classList.add('on');
    frame(turn.F);
  }

  /* how far the turn has gone, 0 at the start, 1 when the sheet has landed */
  function progressOf(F) { return clamp((S.W - F.x) / (2 * S.W), 0, 1); }

  /* One frame. Only transform and opacity are written. */
  function frame(F) {
    var W = S.W, O = turn.O;
    var dx = F.x - O.x, dy = F.y - O.y, len = Math.hypot(dx, dy);
    if (len < 0.6) { dx = -0.6; dy = 0; len = 0.6; }
    var nx = dx / len, ny = dy / len;              /* across the fold, towards the part that stays */
    var ux = ny, uy = -nx;                         /* along the fold */
    var mx = O.x + dx / 2, my = O.y + dy / 2;      /* a point on the fold */
    var h = turn.L / 2, ox = mx - ux * h, oy = my - uy * h;
    var K = [ux, uy, nx, ny, ox, oy];
    var Ki = inv(K);
    /* the mirror across the fold */
    var a = 2 * ux * ux - 1, b = 2 * ux * uy, d = 2 * uy * uy - 1;
    var R = [a, b, b, d, mx - a * mx - b * my, my - b * mx - d * my];
    var RD = mul(R, turn.D);
    var p = progressOf(F);
    var s = Math.sin(Math.PI * p);
    fold.style.transform = css(mul(turn.X, K));
    faceF.style.transform = css(mul(Ki, turn.U));
    var down = css(mul(Ki, RD));
    faceB.style.transform = down;
    dropEl.style.transform = down;
    dropEl.style.opacity = (0.9 * Math.pow(s, 0.7)).toFixed(3);
    /* light on the curve of the lifted paper, from the fold outwards */
    var wl = Math.max(1, W * (0.18 + 0.3 * s));
    hlEl.style.transform = css(mul(inv(RD), [ux, uy, nx * wl / 100, ny * wl / 100, ox, oy]));
    hlEl.style.opacity = Math.pow(s, 0.5).toFixed(3);
    /* the shadow the lifted paper throws on the page it uncovers */
    var ws = Math.max(1, W * (0.06 + 0.22 * s));
    fsEl.style.transform = css(mul(turn.B, mul(turn.X, [-ux, -uy, -nx * ws / 100, -ny * ws / 100, mx + ux * h, my + uy * h])));
    fsEl.style.opacity = Math.pow(s, 0.6).toFixed(3);
    if (turn.a !== turn.b) {
      stage.style.transform = 'translate(' + (turn.a + (turn.b - turn.a) * p).toFixed(2) + 'px,0)';
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
        var dd = bx(u) - x;
        if (Math.abs(dd) < 1e-5) break;
        if (dd > 0) hi = u; else lo = u;
        u = (lo + hi) / 2;
      }
      return by(u);
    };
  }
  /* a page is lifted gently, swings through, and settles with a long soft landing */
  var easeTurn = bezier(0.45, 0.05, 0.22, 1);
  /* after a drag: carries on at the finger's own speed and eases to rest (never a snap) */
  function easeRelease(m0) {
    return function (k) { return (k * k * k - 2 * k * k + k) * m0 + (-2 * k * k * k + 3 * k * k); };
  }
  var TURN_MS = 900, FAR_MS = 1000;

  /* the path of the corner for a turn made by a button, a tap or a key: across, rising a little in the middle */
  function pathAt(e) {
    var W = S.W, H = S.H;
    return reach({ x: W - 2 * W * e, y: turn.cy - (turn.cy > H / 2 ? 1 : -1) * H * 0.16 * Math.sin(Math.PI * e) });
  }

  function animate(ms, ease, at, onDone) {
    cancelAnimationFrame(raf);
    var start = null;
    function tick(ts) {
      if (start === null) start = ts;
      var k = Math.min(1, (ts - start) / ms);
      turn.F = at(ease(k));
      frame(turn.F);
      if (k < 1) raf = requestAnimationFrame(tick); else onDone();
    }
    raf = requestAnimationFrame(tick);
  }

  function finishTurn(commit) {
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
    animate(far ? FAR_MS : TURN_MS, easeTurn, pathAt, function () { finishTurn(true); });
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

  /* ------------------------------------------------------------ gestures
     One finger at 1x: the corner comes to the finger and then stays under it. Two fingers, or a page that
     is zoomed in, belong to the browser: pinch and pan, never a turn. */
  var drag = null, suppressClick = false, framePending = false;
  var touches = {}, nTouch = 0, pinching = false;
  function zoomed() { var vv = window.visualViewport; return !!(vv && vv.scale > 1.01); }
  function syncZoom() { stage.classList.toggle('zoomed', zoomed()); }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncZoom);

  /* a drag is never also a tap: the click that follows a drag is ignored */
  function swallowClick() {
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 350);
  }
  function sheetPoint(e) {
    return { x: (e.clientX - drag.ox) * drag.dir, y: e.clientY - drag.oy };
  }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  /* the page goes back to where it lay, from wherever the finger left it */
  function abandon() {
    var d = drag; drag = null;
    if (!d || !d.active || d.soft || !turn) return;
    var F0 = turn.F, R = turn.O;
    var dist = Math.hypot(R.x - F0.x, R.y - F0.y) / (2 * S.W);
    animate(clamp(dist * TURN_MS, 200, 600), bezier(0.25, 0.6, 0.3, 1), function (k) {
      return reach({ x: F0.x + (R.x - F0.x) * k, y: F0.y + (R.y - F0.y) * k });
    }, function () { finishTurn(false); });
  }

  function onDown(e) {
    if (e.pointerType === 'touch') {
      if (!touches[e.pointerId]) { touches[e.pointerId] = 1; nTouch++; }
      if (nTouch > 1) { pinching = true; abandon(); swallowClick(); return; }
    }
    if (busy || switching || pinching || zoomed()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, trail: [[e.timeStamp, e.clientX, e.clientY]] };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id || drag.dead) return;
    if (pinching) { abandon(); return; }
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    drag.trail.push([e.timeStamp, e.clientX, e.clientY]);
    if (drag.trail.length > 16) drag.trail.shift();
    if (!drag.active) {
      /* an upright drag is a scroll, never a turn; the click that ends it is ignored too */
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { drag.dead = true; swallowClick(); return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      var fwd = dx < 0, to = S.pos + (fwd ? 1 : -1);
      if (to < 0 || to > lastPos()) { drag = null; swallowClick(); return; }
      drag.active = true; drag.fwd = fwd;
      if (reduced()) { drag.soft = true; return; }
      busy = true;
      stage.setAttribute('data-motion', 'turn');
      var sr = stage.getBoundingClientRect();
      drag.ox = sr.left + (S.mode === 'spread' ? S.W : 0);
      drag.oy = sr.top;
      drag.dir = fwd ? 1 : -1;
      var st = { x: (drag.x0 - drag.ox) * drag.dir, y: drag.y0 - drag.oy };
      setupTurn(S.pos, to, st.y > S.H / 2 ? S.H : 0);
      drag.start = st;
      drag.home = turn.O;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    }
    if (drag.soft || !turn) return;
    /* the corner starts where it lies and comes to the finger over the first stretch of the drag */
    var f = sheetPoint(e);
    var w = 1 - smooth(Math.hypot(f.x - drag.start.x, f.y - drag.start.y) / (S.W * 0.42));
    turn.F = reach({ x: f.x + (drag.home.x - drag.start.x) * w, y: f.y + (drag.home.y - drag.start.y) * w });
    if (!framePending) {
      framePending = true;
      requestAnimationFrame(function () { framePending = false; if (turn && drag) frame(turn.F); });
    }
  }
  function onUp(e) {
    if (e.pointerType === 'touch' && touches[e.pointerId]) {
      delete touches[e.pointerId]; nTouch = Math.max(0, nTouch - 1);
      if (pinching) { if (nTouch === 0) pinching = false; swallowClick(); abandon(); return; }
    }
    if (!drag || e.pointerId !== drag.id) return;
    if (e.type === 'pointercancel') { swallowClick(); abandon(); return; }
    var d = drag; drag = null;
    if (d.dead) { swallowClick(); return; }
    if (!d.active) return;
    swallowClick();
    /* the finger's speed over its last 100 ms */
    var tr = d.trail, last = tr[tr.length - 1], k0 = tr.length - 1;
    while (k0 > 0 && last[0] - tr[k0 - 1][0] <= 100) k0--;
    /* a slow device may space the moves out: then the last two moves give the speed */
    if (k0 === tr.length - 1 && k0 > 0 && last[0] - tr[k0 - 1][0] <= 220) k0--;
    var span = Math.max(1, last[0] - tr[k0][0]);
    var vx = k0 < tr.length - 1 ? (last[1] - tr[k0][1]) / span : 0;
    var vy = k0 < tr.length - 1 ? (last[2] - tr[k0][2]) / span : 0;
    if (d.soft) {
      if (Math.abs(last[1] - d.x0) > 40) step(d.fwd ? 1 : -1);
      return;
    }
    if (!turn) return;
    vx *= turn.dir;                                /* in peel coordinates */
    var gone = progressOf(turn.F);
    var vdir = -vx;                                /* px per ms in the direction of turning */
    var commit = (gone > 0.3 || vdir > 0.4) && vdir > -0.4;
    var tgt = commit ? turn.rest : turn.O;
    var F0 = turn.F;
    var ex = tgt.x - F0.x, ey = tgt.y - F0.y, dist = Math.hypot(ex, ey);
    /* time in proportion to the way left; the finger's own speed sets how briskly it carries on */
    var ms = clamp(dist / (2 * S.W) * TURN_MS * 1.1, 260, TURN_MS);
    var along = dist > 0.5 ? (vx * ex + vy * ey) / dist : 0;   /* px per ms towards the target */
    var m0 = dist > 0.5 ? clamp(Math.max(0, along) * ms / dist, 0, 2.4) : 0;
    var ease = easeRelease(m0);
    animate(ms, function (k) { return k; }, function (k) {
      var q = ease(k);
      /* a light lift on the way, so the corner arcs rather than slides */
      var lift = Math.sin(Math.PI * q) * Math.min(S.H * 0.05, dist * 0.08) * (turn.cy > S.H / 2 ? -1 : 1);
      return reach({ x: F0.x + ex * q, y: F0.y + ey * q + lift });
    }, function () { finishTurn(commit); });
  }
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);

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
    if (busy || switching || zoomed()) return;
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
    var key = root.clientWidth + 'x' + root.clientHeight + ':' + doc.clientWidth + 'x' + doc.clientHeight;
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
    lastKey = root.clientWidth + 'x' + root.clientHeight + ':' + doc.clientWidth + 'x' + doc.clientHeight;
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
    busy: function () { return busy || switching; },
    /* the turn in progress: how far it has gone (0 to 1) and where the lifted corner is on screen */
    turn: function () {
      if (!turn) return null;
      var r = stage.getBoundingClientRect(), sx = r.left + (S.mode === 'spread' ? S.W : 0);
      return { p: progressOf(turn.F), x: sx + turn.dir * turn.F.x, y: r.top + turn.F.y, fwd: turn.fwd };
    }
  };
})();
