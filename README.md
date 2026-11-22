# System Design Visualized

Animated, interactive system design walkthroughs for SDE-2 backend interview prep.
Each page follows one request through an architecture step by step: what each component
does, what it stores, and the tradeoff you would be asked to defend.

**Live site: https://maruthi-teja.github.io/system-design-visualized/**

## Pages

| Page | Type | Status |
| --- | --- | --- |
| [Ad-Serving / Real-Time Bidding (RTB) System](https://maruthi-teja.github.io/system-design-visualized/designs/rtb.html) | HLD | Live |
| [Rate Limiter](https://maruthi-teja.github.io/system-design-visualized/designs/rate-limiter.html) | LLD | Live |
| [URL Shortener](https://maruthi-teja.github.io/system-design-visualized/designs/url-shortener.html) | HLD | Live |
| Notification System | HLD | Coming soon |
| Parking Lot | LLD | Coming soon |
| Chat / Messaging System | HLD | Coming soon |
| News Feed | HLD | Coming soon |
| Distributed Cache | HLD | Coming soon |
| LRU Cache | LLD | Coming soon |

The URL Shortener page has estimation, a short-code lab (code length vs capacity and
collision odds; counter, scrambled-counter and hash codes for any URL), a 13-step walkthrough
of the write path, redirect path, a viral hot-key failure and async analytics/expiry, plus
data model, API, scaling, failure modes and ten interviewer follow-ups.

The Rate Limiter page has a live playground comparing token bucket, fixed window and
sliding window counter, an 11-step class walkthrough (allowed, denied, store down), class
design, Java and Redis Lua sketches, concurrency notes and ten interviewer follow-ups.

The RTB page covers requirements, back-of-envelope estimation, an 18-step animated
architecture walkthrough with a latency budget bar, a deep dive (data model, OpenRTB
request/response examples, scaling and failure modes) and ten interviewer follow-ups
with model answers. It uses only public, generic knowledge (OpenRTB 2.x); numbers are
illustrative.

## Run locally

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/Maruthi-Teja/system-design-visualized.git
```

```bash
cd system-design-visualized && python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk also works;
only the offline cache (service worker) needs a server.

Controls: `←` / `→` step, `Space` auto-play, `Home` / `End` first / last step, or click
any component in the diagram.

## Structure

```
index.html              landing page
designs/rtb.html        RTB page (content)
designs/rtb.config.js   RTB diagram: nodes, edges, steps (pure data)
designs/rate-limiter.html        Rate Limiter page (content)
designs/rate-limiter.config.js   Rate Limiter diagram (pure data)
designs/rate-limiter.sim.js      algorithm playground
designs/url-shortener.html       URL Shortener page (content)
designs/url-shortener.config.js  URL Shortener diagram (pure data)
designs/url-shortener.lab.js     short-code lab
assets/style.css        shared styles, dark + light themes
assets/engine.js        reusable step-through animation engine
sw.js                   offline cache (network-first)
.github/workflows/pages.yml   GitHub Pages deploy
```

## Adding a new walkthrough

1. Copy `designs/rtb.html` and replace the content sections.
2. Write a config file describing `nodes`, `edges` and `steps` (the schema is documented
   at the top of `assets/engine.js`).
3. Mount it: `SDV.mount(document.getElementById('walkthrough'), config)`.
4. Add a card to `index.html` and the new files to `PRECACHE` in `sw.js`.

The engine draws the SVG, animates packets along edges, highlights active components,
fills the budget bar, and handles keyboard, touch, reduced motion and small screens.
