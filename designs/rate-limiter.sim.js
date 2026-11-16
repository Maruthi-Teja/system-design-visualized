/*
 * Rate-limiter playground: three algorithms enforcing the same limit
 * (5 requests per 10 seconds) so their behaviour can be compared by hand.
 * Self-contained; looks for #sim on the page.
 */
(function () {
  'use strict';

  const LIMIT = 5;            // requests
  const WINDOW = 10000;       // ms
  const SPAN = 20000;         // ms of history shown on the strip
  const root = document.getElementById('sim');
  if (!root) return;

  const $ = function (sel) { return root.querySelector(sel); };
  const t0 = performance.now();
  const now = function () { return performance.now() - t0; };

  /* ---------- algorithms: each exposes allow(t) and gauge(t) ---------- */

  const algos = {
    token: {
      name: 'Token bucket',
      desc: 'A bucket holds up to <b>5 tokens</b> and refills continuously at <b>0.5 tokens/s</b>. Each request takes one token; no token, no entry. Bursts are fine as long as tokens are saved up.',
      tryIt: 'Wait for a full bucket, then hit <b>Burst ×5</b> — all pass. Send one more straight away: denied, until a token drips back in 2 s.',
      label: 'Tokens in bucket',
      reset: function () { this.tokens = LIMIT; this.last = now(); },
      refill: function (t) {
        this.tokens = Math.min(LIMIT, this.tokens + ((t - this.last) / WINDOW) * LIMIT);
        this.last = t;
      },
      allow: function (t) {
        this.refill(t);
        if (this.tokens >= 1) { this.tokens -= 1; return true; }
        return false;
      },
      gauge: function (t) {
        this.refill(t);
        return { frac: this.tokens / LIMIT, text: this.tokens.toFixed(1) + ' / ' + LIMIT, full: this.tokens < 1 };
      },
    },

    fixed: {
      name: 'Fixed window',
      desc: 'Time is cut into <b>10-second windows</b>. Count requests in the current window; reject once the count reaches 5. The counter resets to zero at each boundary.',
      tryIt: 'Send 5 requests <b>just before</b> a window boundary and 5 <b>just after</b>. All 10 pass within a couple of seconds — double the intended rate. That is the boundary-burst problem.',
      label: 'Requests in current window',
      windows: true,
      reset: function () { this.win = -1; this.count = 0; },
      roll: function (t) {
        const w = Math.floor(t / WINDOW);
        if (w !== this.win) { this.win = w; this.count = 0; }
      },
      allow: function (t) {
        this.roll(t);
        if (this.count < LIMIT) { this.count += 1; return true; }
        return false;
      },
      gauge: function (t) {
        this.roll(t);
        const left = ((this.win + 1) * WINDOW - t) / 1000;
        return { frac: this.count / LIMIT, text: this.count + ' / ' + LIMIT + ' · resets in ' + left.toFixed(1) + ' s', full: this.count >= LIMIT };
      },
    },

    sliding: {
      name: 'Sliding window counter',
      desc: 'Keeps two counters — current and previous window — and estimates the last 10 seconds as <b>current + previous × (share of the previous window still in view)</b>. Nearly as cheap as fixed window, without the boundary burst.',
      tryIt: 'Repeat the fixed-window trick: 5 just before a boundary, 5 just after. This time the second batch is denied, because the previous window still weighs almost fully.',
      label: 'Weighted estimate (last 10 s)',
      windows: true,
      reset: function () { this.win = -1; this.cur = 0; this.prev = 0; },
      roll: function (t) {
        const w = Math.floor(t / WINDOW);
        if (w === this.win) return;
        this.prev = w === this.win + 1 ? this.cur : 0;   // skipped a whole window → nothing carries over
        this.cur = 0;
        this.win = w;
      },
      estimate: function (t) {
        this.roll(t);
        const elapsed = (t - this.win * WINDOW) / WINDOW;
        return this.cur + this.prev * (1 - elapsed);
      },
      allow: function (t) {
        if (this.estimate(t) + 1 <= LIMIT) { this.cur += 1; return true; }
        return false;
      },
      gauge: function (t) {
        const e = this.estimate(t);
        return { frac: Math.min(1, e / LIMIT), text: e.toFixed(1) + ' / ' + LIMIT, full: e + 1 > LIMIT };
      },
    },
  };

  /* ---------- state + DOM ---------- */

  let algo = null;
  let events = [];            // { t, ok, el }
  let allowed = 0, denied = 0;
  const strip = $('.sim-strip');
  const fill = $('.sim-fill');
  const boundaries = [0, 1, 2].map(function () {
    const b = document.createElement('div');
    b.className = 'sim-boundary';
    strip.appendChild(b);
    return b;
  });

  function select(id) {
    algo = algos[id];
    algo.reset();
    events.forEach(function (e) { e.el.remove(); });
    events = []; allowed = 0; denied = 0;
    root.querySelectorAll('.sim-tab').forEach(function (tab) {
      tab.setAttribute('aria-selected', tab.dataset.algo === id ? 'true' : 'false');
    });
    $('.sim-desc').innerHTML = algo.desc;
    $('.sim-try').innerHTML = '<strong>Try this:</strong> ' + algo.tryIt;
    $('.sim-gauge-head span').textContent = algo.label;
    render();
  }

  function send() {
    const t = now();
    const ok = algo.allow(t);
    const el = document.createElement('div');
    el.className = 'sim-dot' + (ok ? '' : ' is-denied');
    el.title = ok ? 'allowed' : 'denied (429)';
    strip.appendChild(el);
    events.push({ t: t, ok: ok, el: el });
    if (ok) allowed += 1; else denied += 1;
    render();
  }

  /** Position on the strip in %: "now" sits just inside the right edge, SPAN ms ago at the left edge. */
  function x(t, tNow) { return 97 - ((tNow - t) / SPAN) * 97; }

  function render() {
    const t = now();
    const g = algo.gauge(t);
    fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, g.frac)) + ')';
    fill.classList.toggle('is-full', g.full);
    $('.sim-gauge-head b').textContent = g.text;
    $('.sim-stats').innerHTML = '<span class="ok">' + allowed + '</span> allowed · <span class="no">' + denied + '</span> denied';

    // Drop events that scrolled off the left edge; move the rest.
    events = events.filter(function (e) {
      if (t - e.t > SPAN) { e.el.remove(); return false; }
      e.el.style.left = x(e.t, t) + '%';
      return true;
    });

    // Window boundaries (only for window-based algorithms).
    const firstBoundary = Math.floor(t / WINDOW) * WINDOW;
    boundaries.forEach(function (b, i) {
      const bt = firstBoundary - i * WINDOW;
      const show = algo.windows && bt >= 0 && t - bt <= SPAN;
      b.style.display = show ? '' : 'none';
      if (show) b.style.left = x(bt, t) + '%';
    });
  }

  /* ---------- wiring ---------- */

  root.querySelectorAll('.sim-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { select(tab.dataset.algo); });
  });
  $('[data-sim="send"]').addEventListener('click', send);
  $('[data-sim="burst"]').addEventListener('click', function () {
    for (let i = 0; i < 5; i++) setTimeout(send, i * 60);
  });
  $('[data-sim="reset"]').addEventListener('click', function () {
    select(Object.keys(algos).find(function (k) { return algos[k] === algo; }));
  });

  select('token');

  // Smooth updates normally; a slow tick when the user prefers reduced motion.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(render, 500);
  } else {
    (function loop() { render(); requestAnimationFrame(loop); })();
  }
})();
