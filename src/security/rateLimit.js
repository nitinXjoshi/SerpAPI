/**
 * Lightweight in-memory protections — no external dependency.
 * Suitable for a single-process local server; state is not shared across instances.
 */

/** Fixed-window-ish limiter: at most `max` requests per `windowMs` per key. */
export function createRateLimiter({ windowMs = 60_000, max = 120, message = 'Too many requests. Please slow down.' } = {}) {
  const hits = new Map();

  const prune = () => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  };
  const timer = setInterval(prune, Math.max(10_000, Math.min(windowMs, 60_000)));
  timer.unref?.();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const times = (hits.get(key) || []).filter((t) => t > now - windowMs);
    if (times.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    times.push(now);
    hits.set(key, times);
    next();
  };
}

/**
 * Coarse per-second limiter for the most expensive endpoints (search, news,
 * market polling, validation, Ollama investigation).
 */
export function createBurstLimiter({ windowMs = 1000, max = 5, message = 'Too many requests for this operation.' } = {}) {
  return createRateLimiter({ windowMs, max, message });
}

/** Allow at most `max` concurrent in-flight requests for a guarded route. */
export function createConcurrencyGuard(max = 1, message = 'Another operation is already running. Please wait.') {
  let active = 0;
  return function guard(_req, res, next) {
    if (active >= max) return res.status(429).json({ error: message });
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}
