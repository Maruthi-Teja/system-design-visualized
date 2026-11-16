/*!
 * system-design-visualized — step-through animation engine
 * ---------------------------------------------------------------------------
 * A page describes its diagram as plain data and calls:
 *
 *   SDV.mount(document.getElementById('walkthrough'), {
 *     viewBox: [960, 610],
 *     budget:  { label: 'Latency budget', total: 100, unit: 'ms' },   // optional
 *     groups:  [{ id, label, x, y, w, h }],
 *     nodes:   [{ id, label, sub, x, y, w, h, kind }],  // kind: service|store|client|queue|external
 *     edges:   [{ id, from, to, fromSide, toSide, fromOffset, toOffset, via: [[x,y]], label, dashed }],
 *     steps:   [{
 *       title, phase, async,              // async: true => styled as "off the hot path"
 *       active: [nodeId],                 // highlighted components
 *       fail:   [nodeId],                 // components drawn as failed / timed out
 *       packets: [{ edge, reverse, delay, tone }],  // tone: 'accent' | 'money' | 'async' | 'danger'
 *       budget, budgetNote,               // cumulative value on the budget bar
 *       what,                             // HTML string: what happens
 *       data:      [HTML string],         // key data stored / read
 *       tradeoffs: [{ title, body }],     // 1–2 tradeoffs
 *     }],
 *   });
 *
 * The engine renders the SVG, controls, timeline, budget bar and side panel,
 * and handles keyboard (← → Home End, Space = auto-play), reduced motion,
 * and small screens (the canvas scrolls and follows the active component).
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let mountCount = 0;

  /* ---------- tiny DOM helpers ---------- */

  function svg(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function html(tag, cls, parent, content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content != null) el.innerHTML = content;
    if (parent) parent.appendChild(el);
    return el;
  }

  /* ---------- geometry ---------- */

  /** Point on the border of a node, on the given side, shifted by `offset` along that side. */
  function anchor(n, side, offset) {
    const o = offset || 0;
    switch (side) {
      case 'top':    return [n.x + n.w / 2 + o, n.y];
      case 'bottom': return [n.x + n.w / 2 + o, n.y + n.h];
      case 'left':   return [n.x, n.y + n.h / 2 + o];
      default:       return [n.x + n.w, n.y + n.h / 2 + o];
    }
  }

  /** Pick sensible sides when the config doesn't specify them. */
  function autoSides(a, b) {
    const dx = b.x + b.w / 2 - (a.x + a.w / 2);
    const dy = b.y + b.h / 2 - (a.y + a.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  /** Polyline through `pts` with corners rounded by radius `r`, as an SVG path string. */
  function roundedPath(pts, r) {
    let d = 'M' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i - 1], c = pts[i], n = pts[i + 1];
      const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]);
      const l2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const a = [c[0] - ((c[0] - p[0]) / l1) * rr, c[1] - ((c[1] - p[1]) / l1) * rr];
      const b = [c[0] + ((n[0] - c[0]) / l2) * rr, c[1] + ((n[1] - c[1]) / l2) * rr];
      d += ' L' + a[0] + ',' + a[1] + ' Q' + c[0] + ',' + c[1] + ' ' + b[0] + ',' + b[1];
    }
    const last = pts[pts.length - 1];
    return d + ' L' + last[0] + ',' + last[1];
  }

  /** Outline for a node, by kind. Data stores are drawn as cylinders. */
  function nodeShape(n, parent) {
    if (n.kind === 'store') {
      const ry = 6, x = n.x, y = n.y, w = n.w, h = n.h;
      svg('path', {
        class: 'sdv-node-box',
        d: `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} ` +
           `A${w / 2},${ry} 0 0 1 ${x},${y + h - ry} Z`,
      }, parent);
      svg('path', {
        class: 'sdv-node-lid',
        d: `M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`,
      }, parent);
    } else {
      svg('rect', { class: 'sdv-node-box', x: n.x, y: n.y, width: n.w, height: n.h, rx: 10 }, parent);
    }
  }

  /* ---------- the engine ---------- */

  function mount(root, config) {
    const uid = 'sdv' + ++mountCount;
    const [VW, VH] = config.viewBox || [960, 600];
    const nodes = {}, edges = {};
    const steps = config.steps;
    let current = -1;
    let autoTimer = null;
    let rafId = 0;

    root.classList.add('sdv');
    root.innerHTML = '';

    /* --- budget bar (optional) --- */
    let budgetEl = null;
    if (config.budget) {
      budgetEl = html('div', 'sdv-budget', root);
      budgetEl.innerHTML =
        '<div class="sdv-budget-head">' +
          '<span class="sdv-budget-label">' + config.budget.label + '</span>' +
          '<span class="sdv-budget-note"></span>' +
          '<span class="sdv-budget-readout"></span>' +
        '</div>' +
        '<div class="sdv-budget-track" role="progressbar" aria-valuemin="0" aria-valuemax="' + config.budget.total + '">' +
          '<div class="sdv-budget-fill"></div>' +
          '<div class="sdv-budget-ticks">' +
            [0, 25, 50, 75, 100].map(function (p) {
              return '<span style="left:' + p + '%"><i>' + +((config.budget.total * p) / 100).toFixed(2) + '</i></span>';
            }).join('') +
          '</div>' +
        '</div>';
    }

    const main = html('div', 'sdv-main', root);
    const stage = html('div', 'sdv-stage', main);
    const canvas = html('div', 'sdv-canvas', stage);
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Architecture diagram. Use left and right arrow keys to step through.');

    /* --- SVG scaffold --- */
    const svgEl = svg('svg', {
      viewBox: '0 0 ' + VW + ' ' + VH,
      class: 'sdv-svg',
      role: 'img',
      'aria-label': config.title || 'Architecture diagram',
    }, canvas);
    svgEl.style.setProperty('--sdv-ratio', VW / VH);

    // Arrowheads: one marker per edge state, so they can be coloured with CSS.
    const defs = svg('defs', {}, svgEl);
    ['idle', 'done', 'active'].forEach(function (state) {
      const m = svg('marker', {
        id: uid + '-arrow-' + state, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
      }, defs);
      svg('path', { d: 'M1,1.5 L9,5 L1,8.5 Z', class: 'sdv-arrow sdv-arrow-' + state }, m);
    });

    const gGroups = svg('g', {}, svgEl);
    const gEdges = svg('g', {}, svgEl);
    const gNodes = svg('g', {}, svgEl);
    const gPackets = svg('g', { class: 'sdv-packets', 'aria-hidden': 'true' }, svgEl);

    /* --- groups (dashed containers) --- */
    (config.groups || []).forEach(function (g) {
      const el = svg('g', { class: 'sdv-group' }, gGroups);
      svg('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 16 }, el);
      svg('text', { x: g.x + 16, y: g.y + 22 }, el).textContent = g.label;
    });

    /* --- nodes --- */
    config.nodes.forEach(function (n) {
      n.w = n.w || 120; n.h = n.h || 52;
      const el = svg('g', { class: 'sdv-node sdv-kind-' + (n.kind || 'service'), 'data-id': n.id }, gNodes);
      svg('rect', { class: 'sdv-node-glow', x: n.x - 5, y: n.y - 5, width: n.w + 10, height: n.h + 10, rx: 14 }, el);
      nodeShape(n, el);
      const cy = n.y + n.h / 2 + (n.kind === 'store' ? 3 : 0);
      svg('text', { class: 'sdv-node-title', x: n.x + n.w / 2, y: cy + (n.sub ? -3 : 4.5) }, el).textContent = n.label;
      if (n.sub) svg('text', { class: 'sdv-node-sub', x: n.x + n.w / 2, y: cy + 13 }, el).textContent = n.sub;
      svg('title', {}, el).textContent = n.label + (n.sub ? ' — ' + n.sub : '');
      // Clicking a component jumps to the first step that features it.
      el.addEventListener('click', function () {
        const i = steps.findIndex(function (s) { return (s.active || []).indexOf(n.id) !== -1; });
        if (i !== -1) { stopAuto(); go(i); }
      });
      nodes[n.id] = { cfg: n, el: el };
    });

    /* --- edges --- */
    config.edges.forEach(function (e) {
      const a = nodes[e.from].cfg, b = nodes[e.to].cfg;
      const auto = autoSides(a, b);
      const pts = [anchor(a, e.fromSide || auto[0], e.fromOffset)]
        .concat(e.via || [])
        .concat([anchor(b, e.toSide || auto[1], e.toOffset)]);
      const el = svg('g', { class: 'sdv-edge' + (e.dashed ? ' is-dashed' : ''), 'data-id': e.id }, gEdges);
      const path = svg('path', { d: roundedPath(pts, 10), class: 'sdv-edge-line' }, el);
      if (e.label) {
        // Label sits at the middle of the longest segment.
        let best = 0, bi = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
          if (len > best) { best = len; bi = i; }
        }
        svg('text', {
          class: 'sdv-edge-label',
          x: (pts[bi][0] + pts[bi + 1][0]) / 2,
          y: (pts[bi][1] + pts[bi + 1][1]) / 2 - 7,
        }, el).textContent = e.label;
      }
      edges[e.id] = { cfg: e, el: el, path: path, length: path.getTotalLength() };
    });

    /* --- controls --- */
    const controls = html('div', 'sdv-controls', stage);
    const btnRestart = html('button', 'sdv-btn sdv-btn-ghost', controls, '<span aria-hidden="true">⏮</span><span class="sdv-btn-text">Restart</span>');
    const btnPrev = html('button', 'sdv-btn', controls, '<span aria-hidden="true">←</span> Prev');
    const btnAuto = html('button', 'sdv-btn sdv-btn-ghost', controls);
    const btnNext = html('button', 'sdv-btn sdv-btn-primary', controls, 'Next <span aria-hidden="true">→</span>');
    const counter = html('span', 'sdv-counter', controls);
    html('span', 'sdv-hint', controls, '<kbd>←</kbd> <kbd>→</kbd> step · <kbd>Space</kbd> auto-play');
    [btnRestart, btnPrev, btnAuto, btnNext].forEach(function (b) { b.type = 'button'; });
    btnRestart.setAttribute('aria-label', 'Restart from step 1');

    /* --- timeline (one dot per step) --- */
    const timeline = html('ol', 'sdv-timeline', stage);
    const dots = steps.map(function (s, i) {
      const li = html('li', '', timeline);
      const b = html('button', 'sdv-dot' + (s.async ? ' is-async' : ''), li, String(i + 1));
      b.type = 'button';
      b.title = s.title;
      b.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + s.title);
      b.addEventListener('click', function () { stopAuto(); go(i); });
      return b;
    });

    /* --- side panel --- */
    const panel = html('aside', 'sdv-panel', main);
    panel.setAttribute('aria-live', 'polite');

    /* ---------- rendering a step ---------- */

    function renderPanel(s, i) {
      let out =
        '<div class="sdv-panel-head">' +
          '<span class="sdv-step-num">' + String(i + 1).padStart(2, '0') + '</span>' +
          (s.phase ? '<span class="sdv-phase' + (s.async ? ' is-async' : '') + '">' + s.phase + '</span>' : '') +
        '</div>' +
        '<h3 class="sdv-panel-title">' + s.title + '</h3>' +
        '<section><h4>What happens</h4><div class="sdv-what">' + s.what + '</div></section>';
      if (s.data && s.data.length) {
        out += '<section><h4>Key data</h4><ul class="sdv-data">' +
          s.data.map(function (d) { return '<li>' + d + '</li>'; }).join('') + '</ul></section>';
      }
      if (s.tradeoffs && s.tradeoffs.length) {
        out += '<section><h4>Tradeoffs</h4>' +
          s.tradeoffs.map(function (t) {
            return '<div class="sdv-tradeoff"><strong>' + t.title + '</strong><p>' + t.body + '</p></div>';
          }).join('') + '</section>';
      }
      panel.innerHTML = out;
      // Restart the fade-in animation.
      panel.classList.remove('is-entering');
      void panel.offsetWidth;
      panel.classList.add('is-entering');
    }

    function renderBudget(s, prev) {
      if (!budgetEl) return;
      const total = config.budget.total, unit = config.budget.unit || '';
      const value = s.budget != null ? s.budget : 0;
      const frac = Math.min(1, value / total);
      const fill = budgetEl.querySelector('.sdv-budget-fill');
      fill.style.transform = 'scaleX(' + frac + ')';
      budgetEl.classList.toggle('is-warn', frac >= 0.7);
      budgetEl.classList.toggle('is-off', !!s.async);
      budgetEl.querySelector('.sdv-budget-track').setAttribute('aria-valuenow', value);
      // Rounded so fractional budgets (e.g. 0.3 ms) don't show float noise; only increases are shown.
      const rawDelta = prev && prev.budget != null && !s.async ? +(value - prev.budget).toFixed(2) : 0;
      const delta = rawDelta > 0 ? rawDelta : null;
      budgetEl.querySelector('.sdv-budget-readout').innerHTML =
        '<b>' + value + '</b> / ' + total + ' ' + unit;
      budgetEl.querySelector('.sdv-budget-note').innerHTML =
        (delta ? '<span class="sdv-delta">+' + delta + ' ' + unit + '</span> ' : '') + (s.budgetNote || '');
    }

    function go(i) {
      i = Math.max(0, Math.min(steps.length - 1, i));
      if (i === current) return;
      const s = steps[i];
      current = i;

      // Everything touched by earlier steps is "done"; this step's parts are "active".
      const doneNodes = {}, doneEdges = {};
      for (let k = 0; k < i; k++) {
        (steps[k].active || []).forEach(function (id) { doneNodes[id] = 1; });
        (steps[k].packets || []).forEach(function (p) { doneEdges[p.edge] = 1; });
      }
      const activeEdges = {};
      (s.packets || []).forEach(function (p) { activeEdges[p.edge] = p; });

      for (const id in nodes) {
        const cl = nodes[id].el.classList;
        cl.toggle('is-active', (s.active || []).indexOf(id) !== -1);
        cl.toggle('is-done', !!doneNodes[id]);
        cl.toggle('is-fail', (s.fail || []).indexOf(id) !== -1);
        cl.toggle('is-async', !!s.async);
      }
      for (const id in edges) {
        const e = edges[id], p = activeEdges[id];
        const state = p ? 'active' : doneEdges[id] ? 'done' : 'idle';
        e.el.classList.toggle('is-active', state === 'active');
        e.el.classList.toggle('is-done', state === 'done');
        e.el.classList.toggle('is-reverse', !!(p && p.reverse));
        e.el.setAttribute('data-tone', (p && p.tone) || (s.async ? 'async' : 'accent'));
        // Arrowhead follows the direction of travel in this step.
        const url = 'url(#' + uid + '-arrow-' + state + ')';
        e.path.style.markerEnd = p && p.reverse ? 'none' : url;
        e.path.style.markerStart = p && p.reverse ? url : 'none';
      }

      dots.forEach(function (d, k) {
        d.classList.toggle('is-current', k === i);
        d.classList.toggle('is-past', k < i);
        if (k === i) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
      });
      counter.innerHTML = 'Step <b>' + (i + 1) + '</b> / ' + steps.length;
      btnPrev.disabled = i === 0;
      btnNext.disabled = i === steps.length - 1;

      renderPanel(s, i);
      renderBudget(s, steps[i - 1]);
      followActive(s);
      runPackets(s);
    }

    /** On narrow screens the canvas scrolls horizontally: keep the active component in view. */
    function followActive(s) {
      if (canvas.scrollWidth <= canvas.clientWidth + 2 || !(s.active || []).length) return;
      const n = nodes[s.active[0]].cfg;
      const scale = svgEl.getBoundingClientRect().width / VW;
      const target = (n.x + n.w / 2) * scale - canvas.clientWidth / 2;
      canvas.scrollTo({ left: Math.max(0, target), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }

    /* ---------- packet animation ---------- */

    /**
     * Animates one "packet" (a dot with a short trail) along each edge in the step,
     * then loops after a pause so the flow stays visible while the reader reads.
     * Runs on requestAnimationFrame and only touches transforms, so it stays at 60fps.
     */
    function runPackets(s) {
      cancelAnimationFrame(rafId);
      gPackets.textContent = '';
      if (reducedMotion.matches || !(s.packets || []).length) return;

      const TRAIL = [0, 0.045, 0.09]; // how far behind the head each trail dot sits (fraction of path)
      const items = s.packets.map(function (p) {
        const e = edges[p.edge];
        const g = svg('g', { class: 'sdv-packet', 'data-tone': p.tone || (s.async ? 'async' : 'accent') }, gPackets);
        const dotEls = TRAIL.map(function (_, k) {
          return svg('circle', { r: k === 0 ? 5 : 4 - k, class: k === 0 ? 'sdv-packet-head' : 'sdv-packet-tail' }, g);
        });
        svg('circle', { r: 10, class: 'sdv-packet-halo' }, g);
        return {
          e: e, g: g, dots: dotEls, halo: g.lastChild,
          reverse: !!p.reverse,
          delay: p.delay || 0,
          dur: Math.max(520, Math.min(1300, e.length * 2.6)),
        };
      });
      const cycle = Math.max.apply(null, items.map(function (it) { return it.delay + it.dur; })) + 900;
      const ease = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
      let start = performance.now();

      function frame(now) {
        let elapsed = now - start;
        if (elapsed > cycle) { start = now; elapsed = 0; }
        items.forEach(function (it) {
          const t = (elapsed - it.delay) / it.dur;
          if (t < 0 || t > 1) { it.g.style.opacity = 0; return; }
          it.g.style.opacity = t > 0.92 ? (1 - t) / 0.08 : 1;
          it.dots.forEach(function (dot, k) {
            let f = ease(Math.max(0, t - TRAIL[k]));
            if (it.reverse) f = 1 - f;
            const pt = it.e.path.getPointAtLength(f * it.e.length);
            dot.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
            if (k === 0) it.halo.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
          });
        });
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    }

    /* ---------- auto-play ---------- */

    function setAutoLabel(playing) {
      btnAuto.innerHTML = playing
        ? '<span aria-hidden="true">❚❚</span> Pause'
        : '<span aria-hidden="true">▶</span> Auto-play';
      btnAuto.setAttribute('aria-pressed', playing ? 'true' : 'false');
      root.classList.toggle('is-playing', playing);
    }

    function stopAuto() {
      clearInterval(autoTimer);
      autoTimer = null;
      setAutoLabel(false);
    }

    function startAuto() {
      if (current >= steps.length - 1) go(0);
      setAutoLabel(true);
      autoTimer = setInterval(function () {
        if (current >= steps.length - 1) stopAuto(); else go(current + 1);
      }, config.autoPlayMs || 3800);
    }

    function toggleAuto() { if (autoTimer) stopAuto(); else startAuto(); }

    /* ---------- wiring ---------- */

    btnPrev.addEventListener('click', function () { stopAuto(); go(current - 1); });
    btnNext.addEventListener('click', function () { stopAuto(); go(current + 1); });
    btnRestart.addEventListener('click', function () { stopAuto(); go(0); });
    btnAuto.addEventListener('click', toggleAuto);

    // Keyboard: arrows work page-wide unless the user is typing or the diagram is far off-screen.
    document.addEventListener('keydown', function (ev) {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const t = ev.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const r = root.getBoundingClientRect();
      const visible = r.bottom > 0 && r.top < window.innerHeight;
      if (!visible) return;
      const inside = root.contains(t);
      if (ev.key === 'ArrowRight') { stopAuto(); go(current + 1); ev.preventDefault(); }
      else if (ev.key === 'ArrowLeft') { stopAuto(); go(current - 1); ev.preventDefault(); }
      else if (ev.key === 'Home' && inside) { stopAuto(); go(0); ev.preventDefault(); }
      else if (ev.key === 'End' && inside) { stopAuto(); go(steps.length - 1); ev.preventDefault(); }
      else if (ev.key === ' ' && (t === document.body || t === canvas)) { toggleAuto(); ev.preventDefault(); }
    });

    // If the user switches reduced-motion on/off mid-session, re-render the current step.
    const onMotionChange = function () { runPackets(steps[current]); };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);

    setAutoLabel(false);
    go(0);

    return { go: go, next: function () { go(current + 1); }, prev: function () { go(current - 1); },
             play: startAuto, pause: stopAuto, get step() { return current; } };
  }

  /* ---------- site chrome shared by every page ---------- */

  /** Dark / light toggle. The initial theme is set by a tiny inline script in <head> to avoid a flash. */
  function initTheme() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('sdv-theme', next); } catch (e) { /* private mode */ }
      });
    });
  }

  /** Minimal JSON syntax colouring for <pre><code class="json"> blocks. */
  function highlightJSON() {
    document.querySelectorAll('code.json').forEach(function (el) {
      const text = el.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      el.innerHTML = text.replace(
        /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)|(\/\/.*)/g,
        function (m, str, colon, lit, num, comment) {
          if (comment) return '<span class="tok-c">' + comment + '</span>';
          if (str) return '<span class="' + (colon ? 'tok-k' : 'tok-s') + '">' + str + '</span>' + (colon || '');
          if (lit) return '<span class="tok-l">' + lit + '</span>';
          return '<span class="tok-n">' + num + '</span>';
        }
      );
    });
  }

  /** Register the service worker (offline support). Its URL is resolved relative to this script. */
  function initOffline() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || !scriptSrc) return;
    navigator.serviceWorker.register(new URL('../sw.js', scriptSrc).href).catch(function () {});
  }

  const scriptSrc = document.currentScript && document.currentScript.src;

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    highlightJSON();
    initOffline();
  });

  window.SDV = { mount: mount };
})();
