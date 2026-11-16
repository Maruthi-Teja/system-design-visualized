/*
 * Walkthrough config: Rate Limiter (LLD).
 * Pure data — the shared engine (assets/engine.js) renders and animates it.
 * Three scenarios on one diagram: request allowed, request denied, store unavailable.
 * Coordinates are in viewBox units (960 x 450).
 */
window.RATE_LIMITER_CONFIG = {
  title: 'Rate limiter: classes and the path of one request',
  viewBox: [960, 450],
  autoPlayMs: 4200,
  budget: { label: 'Added latency', total: 5, unit: 'ms' },

  groups: [
    { id: 'lib', label: 'Rate limiter library', x: 322, y: 14, w: 476, h: 262 },
  ],

  nodes: [
    { id: 'client',   label: 'Client',          sub: 'API key abc123',     x: 16,  y: 70,  kind: 'client' },
    { id: 'filter',   label: 'RateLimitFilter', sub: 'middleware',         x: 166, y: 70,  w: 130 },
    { id: 'keys',     label: 'KeyResolver',     sub: 'who is calling?',    x: 338, y: 70,  w: 130 },
    { id: 'rules',    label: 'RuleRepository',  sub: 'which limit applies?', x: 492, y: 70, w: 130 },
    { id: 'limiter',  label: 'RateLimiter',     sub: '«interface»',        x: 646, y: 70,  w: 136 },
    { id: 'strategy', label: 'TokenBucket',     sub: '«strategy»',         x: 646, y: 200, w: 136 },
    { id: 'store',    label: 'CounterStore',    sub: '«interface»',        x: 492, y: 200, w: 130 },
    { id: 'local',    label: 'LocalStore',      sub: 'in-memory fallback', x: 338, y: 200, w: 130 },
    { id: 'redis',    label: 'Redis',           sub: 'atomic Lua script',  x: 492, y: 360, w: 130, kind: 'store' },
    { id: 'upstream', label: 'Upstream Service', sub: 'the protected API', x: 166, y: 360, w: 130 },
    { id: 'config',   label: 'Rule Config',     sub: 'hot-reloaded',    x: 822, y: 200, w: 122, kind: 'store' },
  ],

  edges: [
    { id: 'c-f',      from: 'client', to: 'filter' },
    { id: 'f-k',      from: 'filter', to: 'keys' },
    { id: 'k-r',      from: 'keys', to: 'rules' },
    { id: 'r-l',      from: 'rules', to: 'limiter' },
    { id: 'l-s',      from: 'limiter', to: 'strategy' },
    { id: 's-st',     from: 'strategy', to: 'store' },
    { id: 'st-redis', from: 'store', to: 'redis' },
    { id: 'st-local', from: 'store', to: 'local' },
    // The Decision travels back to the filter over the top of the library.
    { id: 'l-f',      from: 'limiter', to: 'filter', fromSide: 'top', toSide: 'top',
      via: [[714, 50], [231, 50]] },
    { id: 'f-up',     from: 'filter', to: 'upstream', fromSide: 'bottom', toSide: 'top' },
    { id: 'cfg-r',    from: 'config', to: 'rules', fromSide: 'top', toSide: 'bottom',
      via: [[883, 150], [557, 150]], dashed: true },
  ],

  steps: [
    /* --------------------------- request allowed --------------------------- */
    {
      title: 'A request hits the filter',
      phase: 'Scenario A · allowed',
      active: ['client', 'filter'],
      packets: [{ edge: 'c-f' }],
      budget: 0.1, budgetNote: 'intercept before any business logic',
      what: '<p>Every request passes through <code>RateLimitFilter</code> — a middleware in the API gateway or the service’s own filter chain — <b>before</b> it reaches a handler. Rejecting early is the point: a denied request should cost almost nothing.</p><p>The filter owns no limiting logic. It orchestrates: resolve a key, find the rule, ask the limiter, act on the decision.</p>',
      data: ['Request: method, path, headers, remote IP', 'No state in the filter itself — it is shared by all threads'],
      tradeoffs: [
        { title: 'Gateway vs in-service', body: 'At the gateway, one implementation protects everything and bad traffic never reaches your services. In-service limiting knows more (user plan, request cost) but every team must wire it in. Most systems do coarse limits at the edge and fine-grained ones in the service.' },
      ],
    },
    {
      title: 'KeyResolver: who is this?',
      phase: 'Scenario A · allowed',
      active: ['keys'],
      packets: [{ edge: 'f-k' }],
      budget: 0.2, budgetNote: 'string work, no I/O',
      what: '<p><code>KeyResolver</code> turns the request into the identity being limited — an API key, user ID, tenant, or IP — and combines it with the route to build the counter key.</p><p>Here: <code>rl:{abc123}:POST:/orders</code>.</p>',
      data: ['Key = <code>prefix : identity : route</code>', 'Identity precedence: API key → user ID → IP address'],
      tradeoffs: [
        { title: 'Limiting by IP', body: 'IP needs no authentication, so it works for anonymous traffic — but an office or mobile carrier behind one NAT shares a single limit, and attackers rotate IPs. Prefer an authenticated identity and keep IP limits as a loose outer guard.' },
      ],
    },
    {
      title: 'RuleRepository: which limit applies?',
      phase: 'Scenario A · allowed',
      active: ['rules'],
      packets: [{ edge: 'k-r' }],
      budget: 0.3, budgetNote: 'in-memory map lookup',
      what: '<p><code>RuleRepository</code> returns the <code>RateLimitRule</code> for this caller and route: algorithm, capacity, refill rate. Rules are held <b>in memory</b> and matched most-specific first (route + plan → plan → default).</p><p>Result: <i>free plan, POST /orders → token bucket, capacity 20, refill 5/s</i>.</p>',
      data: ['<code>RateLimitRule { id, algorithm, capacity, refillPerSec, window }</code>', 'Immutable snapshot swapped atomically on reload'],
      tradeoffs: [
        { title: 'Rules in code vs config', body: 'Hard-coded limits are simple and type-checked but need a deploy to change — useless during an incident. External config can be changed in seconds, so it needs validation and a safe default when the config is missing or malformed.' },
      ],
    },
    {
      title: 'RateLimiter picks the algorithm',
      phase: 'Scenario A · allowed',
      active: ['limiter', 'strategy'],
      packets: [{ edge: 'r-l' }, { edge: 'l-s', delay: 500 }],
      budget: 0.4, budgetNote: 'one virtual call',
      what: '<p>The filter calls <code>RateLimiter.tryAcquire(key, rule, permits)</code>. The interface hides <i>how</i> limiting is done; the rule’s algorithm selects a concrete <b>strategy</b> — here <code>TokenBucket</code>.</p><p>This is the Strategy pattern doing real work: fixed window, sliding window and token bucket are interchangeable, and a new algorithm is a new class, not an edit to the filter.</p>',
      data: ['<code>Map&lt;Algorithm, RateLimiter&gt;</code> built once at startup', '<code>permits</code>: usually 1; more for expensive requests'],
      tradeoffs: [
        { title: 'Token bucket as the default', body: 'It allows short bursts up to <code>capacity</code> while enforcing an average rate, and needs only two numbers per key. Use a sliding window when the contract is a strict “N per minute” with no burst allowance.' },
      ],
    },
    {
      title: 'Atomic refill-and-take in the store',
      phase: 'Scenario A · allowed',
      active: ['store', 'redis'],
      packets: [{ edge: 's-st' }, { edge: 'st-redis', delay: 450 }],
      budget: 1.6, budgetNote: 'one Redis round trip — the only I/O',
      what: '<p>The strategy asks <code>CounterStore</code> to consume a token. With several app servers the counter must be shared, so the store is Redis — and the whole <b>read → refill → check → write</b> runs as one Lua script, which Redis executes atomically.</p><p>Bucket had 7 tokens → take 1 → 6 left → <b>allowed</b>.</p>',
      data: ['Hash <code>rl:{abc123}:POST:/orders</code> → <code>tokens</code>, <code>ts</code>', 'TTL ≈ 2 × time-to-refill, so idle keys disappear on their own'],
      tradeoffs: [
        { title: 'Why not GET then SET?', body: 'Two servers both read “1 token left”, both allow, both write 0 — the limit is exceeded. Check-then-act across a network is a race. Fix it with one atomic operation (Lua script), not a distributed lock: a lock adds round trips and a failure mode.' },
        { title: 'One Redis hop per request', body: 'About 1 ms and a hard dependency. For very hot paths, hand each server a local batch of tokens and sync periodically — faster, but the limit becomes approximate.' },
      ],
    },
    {
      title: 'Decision returns to the filter',
      phase: 'Scenario A · allowed',
      active: ['limiter', 'filter'],
      packets: [{ edge: 'l-f' }],
      budget: 1.7, budgetNote: 'allowed · 6 remaining',
      what: '<p>The limiter returns an immutable <code>Decision</code>: <code>allowed = true, remaining = 6, retryAfter = 0</code>. The filter doesn’t care which algorithm produced it.</p><p>Returning a value object — rather than a boolean, or throwing on denial — gives the filter what it needs to set response headers, and keeps denial a normal outcome instead of an exception.</p>',
      data: ['<code>Decision { allowed, remaining, retryAfter }</code>', 'Headers: <code>RateLimit-Limit</code>, <code>RateLimit-Remaining</code>, <code>RateLimit-Reset</code>'],
      tradeoffs: [
        { title: 'Exposing remaining quota', body: 'Headers let well-behaved clients slow down before they are blocked. They also tell an attacker exactly how hard they can push. Public APIs usually expose them; internal abuse limits often stay silent.' },
      ],
    },
    {
      title: 'Request forwarded to the service',
      phase: 'Scenario A · allowed',
      active: ['filter', 'upstream'],
      packets: [{ edge: 'f-up' }],
      budget: 1.8, budgetNote: 'total overhead for an allowed request',
      what: '<p>Allowed: the filter calls the next handler in the chain and the upstream service does its work. The rate-limit headers are added to whatever response comes back.</p><p>Total cost of being protected: <b>under 2 ms</b>, almost all of it the Redis round trip.</p>',
      data: ['Nothing new stored — the token was already taken'],
      tradeoffs: [
        { title: 'Charge before or after?', body: 'Taking the token up front is simple and protects the service. But if the request then fails with a 5xx, the client paid for nothing — some APIs refund the token on server errors, at the price of a second store call.' },
      ],
    },

    /* --------------------------- request denied --------------------------- */
    {
      title: 'A burst arrives — the bucket is empty',
      phase: 'Scenario B · denied',
      active: ['client', 'strategy', 'redis'],
      packets: [{ edge: 'c-f', tone: 'danger' }, { edge: 'st-redis', tone: 'danger', delay: 500 }],
      budget: 1.6, budgetNote: 'same path, same cost',
      what: '<p>The same client now fires 30 requests in a second. The first few drain the bucket; this one finds <b>0.4 tokens</b> — less than the 1 it needs.</p><p>The script refills, sees it’s still short, <b>takes nothing</b>, and returns <code>allowed = 0</code> along with how long until one token is available: 120 ms.</p>',
      data: ['Bucket: <code>tokens = 0.4</code>, refill 5/s → next token in 120 ms', 'Denied requests do not consume tokens'],
      tradeoffs: [
        { title: 'Reject vs queue', body: 'Rejecting immediately is cheap and pushes back-pressure to the caller. Queueing (leaky bucket) smooths the burst and hides it from the client, but holds connections and memory — and under sustained overload the queue just fills and you reject anyway.' },
      ],
    },
    {
      title: '429 Too Many Requests',
      phase: 'Scenario B · denied',
      active: ['filter', 'client'],
      fail: ['upstream'],
      packets: [{ edge: 'l-f', tone: 'danger' }, { edge: 'c-f', reverse: true, tone: 'danger', delay: 800 }],
      budget: 1.7, budgetNote: 'rejected before the service is touched',
      what: '<p><code>Decision.allowed = false</code>. The filter short-circuits the chain and answers <code>429 Too Many Requests</code> with <code>Retry-After: 1</code>. <b>The upstream service never sees the request</b> — that is the protection.</p><p>A good client backs off with jitter; a bad one keeps hammering and keeps getting cheap 429s.</p>',
      data: ['Response: <code>429</code>, <code>Retry-After</code>, <code>RateLimit-Remaining: 0</code>', 'Metric: <code>rate_limited_total{rule, key_type}</code>'],
      tradeoffs: [
        { title: 'Hard vs soft limits', body: 'A hard limit rejects at exactly N. A soft limit allows a small overage (or only logs — “shadow mode”) so you can roll out a new rule and see who it would block before it blocks anyone.' },
      ],
    },

    /* --------------------------- store unavailable --------------------------- */
    {
      title: 'Redis times out — fall back to local',
      phase: 'Scenario C · store down',
      active: ['store', 'local'],
      fail: ['redis'],
      packets: [{ edge: 'st-redis', tone: 'danger' }, { edge: 'st-local', delay: 600 }],
      budget: 2.6, budgetNote: 'bounded by a 2 ms store timeout',
      what: '<p>Redis doesn’t answer within its <b>2 ms timeout</b>. The limiter must not take the API down with it. A circuit breaker opens and <code>CounterStore</code> switches to <code>LocalStore</code>: an in-process token bucket per key.</p><p>Each server now enforces roughly <code>limit ÷ server count</code> on its own. Less accurate, still protective, and no network.</p>',
      data: ['<code>ConcurrentHashMap&lt;String, TokenBucket&gt;</code> with idle-entry eviction', 'Circuit breaker state: closed → open → half-open'],
      tradeoffs: [
        { title: 'Fail open vs fail closed', body: 'Fail open (allow everything) keeps the product up but removes protection exactly when things are already going wrong. Fail closed (deny everything) turns a cache outage into a full outage. A local fallback sits between: degraded accuracy, not zero protection. Choose fail-closed only for limits that guard money or security, like login attempts.' },
      ],
    },

    /* ------------------------------ background ------------------------------ */
    {
      title: 'Rules change without a deploy',
      phase: 'Background',
      async: true,
      active: ['config', 'rules'],
      packets: [{ edge: 'cfg-r' }],
      budget: 1.8, budgetNote: 'off the request path',
      what: '<p>An operator halves the free-plan limit during an incident. <code>RuleRepository</code> watches the config store (or polls every few seconds), validates the new rules, builds a fresh immutable snapshot and <b>swaps one reference</b>.</p><p>Requests in flight keep the snapshot they started with; new requests see the new rules. No locks on the request path.</p>',
      data: ['<code>volatile RuleSet current</code> — replaced, never mutated', 'Rule version, for logs and debugging'],
      tradeoffs: [
        { title: 'What happens to existing buckets?', body: 'Buckets store only tokens and a timestamp; capacity and rate come from the rule on each call. So a new rule applies on the very next request — just clamp tokens to the new capacity. No migration of counters is needed.' },
      ],
    },
  ],
};
