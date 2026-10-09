import { config } from '../config.js';
import { logger } from '../logger.js';

const cache = { at: 0, models: null, host: null };
const TAGS_TTL_MS = 60 * 1000;

export async function listModels({ host = config.ollama.host, timeoutMs = 5000 } = {}) {
  if (cache.models && cache.host === host && Date.now() - cache.at < TAGS_TTL_MS) return cache.models;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map((m) => ({ name: m.name, size: m.size, modified: m.modified_at }));
    cache.models = models;
    cache.at = Date.now();
    cache.host = host;
    return models;
  } finally {
    clearTimeout(timer);
  }
}

/** Pick the configured model if present, otherwise the first installed model. */
export async function discoverModel({ host = config.ollama.host, preferred = config.ollama.model } = {}) {
  const models = await listModels({ host });
  if (!models.length) return null;
  if (preferred) {
    const exact = models.find((m) => m.name === preferred || m.name.split(':')[0] === preferred);
    if (exact) return exact.name;
  }
  return models[0].name;
}

export async function ollamaStatus() {
  try {
    const models = await listModels();
    return {
      available: true,
      host: config.ollama.host,
      configuredModel: config.ollama.model,
      models: models.map((m) => m.name),
    };
  } catch (err) {
    return { available: false, host: config.ollama.host, error: err.message, models: [] };
  }
}

/**
 * Call Ollama /api/chat requesting a JSON object. Returns { ok, content, model, error }.
 * Never throws — the caller decides how to degrade.
 */
export async function chatJson({
  system,
  prompt,
  model,
  host = config.ollama.host,
  timeoutMs = config.ollama.timeoutMs,
} = {}) {
  let chosen = model;
  try {
    if (!chosen) chosen = await discoverModel({ host });
    if (!chosen) return { ok: false, error: 'No Ollama model available.', model: null };
  } catch (err) {
    return { ok: false, error: `Ollama unreachable: ${err.message}`, model: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chosen,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}`, model: chosen };
    }
    const data = await res.json();
    return { ok: true, content: data?.message?.content ?? '', model: chosen };
  } catch (err) {
    const aborted = err.name === 'AbortError';
    logger.warn('ollama.chat.failed', { aborted, error: err.message });
    return { ok: false, error: aborted ? 'Ollama inference timed out.' : err.message, model: chosen };
  } finally {
    clearTimeout(timer);
  }
}
