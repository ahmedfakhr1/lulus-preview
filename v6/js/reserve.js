/* Reserve sheet: a short form that opens WhatsApp with the booking filled in. */
(function () {
  'use strict';
  var WA = '201210514222';
  function cairoToday() {
    try {
      var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()), o = {};
      for (var k = 0; k < p.length; k++) o[p[k].type] = p[k].value;
      return o.year + '-' + o.month + '-' + o.day;
    } catch (e) { return ''; }
  }
  var L = { today: cairoToday() };
  /* ---- reserve sheet ---- */
  var dlg = document.getElementById('reserve');
  var form = document.getElementById('reserve-form');
  if (dlg && form && typeof dlg.showModal === 'function') {
    var fName = form.elements.name, fDate = form.elements.date, fTime = form.elements.time;
    var out = document.getElementById('r-guests');
    var guests = 2;
    if (L.today) fDate.min = L.today;

    /* a table is booked on the half hour: every slot from opening (9:00 am) to the last one before midnight */
    var slot = function (h, m) { return (h < 10 ? '0' : '') + h + ':' + (m ? '30' : '00'); };
    fTime.innerHTML = '<option value="">Choose a time</option>';
    for (var hh = 9; hh < 24; hh++) {
      for (var mm = 0; mm < 60; mm += 30) {
        var opt = document.createElement('option');
        opt.value = slot(hh, mm);
        opt.textContent = ((hh % 12) || 12) + ':' + (mm ? '30' : '00') + ' ' + (hh < 12 ? 'AM' : 'PM');
        fTime.appendChild(opt);
      }
    }

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

    /* the message to the restaurant is always English, whatever the phone's language: "Sun 5 Oct 2026", "7:05 PM" */
    var fmtDate = function (v) {
      var p = v.split('-');
      return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        .formatToParts(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])))
        .filter(function (x) { return x.type !== 'literal'; })
        .map(function (x) { return x.value; }).join(' ');
    };
    var fmtTime = function (v) {
      var p = v.split(':');
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' })
        .format(new Date(Date.UTC(1970, 0, 1, +p[0], +p[1]))).replace(/[  ]/g, ' ');
    };

    /* an iPhone shows nothing in an empty date field and sets a chosen value at the top of the box, so there the field's own text is
       hidden and the box carries our own: "Choose a date" until a value is picked, then the value, centred (the picker still opens
       from the field, which lies under the text) */
    if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) document.documentElement.classList.add('ios');
    [[fDate, fmtDate, 'Choose a date']].forEach(function (f) {
      var input = f[0], ph = input.parentNode.querySelector('.ph');
      var sync = function () {
        input.parentNode.classList.toggle('filled', input.value !== '');
        if (ph) ph.textContent = input.value ? f[1](input.value) : f[2];
      };
      input.addEventListener('input', sync); input.addEventListener('change', sync); sync();
    });

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
