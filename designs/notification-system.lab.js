/*
 * Retry-storm lab for the Notification System page.
 * 1,000 SMS sends fail at the start of a provider outage. Each strategy schedules
 * retries differently; when the provider comes back it can handle `capacity`
 * requests per second and rejects the rest (which then retry again).
 * The chart shows attempts per second: accepted vs rejected.
 * Deterministic (seeded RNG) so the same settings always give the same picture.
 * Self-contained; looks for #retrylab on the page.
 */
(function () {
  'use strict';

  const root = document.getElementById('retrylab');
  if (!root) return;
  const $ = function (sel) { return root.querySelector(sel); };

  const N = 1000;            // messages that fail at t ≈ 0
  const MAX_ATTEMPTS = 7;    // then dead-letter
  const SPAN = 100;          // seconds shown on the chart
  const BASE = 1;            // seconds
  const CAP = 30;            // max backoff, seconds

  /** Small seeded PRNG (mulberry32), so runs are reproducible. */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Delay before attempt number `next` (2, 3, …). */
  const strategies = {
    immediate: {
      name: 'Immediate',
      desc: 'Retry 200 ms after every failure. Feels responsive; in an outage it burns all 7 attempts in about a second.',
      delay: function () { return 0.2; },
    },
    fixed: {
      name: 'Fixed 2 s',
      desc: 'Retry every 2 seconds. Every message that failed together stays in lockstep, so each retry is a synchronised wave.',
      delay: function () { return 2; },
    },
    expo: {
      name: 'Exponential',
      desc: 'Wait 1, 2, 4, 8, 16, 30 s. Far fewer wasted calls — but the waves are still synchronised, and each lands on the provider all at once.',
      delay: function (next) { return Math.min(CAP, BASE * Math.pow(2, next - 2)); },
    },
    jitter: {
      name: 'Exponential + jitter',
      desc: '“Full jitter”: wait a random time between 0 and the exponential delay. Same average back-off, but retries are smeared out, so the recovering provider sees a steady stream.',
      delay: function (next, rand) { return rand() * Math.min(CAP, BASE * Math.pow(2, next - 2)); },
    },
  };

  /**
   * Discrete simulation in 1-second buckets.
   * During the outage every attempt fails. Afterwards each second accepts at most
   * `capacity` attempts (earliest first); the rest are rejected with 429 and retry.
   */
  function simulate(strategy, outage, capacity) {
    const rand = rng(42);
    const buckets = [];
    for (let s = 0; s < SPAN + 60; s++) buckets.push([]);
    for (let i = 0; i < N; i++) buckets[0].push({ t: rand(), attempt: 1 });

    const ok = new Array(SPAN).fill(0), no = new Array(SPAN).fill(0);
    let delivered = 0, dead = 0, attempts = 0, last = 0;

    for (let s = 0; s < buckets.length; s++) {
      const list = buckets[s].sort(function (a, b) { return a.t - b.t; });
      let accepted = 0;
      for (let k = 0; k < list.length; k++) {
        const m = list[k];
        attempts++;
        const success = m.t >= outage && accepted < capacity;
        if (success) {
          accepted++; delivered++; last = m.t;
          if (s < SPAN) ok[s]++;
          continue;
        }
        if (s < SPAN) no[s]++;
        if (m.attempt >= MAX_ATTEMPTS) { dead++; continue; }
        const next = m.attempt + 1;
        const t = m.t + strategy.delay(next, rand);
        const b = Math.floor(t);
        if (b < buckets.length) buckets[b].push({ t: t, attempt: next });
        else dead++;                       // beyond the simulated horizon: treat as given up
      }
    }
    // Peak load the provider sees once it is back up — the number that decides whether it stays up.
    let peak = 0;
    for (let s = Math.ceil(outage); s < SPAN; s++) peak = Math.max(peak, ok[s] + no[s]);
    return { ok: ok, no: no, delivered: delivered, dead: dead, attempts: attempts, peak: peak, last: last };
  }

  /* ---------- rendering ---------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const chart = $('.rl-chart');
  const H = 200, W = 1000, BW = W / SPAN;

  function el(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    chart.appendChild(e);
    return e;
  }

  let current = 'jitter';
  const outageInput = $('[data-rl="outage"]');
  const capInput = $('[data-rl="cap"]');

  function render() {
    const strategy = strategies[current];
    const outage = Number(outageInput.value);
    const capacity = Number(capInput.value);
    const r = simulate(strategy, outage, capacity);

    // Fixed y-scale per capacity so strategies can be compared by eye; tall spikes are clipped and labelled.
    const yMax = Math.max(capacity * 4, 50);
    chart.textContent = '';
    el('rect', { x: 0, y: 0, width: (outage / SPAN) * W, height: H, class: 'rl-outage' });
    for (let s = 0; s < SPAN; s++) {
      const okH = Math.min(H, (r.ok[s] / yMax) * H);
      const noH = Math.min(H - okH, (r.no[s] / yMax) * H);
      if (okH > 0) el('rect', { x: s * BW + 1, y: H - okH, width: BW - 2, height: okH, class: 'rl-ok' });
      if (noH > 0) el('rect', { x: s * BW + 1, y: H - okH - noH, width: BW - 2, height: noH, class: 'rl-no' });
      if (r.ok[s] + r.no[s] > yMax) el('rect', { x: s * BW + 1, y: 0, width: BW - 2, height: 4, class: 'rl-clip' });
    }
    const capY = H - (capacity / yMax) * H;
    el('line', { x1: 0, x2: W, y1: capY, y2: capY, class: 'rl-cap' });

    $('.rl-outage-label').style.width = (outage / SPAN) * 100 + '%';
    $('.rl-outage-label').textContent = 'down ' + outage + ' s';
    $('.rl-cap-label').style.bottom = (capacity / yMax) * 100 + '%';
    $('.rl-cap-label').textContent = 'capacity ' + capacity + '/s';
    $('.rl-ymax').textContent = yMax + '/s';

    $('[data-out="outage"]').textContent = outage + ' s';
    $('[data-out="cap"]').textContent = capacity + ' / s';
    $('[data-out="delivered"]').textContent = r.delivered.toLocaleString() + ' / ' + N.toLocaleString();
    $('[data-out="dead"]').textContent = r.dead.toLocaleString();
    $('[data-out="dead"]').classList.toggle('is-bad', r.dead > 0);
    $('[data-out="attempts"]').textContent = r.attempts.toLocaleString();
    $('[data-out="peak"]').textContent = r.peak.toLocaleString() + ' / s';
    $('[data-out="peak"]').classList.toggle('is-bad', r.peak > capacity * 2);
    $('[data-out="last"]').textContent = r.delivered ? r.last.toFixed(1) + ' s' : '—';
    $('.rl-desc').innerHTML = '<b>' + strategy.name + '.</b> ' + strategy.desc;

    root.querySelectorAll('.sim-tab').forEach(function (tab) {
      tab.setAttribute('aria-selected', tab.dataset.strategy === current ? 'true' : 'false');
    });
  }

  root.querySelectorAll('.sim-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { current = tab.dataset.strategy; render(); });
  });
  outageInput.addEventListener('input', render);
  capInput.addEventListener('input', render);
  render();
})();
