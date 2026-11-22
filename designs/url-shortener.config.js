/*
 * Walkthrough config: URL Shortener (HLD).
 * Pure data — the shared engine (assets/engine.js) renders and animates it.
 * Write path (create a link), read path (redirect), a hot-key failure, then async work.
 * Coordinates are in viewBox units (960 x 484).
 */
window.URL_SHORTENER_CONFIG = {
  title: 'URL shortener: write path, redirect path and click analytics',
  viewBox: [960, 484],
  autoPlayMs: 4200,
  budget: { label: 'Latency budget', total: 50, unit: 'ms' },

  groups: [
    { id: 'write', label: 'Write path · ~1K QPS', x: 6, y: 10, w: 634, h: 102 },
    { id: 'read',  label: 'Read path · ~100K+ QPS', x: 6, y: 240, w: 634, h: 102 },
    { id: 'async', label: 'Async · analytics', x: 316, y: 372, w: 640, h: 104 },
  ],

  nodes: [
    // Write path
    { id: 'client',  label: 'Client App',    sub: 'creates a link',    x: 16,  y: 50, kind: 'client' },
    { id: 'gateway', label: 'API Gateway',   sub: 'auth · rate limit', x: 172, y: 50 },
    { id: 'write',   label: 'Write Service', sub: 'validate · store',  x: 328, y: 50 },
    { id: 'kgs',     label: 'Key Allocator', sub: 'local ID range',    x: 490, y: 50, w: 130 },
    { id: 'coord',   label: 'Coordinator',   sub: 'etcd · range leases', x: 670, y: 50, kind: 'store' },

    // Shared storage
    { id: 'db',      label: 'URL Store',     sub: 'code → long URL',   x: 670, y: 160, kind: 'store' },
    { id: 'sweeper', label: 'Expiry Sweeper', sub: 'background job',   x: 830, y: 160, w: 114 },

    // Read path
    { id: 'browser',  label: 'Browser',          sub: 'GET /2crtgcW',     x: 16,  y: 280, kind: 'client' },
    { id: 'cdn',      label: 'CDN / Edge',       sub: 'optional cache',   x: 172, y: 280 },
    { id: 'redirect', label: 'Redirect Service', sub: 'stateless',        x: 328, y: 280 },
    { id: 'cache',    label: 'Redis Cache',      sub: 'hot codes',        x: 490, y: 280, w: 130, kind: 'store' },

    // Async
    { id: 'kafka', label: 'Kafka',             sub: 'click events',      x: 328, y: 410, kind: 'queue' },
    { id: 'agg',   label: 'Stream Aggregator', sub: 'per-minute counts', x: 490, y: 410, w: 130 },
    { id: 'olap',  label: 'Analytics Store',   sub: 'OLAP',              x: 670, y: 410, kind: 'store' },
    { id: 'stats', label: 'Stats API',         sub: 'clicks per link',   x: 830, y: 410, w: 114 },
  ],

  edges: [
    { id: 'c-g',   from: 'client', to: 'gateway' },
    { id: 'g-w',   from: 'gateway', to: 'write' },
    { id: 'w-k',   from: 'write', to: 'kgs' },
    { id: 'k-co',  from: 'kgs', to: 'coord', dashed: true },
    { id: 'w-db',  from: 'write', to: 'db', fromSide: 'bottom', toSide: 'left', fromOffset: -20,
      via: [[368, 186]] },
    { id: 'b-cdn', from: 'browser', to: 'cdn' },
    { id: 'cdn-r', from: 'cdn', to: 'redirect' },
    { id: 'r-cache', from: 'redirect', to: 'cache' },
    { id: 'r-db',  from: 'redirect', to: 'db', fromSide: 'top', toSide: 'bottom', fromOffset: 20,
      via: [[408, 228], [730, 228]], label: 'cache miss' },
    { id: 'r-kafka', from: 'redirect', to: 'kafka', fromSide: 'bottom', toSide: 'top', dashed: true },
    { id: 'k-agg', from: 'kafka', to: 'agg' },
    { id: 'agg-olap', from: 'agg', to: 'olap' },
    { id: 'olap-stats', from: 'olap', to: 'stats' },
    { id: 'sw-db', from: 'sweeper', to: 'db' },
  ],

  steps: [
    /* ------------------------------ write path ------------------------------ */
    {
      title: 'Client asks for a short link',
      phase: 'Write path',
      active: ['client', 'gateway'],
      packets: [{ edge: 'c-g' }],
      budget: 4, budgetNote: 'client → gateway',
      what: '<p>An app or a user calls <code>POST /api/v1/urls</code> with the long URL and, optionally, a custom alias and an expiry date.</p><p>The API gateway authenticates the API key and applies a <b>per-user rate limit</b>. Anonymous link creation is the main source of spam, so this limit matters more than usual.</p>',
      data: ['Request: <code>long_url</code>, optional <code>alias</code>, <code>expires_at</code>', 'API key → user / plan (cached at the gateway)'],
      tradeoffs: [
        { title: 'Allow anonymous creation?', body: 'Anonymous links help adoption but invite spammers and phishers, who create millions of links and burn your domain’s reputation. Common middle ground: anonymous links with strict IP limits and short expiry, full features only for signed-in users.' },
      ],
    },
    {
      title: 'Validate and normalise the URL',
      phase: 'Write path',
      active: ['gateway', 'write'],
      packets: [{ edge: 'g-w' }],
      budget: 9, budgetNote: 'parse, normalise, blocklist check',
      what: '<p>The write service checks the URL is well-formed (scheme <code>http</code>/<code>https</code>, length under ~2 KB), normalises it (lower-case host, drop default port) and checks the domain against a <b>blocklist</b> of known malware and phishing hosts held in memory.</p><p>A deeper scan — fetching the page, reputation services — runs asynchronously and can disable the link afterwards.</p>',
      data: ['In-memory domain blocklist, refreshed every few minutes', 'Normalised URL (used for dedup if enabled)'],
      tradeoffs: [
        { title: 'Same long URL → same short code?', body: 'Deduplicating saves storage but needs a second index (long URL → code) and leaks information: user B learns that user A already shortened that URL, and both share one click counter. Most services give every request its own code; dedup only within one user’s account if at all.' },
      ],
    },
    {
      title: 'Allocate a unique ID from a local range',
      phase: 'Write path',
      active: ['kgs', 'coord'],
      packets: [{ edge: 'w-k' }, { edge: 'k-co', tone: 'async', delay: 600 }],
      budget: 9.2, budgetNote: 'in-memory counter — no network',
      what: '<p>Each write server leases a block of IDs — say <b>1,000,000 at a time</b> — from a coordinator (etcd / ZooKeeper / a DB sequence). Inside the block it just increments a local counter, so allocating an ID is an atomic add in memory.</p><p>It fetches the next block in the background when the current one is ~80% used, so the coordinator is never on the request path.</p><p>The ID is then <b>base62-encoded</b>: ID <code>125,000,000,042</code> → <code>2crtgcW</code> (7 characters).</p>',
      data: ['Coordinator: one counter <code>next_block_start</code>, updated with compare-and-set', 'Write server: <code>[block_start, block_end)</code> and a local <code>AtomicLong</code>'],
      tradeoffs: [
        { title: 'Counter vs hash vs random', body: 'Hashing the URL and truncating to 7 chars needs a collision check on every write and gets worse as the table fills. Random codes have the same problem. A counter can never collide, so the insert needs no read-before-write. Its cost is the coordinator — kept off the hot path by leasing blocks.' },
        { title: 'Sequential codes are guessable', body: 'Consecutive IDs give consecutive codes, so anyone can enumerate every link and estimate your volume. Fix: run the ID through a reversible scramble (e.g. multiply by a large odd constant modulo 62⁷) before encoding — still collision-free, no longer predictable.' },
      ],
    },
    {
      title: 'Persist the mapping',
      phase: 'Write path',
      active: ['write', 'db'],
      packets: [{ edge: 'w-db' }],
      budget: 21, budgetNote: 'replicated write, quorum ack',
      what: '<p>The service writes <code>code → long_url</code> to the URL store with a <b>conditional insert</b> (<code>IF NOT EXISTS</code>). For counter-generated codes it always succeeds; for a <b>custom alias</b> it is what detects “already taken” without a race.</p><p>The store is a key-value / wide-column database partitioned by <code>code</code> — every read is a single-key lookup.</p>',
      data: ['Row: <code>code</code> (PK), <code>long_url</code>, <code>user_id</code>, <code>created_at</code>, <code>expires_at</code>', 'Secondary index <code>user_id → codes</code> for “my links”, maintained asynchronously'],
      tradeoffs: [
        { title: 'SQL or NoSQL?', body: 'There are no joins and every read is by primary key, so a horizontally partitioned KV store (Cassandra, DynamoDB) scales simply to hundreds of billions of rows. Sharded MySQL / Postgres works too and gives you transactions for custom aliases — at the cost of operating the sharding yourself.' },
      ],
    },
    {
      title: 'Return the short URL',
      phase: 'Write path',
      active: ['gateway', 'client'],
      packets: [{ edge: 'g-w', reverse: true }, { edge: 'c-g', reverse: true, delay: 420 }],
      budget: 25, budgetNote: 'create done — well inside budget',
      what: '<p>The client gets <code>201 Created</code> with <code>https://sho.rt/2crtgcW</code>. Nothing is written to the cache: most links are never clicked, and the ones that are will be loaded on first read.</p>',
      data: ['Response: <code>short_url</code>, <code>code</code>, <code>expires_at</code>'],
      tradeoffs: [
        { title: 'Write-through cache?', body: 'Pre-warming the cache on create makes the first click fast, but fills memory with links nobody opens. Cache-aside (load on first miss) keeps only links that are actually used — usually the better trade for a 100:1 read-heavy, long-tail workload.' },
      ],
    },

    /* ------------------------------ read path ------------------------------ */
    {
      title: 'Someone clicks the short link',
      phase: 'Read path',
      active: ['browser', 'cdn'],
      packets: [{ edge: 'b-cdn' }],
      budget: 3, budgetNote: 'new request: the redirect — this path is the product',
      what: '<p>A browser requests <code>GET https://sho.rt/2crtgcW</code>. DNS points at the edge / CDN closest to the user. Redirects outnumber creates roughly <b>100 : 1</b>, so this path gets all the optimisation effort.</p><p>The edge <i>can</i> cache the redirect response itself, answering without touching your servers at all.</p>',
      data: ['Edge cache key: the path <code>/2crtgcW</code>', 'Cache lifetime set by the redirect’s <code>Cache-Control</code> header'],
      tradeoffs: [
        { title: 'Cache redirects at the edge?', body: 'Edge caching makes redirects near-instant and absorbs viral spikes for free. But every edge hit is a click you never see (analytics undercount), and a disabled or edited link stays live until the edge entry expires. Short TTLs (minutes) or edge logs shipped to analytics are the usual compromise.' },
      ],
    },
    {
      title: 'Cache hit in Redis',
      phase: 'Read path',
      active: ['redirect', 'cache'],
      packets: [{ edge: 'cdn-r' }, { edge: 'r-cache', delay: 520 }],
      budget: 8, budgetNote: 'one in-region Redis GET, ~1 ms',
      what: '<p>The stateless redirect service looks up the code in Redis. Link popularity is extremely skewed — a small fraction of links gets most clicks — so a cache of a few tens of GB serves <b>well over 90%</b> of redirects.</p><p>It also checks <code>expires_at</code> and a “disabled” flag on the cached entry before answering.</p>',
      data: ['<code>code → { long_url, expires_at, disabled }</code>', 'LRU eviction; TTL capped at the link’s own expiry'],
      tradeoffs: [
        { title: 'How big should the cache be?', body: 'Size it by the hot set, not the total: if 20% of daily-active links make 80% of clicks, caching those is enough. Measure the hit rate and grow until the curve flattens — doubling a 95%-hit cache halves DB reads only if misses are not long-tail one-offs.' },
      ],
    },
    {
      title: 'Cache miss: read the store, fill the cache',
      phase: 'Read path',
      active: ['redirect', 'db', 'cache'],
      packets: [{ edge: 'r-db' }, { edge: 'r-cache', delay: 900 }],
      budget: 16, budgetNote: 'miss adds one DB read (~5–10 ms)',
      what: '<p>On a miss, the service reads the URL store by primary key and writes the result into Redis (<b>cache-aside</b>). A code that does not exist is cached too, as a short-lived <b>negative entry</b>, so bots scanning random codes can’t hammer the database.</p>',
      data: ['Negative cache: <code>code → NOT_FOUND</code>, TTL ~60 s', 'Read at consistency level ONE / eventually consistent read'],
      tradeoffs: [
        { title: 'Read consistency', body: 'A link created a few milliseconds ago on another replica might not be visible yet. Reading at ONE is fast and almost always fine; if not found, retry once at QUORUM before returning 404. That keeps the common case cheap and the fresh-link case correct.' },
      ],
    },
    {
      title: 'Answer with a redirect',
      phase: 'Read path',
      active: ['browser', 'redirect'],
      packets: [{ edge: 'cdn-r', reverse: true }, { edge: 'b-cdn', reverse: true, delay: 420 }],
      budget: 19, budgetNote: 'redirect p99 well under 50 ms',
      what: '<p>The service responds <code>302 Found</code> with <code>Location: https://example.com/very/long/path…</code> and a short <code>Cache-Control</code>. The browser follows it to the destination.</p><p>Expired or disabled links return <code>410 Gone</code>; unknown codes return <code>404</code>.</p>',
      data: ['Response headers only — no body needed', 'Status choice: <code>301</code> / <code>302</code> / <code>307</code> / <code>308</code>'],
      tradeoffs: [
        { title: '301 or 302?', body: '<b>301 (permanent)</b> lets browsers cache the redirect forever: less load, but repeat clicks never reach you, so analytics undercount and you can never change or disable the link for that user. <b>302 (temporary)</b> sends every click through your servers: full analytics and control, more traffic. Analytics products choose 302.' },
      ],
    },

    /* ------------------------------ failure ------------------------------ */
    {
      title: 'A link goes viral and a cache node fails',
      phase: 'Failure',
      active: ['redirect', 'db'],
      fail: ['cache'],
      packets: [{ edge: 'r-cache', tone: 'danger' }, { edge: 'r-db', tone: 'danger', delay: 300 }],
      budget: 30, budgetNote: 'DB under a thundering herd',
      what: '<p>One link is getting 200K clicks per second — all of them hash to the <b>same cache shard</b>. That shard fails, and every redirect service instance misses at once and goes to the database for the same key: a <b>thundering herd</b>.</p><p>Defences, cheapest first:</p><ul><li><b>Request coalescing</b> — one in-flight DB read per code per instance; other requests wait for it.</li><li><b>In-process cache</b> of the hottest few thousand codes (seconds-long TTL) in each redirect instance.</li><li><b>Replicate hot keys</b> across shards, and let the CDN absorb the spike.</li></ul>',
      data: ['Per-instance in-flight map: <code>code → Future&lt;Url&gt;</code>', 'Hot-key detector: top-K counter over the last few seconds'],
      tradeoffs: [
        { title: 'Freshness vs survival', body: 'A local cache with a 5-second TTL means a disabled link can keep redirecting for 5 seconds on some servers. For a malware link that is a real cost — so publish disables as an event that evicts local entries immediately, instead of making the TTL tiny.' },
      ],
    },

    /* ------------------------------ async ------------------------------ */
    {
      title: 'Emit a click event',
      phase: 'Async',
      async: true,
      active: ['redirect', 'kafka'],
      packets: [{ edge: 'r-kafka' }],
      budget: 19, budgetNote: 'off the redirect path',
      what: '<p>After responding, the redirect service publishes a click event to Kafka — fire-and-forget through a local buffer. <b>The redirect must never wait for, or fail because of, analytics.</b></p><p>If Kafka is unavailable the buffer fills and events are dropped (and counted as dropped) rather than slowing redirects.</p>',
      data: ['Event: <code>event_id, code, ts, country, referrer, user_agent, ip_hash</code>', 'Topic partitioned by <code>event_id</code> (not <code>code</code> — a viral link would make one hot partition)'],
      tradeoffs: [
        { title: 'Drop or block?', body: 'Blocking until Kafka acks keeps every click but couples redirect latency to Kafka health. Dropping on overflow keeps redirects fast and loses a small, measurable fraction of analytics. For a shortener, availability of the redirect wins.' },
      ],
    },
    {
      title: 'Aggregate clicks for the stats API',
      phase: 'Async',
      async: true,
      active: ['agg', 'olap', 'stats'],
      packets: [{ edge: 'k-agg' }, { edge: 'agg-olap', delay: 450 }, { edge: 'olap-stats', delay: 900 }],
      budget: 19, budgetNote: 'stats are seconds-to-minutes fresh',
      what: '<p>A stream job (Flink / Kafka Streams) deduplicates by <code>event_id</code>, filters obvious bots, and rolls clicks up per <code>(code, minute, country, referrer)</code>. Rows land in a columnar OLAP store (ClickHouse, Druid, Pinot).</p><p>The stats API answers “clicks per day for my link” from these rollups in milliseconds. Unique visitors use HyperLogLog sketches rather than storing every IP.</p>',
      data: ['Rollup row: <code>code, minute, country, referrer, clicks, uniques_hll</code>', 'Raw events kept in object storage for re-processing'],
      tradeoffs: [
        { title: 'Pre-aggregate vs raw', body: 'Rollups make queries fast and storage small, but any question you didn’t pre-aggregate for (“clicks by browser version”) needs a re-run over raw events. Keep raw events cheaply in object storage so you can always backfill.' },
      ],
    },
    {
      title: 'Expire old links',
      phase: 'Async',
      async: true,
      active: ['sweeper', 'db'],
      packets: [{ edge: 'sw-db' }],
      budget: 19, budgetNote: 'background maintenance',
      what: '<p>Expiry is enforced in two places. <b>Lazily</b>: every redirect checks <code>expires_at</code>, so an expired link stops working at exactly the right moment. <b>Eagerly</b>: a low-priority sweeper (or the database’s native row TTL) deletes expired rows to reclaim space.</p><p>Deleted codes are <b>not reused</b> — a reused code would send an old printed QR code or bookmark to someone else’s URL.</p>',
      data: ['Index or time-bucketed table on <code>expires_at</code> for the sweeper', 'Tombstoned codes: never handed out again'],
      tradeoffs: [
        { title: 'Reclaim codes or not?', body: 'At 7 characters there are 3.5 trillion codes — decades of headroom at 100M links/day — so reusing codes saves nothing worth the risk. If space ever runs low, move to 8 characters (62× more) instead.' },
      ],
    },
  ],
};
