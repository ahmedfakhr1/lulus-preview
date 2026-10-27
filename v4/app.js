(function () {
  var body = document.body;
  var tones = document.querySelectorAll('[data-tone]');
  var on = function () {
    body.classList.toggle('scrolled', window.scrollY > window.innerHeight * 0.5);
    var mid = window.innerHeight * 0.55, best = null;
    for (var i = 0; i < tones.length; i++) {
      if (tones[i] === body) continue;
      var r = tones[i].getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) best = tones[i];
    }
    if (best) {
      var t = best.getAttribute('data-tone');
      if (body.getAttribute('data-tone') !== t) {
        body.setAttribute('data-tone', t);
        var m = document.querySelector('meta[name="theme-color"]');
        if (m) m.setAttribute('content', { morning: '#fdf3dc', noon: '#e9b25a', evening: '#7a0000', night: '#1d1209' }[t]);
      }
    }
  };
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { on(); ticking = false; });
  }, { passive: true });
  window.addEventListener('resize', on);
  on();
})();
