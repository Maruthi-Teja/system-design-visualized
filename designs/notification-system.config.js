/*
 * Walkthrough config: Notification System (HLD).
 * Pure data — the shared engine (assets/engine.js) renders and animates it.
 * Transactional path (an order-shipped push), bulk path (a 20M-user campaign),
 * a provider failure with retries, then delivery tracking.
 * Coordinates are in viewBox units (960 x 440).
 */
window.NOTIFICATION_CONFIG = {
  title: 'Notification system: ingest, dispatch, channel delivery, retries and tracking',
  viewBox: [960, 440],
  autoPlayMs: 4200,
  budget: { label: 'Time to deliver (critical)', total: 5, unit: 's' },

  nodes: [
    // Top row: stores and the device
    { id: 'idem',   label: 'Dedup Keys',       sub: 'Redis · 24 h TTL',   x: 172, y: 20, kind: 'store' },
    { id: 'prefs',  label: 'Prefs & Devices',  sub: 'opt-outs · tokens',  x: 490, y: 20, w: 130, kind: 'store' },
    { id: 'device', label: 'User Device',      sub: 'phone · inbox',      x: 830, y: 20, w: 114, kind: 'client' },

    // Main flow
    { id: 'order',      label: 'Order Service',    sub: 'transactional',          x: 16,  y: 110, kind: 'client' },
    { id: 'api',        label: 'Notification API', sub: 'auth · validate',        x: 172, y: 110 },
    { id: 'kafka',      label: 'Priority Topics',  sub: 'Kafka · 3 tiers', x: 328, y: 110, w: 130, kind: 'queue' },
    { id: 'dispatcher', label: 'Dispatcher',       sub: 'prefs · caps',  x: 490, y: 110, w: 130 },
    { id: 'chq',        label: 'Channel Queues',   sub: 'push · sms · email',     x: 660, y: 110, kind: 'queue' },
    { id: 'apns',       label: 'APNs / FCM',       sub: 'push provider',          x: 830, y: 110, w: 114, kind: 'external' },

    // Second row
    { id: 'campaign', label: 'Campaign Tool',    sub: '20M-user blast',     x: 16,  y: 230, kind: 'client' },
    { id: 'fanout',   label: 'Fan-out',         sub: 'segment → users',    x: 172, y: 230 },
    { id: 'retry',    label: 'Retry Queue',      sub: 'delayed · backoff',  x: 490, y: 230, w: 130, kind: 'queue' },
    { id: 'workers',  label: 'Channel Workers',  sub: 'per-provider pools', x: 660, y: 230 },
    { id: 'sms',      label: 'SMS Gateway',      sub: 'sms provider',       x: 830, y: 190, w: 114, kind: 'external' },
    { id: 'email',    label: 'Email Provider',   sub: 'smtp / api',         x: 830, y: 270, w: 114, kind: 'external' },

    // Bottom row
    { id: 'dlq',    label: 'Dead Letters',    sub: 'after 7 attempts',   x: 490, y: 350, w: 130, kind: 'queue' },
    { id: 'log',    label: 'Delivery Log',    sub: 'status per message', x: 660, y: 370, kind: 'store' },
    { id: 'status', label: 'Status Receiver', sub: 'provider webhooks',  x: 830, y: 370, w: 114 },
  ],

  edges: [
    { id: 'o-a',  from: 'order', to: 'api', fromOffset: -10, toOffset: -10 },
    { id: 'c-a',  from: 'campaign', to: 'api', fromSide: 'right', toSide: 'left', toOffset: 10,
      via: [[154, 256], [154, 146]] },
    { id: 'a-i',  from: 'api', to: 'idem', fromSide: 'top', toSide: 'bottom' },
    { id: 'a-k',  from: 'api', to: 'kafka' },
    { id: 'a-f',  from: 'api', to: 'fanout', fromSide: 'bottom', toSide: 'top' },
    { id: 'f-k',  from: 'fanout', to: 'kafka', fromSide: 'right', toSide: 'bottom', via: [[393, 256]] },
    { id: 'k-d',  from: 'kafka', to: 'dispatcher' },
    { id: 'd-p',  from: 'dispatcher', to: 'prefs', fromSide: 'top', toSide: 'bottom' },
    { id: 'd-c',  from: 'dispatcher', to: 'chq' },
    { id: 'c-w',  from: 'chq', to: 'workers', fromSide: 'bottom', toSide: 'top' },
    { id: 'w-apns',  from: 'workers', to: 'apns',  fromSide: 'right', toSide: 'left', via: [[805, 256], [805, 136]] },
    { id: 'w-sms',   from: 'workers', to: 'sms',   fromSide: 'right', toSide: 'left', via: [[805, 256], [805, 216]] },
    { id: 'w-email', from: 'workers', to: 'email', fromSide: 'right', toSide: 'left', via: [[805, 256], [805, 296]] },
    { id: 'apns-dev', from: 'apns', to: 'device', fromSide: 'top', toSide: 'bottom' },
    { id: 'w-r',  from: 'workers', to: 'retry' },
    { id: 'r-c',  from: 'retry', to: 'chq', fromSide: 'top', toSide: 'left', fromOffset: 40, toOffset: 14,
      via: [[595, 200], [640, 200], [640, 150]], dashed: true, label: 'after delay' },
    { id: 'r-dlq', from: 'retry', to: 'dlq', fromSide: 'bottom', toSide: 'top' },
    { id: 'w-log', from: 'workers', to: 'log', fromSide: 'bottom', toSide: 'top' },
    { id: 'e-s',  from: 'email', to: 'status', fromSide: 'bottom', toSide: 'top', label: 'receipts' },
    { id: 's-log', from: 'status', to: 'log' },
  ],

  steps: [
    /* --------------------------- transactional path --------------------------- */
    {
      title: 'A service asks to notify a user',
      phase: 'Transactional',
      active: ['order', 'api'],
      packets: [{ edge: 'o-a' }],
      budget: 0.03, budgetNote: 'service → API',
      what: '<p>The order service calls <code>POST /v1/notifications</code>: “tell user 42 their order shipped”. It sends an <b>event type and data</b>, not finished text — the notification system owns templates, channels and user preferences.</p><p>The caller also sends a <b>priority</b> and an <b>idempotency key</b> such as <code>order-981:shipped</code>.</p>',
      data: ['<code>user_id</code>, <code>type</code>, <code>data{}</code>, <code>priority</code>, <code>idempotency_key</code>', 'Optional: <code>channels</code> override, <code>send_at</code>, <code>expires_at</code>'],
      tradeoffs: [
        { title: 'Events, not messages', body: 'If every team formats its own text and picks channels, you get inconsistent wording, ignored opt-outs and no global frequency limits. Accepting a typed event and rendering centrally puts those rules in one place — at the cost of a template registry every team must use.' },
      ],
    },
    {
      title: 'Validate and deduplicate',
      phase: 'Transactional',
      active: ['api', 'idem'],
      packets: [{ edge: 'a-i' }],
      budget: 0.04, budgetNote: 'one Redis SET NX',
      what: '<p>The API authenticates the caller, validates the payload against the event type’s schema, and records the idempotency key with <code>SET key NX EX 86400</code>. If the key already exists, this is a retry from the caller: return the original response and <b>do not send again</b>.</p><p>Callers retry on timeouts, so without this step a slow network turns into duplicate texts.</p>',
      data: ['<code>idem:{caller}:{key}</code> → <code>notification_id</code>, TTL 24 h', 'Per-caller rate limits, so one buggy service can’t flood users'],
      tradeoffs: [
        { title: 'How long to remember keys', body: 'Longer windows catch later retries but cost memory: 1B requests/day × ~100 B ≈ 100 GB for 24 hours. Most caller retries happen within minutes, so a day is generous. Duplicates past that window are caught by per-user frequency caps downstream.' },
      ],
    },
    {
      title: 'Enqueue by priority, answer 202',
      phase: 'Transactional',
      active: ['api', 'kafka'],
      packets: [{ edge: 'a-k' }],
      budget: 0.06, budgetNote: 'accepted — the caller is done',
      what: '<p>The request is written to a Kafka topic chosen by priority: <b>critical</b> (OTPs, security alerts), <b>normal</b> (order updates, mentions) or <b>bulk</b> (marketing). Once Kafka acknowledges, the API returns <code>202 Accepted</code> with a <code>notification_id</code>.</p><p>From here everything is asynchronous. The caller can poll the status or subscribe to a webhook.</p>',
      data: ['Topics: <code>notify.critical</code>, <code>notify.normal</code>, <code>notify.bulk</code>', 'Partition key: <code>user_id</code> — keeps one user’s notifications in order'],
      tradeoffs: [
        { title: 'Separate topics vs one topic with a priority field', body: 'A single queue processes in arrival order, so an OTP waits behind 20 million marketing messages. Separate topics with their own consumers (and more capacity reserved for critical) give real isolation. The cost is more topics and consumer groups to run.' },
      ],
    },
    {
      title: 'Dispatcher checks preferences and limits',
      phase: 'Transactional',
      active: ['dispatcher', 'prefs'],
      packets: [{ edge: 'k-d' }, { edge: 'd-p', delay: 500 }],
      budget: 0.12, budgetNote: 'cached preference read',
      what: '<p>The dispatcher loads the user’s settings (from a local cache, backed by the preferences store) and decides <b>whether and where</b> to send:</p><ul><li>Opted out of this category or channel? Drop it.</li><li>Quiet hours in the user’s time zone? Hold non-critical messages until morning.</li><li>Frequency cap exceeded (e.g. max 3 promotional pushes a day)? Drop or digest it.</li><li>Pick channels: push first, email as well for receipts, SMS only for critical.</li></ul>',
      data: ['<code>user_id → { channels, categories opted out, quiet_hours, tz, locale }</code>', '<code>user_id → devices[] { token, platform, last_seen }</code>, email, phone', 'Frequency counters: <code>freq:{user}:{category}:{day}</code>'],
      tradeoffs: [
        { title: 'Check preferences early or late?', body: 'Checking here, before fan-out to channels, avoids wasted work. But preferences can change between enqueue and send (a user unsubscribes while a campaign is still running). Re-check cheaply in the channel worker for bulk messages, where the delay can be long.' },
      ],
    },
    {
      title: 'Render the template, split per channel',
      phase: 'Transactional',
      active: ['dispatcher', 'chq'],
      packets: [{ edge: 'd-c' }],
      budget: 0.15, budgetNote: 'in-process render',
      what: '<p>The dispatcher renders the template for each chosen channel in the user’s language — a 40-character push title, an HTML email, a 160-character SMS — and writes <b>one message per channel per device</b> to the channel queues.</p><p>Templates are versioned and cached in every dispatcher; rendering never makes a network call.</p>',
      data: ['Template key: <code>(type, channel, locale, version)</code>', 'Channel message: <code>message_id, notification_id, channel, address, payload, attempt</code>'],
      tradeoffs: [
        { title: 'Why separate channel queues?', body: 'Channels fail and throttle independently: the SMS provider may be down while push is fine. Per-channel queues let each channel back up, retry and scale on its own, so an email outage never delays push notifications.' },
      ],
    },
    {
      title: 'Channel worker calls the push provider',
      phase: 'Transactional',
      active: ['workers', 'apns'],
      packets: [{ edge: 'c-w' }, { edge: 'w-apns', delay: 500 }],
      budget: 0.45, budgetNote: 'provider API round trip',
      what: '<p>A push worker takes the message, calls the platform push service (APNs for iOS, FCM for Android) over a pooled HTTP/2 connection, and records the result.</p><p>Workers respect each provider’s <b>rate limits</b> with a token bucket per provider and per account, and they write <code>message_id</code> as “sent” <i>before</i> acknowledging the queue — so a crash mid-send leads to a retry, not a lost message.</p>',
      data: ['Per-provider token bucket and connection pool', 'Provider response: accepted, invalid token, throttled, server error'],
      tradeoffs: [
        { title: 'At-least-once means a rare duplicate', body: 'If a worker crashes after the provider accepted the message but before it recorded success, the retry sends it again. Truly exactly-once delivery to a phone is impossible across that boundary. Reduce it: pass <code>message_id</code> as the provider’s collapse/idempotency key where supported, and check the delivery log before resending.' },
      ],
    },
    {
      title: 'Delivered to the device',
      phase: 'Transactional',
      active: ['apns', 'device'],
      packets: [{ edge: 'apns-dev' }],
      budget: 1.2, budgetNote: 'push lands in ~1 s',
      what: '<p>The push service delivers to the phone over its own persistent connection. If the phone is offline, the provider stores it briefly and delivers later — or drops it if a newer message with the same <b>collapse key</b> replaces it.</p><p>About a second end to end, most of it outside your system. That’s why your own hops must stay small.</p>',
      data: ['Collapse key, e.g. <code>order-981</code>: an update replaces the older notification', 'Push TTL: drop an OTP that is minutes old rather than deliver it late'],
      tradeoffs: [
        { title: '“Sent” is not “seen”', body: 'Push providers acknowledge acceptance, not display. For important messages, keep an <b>in-app inbox</b> as the source of truth that the app syncs on open — push is the doorbell, not the mailbox.' },
      ],
    },

    /* ------------------------------ bulk path ------------------------------ */
    {
      title: 'A marketing campaign to 20 million users',
      phase: 'Bulk',
      async: true,
      active: ['campaign', 'api', 'fanout'],
      packets: [{ edge: 'c-a' }, { edge: 'a-f', delay: 650 }],
      budget: 1.2, budgetNote: 'bulk is measured in minutes, not seconds',
      what: '<p>The campaign tool submits <b>one request</b>: a template plus an audience segment (“users in India active in the last 30 days”). The API doesn’t expand it inline — that would mean writing 20 million messages inside one HTTP request.</p><p>Instead it hands the job to the audience fan-out service.</p>',
      data: ['Campaign: <code>campaign_id, segment_id, template, send_window, throttle</code>', 'Job progress: last processed user cursor (so a restart resumes, not restarts)'],
      tradeoffs: [
        { title: 'Send now vs at local time', body: 'Sending to everyone at once is simple, but 3 AM pushes get people to switch notifications off. Scheduling per time zone (“9 AM local”) spreads the load naturally across 24 hours — and is the main reason to keep <code>tz</code> in preferences.' },
      ],
    },
    {
      title: 'Fan-out in throttled batches',
      phase: 'Bulk',
      async: true,
      active: ['fanout', 'kafka'],
      packets: [{ edge: 'f-k' }],
      budget: 1.2, budgetNote: 'throttled to protect critical traffic',
      what: '<p>Fan-out pages through the segment in batches of a few thousand users and publishes one message per user to the <b>bulk</b> topic, at a controlled rate — say 20K/s, finishing in about 17 minutes.</p><p>It checkpoints its cursor after each batch, so if it crashes it resumes where it left off instead of messaging everyone twice.</p>',
      data: ['Batch cursor per campaign (resume point)', 'Bulk topic, partitioned by <code>user_id</code>'],
      tradeoffs: [
        { title: 'Fan-out speed vs everything else', body: 'Expanding at full speed creates a burst that every downstream system must absorb — dispatcher, preferences cache, providers (whose quotas are shared with critical traffic). A fixed send rate makes the campaign take longer but keeps the rest of the system healthy.' },
      ],
    },
    {
      title: 'Critical traffic jumps the queue',
      phase: 'Bulk',
      async: true,
      active: ['kafka', 'dispatcher'],
      packets: [{ edge: 'k-d', tone: 'money' }],
      budget: 1.2, budgetNote: 'OTP latency unaffected by the campaign',
      what: '<p>While 20M bulk messages flow, an OTP arrives on the critical topic. Dispatchers run <b>separate consumer pools per priority</b>, with more capacity reserved for critical. Bulk consumers can be paused or slowed when critical lag grows — critical consumers never are.</p><p>The same isolation continues downstream: separate channel queues per priority and a reserved share of each provider’s rate limit.</p>',
      data: ['Consumer lag per topic — the main health signal', 'Provider quota split, e.g. 30% reserved for critical'],
      tradeoffs: [
        { title: 'Strict priority vs weighted fairness', body: 'Strict priority (always drain critical first) can starve bulk forever during a busy period. Weighted sharing (e.g. 70/25/5) guarantees bulk still moves. Most systems use weights plus a hard reservation for the critical tier.' },
      ],
    },

    /* ------------------------------ failure ------------------------------ */
    {
      title: 'The SMS provider fails',
      phase: 'Failure',
      active: ['workers', 'retry'],
      fail: ['sms'],
      packets: [{ edge: 'w-sms', tone: 'danger' }, { edge: 'w-r', tone: 'danger', delay: 650 }],
      budget: 2.2, budgetNote: 'an SMS OTP misses its first attempt',
      what: '<p>An SMS OTP gets <code>503</code> from the SMS gateway. The worker classifies the error first:</p><ul><li><b>Permanent</b> (invalid number, unsubscribed): don’t retry; record and stop.</li><li><b>Transient</b> (timeout, 429, 5xx): schedule a retry.</li></ul><p>The retry goes to a <b>delay queue</b> with a due time computed by <b>exponential backoff with jitter</b>, and the worker moves on — it never sleeps holding the message.</p>',
      data: ['Retry message: <code>attempt</code>, <code>next_attempt_at</code>, last error', 'Circuit breaker per provider: stop calling it while it is failing'],
      tradeoffs: [
        { title: 'Retry the same provider or fail over?', body: 'For critical SMS, keep a second provider. After a few failures the circuit breaker opens and traffic routes to the backup — more expensive, but an OTP that arrives in 3 seconds beats a cheaper one that arrives after the user gave up.' },
      ],
    },
    {
      title: 'Retry after backoff, or give up to the DLQ',
      phase: 'Failure',
      active: ['retry', 'chq', 'dlq'],
      packets: [{ edge: 'r-c' }, { edge: 'r-dlq', tone: 'danger', delay: 700 }],
      budget: 4.2, budgetNote: 'second attempt succeeds — but only just',
      what: '<p>When the delay expires the message goes back to its channel queue and is attempted again. Delays grow — roughly 1 s, 2 s, 4 s, 8 s… capped at a few minutes — with random jitter so thousands of failed messages don’t all retry in the same second.</p><p>After the last attempt (or once the message has <b>expired</b> — an OTP is useless after 5 minutes), it goes to a <b>dead-letter queue</b> for alerting and inspection.</p>',
      data: ['Max attempts and <code>expires_at</code> per notification type', 'DLQ entries: message, every error, timestamps'],
      tradeoffs: [
        { title: 'Why jitter matters', body: 'Without jitter, every message that failed during an outage retries at the same moments: 1 s, 3 s, 7 s… The provider recovers and is immediately flattened again by a synchronised wave. Random jitter spreads retries out — try both in the retry lab above.' },
      ],
    },

    /* ------------------------------ tracking ------------------------------ */
    {
      title: 'Track delivery status',
      phase: 'Tracking',
      async: true,
      active: ['workers', 'log', 'status'],
      packets: [{ edge: 'w-log' }, { edge: 'e-s', delay: 300 }, { edge: 's-log', delay: 800 }],
      budget: 4.2, budgetNote: 'off the delivery path',
      what: '<p>Workers write each message’s state — <code>queued → sent → delivered / failed</code> — to the delivery log. Providers report what happens next through <b>webhooks</b>: delivered, bounced, opened, clicked, marked as spam.</p><p>Receipts also clean up data: a hard email bounce or an “unregistered” push token disables that address in preferences, so you stop paying to send to it.</p>',
      data: ['<code>(notification_id, message_id) → status, channel, provider_id, timestamps</code>', 'Provider id ↔ message_id mapping to match receipts', 'Retained ~90 days; aggregates kept longer'],
      tradeoffs: [
        { title: 'Webhooks are at-least-once and unordered', body: 'Providers retry webhooks and may send “opened” before “delivered”. Treat status as a state machine that only moves forward, and make updates idempotent by <code>(message_id, event)</code>.' },
      ],
    },
  ],
};
