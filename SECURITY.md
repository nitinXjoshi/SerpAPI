# Security Policy

## Reporting a vulnerability

Please report security issues **privately** using GitHub's private vulnerability reporting:

- Go to the repository's **Security** tab → **Report a vulnerability**
  (this opens a private GitHub Security Advisory visible only to maintainers).

Please do **not** open a public issue for a suspected vulnerability, and do not include real
API keys, database files, or personal data in a report. A minimal, sanitised reproduction is
far more useful than raw secrets.

There is no bug-bounty programme. Reports are handled on a best-effort basis.

## Scope and threat model

This project is designed to run **locally, on a trusted machine**, and to be reachable only
from `localhost`:

- The server binds to `127.0.0.1` by default (`HOST` changes this).
- Administrative and data APIs require an authenticated session.
- The local **Ollama** service (`http://localhost:11434`) is assumed to be trusted and
  local-only.

**It is not hardened for public internet exposure.** If you set `HOST=0.0.0.0`, place it
behind a trusted reverse proxy with TLS, and understand that you are exposing an
administrative tool and your locally stored provider keys.

## Supported versions

Only the latest `master` is supported. Security fixes are applied there.

## Security-relevant behaviour to be aware of

- **Authentication:** admin credentials come from `ADMIN_USERNAME`/`ADMIN_PASSWORD` or
  `ADMIN_TOKEN`. If neither is set, a one-time token is generated at startup and printed to
  the **server console** (never the browser). `AUTH_DISABLED=true` is an explicit,
  insecure, local-only bypass and is never enabled by default.
- **Sessions:** HttpOnly, `SameSite=Strict` cookies (Secure when served over HTTPS), stored
  in memory and lost on restart. State-changing requests are additionally same-origin checked.
- **Secrets:** provider keys are encrypted at rest with AES-256-GCM. The encryption key comes
  from `APP_ENCRYPTION_KEY` or a generated `data/encryption.key` (mode `0600`, outside Git).
  Keys are never returned to the browser (masked + last 4 only) and never logged.
- **No client-supplied keys:** the browser never sends provider keys; all provider calls are
  server-side.
- **Outbound calls:** the app contacts SerpApi, Twelve Data, and your local Ollama. It makes
  **no** calls at all when `DEMO_MODE=true` or when the relevant provider key is absent.

## For operators

- Do not commit `.env`, `data/`, `data/encryption.key`, or logs. `.gitignore` covers these
  and `npm run check` fails if any are tracked.
- Rotate provider keys if a machine hosting them is compromised; delete the key in the
  dashboard **API Keys** page and re-add it.
- Keep the machine patched and keep Ollama bound to localhost.
