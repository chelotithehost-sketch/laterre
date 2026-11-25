/* net.js — the ONLY place in web/ that calls fetch() (TERRA_MASTER_SPEC.md §5.1).
   Every browser request goes through terraFetch(sourceId, opts):
     opts.path   → {placeholders} filled into the manifest url_template
     opts.query  → query string params
     opts.ttl    → cache override (seconds)
     opts.raw    → return the Response instead of parsed JSON
   Per-host token bucket · memory+sessionStorage cache · in-flight de-dupe ·
   debounce · backoff+Retry-After · circuit breaker (3 fails → offline 5 min,
   fallback source takes over) · visibility-aware polling · session budgets. */
(function () {
  const M = (D.manifest && D.manifest.sources) || {};
  const mem = new Map();                 // url → {t, data}
  let ses = null;
  try { ses = window.sessionStorage; } catch (e) { ses = null; }

  const hostBuckets = new Map();         // host → {tokens, last, cap, refill}
  const inflight = new Map();            // url → promise
  const stats = { hits: 0, misses: 0, queued: 0, failures: 0, served_stale: 0 };
  const offline = new Map();             // sourceId → offline-until ms
  const strikes = new Map();             // sourceId → consecutive failures
  const toolBudget = { count: 0, windowStart: 0 };

  function src(id) { return M[id] || null; }

  function buildUrl(id, opts) {
    const s = src(id);
    if (!s) return null;
    let u = s.url_template;
    for (const [k, v] of Object.entries(opts.path || {}))
      u = u.replace('{' + k + '}', encodeURIComponent(v));
    const q = Object.entries(opts.query || {}).filter(([, v]) => v != null)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    if (q) u += (u.includes('?') ? '&' : '?') + q;
    return u;
  }

  function bucket(host, cfg) {
    if (!hostBuckets.has(host)) {
      const cap = (cfg && cfg.requests) || 5;
      hostBuckets.set(host, { tokens: cap, last: Date.now(), cap, refill: cap / ((cfg && cfg.per_seconds) || 60) });
    }
    return hostBuckets.get(host);
  }

  function takeToken(host, cfg) {         // returns ms to wait (0 = go now)
    const b = bucket(host, cfg);
    const now = Date.now();
    b.tokens = Math.min(b.cap, b.tokens + (now - b.last) / 1000 * b.refill);
    b.last = now;
    if (b.tokens >= 1) { b.tokens -= 1; return 0; }
    stats.queued++;
    return Math.ceil((1 - b.tokens) / b.refill * 1000);
  }

  function cacheGet(url, ttl, id) {
    const hit = mem.get(url);
    const t = ttl || (src(id) && src(id).ttl_seconds) || 300;
    if (hit && Date.now() - hit.t < t * 1000) { stats.hits++; return { fresh: true, data: hit.data }; }
    if (ses) {
      try {
        const raw = ses.getItem('terra:' + url);
        if (raw) {
          const o = JSON.parse(raw);
          if (Date.now() - o.t < t * 1000) { stats.hits++; mem.set(url, o); return { fresh: true, data: o.data }; }
          return { fresh: false, data: o.data };       // stale-while-revalidate
        }
      } catch (e) { /* sandboxed storage — ignore */ }
    }
    return hit ? { fresh: false, data: hit.data } : { fresh: false, data: undefined };
  }

  function cacheSet(url, data) {
    mem.set(url, { t: Date.now(), data });
    if (ses) { try { ses.setItem('terra:' + url, JSON.stringify({ t: Date.now(), data })); } catch (e) { /* full */ } }
  }

  function markFail(id) {
    stats.failures++;
    const n = (strikes.get(id) || 0) + 1;
    strikes.set(id, n);
    if (n >= 3) { offline.set(id, Date.now() + 5 * 60 * 1000); }   // circuit breaker
  }

  function isOffline(id) {
    const until = offline.get(id);
    if (!until) return false;
    if (Date.now() > until) { offline.delete(id); strikes.set(id, 0); return false; }
    return true;
  }

  async function oneShot(id, url, opts) {
    const s = src(id);
    const host = new URL(url).host;
    const wait = takeToken(host, s && s.budget);
    if (wait) await new Promise(r => setTimeout(r, wait));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const headers = Object.assign({}, (s && s.headers) || {}, opts.headers || {});
        const r = await fetch(url, { headers, signal: opts.signal || AbortSignal.timeout(12000) });
        if (r.status === 429 || r.status === 503) {
          const ra = parseFloat(r.headers.get('retry-after') || '') || Math.pow(2, attempt);
          await new Promise(res => setTimeout(res, Math.min(ra, 20) * 1000 + Math.random() * 400));
          continue;
        }
        if (!r.ok) { markFail(id); return null; }
        strikes.set(id, 0);
        return opts.raw ? r : await r.json();
      } catch (e) {
        if (opts.signal && opts.signal.aborted) return null;
        await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 1000 + Math.random() * 400));
      }
    }
    markFail(id);
    return null;
  }

  /* terraFetch — the choke point. Returns parsed JSON, or null on failure. */
  async function terraFetch(id, opts) {
    opts = opts || {};
    const url = buildUrl(id, opts);
    if (!url) return null;
    const cached = cacheGet(url, opts.ttl, id);
    if (cached.fresh) return cached.data;
    if (inflight.has(url)) return inflight.get(url);
    if (isOffline(id)) {                              // circuit open → fallback source, else stale
      const fb = src(id) && src(id).fallback;
      if (fb && !isOffline(fb)) return terraFetch(fb, opts);
      if (cached.data !== undefined) { stats.served_stale++; return cached.data; }
      return null;
    }
    const p = (async () => {
      stats.misses++;
      let data = await oneShot(id, url, opts);
      if (data === null && src(id) && src(id).fallback) data = await terraFetch(src(id).fallback, opts);
      if (data === null && cached.data !== undefined) { stats.served_stale++; data = cached.data; }
      if (data !== null && !opts.raw) cacheSet(url, data);
      inflight.delete(url);
      return data;
    })();
    inflight.set(url, p);
    return p;
  }

  /* debounce + cancel for the omnibox (350 ms) */
  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* visibility-aware polling: pauses when the tab is hidden, refreshes on resume */
  function poll(fn, ms) {
    let timer = null, stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (!document.hidden) await fn();
      timer = setTimeout(tick, ms);
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !stopped) { clearTimeout(timer); tick(); }   // one immediate refresh
      else clearTimeout(timer);
    });
    timer = setTimeout(tick, ms);
    return () => { stopped = true; clearTimeout(timer); };
  }

  /* session budget for user-triggered tools (DNS/RDAP/IP ≤ 10/min) */
  function toolAllowed() {
    const now = Date.now();
    if (now - toolBudget.windowStart > 60000) { toolBudget.windowStart = now; toolBudget.count = 0; }
    if (toolBudget.count >= 10) return false;
    toolBudget.count++;
    return true;
  }

  /* terraFetchURL — same pipeline for manifest asset URLs (CDN GeoJSON etc.),
     so no raw fetch() ever exists outside this file. */
  async function terraFetchURL(url, ttlSeconds, opts) {
    opts = opts || {};
    const cached = cacheGet(url, ttlSeconds, 'asset');
    if (cached.fresh) return cached.data;
    if (inflight.has(url)) return inflight.get(url);
    const p = (async () => {
      stats.misses++;
      let data = await oneShot('asset', url, opts);
      if (data === null && cached.data !== undefined) { stats.served_stale++; data = cached.data; }
      if (data !== null && !opts.raw) cacheSet(url, data);
      inflight.delete(url);
      return data;
    })();
    inflight.set(url, p);
    return p;
  }

  /* reachability probe (no-cors): succeeds when the server answers at all.
     Used by the "is it down?" card so no fetch exists outside this file. */
  async function probe(url) {
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      return true;
    } catch (e) { return false; }
  }

  window.terraFetch = terraFetch;
  window.terraFetchURL = terraFetchURL;
  window.TERRA_NET = {
    stats: () => Object.assign({}, stats, {
      offline: [...offline.keys()],
      buckets: [...hostBuckets.entries()].map(([h, b]) => [h, Math.round(b.tokens * 10) / 10])
    }),
    url: buildUrl,
    debounce, poll, toolAllowed, probe,
    offlineSources: () => [...offline.keys()]
  };
})();
