/*
 * Walkthrough config: Ad-Serving / Real-Time Bidding (RTB) system.
 * Pure data — the shared engine (assets/engine.js) renders and animates it.
 * Coordinates are in viewBox units (960 x 610). See engine.js for the schema.
 */
window.RTB_CONFIG = {
  title: 'Real-time bidding architecture: request path and event pipeline',
  viewBox: [960, 610],
  autoPlayMs: 4200,
  budget: { label: 'Latency budget', total: 100, unit: 'ms' },

  groups: [
    { id: 'dsp', label: 'DSP A · bidder internals', x: 496, y: 14, w: 448, h: 286 },
  ],

  nodes: [
    // Request path (top row)
    { id: 'pub',      label: 'Publisher Page',  sub: 'browser / app SDK', x: 16,  y: 56,  kind: 'client' },
    { id: 'ssp',      label: 'SSP',             sub: 'supply-side',       x: 172, y: 56 },
    { id: 'exchange', label: 'Ad Exchange',     sub: 'auction engine',    x: 328, y: 56 },
    { id: 'dspB',     label: 'DSP B',           sub: 'bids in time',      x: 256, y: 180, w: 92, h: 44, kind: 'external' },
    { id: 'dspC',     label: 'DSP C',           sub: 'too slow',          x: 356, y: 180, w: 92, h: 44, kind: 'external' },

    // DSP internals
    { id: 'parser',   label: 'Request Parser',  sub: 'validate · dedup',  x: 510, y: 56,  w: 124 },
    { id: 'segments', label: 'Segment Lookup',  sub: 'user → segments',   x: 656, y: 56,  w: 124, kind: 'store' },
    { id: 'target',   label: 'Targeting Filter', sub: 'campaign match',   x: 802, y: 56,  w: 124 },
    { id: 'pacing',   label: 'Budget Pacing',   sub: 'token buckets',     x: 802, y: 200, w: 124 },
    { id: 'model',    label: 'Bid Price Model', sub: 'pCTR × value',      x: 656, y: 200, w: 124 },
    { id: 'tracker',  label: 'Win Tracker',     sub: 'nurl / burl',       x: 510, y: 200, w: 124 },

    // Event pipeline (bottom row)
    { id: 'collector', label: 'Event Collector', sub: 'imp / click beacons', x: 16,  y: 420 },
    { id: 'kafka',     label: 'Kafka',           sub: 'event log',           x: 172, y: 420, kind: 'queue' },
    { id: 'stream',    label: 'Stream Jobs',     sub: 'Flink / Spark',       x: 328, y: 420 },
    { id: 'druid',     label: 'OLAP Store',      sub: 'Druid rollups',       x: 510, y: 420, kind: 'store' },
    { id: 'reports',   label: 'Reporting',       sub: 'dashboards · billing', x: 690, y: 420, w: 128 },
    { id: 'lake',      label: 'Data Lake',       sub: 'raw events',          x: 172, y: 540, kind: 'store' },
  ],

  edges: [
    { id: 'pub-ssp',      from: 'pub', to: 'ssp' },
    { id: 'ssp-ex',       from: 'ssp', to: 'exchange' },
    { id: 'ex-parser',    from: 'exchange', to: 'parser', fromOffset: -14, toOffset: -14 },
    { id: 'ex-dspB',      from: 'exchange', to: 'dspB', fromSide: 'bottom', toSide: 'top', fromOffset: -30 },
    { id: 'ex-dspC',      from: 'exchange', to: 'dspC', fromSide: 'bottom', toSide: 'top', fromOffset: 30 },
    { id: 'parser-seg',   from: 'parser', to: 'segments' },
    { id: 'seg-target',   from: 'segments', to: 'target' },
    { id: 'target-pace',  from: 'target', to: 'pacing' },
    { id: 'pace-model',   from: 'pacing', to: 'model' },
    // Bid response loops back under the DSP row to the exchange.
    { id: 'model-ex',     from: 'model', to: 'exchange', fromSide: 'bottom', toSide: 'right', toOffset: 16,
      via: [[718, 278], [464, 278], [464, 98]], label: 'bid response' },
    { id: 'ex-tracker',   from: 'exchange', to: 'tracker', fromSide: 'right', toSide: 'left', fromOffset: 1,
      via: [[480, 83], [480, 226]], label: 'nurl' },
    { id: 'tracker-kafka', from: 'tracker', to: 'kafka', fromSide: 'bottom', toSide: 'top', toOffset: 24,
      via: [[572, 330], [256, 330]], dashed: true },
    { id: 'pub-collector', from: 'pub', to: 'collector', fromSide: 'bottom', toSide: 'top', label: 'beacons' },
    { id: 'collector-kafka', from: 'collector', to: 'kafka' },
    { id: 'kafka-stream', from: 'kafka', to: 'stream' },
    { id: 'kafka-lake',   from: 'kafka', to: 'lake', fromSide: 'bottom', toSide: 'top' },
    { id: 'stream-druid', from: 'stream', to: 'druid' },
    { id: 'druid-reports', from: 'druid', to: 'reports' },
    // Spend feedback closes the loop into the pacer.
    { id: 'stream-pacing', from: 'stream', to: 'pacing', fromSide: 'top', toSide: 'bottom',
      via: [[388, 366], [864, 366]], dashed: true, label: 'spend feedback' },
  ],

  steps: [
    /* ------------------------------ hot path ------------------------------ */
    {
      title: 'Page loads, ad slot asks for an ad',
      phase: 'Hot path',
      active: ['pub'],
      packets: [{ edge: 'pub-ssp' }],
      budget: 8, budgetNote: 'client → SSP network hop',
      what: '<p>The publisher’s page (or app SDK) hits an empty ad slot and calls the SSP’s ad tag with what it knows: page URL, slot sizes, device, consent string and a first-party / cookie ID.</p><p>The user is waiting on this — everything until the creative renders is on the clock.</p>',
      data: ['<code>slot_id</code>, sizes, page URL / app bundle', 'User agent, IP (→ geo), consent flags', 'Publisher-side user ID or cookie'],
      tradeoffs: [
        { title: 'Client-side vs server-side auction', body: 'Header bidding in the browser gives publishers transparency but burns the user’s CPU and network. Server-to-server moves the fan-out into a datacenter — faster, but cookie matching gets harder.' },
      ],
    },
    {
      title: 'SSP builds an OpenRTB bid request',
      phase: 'Hot path',
      active: ['ssp'],
      packets: [{ edge: 'ssp-ex' }],
      budget: 14, budgetNote: 'enrich + forward',
      what: '<p>The SSP represents the publisher. It enriches the raw ad call — geo from IP, device parsing, the publisher’s <b>floor price</b> and blocked advertiser categories — and emits a standard <b>OpenRTB 2.x</b> <code>BidRequest</code> to the exchange.</p>',
      data: ['<code>imp[]</code>: slot size, <code>bidfloor</code>, position', '<code>site</code>/<code>app</code>, <code>device</code>, <code>user</code>, <code>regs</code> (privacy)', 'Publisher rules: floors, <code>bcat</code>, <code>badv</code> block lists (in-memory, refreshed)'],
      tradeoffs: [
        { title: 'Rich request vs small request', body: 'More signals mean better bids, but a 2–4 KB JSON body × 1M QPS is real bandwidth and parse cost. Compress (gzip), drop empty fields, or negotiate a binary encoding with high-volume partners.' },
      ],
    },
    {
      title: 'Exchange pre-filters, then fans out to DSPs',
      phase: 'Hot path',
      active: ['exchange', 'dspB', 'dspC'],
      packets: [{ edge: 'ex-parser' }, { edge: 'ex-dspB', delay: 80 }, { edge: 'ex-dspC', delay: 160 }],
      budget: 20, budgetNote: 'fan-out with tmax attached',
      what: '<p>The exchange runs a cheap <b>inline fraud / bot pre-filter</b> (datacenter IPs, known-bad user agents, block lists), then picks which DSPs should see this request and sends it to all of them <b>in parallel</b> with a deadline: <code>tmax</code>.</p><p>It doesn’t send everything to everyone — each DSP has a QPS cap and declared interests (geo, format), so the exchange throttles to what each buyer is likely to bid on.</p>',
      data: ['Per-DSP config: endpoint, QPS cap, filters, timeout stats', '<code>tmax</code> (e.g. 80 ms), <code>at: 1</code> (first-price)', 'Auction context held in memory, keyed by request <code>id</code>'],
      tradeoffs: [
        { title: 'Fraud filtering: inline vs async', body: 'Inline checks must fit in ~1 ms, so only cheap list / rule lookups run here. Heavy ML detection runs asynchronously on the event stream and feeds back as block lists and refunds — you trade catching less up-front for not blowing the latency budget.' },
        { title: 'Fan-out width', body: 'More DSPs → more competition and revenue, but outbound QPS multiplies (1M in × 10 DSPs = 10M out). Selective call-out cuts cost at the risk of skipping a would-be winner.' },
      ],
    },
    {
      title: 'DSP parses and validates the request',
      phase: 'Hot path · DSP',
      active: ['parser'],
      packets: [],
      budget: 27, budgetNote: 'network to DSP + parse',
      what: '<p>Inside the DSP, a stateless bidder node terminates the keep-alive connection, parses the JSON, and rejects junk early: unsupported sizes, missing consent, blocked publishers, duplicate request IDs.</p><p>Early exit matters — the DSP will bid on only a few percent of requests, so the cheapest checks go first.</p>',
      data: ['Parsed request → compact internal struct (no JSON past this point)', 'Exchange user ID → DSP user ID (cookie-sync / ID-map table)', 'Publisher & domain block lists (in-memory)'],
      tradeoffs: [
        { title: 'Persistent connections & co-location', body: 'TLS handshakes cost more than the whole budget, so exchanges keep long-lived HTTP connection pools to bidders — and DSPs deploy bidders in the same region as each exchange. Cheaper compute elsewhere is not worth 30 ms of network.' },
      ],
    },
    {
      title: 'User segment lookup from cache',
      phase: 'Hot path · DSP',
      active: ['segments'],
      packets: [{ edge: 'parser-seg' }],
      budget: 31, budgetNote: 'single key-value read, p99 < 3 ms',
      what: '<p>The bidder fetches the user’s profile — audience segments, recent-activity flags, frequency-cap counters — with <b>one key-value read</b> by user ID. This is the only network call on the DSP’s hot path, so it gets a hard timeout of a few milliseconds.</p>',
      data: ['<code>user_id → { segments[], freq_caps{}, last_seen }</code>', '~1B profiles × ~200 B ≈ 200 GB per replica, sharded by user ID', 'TTL 30–90 days; written by an offline / streaming audience pipeline'],
      tradeoffs: [
        { title: 'Redis / Aerospike vs DynamoDB', body: 'In-memory Redis or SSD-backed Aerospike give sub-ms to ~1 ms reads if you run them yourself next to the bidders. A managed store like DynamoDB removes the ops burden but has higher, less predictable tail latency (single-digit ms) and per-request cost that hurts at 1M QPS.' },
        { title: 'Cache TTL & cold start', body: 'Long TTLs keep hit rates high but serve stale segments. On a miss or timeout, don’t wait: bid with contextual signals only (page, geo, device) or skip. A cold region is warmed by replaying profile snapshots before it takes traffic.' },
      ],
    },
    {
      title: 'Campaign targeting filter',
      phase: 'Hot path · DSP',
      active: ['target'],
      packets: [{ edge: 'seg-target' }],
      budget: 35, budgetNote: 'in-memory index, no I/O',
      what: '<p>Out of maybe 100K active line items, which are <i>eligible</i> for this impression? The bidder intersects the request’s attributes (geo, device, segments, size, time of day) against an <b>in-memory inverted index</b> of targeting rules, then applies frequency caps and brand-safety exclusions.</p><p>Typically a few dozen candidates survive.</p>',
      data: ['Inverted index: <code>attribute value → bitmap of line items</code>', 'Campaign / line item / creative snapshot, pushed to every bidder', 'Frequency caps from the profile fetched in the previous step'],
      tradeoffs: [
        { title: 'Local snapshot vs live DB', body: 'Reading campaigns from a database per request is impossible at this latency. Bidders hold a full in-memory copy refreshed every few seconds via a change stream. The price: a paused campaign may keep bidding for a few seconds.' },
      ],
    },
    {
      title: 'Budget pacing check',
      phase: 'Hot path · DSP',
      active: ['pacing'],
      packets: [{ edge: 'target-pace' }],
      budget: 37, budgetNote: 'local token bucket, ~µs',
      what: '<p>Each surviving line item must have budget left <i>and</i> be allowed to spend right now. Pacing spreads a daily budget across the day instead of burning it by 9 am.</p><p>The check is purely local: every bidder holds a <b>token bucket per line item</b>, refilled by a central pacing service that splits the remaining budget across bidders every few seconds.</p>',
      data: ['Local: <code>line_item_id → tokens, pacing_rate</code>', 'Central: <code>budget_total, spend_confirmed, spend_pending</code>', 'Refill allocations pushed every 1–5 s'],
      tradeoffs: [
        { title: 'Strong consistency vs overspend', body: 'A global atomic counter per bid would never overspend — and would add a network round-trip plus a hot-key bottleneck to every request. Local buckets with periodic sync are fast and bounded: worst-case overspend ≈ (bidders × allocation per sync window).' },
        { title: 'Bids are not spend', body: 'You pay only when you win and the impression renders, seconds later. So reserve budget at bid time and reconcile against real wins — otherwise you either overspend or under-deliver.' },
      ],
    },
    {
      title: 'Bid price model',
      phase: 'Hot path · DSP',
      active: ['model'],
      packets: [{ edge: 'pace-model' }],
      budget: 44, budgetNote: 'model inference for a few dozen candidates',
      what: '<p>For each candidate the bidder predicts the chance of a click or conversion and turns it into a price: roughly <code>bid = pCTR × value_per_click × pacing_multiplier</code>. It then picks the single best candidate.</p><p>Because the auction is first-price, the model also <b>shades</b> the bid — estimating the lowest price that would still win.</p>',
      data: ['Model weights loaded in-process (logistic regression / GBDT / small NN)', 'Features: user segments, context, creative, time, historical CTR', 'Win-price distributions per publisher for bid shading'],
      tradeoffs: [
        { title: 'Model accuracy vs inference time', body: 'A deep model predicts better but may take 20 ms for 50 candidates. Common pattern: a cheap model scores everything, a heavier model re-ranks the top few. Always in-process — a remote model server adds a network hop and a failure mode.' },
      ],
    },
    {
      title: 'Bid responses return — slow DSPs are dropped',
      phase: 'Hot path',
      active: ['exchange', 'dspB'],
      fail: ['dspC'],
      packets: [{ edge: 'model-ex', tone: 'money' }, { edge: 'ex-dspB', reverse: true, tone: 'money', delay: 120 }],
      budget: 52, budgetNote: 'DSP C missed tmax — ignored',
      what: '<p>DSP A answers with a <code>BidResponse</code>: price, creative markup (<code>adm</code>), advertiser domain and a win-notice URL. DSP B answers too. A DSP with nothing to bid returns <b>HTTP 204</b> — the cheapest possible reply.</p><p><b>DSP C is too slow.</b> When <code>tmax</code> expires the exchange closes the auction with whatever has arrived. A late bid is simply discarded.</p>',
      data: ['<code>seatbid[].bid[]</code>: <code>price</code>, <code>adm</code>, <code>nurl</code>, <code>crid</code>, <code>adomain</code>', 'Per-DSP timeout rate & latency histogram (drives throttling)'],
      tradeoffs: [
        { title: 'Timeouts: where to set tmax', body: 'A generous tmax collects more bids (more revenue per auction) but slows every page. A tight one protects the user and cuts off slow buyers. Exchanges also track each DSP’s timeout rate and reduce the traffic sent to chronic offenders — a circuit breaker, not just a deadline.' },
        { title: 'DSP side: bid late or not at all?', body: 'A DSP should carry its own internal deadline (tmax minus network time) and return 204 once it passes. Computing a bid nobody will read wastes CPU and reserved budget.' },
      ],
    },
    {
      title: 'First-price auction',
      phase: 'Hot path',
      active: ['exchange'],
      fail: ['dspC'],
      packets: [],
      budget: 56, budgetNote: 'in-memory sort + validation',
      what: '<p>The exchange validates each bid (above the floor? advertiser not blocked? creative approved?), then the <b>highest bid wins and pays exactly what it bid</b>. DSP A bid $2.40, DSP B bid $1.90 → A wins at $2.40.</p><p>The whole auction is an in-memory comparison; no storage is touched on the hot path.</p>',
      data: ['Auction record: all bids, winner, clearing price, loss reasons', 'Logged asynchronously to Kafka — never blocks the response'],
      tradeoffs: [
        { title: 'First-price vs second-price', body: 'Second-price (pay the runner-up’s bid + 1¢) makes truthful bidding optimal but is opaque and easy to manipulate with hidden floors. The industry moved to first-price for transparency; the cost is that buyers must now run bid-shading models.' },
      ],
    },
    {
      title: 'Win notice to the winning DSP',
      phase: 'Hot path',
      active: ['exchange', 'tracker'],
      packets: [{ edge: 'ex-tracker', tone: 'money' }, { edge: 'tracker-kafka', tone: 'async', delay: 700 }],
      budget: 57, budgetNote: 'fire-and-forget, off the critical path',
      what: '<p>The exchange calls the winner’s <code>nurl</code> with the clearing price substituted into the <code>${AUCTION_PRICE}</code> macro. The DSP’s win tracker records the win and writes it to Kafka so pacing can move the reserved budget to “pending spend”.</p><p>Winning the auction isn’t yet a billable impression — the ad still has to render. OpenRTB 2.5 added a separate billing notice (<code>burl</code>) for that moment.</p>',
      data: ['Win event: <code>bid_id, line_item_id, clearing_price, ts</code>', 'Price macro is usually encrypted so intermediaries can’t read it'],
      tradeoffs: [
        { title: 'Bill on win vs bill on render', body: 'Counting spend on <code>nurl</code> is immediate but overcounts — some wins never render (user navigates away, ad blocked). Billing on <code>burl</code> / impression beacon is accurate but arrives later, so pacing must tolerate a gap between “won” and “billable”.' },
      ],
    },
    {
      title: 'Ad markup served and rendered',
      phase: 'Hot path',
      active: ['ssp', 'pub'],
      packets: [{ edge: 'ssp-ex', reverse: true }, { edge: 'pub-ssp', reverse: true, delay: 420 }],
      budget: 78, budgetNote: 'response returns — 22 ms of headroom',
      what: '<p>The winning creative’s markup travels back: exchange → SSP → page. The browser renders it and fetches the actual image / video from a <b>CDN</b>. The markup carries tracking pixels that will fire once the ad is on screen.</p><p>End-to-end: <b>~78 ms</b> against a 100 ms p99 budget. The remaining headroom absorbs GC pauses, retransmits and tail latency.</p>',
      data: ['<code>adm</code>: HTML / VAST snippet with impression + click tracker URLs', 'Creative assets on CDN (immutable, long cache TTL)'],
      tradeoffs: [
        { title: 'Where the budget actually goes', body: 'Roughly half is network, not compute. That’s why the big wins are architectural — co-location, connection reuse, parallel fan-out, hard deadlines — rather than micro-optimising the bid code.' },
      ],
    },

    /* --------------------------- async pipeline --------------------------- */
    {
      title: 'Impression & click beacons fire',
      phase: 'Async pipeline',
      async: true,
      active: ['pub', 'collector'],
      packets: [{ edge: 'pub-collector' }],
      budget: 78, budgetNote: 'user has the ad — from here on, seconds not milliseconds',
      what: '<p>When the creative renders, a tracking pixel calls the event collector: <b>impression</b>. If the user clicks, the link bounces through a redirect: <b>click</b>. These beacons are the source of truth for billing.</p><p>The collector does almost nothing: validate, stamp, append to Kafka, return <code>204</code>. It must never lose an event and never be slow.</p>',
      data: ['Event: <code>event_id, type, bid_id, line_item_id, creative_id, price, ts</code>', 'Signed URL params so events can’t be forged or replayed'],
      tradeoffs: [
        { title: 'Durability vs collector latency', body: 'Ack the browser only after Kafka confirms the write (<code>acks=all</code>) and you won’t lose billable events, at the cost of a few ms per beacon. Acking first and buffering locally is faster but loses data when a collector node dies.' },
      ],
    },
    {
      title: 'Events land in Kafka',
      phase: 'Async pipeline',
      async: true,
      active: ['kafka'],
      packets: [{ edge: 'collector-kafka' }],
      budget: 78, budgetNote: 'durable, replayable log',
      what: '<p>Kafka decouples the latency-critical serving tier from everything downstream. Bids, wins, impressions and clicks go to separate topics, replicated ×3 and retained for days so any consumer can <b>replay</b> after a bug or outage.</p>',
      data: ['Topics: <code>bids</code>, <code>wins</code>, <code>impressions</code>, <code>clicks</code>', 'Partition key: <code>bid_id</code> (join-friendly, evenly spread)', 'Retention 3–7 days, replication factor 3'],
      tradeoffs: [
        { title: 'Partition key choice', body: 'Keying by <code>campaign_id</code> keeps a campaign’s events ordered together but one giant advertiser creates a hot partition. Keying by <code>bid_id</code> spreads load evenly; aggregation by campaign then happens downstream after a shuffle.' },
      ],
    },
    {
      title: 'Stream processing: dedup, join, aggregate',
      phase: 'Async pipeline',
      async: true,
      active: ['stream', 'lake'],
      packets: [{ edge: 'kafka-stream' }, { edge: 'kafka-lake', delay: 200 }],
      budget: 78, budgetNote: 'seconds of lag is fine',
      what: '<p>Flink / Spark Structured Streaming jobs consume the topics and: <b>deduplicate</b> by <code>event_id</code>, <b>join</b> impressions to the bids that produced them, run the heavier <b>async fraud models</b>, and compute windowed aggregates (spend, impressions, clicks per line item per minute).</p><p>In parallel, raw events are archived to a data lake — the immutable record used for batch reconciliation and model training.</p>',
      data: ['Dedup state: seen <code>event_id</code>s with a TTL (keyed state / RocksDB)', 'Windowed counters per <code>(line_item, minute)</code>', 'Raw events → object storage (Parquet, partitioned by hour)'],
      tradeoffs: [
        { title: 'At-least-once + idempotent dedup vs exactly-once', body: 'True end-to-end exactly-once (transactional sinks, two-phase commit on checkpoints) adds latency and operational weight. The pragmatic choice: accept at-least-once delivery, give every event a unique ID, and make the sink idempotent — duplicates collapse, nothing is lost.' },
        { title: 'Late events', body: 'A phone can send a beacon minutes late. Watermarks decide how long a window stays open: longer = more accurate, but results arrive later. Anything past the watermark is fixed by the batch job.' },
      ],
    },
    {
      title: 'Aggregates into the OLAP store',
      phase: 'Async pipeline',
      async: true,
      active: ['druid'],
      packets: [{ edge: 'stream-druid' }],
      budget: 78, budgetNote: 'queryable within ~1 minute',
      what: '<p>Aggregated rows are ingested into a columnar OLAP store such as <b>Druid</b>. It pre-aggregates at ingest (“rollup”) by time bucket and dimensions, so billions of raw events become millions of rows that can be sliced in under a second.</p>',
      data: ['Row: <code>ts_minute, campaign, line_item, creative, publisher, geo, device</code>', 'Metrics: <code>impressions, clicks, spend, wins, bids</code> (+ sketches for uniques)', 'Real-time segments, later compacted and replaced by batch-corrected ones'],
      tradeoffs: [
        { title: 'Rollup granularity', body: 'More dimensions = more flexible reports but less compression and slower queries. High-cardinality fields (user ID, full URL) stay out of the OLAP store and live in the data lake; uniques use approximate sketches (HLL).' },
      ],
    },
    {
      title: 'Reporting & billing',
      phase: 'Async pipeline',
      async: true,
      active: ['reports'],
      packets: [{ edge: 'druid-reports' }],
      budget: 78, budgetNote: 'eventually consistent by design',
      what: '<p>Advertiser dashboards query the OLAP store for near-real-time numbers. These are <b>eventually consistent</b> — fresh within a minute or so, and may shift slightly as late events and fraud corrections arrive.</p><p><b>Invoices</b> never come from the streaming numbers. A nightly batch job recomputes from raw events in the data lake and overwrites the day’s aggregates — the classic lambda-style correction.</p>',
      data: ['Reporting API with per-advertiser row-level filtering', 'Finalised daily billing table (batch-computed, immutable once closed)'],
      tradeoffs: [
        { title: 'Fresh vs final numbers', body: 'Showing live numbers that later change confuses users; hiding them until final makes the product feel dead. Standard answer: show both — live figures marked “preliminary”, and a finalised figure once the batch reconciliation closes the day.' },
      ],
    },
    {
      title: 'Spend feedback closes the loop into pacing',
      phase: 'Async pipeline',
      async: true,
      active: ['stream', 'pacing'],
      packets: [{ edge: 'stream-pacing', tone: 'money' }],
      budget: 78, budgetNote: 'loop latency ≈ seconds',
      what: '<p>The same stream job that counts spend publishes <b>confirmed spend per line item</b> back to the pacing service every few seconds. Pacing compares actual vs planned spend and adjusts: refill token buckets, raise or lower the pacing multiplier, or stop a line item whose budget is gone.</p><p>It’s a control loop — and the delay in the loop is exactly what bounds how much you can overspend.</p>',
      data: ['<code>line_item_id → spend_confirmed, spend_pending, budget_remaining</code>', 'Pacing multiplier / bucket refill rate per line item'],
      tradeoffs: [
        { title: 'Feedback delay vs overspend', body: 'A 5 s loop at a $10/s spend rate risks ~$50 of overshoot; a 60 s loop risks $600. Tighten the loop for small or nearly-exhausted budgets, and hold back a safety margin (stop at ~98%) instead of trying to be exactly right.' },
        { title: 'If the pipeline stalls', body: 'When feedback stops arriving, bidders must fail safe: keep spending only their last allocation, then stop. Under-delivering for a few minutes is recoverable; overspending a client’s budget is a refund.' },
      ],
    },
  ],
};
