/** A client-safe validation failure (mapped to HTTP 400). */
export class ValidationError extends Error {
  constructor(message, { field } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    if (field) this.field = field;
  }
}

/** Wrap an async handler so rejections reach the Express error handler. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Express error handler for ValidationError; falls through otherwise. */
export function validationErrorHandler(err, _req, res, next) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message, ...(err.field ? { field: err.field } : {}) });
  }
  return next(err);
}

/**
 * Replace an upstream provider error with a safe, non-disclosing message.
 * Provider responses can be returned to the caller, but any `error` field is
 * normalised so upstream text (which may contain URLs or internals) never leaks.
 */
export function sanitizeUpstream(data, { fallback = 'The upstream provider rejected the request.' } = {}) {
  if (!data || typeof data !== 'object') return { error: fallback };
  if (typeof data.error === 'string') return { ...data, error: fallback };
  return data;
}

/** Generic upstream failure message by HTTP status (never echoes provider text). */
export function upstreamErrorMessage(status) {
  if (status === 401 || status === 403) return 'Upstream provider rejected the credentials.';
  if (status === 429) return 'Upstream provider rate limit reached. Try again later.';
  if (status === 504) return 'Upstream provider timed out.';
  if (status >= 500) return 'Upstream provider error.';
  return 'Upstream request failed.';
}
