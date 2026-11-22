/*
 * Short-code lab for the URL Shortener page.
 *  1. Capacity calculator: key length × creation rate → keyspace, years to exhaust,
 *     and how often random/hash codes would collide.
 *  2. Encoder: the same long URL through three code-generation strategies
 *     (counter + base62, scrambled counter, truncated hash).
 * Self-contained; looks for #lab on the page. Uses BigInt (62^9 > 2^53).
 */
(function () {
  'use strict';

  const root = document.getElementById('lab');
  if (!root) return;
  const $ = function (sel) { return root.querySelector(sel); };

  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const B62 = 62n;

  /* ---------- helpers ---------- */

  /** Base62-encode a non-negative BigInt, left-padded to `len` characters. Also returns the division steps. */
  function base62(n, len) {
    const steps = [];
    let s = '';
    let x = n;
    do {
      const q = x / B62, r = x % B62;
      steps.push({ x: x, q: q, r: r, ch: ALPHABET[Number(r)] });
      s = ALPHABET[Number(r)] + s;
      x = q;
    } while (x > 0n);
    return { code: s.padStart(len, '0'), steps: steps };
  }

  /** 64-bit FNV-1a over the UTF-8 bytes. A stand-in for MD5 / SHA-256: same lesson, no async crypto API needed. */
  function fnv1a64(str) {
    let h = 0xcbf29ce484222325n;
    const bytes = new TextEncoder().encode(str);
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]);
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h;
  }

  /** Human formatting for big numbers: 3.52 trillion, 182 billion … */
  function human(n) {
    const units = [[1e15, 'quadrillion'], [1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
    for (let i = 0; i < units.length; i++) {
      if (n >= units[i][0]) return (n / units[i][0]).toPrecision(3).replace(/\.?0+$/, '') + ' ' + units[i][1];
    }
    return String(Math.round(n));
  }

  function pct(p) {
    if (p >= 0.9995) return '≈ 100%';
    if (p < 1e-6) return '< 0.0001%';
    return (p * 100).toPrecision(2) + '%';
  }

  /* ---------- 1. capacity calculator ---------- */

  const lenInput = $('[data-lab="len"]');
  const rateInput = $('[data-lab="rate"]');

  function renderCapacity() {
    const len = Number(lenInput.value);
    const perDay = Number(rateInput.value);
    const space = Math.pow(62, len);
    const fiveYears = perDay * 365 * 5;
    const years = space / (perDay * 365);
    // Probability that ONE new random code hits an existing one, after 5 years of links.
    const pNext = Math.min(1, fiveYears / space);
    // Expected number of colliding pairs among all 5-year codes (birthday approximation).
    const pairs = (fiveYears * fiveYears) / (2 * space);

    $('[data-out="len"]').textContent = len + ' chars';
    $('[data-out="space"]').textContent = human(space);
    $('[data-out="years"]').textContent = years > 1e6 ? '> 1 million years' : years >= 100 ? Math.round(years).toLocaleString() + ' years' : years.toPrecision(2) + ' years';
    $('[data-out="years"]').classList.toggle('is-bad', years < 10);
    $('[data-out="used"]').textContent = pct(Math.min(1, fiveYears / space));
    $('[data-out="pnext"]').textContent = pct(pNext);
    $('[data-out="pairs"]').textContent = pairs < 1 ? '< 1' : human(pairs);
    $('[data-out="verdict"]').innerHTML = years < 10
      ? '<b>Too short.</b> The counter runs out in under a decade — add a character.'
      : pNext > 0.01
        ? 'A counter is fine for decades, but <b>random or hashed codes would collide on more than 1 in 100 inserts</b> by year five — each one a retry.'
        : 'Plenty of room either way. Random or hashed codes would rarely collide, but every insert still needs a check.';
  }

  /* ---------- 2. encoder ---------- */

  let counter = 125000000000n;           // pretend we are well into the service's life
  const SCRAMBLE = 3010349n;             // odd and not a multiple of 31 → invertible mod 62^k

  const urlInput = $('[data-lab="url"]');

  function renderEncoder(advance) {
    const len = Number(lenInput.value);
    const space = B62 ** BigInt(len);
    if (advance) counter += 1n;
    const id = counter % space;

    const seq = base62(id, len);
    const scrambled = base62((id * SCRAMBLE) % space, len);
    const url = urlInput.value.trim() || 'https://example.com/';
    const h = fnv1a64(url);
    const hashed = base62(h % space, len);

    $('[data-out="id"]').textContent = id.toLocaleString();
    $('[data-out="seq"]').textContent = seq.code;
    $('[data-out="scr"]').textContent = scrambled.code;
    $('[data-out="hash"]').textContent = hashed.code;
    $('[data-out="hashhex"]').textContent = '0x' + h.toString(16).padStart(16, '0');
    $('[data-out="steps"]').innerHTML = seq.steps.map(function (s) {
      return '<li><span>' + s.x.toLocaleString() + ' ÷ 62</span><span>= ' + s.q.toLocaleString() + ' r <b>' + s.r + '</b></span><code>' + s.ch + '</code></li>';
    }).join('') + '<li class="lab-read">read remainders bottom → top: <code>' + seq.code.replace(/^0+(?=.)/, '') + '</code>' + (seq.code.length > seq.code.replace(/^0+(?=.)/, '').length ? ', padded to ' + len : '') + '</li>';
  }

  /* ---------- wiring ---------- */

  lenInput.addEventListener('input', function () { renderCapacity(); renderEncoder(false); });
  rateInput.addEventListener('change', renderCapacity);
  urlInput.addEventListener('input', function () { renderEncoder(false); });
  $('[data-lab="shorten"]').addEventListener('click', function () { renderEncoder(true); });

  renderCapacity();
  renderEncoder(false);
})();
