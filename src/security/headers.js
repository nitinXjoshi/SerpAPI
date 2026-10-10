import { config } from '../config.js';

/**
 * Security response headers. Kept dependency-free and intentionally explicit so the
 * Content-Security-Policy matches exactly what the dashboard needs.
 *
 * The dashboard: same-origin API (connect-src 'self'), Chart.js from jsDelivr,
 * external news thumbnails (img-src https:), and inline `style="..."` attributes
 * in generated markup (style-src 'unsafe-inline').
 */
export function securityHeaders({ csp = config.csp.enabled } = {}) {
  const policy = [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return function securityHeadersMiddleware(req, res, next) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    if (csp) res.set('Content-Security-Policy', policy);
    // Only advertise HSTS when the request actually arrived over HTTPS.
    if (req.secure) {
      res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}
