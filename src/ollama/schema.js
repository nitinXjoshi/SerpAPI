function asString(v) {
  if (v == null) return '';
  return typeof v === 'string' ? v.trim() : String(v);
}
function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function clamp01(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * Validate and coerce the model's investigation output. Never trust the shape —
 * the model may omit, rename or invent fields.
 */
export function validateInvestigation(raw) {
  const errors = [];
  const obj = raw && typeof raw === 'object' ? raw : null;
  if (!obj) return { valid: false, errors: ['output is not a JSON object'], value: null };

  const out = {
    event_title: asString(obj.event_title ?? obj.title),
    category: asString(obj.category) || 'other',
    summary: asString(obj.summary ?? obj.analysis ?? obj.description),
    key_claims: asArray(obj.key_claims ?? obj.claims)
      .map((c) =>
        typeof c === 'string'
          ? { claim: asString(c), attribution: '', source_url: '' }
          : {
              claim: asString(c?.claim ?? c?.text),
              attribution: asString(c?.attribution ?? c?.type),
              source_url: asString(c?.source_url ?? c?.url),
            },
      )
      .filter((c) => c.claim),
    entities: asArray(obj.entities)
      .map((e) =>
        typeof e === 'string' ? { symbol: '', name: asString(e) } : { symbol: asString(e?.symbol), name: asString(e?.name) },
      )
      .filter((e) => e.symbol || e.name),
    novelty: asString(obj.novelty),
    contradictions: asArray(obj.contradictions)
      .map((c) => (typeof c === 'string' ? c : asString(c?.description ?? c?.summary ?? c?.claim)))
      .filter(Boolean),
    impact: {
      direction: asString(obj.impact?.direction ?? obj.direction) || 'unclear',
      magnitude: asString(obj.impact?.magnitude ?? obj.magnitude) || 'unknown',
      rationale: asString(obj.impact?.rationale ?? obj.rationale),
    },
    confidence: clamp01(Number(obj.confidence)),
    uncertainty_notes: asArray(obj.uncertainty_notes ?? obj.uncertainties).map(asString).filter(Boolean),
    follow_up_queries: asArray(obj.follow_up_queries ?? obj.followups).map(asString).filter(Boolean),
  };

  if (!out.event_title) errors.push('missing event_title');
  if (!out.summary) errors.push('missing summary');
  if (out.confidence == null) {
    errors.push('missing/invalid confidence');
    out.confidence = 0.3;
  }
  return { valid: errors.length === 0, errors, value: out };
}

/** Safe parse of a JSON string from the model (tolerates code fences). */
export function parseModelJson(content) {
  if (!content) return null;
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
