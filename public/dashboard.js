/* Trading Intelligence Dashboard — vanilla JS, no build step. */

const $ = (sel, root = document) => root.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function money(v, cur = '') {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${cur && cur !== 'USD' ? cur + ' ' : ''}${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}
function cls(v) {
  return Number(v) < 0 ? 'down' : Number(v) > 0 ? 'up' : '';
}
function relTime(iso) {
  if (!iso) return '—';
  const d = Date.now() - Date.parse(iso);
  const m = Math.round(d / 60000);
  if (Math.abs(m) < 1) return 'just now';
  if (Math.abs(m) < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function dt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: opts?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

const DECISION = {
  potential_opportunity: { label: 'POTENTIAL OPPORTUNITY', cls: 'opp' },
  watch: { label: 'WATCH', cls: 'watch' },
  insufficient_evidence: { label: 'INSUFFICIENT EVIDENCE', cls: 'insufficient' },
  no_trade: { label: 'NO TRADE', cls: 'no' },
};

const ROUTES = [
  ['#/radar', 'Market Radar'],
  ['#/events', 'Event Feed'],
  ['#/replay', 'Replay'],
  ['#/settings', 'Settings'],
  ['#/keys', 'API Keys'],
];

function renderNav(active) {
  $('#dash-nav').innerHTML = ROUTES.map(
    ([href, label]) => `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`,
  ).join('');
}

async function renderStatusBar() {
  try {
    const s = await api('/api/status');
    const keyed = s.secrets.filter((x) => x.configured).length;
    $('#dash-status').innerHTML = `
      <span class="pill ${s.monitoring.enabled ? 'ok' : 'muted'}">monitoring ${s.monitoring.enabled ? 'ON' : 'off'}</span>
      <span class="pill">${esc(s.scheduler ? (s.scheduler.lockHeld ? 'scheduler: leader' : 'scheduler: standby') : '')}</span>
      <span class="pill ${s.ollama.available ? 'ok' : 'warn'}">ollama ${s.ollama.available ? esc(s.ollama.selectedModel || s.ollama.models?.[0] || 'ready') : 'offline'}</span>
      <span class="pill">${keyed}/2 keys</span>`;
    return s;
  } catch (e) {
    $('#dash-status').innerHTML = `<span class="pill warn">status unavailable</span>`;
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Market Radar                                                        */
/* ------------------------------------------------------------------ */

async function viewRadar() {
  renderNav('#/radar');
  const view = $('#view');
  view.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading market radar…</p></div>`;
  const [radar, status] = await Promise.all([api('/api/market/radar'), api('/api/status')]);

  const td = radar.usage.twelvedata;
  const newsBudget = status.budget?.news;
  const acct = status.account;

  view.innerHTML = `
    <div class="dash-head">
      <div>
        <h2>Market Radar</h2>
        <p class="muted">Provider: <strong>${esc(radar.provider.label)}</strong>
          ${radar.provider.isFallback ? '<span class="pill warn">fixture — not live data</span>' : ''}
          · market ${radar.marketStatus.open ? '<span class="up">open</span>' : `<span class="muted">closed (${esc(radar.marketStatus.reason)})</span>`}
          · last update ${relTime(radar.lastMarketUpdate)}
        </p>
      </div>
      <div class="actions">
        <button class="btn" data-act="poll">Run market poll</button>
        <button class="btn" data-act="news">Run news cycle</button>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric"><div class="k">Coverage</div><div class="v">${radar.coverage.withData}/${radar.coverage.watchlistEnabled}</div><div class="d">symbols with observations</div></div>
      <div class="metric"><div class="k">Twelve Data today</div><div class="v">${td.creditsToday}</div><div class="d">of ${td.perDay} credits · ${td.perMinute}/min</div></div>
      <div class="metric"><div class="k">SerpApi remaining</div><div class="v">${acct ? acct.searchesLeft : (newsBudget ? newsBudget.remaining : '—')}</div><div class="d">of ${acct ? acct.searchesPerMonth : (newsBudget ? newsBudget.monthly : '—')} / month</div></div>
      <div class="metric"><div class="k">News budget/cycle</div><div class="v">${newsBudget ? newsBudget.allowed : '—'}</div><div class="d">carry ${newsBudget ? newsBudget.carry.toFixed(2) : '—'}</div></div>
    </div>

    <div class="card">
      <div class="sec-head"><h2>Watchlist</h2><div class="muted">${radar.rows.length} symbols</div></div>
      <div class="table-scroll">
        <table class="data grid-watch">
          <thead><tr><th>Symbol</th><th>Last</th><th>Chg%</th><th>vs benchmark</th><th>vs peers</th><th>Time</th><th>Source</th></tr></thead>
          <tbody>
            ${radar.rows.map((r) => `
              <tr class="${r.anomalous ? 'row-anom' : ''}">
                <td><strong>${esc(r.symbol)}</strong>${r.anomalous ? ' <span class="pill warn">anomaly</span>' : ''}<br><span class="muted">${esc(r.companyName || '')}</span></td>
                <td>${money(r.price, r.currency)}</td>
                <td class="${cls(r.changePct)}">${pct(r.changePct)}</td>
                <td class="${cls(r.divergence)}">${r.divergence == null ? '—' : pct(r.divergence)}<br><span class="muted">${esc(r.benchmarkSymbol || '')} ${r.benchmarkChangePct == null ? '' : pct(r.benchmarkChangePct)}</span></td>
                <td class="${cls(r.peerDivergence)}">${r.peerDivergence == null ? '—' : pct(r.peerDivergence)}</td>
                <td>${r.hasData ? esc(dt(r.marketTs)) : '—'}<br>${r.stale ? '<span class="pill muted">stale</span>' : '<span class="pill ok">fresh</span>'}</td>
                <td><span class="pill ${r.source === 'fixture' ? 'warn' : ''}">${esc(r.source || '—')}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="sec-head"><h2>Notifications</h2></div>
      <div id="notifications" class="notif-list"><span class="muted">Loading…</span></div>
    </div>`;

  view.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    e.target.disabled = true;
    try {
      if (act === 'poll') {
        const r = await api('/api/market/poll', { method: 'POST', body: { force: true } });
        toast(`Market poll: ${r.result.quotes?.length || 0} quotes (${r.result.provider})`, 'ok');
      } else {
        const r = await api('/api/news/run', { method: 'POST', body: { force: true } });
        toast(`News cycle: ${r.summary.articlesNew} articles, ${r.summary.eventsNew} events`, 'ok');
      }
      renderStatusBar();
      viewRadar();
    } catch (err) {
      toast(err.message, 'warn');
    } finally {
      e.target.disabled = false;
    }
  });

  loadNotifications();
}

async function loadNotifications() {
  const holder = $('#notifications');
  if (!holder) return;
  try {
    const { notifications } = await api('/api/events/notifications?limit=20');
    if (!notifications.length) {
      holder.innerHTML = '<span class="muted">No notifications yet.</span>';
      return;
    }
    const events = (await api('/api/events?limit=50')).events;
    const byId = new Map(events.map((e) => [e.id, e]));
    holder.innerHTML = notifications
      .map((n) => {
        const ev = byId.get(n.eventId);
        const score = ev ? `${ev.score}` : '—';
        const dec = ev ? DECISION[ev.decision] || { label: ev.decision || '', cls: 'muted' } : { label: '', cls: 'muted' };
        return `<a class="notif" href="#/event/${n.eventId}">
          <span class="score-badge ${dec.cls}">${esc(score)}</span>
          <span><strong>${esc(ev ? ev.title : 'Event #' + n.eventId)}</strong>
            <br><span class="muted">${esc(dec.label)} · ${relTime(n.createdAt)}</span></span>
        </a>`;
      })
      .join('');
  } catch (e) {
    holder.innerHTML = `<span class="muted">${esc(e.message)}</span>`;
  }
}

/* ------------------------------------------------------------------ */
/* Event Feed                                                          */
/* ------------------------------------------------------------------ */

async function viewEvents() {
  renderNav('#/events');
  const view = $('#view');
  view.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading events…</p></div>`;
  const { events } = await api('/api/events?limit=100');

  view.innerHTML = `
    <div class="dash-head">
      <div><h2>Event Feed</h2><p class="muted">${events.length} events · deduplicated &amp; clustered</p></div>
      <div class="actions">
        <button class="btn" data-act="investigate-pending">Investigate pending</button>
        <button class="btn" data-act="news">Run news cycle</button>
      </div>
    </div>
    <div id="event-list" class="event-list">
      ${events.length ? events.map(eventCard).join('') : '<div class="card">No events yet. Run a news cycle.</div>'}
    </div>`;

  view.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('[data-id]')?.dataset.id;
    try {
      if (act === 'investigate-pending') {
        e.target.disabled = true;
        const r = await api('/api/ollama/investigate-pending', { method: 'POST', body: { limit: 2 } });
        toast(`Investigated ${r.processed} event(s)`, 'ok');
        viewEvents();
        return;
      }
      if (act === 'news') {
        e.target.disabled = true;
        const r = await api('/api/news/run', { method: 'POST', body: { force: true } });
        toast(`News cycle: ${r.summary.articlesNew} articles, ${r.summary.eventsNew} events`, 'ok');
        viewEvents();
        return;
      }
      if (act === 'status') {
        const status = e.target.dataset.status;
        await api(`/api/events/${id}/status`, { method: 'POST', body: { status } });
        toast(`Event #${id} → ${status}`, 'ok');
        viewEvents();
        return;
      }
      if (act === 'investigate') {
        e.target.disabled = true;
        toast(`Investigating event #${id} with Ollama…`);
        const r = await api(`/api/events/${id}/investigate`, { method: 'POST', body: {} });
        toast(r.ok ? `Investigated with ${r.model}` : `Investigation failed: ${r.error}`, r.ok ? 'ok' : 'warn');
        viewEvents();
      }
    } catch (err) {
      toast(err.message, 'warn');
    }
  });
}

function eventCard(e) {
  const dec = DECISION[e.decision] || { label: e.decision || 'unscored', cls: 'muted' };
  const active = e.reactions?.filter((r) => r.changePct != null) || [];
  return `
    <div class="card event-card" data-id="${e.id}">
      <div class="event-head">
        <div class="event-score">
          <span class="score-badge ${dec.cls}">${e.score == null ? '—' : e.score}</span>
          <span class="decision ${dec.cls}">${esc(dec.label)}</span>
        </div>
        <div class="event-title">
          <a href="#/event/${e.id}"><strong>${esc(e.title)}</strong></a>
          <div class="muted">
            ${(e.symbols || []).map((s) => `<span class="pill sym">${esc(s)}</span>`).join(' ')}
            <span class="pill">${esc(e.category || 'other')}</span>
            <span class="pill ${e.status === 'new' ? 'ok' : 'muted'}">${esc(e.status)}</span>
          </div>
        </div>
      </div>
      ${e.summary ? `<p class="event-summary">${esc(String(e.summary).slice(0, 320))}</p>` : '<p class="muted">Not yet investigated — deterministic score only.</p>'}
      <div class="event-meta">
        <span>first seen ${relTime(e.firstSeenTs)}</span>
        <span>updated ${relTime(e.lastUpdatedTs)}</span>
        <span>${e.evidence.articleCount} articles · ${e.evidence.independentReports} independent · ${e.evidence.syndicated} syndicated</span>
        <span>confidence ${e.confidence == null ? '—' : e.confidence}</span>
      </div>
      ${active.length ? `<div class="reactions">${active
        .map((r) => `<span class="pill ${r.stale ? 'muted' : ''}">${esc(r.symbol)} <b class="${cls(r.changePct)}">${pct(r.changePct)}</b> <span class="muted">${dt(r.marketTs)}${r.stale ? ' · stale' : ''}</span></span>`)
        .join('')}</div>` : ''}
      ${(e.uncertain && e.uncertain.length) ? `<div class="uncertain">⚠ ${esc(e.uncertain.slice(0, 2).join(' '))}</div>` : ''}
      <div class="event-actions">
        <button class="btn small" data-act="investigate" data-id="${e.id}">Investigate</button>
        <button class="btn small ghost" data-act="status" data-id="${e.id}" data-status="saved">Save</button>
        <button class="btn small ghost" data-act="status" data-id="${e.id}" data-status="acknowledged">Ack</button>
        <button class="btn small ghost" data-act="status" data-id="${e.id}" data-status="dismissed">Dismiss</button>
        <a class="btn small ghost" href="#/event/${e.id}">Open</a>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Event detail                                                        */
/* ------------------------------------------------------------------ */

async function viewEvent(id) {
  renderNav('#/events');
  const view = $('#view');
  view.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading event…</p></div>`;
  const d = await api(`/api/events/${id}`);
  const e = d.event;
  const dec = DECISION[e.decision] || { label: e.decision || 'unscored', cls: 'muted' };
  const bd = e.evidence?.components || null;

  view.innerHTML = `
    <div class="dash-head">
      <div>
        <a class="muted" href="#/events">← back to events</a>
        <h2>${esc(e.title)}</h2>
        <p class="muted">
          ${(e.symbols || []).map((s) => `<span class="pill sym">${esc(s)}</span>`).join(' ')}
          <span class="pill">${esc(e.category || 'other')}</span>
          <span class="pill">${esc(e.status)}</span>
        </p>
      </div>
      <div class="actions">
        <span class="score-badge big ${dec.cls}">${e.score == null ? '—' : e.score}</span>
        <span class="decision ${dec.cls}">${esc(dec.label)}</span>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric"><div class="k">Confidence</div><div class="v">${e.confidence ?? '—'}</div><div class="d">heuristic index, not a probability</div></div>
      <div class="metric"><div class="k">Independent reports</div><div class="v">${d.evidence.independentReports}</div><div class="d">${d.evidence.articleCount} articles · ${d.evidence.syndicated} syndicated</div></div>
      <div class="metric"><div class="k">First detected</div><div class="v small">${dt(e.firstSeenTs)}</div><div class="d">${relTime(e.firstSeenTs)}</div></div>
      <div class="metric"><div class="k">Last updated</div><div class="v small">${dt(e.lastUpdatedTs)}</div><div class="d">${relTime(e.lastUpdatedTs)}</div></div>
    </div>

    ${e.summary ? `<div class="card"><div class="sec-head"><h2>Summary <span class="pill">model-generated</span></h2></div><p>${esc(e.summary)}</p>
      ${e.model?.impact ? `<p class="muted">Impact read: <strong>${esc(e.model.impact.direction)}</strong> / ${esc(e.model.impact.magnitude)} — ${esc(e.model.impact.rationale || '')}</p>` : ''}
      ${e.model?.novelty ? `<p class="muted">Novelty: ${esc(e.model.novelty)}</p>` : ''}
    </div>` : '<div class="card"><p class="muted">Not investigated yet. Run <em>Investigate</em> to generate a summary.</p></div>'}

    ${e.model?.key_claims?.length ? `<div class="card"><div class="sec-head"><h2>Key claims <span class="pill">reported</span></h2></div>
      <ul class="claims">${e.model.key_claims.map((c) => `<li>${esc(c.claim)} ${c.source_url ? `<a class="inline" href="${esc(c.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}${c.attribution ? ` <span class="muted">(${esc(c.attribution)})</span>` : ''}</li>`).join('')}</ul></div>` : ''}

    ${(e.model?.contradictions?.length || e.uncertain?.length) ? `<div class="card"><div class="sec-head"><h2>Contradictions &amp; uncertainty</h2></div>
      ${e.model?.contradictions?.length ? `<ul class="contradictions">${e.model.contradictions.map((c) => `<li>⚠ ${esc(c)}</li>`).join('')}</ul>` : ''}
      ${e.uncertain?.length ? `<ul class="uncertain-list">${e.uncertain.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}</div>` : ''}

    <div class="card">
      <div class="sec-head"><h2>Market context</h2></div>
      <div class="table-scroll"><table class="data">
        <thead><tr><th>Symbol</th><th>Before event</th><th>After event</th><th>Current</th><th>Observation time</th></tr></thead>
        <tbody>${d.context.map((c) => `<tr>
          <td><strong>${esc(c.symbol)}</strong></td>
          <td>${c.before ? money(c.before.price) : '—'}</td>
          <td>${c.after ? money(c.after.price) : '—'}</td>
          <td>${c.current ? money(c.current.price) + ' <span class="' + cls(c.current.changePct) + '">' + pct(c.current.changePct) + '</span>' : '—'}</td>
          <td>${c.current ? dt(c.current.marketTs) + (c.current.stale ? ' <span class="pill muted">stale</span>' : '') : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    ${bd ? `<div class="card"><div class="sec-head"><h2>Why this score</h2><span class="pill">${e.score}</span></div>
      <div class="components">${Object.entries(bd).map(([k, v]) => `<div class="comp"><span>${esc(k)}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div><span class="muted">${v}</span></div>`).join('')}</div>
      ${e.evidence?.weights ? `<p class="muted">weights: ${Object.entries(e.evidence.weights).map(([k, v]) => `${esc(k)}=${v}`).join(', ')}</p>` : ''}
      ${e.evidence?.notes ? `<ul class="muted">${e.evidence.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${e.evidence?.gates?.length ? `<p class="muted">${e.evidence.gates.map(esc).join(' ')}</p>` : ''}
      <p class="disclaimer">${esc(e.evidence?.disclaimer || 'Ranking score, not a probability of profit.')}</p>
    </div>` : ''}

    <div class="card">
      <div class="sec-head"><h2>Evidence (${d.evidence.articleCount} articles)</h2><span class="muted">${d.evidence.independentReports} independent reports</span></div>
      <ul class="articles">
        ${d.articles.map((a) => `<li>
          <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.headline)}</a>
          <div class="muted">${esc(a.source || a.sourceDomain)} · published ${dt(a.publishedTs)} · first seen ${dt(a.firstSeenTs)}${a.isPrimary ? ' · <span class="pill sym">primary</span>' : ''}</div>
        </li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <div class="sec-head"><h2>Timeline</h2></div>
      <ul class="timeline">
        ${d.timeline.map((t) => `<li class="tl-${esc(t.kind)}"><span class="tl-time">${dt(t.ts)}</span><span class="tl-label">${esc(t.label)}${t.url ? ` <a class="inline" href="${esc(t.url)}" target="_blank" rel="noopener">↗</a>` : ''}</span></li>`).join('')}
      </ul>
      <p class="muted">Timeline shows only what the system could have known at each timestamp.</p>
    </div>

    <div class="card">
      <div class="sec-head"><h2>Actions</h2></div>
      <div class="event-actions">
        <button class="btn" data-act="investigate" data-id="${e.id}">Re-investigate</button>
        <button class="btn ghost" data-act="status" data-id="${e.id}" data-status="saved">Save</button>
        <button class="btn ghost" data-act="status" data-id="${e.id}" data-status="acknowledged">Acknowledge</button>
        <button class="btn ghost" data-act="status" data-id="${e.id}" data-status="dismissed">Dismiss</button>
        <button class="btn ghost" data-act="followup" data-id="${e.id}">Follow-up searches</button>
      </div>
      <div id="followup" class="muted"></div>
      <p class="disclaimer">The system does not trade. Any action is a human decision.</p>
    </div>`;

  view.addEventListener('click', async (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const eid = ev.target.closest('[data-id]')?.dataset.id;
    try {
      if (act === 'investigate') {
        ev.target.disabled = true;
        toast('Investigating with Ollama…');
        const r = await api(`/api/events/${eid}/investigate`, { method: 'POST', body: {} });
        toast(r.ok ? `Done (${r.model})` : `Failed: ${r.error}`, r.ok ? 'ok' : 'warn');
        viewEvent(id);
      } else if (act === 'status') {
        await api(`/api/events/${eid}/status`, { method: 'POST', body: { status: ev.target.dataset.status } });
        toast(`Marked ${ev.target.dataset.status}`, 'ok');
        viewEvent(id);
      } else if (act === 'followup') {
        const r = await api(`/api/events/${eid}/followup`, { method: 'POST', body: {} });
        $('#followup').innerHTML = r.suggestedQueries.length
          ? `<p>Suggested follow-up queries (not executed):</p><ul>${r.suggestedQueries.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`
          : '<p>No follow-up queries suggested.</p>';
      }
    } catch (err) {
      toast(err.message, 'warn');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function num(id, v, step = 1) {
  return `<input id="${id}" type="number" step="${step}" value="${v}" />`;
}
function checkbox(id, v) {
  return `<input id="${id}" type="checkbox" ${v ? 'checked' : ''} />`;
}

async function viewSettings() {
  renderNav('#/settings');
  const view = $('#view');
  const [{ settings }, status, { watchlist }] = await Promise.all([
    api('/api/settings'),
    api('/api/status'),
    api('/api/watchlist'),
  ]);
  const w = settings.scoring.weights;

  view.innerHTML = `
    <div class="dash-head"><div><h2>Settings</h2><p class="muted">Persisted on the server</p></div>
      <div class="actions"><button class="btn" id="save-settings">Save settings</button></div></div>

    <div class="settings-grid">
      <div class="card">
        <div class="sec-head"><h2>Monitoring</h2></div>
        <label class="field">Enabled ${checkbox('s-enabled', settings.monitoring.enabled)}</label>
        <label class="field">News interval (min) ${num('s-news', settings.monitoring.newsIntervalMinutes)}</label>
        <label class="field">Market interval (min) ${num('s-mkt', settings.monitoring.marketIntervalMinutes)}</label>
        <label class="field">Market hours only ${checkbox('s-hours', settings.monitoring.marketHoursOnly)}</label>
        <label class="field">Backfill window (h) ${num('s-backfill', settings.monitoring.backfillHours)}</label>
        <label class="field">Auto-investigate ${checkbox('s-auto-inv', settings.monitoring.autoInvestigate)}</label>
        <label class="field">Max investigations/cycle ${num('s-max-inv', settings.monitoring.maxInvestigationsPerCycle)}</label>
      </div>

      <div class="card">
        <div class="sec-head"><h2>Providers &amp; budget</h2></div>
        <label class="field">Market provider
          <select id="s-mkt-prov">${['auto', 'twelvedata', 'fixture'].map((p) => `<option ${settings.providers.market === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        </label>
        <label class="field">News provider
          <select id="s-news-prov">${['auto', 'serpapi', 'fixture'].map((p) => `<option ${settings.providers.news === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        </label>
        <label class="field">SerpApi monthly searches ${num('s-serp-mo', settings.budget.serpapiMonthlySearches)}</label>
        <label class="field">SerpApi reserve fraction ${num('s-serp-res', settings.budget.serpapiReserveFraction, 0.05)}</label>
        <label class="field">Twelve Data credits/min ${num('s-td-min', settings.budget.twelvedataPerMinute)}</label>
        <label class="field">Twelve Data credits/day ${num('s-td-day', settings.budget.twelvedataPerDay)}</label>
        <label class="field">Max news queries/cycle ${num('s-maxq', settings.news.maxQueriesPerCycle)}</label>
      </div>

      <div class="card">
        <div class="sec-head"><h2>News queries</h2></div>
        <label class="field">Company queries ${checkbox('s-q-co', settings.news.companyQueries)}</label>
        <label class="field">Sector queries ${checkbox('s-q-sec', settings.news.sectorQueries)}</label>
        <label class="field">Market query ${checkbox('s-q-mkt', settings.news.marketQuery)}</label>
        <label class="field">Category queries ${checkbox('s-q-cat', settings.news.categoryQueries)}</label>
        <label class="field">Categories <input id="s-cats" value="${esc(settings.news.categories.join(', '))}" /></label>
      </div>

      <div class="card">
        <div class="sec-head"><h2>Scoring</h2></div>
        ${Object.entries(w).map(([k, v]) => `<label class="field">w·${esc(k)} ${num('w-' + k, v, 0.01)}</label>`).join('')}
        <label class="field">Opportunity ≥ ${num('t-opp', settings.scoring.thresholds.opportunity)}</label>
        <label class="field">Watch ≥ ${num('t-watch', settings.scoring.thresholds.watch)}</label>
        <label class="field">Insufficient ≥ ${num('t-ins', settings.scoring.thresholds.insufficient)}</label>
        <label class="field">Anomaly % ${num('t-anom', settings.scoring.anomalyPct, 0.5)}</label>
        <label class="field">Divergence % ${num('t-div', settings.scoring.divergencePct, 0.5)}</label>
        <label class="field">Notify min score ${num('n-min', settings.notifications.minScore)}</label>
      </div>
    </div>

    <div class="card">
      <div class="sec-head"><h2>Watchlist</h2><div class="actions">
        <button class="btn small" id="seed-watch">Seed defaults</button></div></div>
      <div class="table-scroll"><table class="data">
        <thead><tr><th>Symbol</th><th>Name</th><th>Sector</th><th>Benchmark</th><th>Peers</th><th>Importance</th><th></th></tr></thead>
        <tbody>
          ${watchlist.map((x) => `<tr>
            <td><strong>${esc(x.symbol)}</strong></td><td>${esc(x.companyName || '')}</td><td>${esc(x.sector || '')}</td>
            <td>${esc(x.benchmarkSymbol || '—')}</td><td>${esc((x.peers || []).join(', '))}</td><td>${x.importance}</td>
            <td><button class="btn small ghost" data-rm="${esc(x.symbol)}">remove</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="row-form">
        <input id="w-symbol" placeholder="SYMBOL" />
        <input id="w-name" placeholder="Company name" />
        <input id="w-sector" placeholder="Sector" />
        <input id="w-bench" placeholder="Benchmark (e.g. SPY)" />
        <input id="w-peers" placeholder="Peers (comma)" />
        <button class="btn" id="add-watch">Add</button>
      </div>
    </div>

    <div class="card">
      <div class="sec-head"><h2>Status</h2></div>
      <pre class="status-pre">${esc(JSON.stringify({
        monitoring: status.monitoring,
        scheduler: {
          lockHeld: status.scheduler?.lockHeld,
          market: { lastAt: status.scheduler?.market?.lastAt, lastError: status.scheduler?.market?.lastError },
          news: { lastAt: status.scheduler?.news?.lastAt, lastError: status.scheduler?.news?.lastError },
          lastNewsCycle: status.scheduler?.lastNewsCycle,
        },
        budget: status.budget,
        usage: status.usage,
        coverage: status.coverage,
        counts: status.counts,
        lastMarketUpdate: status.lastMarketUpdate,
        lastMarketTimestamp: status.lastMarketTimestamp,
      }, null, 2))}</pre>
    </div>`;

  $('#save-settings').addEventListener('click', async () => {
    const weights = {};
    for (const k of Object.keys(w)) weights[k] = Number($('#w-' + k).value);
    const patch = {
      monitoring: {
        enabled: $('#s-enabled').checked,
        newsIntervalMinutes: Number($('#s-news').value),
        marketIntervalMinutes: Number($('#s-mkt').value),
        marketHoursOnly: $('#s-hours').checked,
        backfillHours: Number($('#s-backfill').value),
        autoInvestigate: $('#s-auto-inv').checked,
        maxInvestigationsPerCycle: Number($('#s-max-inv').value),
      },
      providers: { market: $('#s-mkt-prov').value, news: $('#s-news-prov').value },
      budget: {
        serpapiMonthlySearches: Number($('#s-serp-mo').value),
        serpapiReserveFraction: Number($('#s-serp-res').value),
        twelvedataPerMinute: Number($('#s-td-min').value),
        twelvedataPerDay: Number($('#s-td-day').value),
      },
      news: {
        companyQueries: $('#s-q-co').checked,
        sectorQueries: $('#s-q-sec').checked,
        marketQuery: $('#s-q-mkt').checked,
        categoryQueries: $('#s-q-cat').checked,
        maxQueriesPerCycle: Number($('#s-maxq').value),
        categories: $('#s-cats').value.split(',').map((s) => s.trim()).filter(Boolean),
      },
      scoring: {
        weights,
        thresholds: { opportunity: Number($('#t-opp').value), watch: Number($('#t-watch').value), insufficient: Number($('#t-ins').value) },
        anomalyPct: Number($('#t-anom').value),
        divergencePct: Number($('#t-div').value),
      },
      notifications: { minScore: Number($('#n-min').value) },
    };
    try {
      await api('/api/settings', { method: 'PUT', body: { settings: patch } });
      toast('Settings saved', 'ok');
      renderStatusBar();
    } catch (err) {
      toast(err.message, 'warn');
    }
  });

  view.addEventListener('click', async (e) => {
    if (e.target.id === 'add-watch') {
      try {
        await api('/api/watchlist', { method: 'PUT', body: {
          symbol: $('#w-symbol').value, companyName: $('#w-name').value, sector: $('#w-sector').value,
          benchmarkSymbol: $('#w-bench').value || null,
          peers: $('#w-peers').value.split(',').map((s) => s.trim()).filter(Boolean),
        } });
        toast('Added to watchlist', 'ok');
        viewSettings();
      } catch (err) { toast(err.message, 'warn'); }
    }
    if (e.target.id === 'seed-watch') {
      await api('/api/watchlist/seed-defaults', { method: 'POST', body: {} });
      toast('Seeded defaults', 'ok');
      viewSettings();
    }
    const rm = e.target.closest('[data-rm]')?.dataset.rm;
    if (rm) {
      await api(`/api/watchlist/${rm}`, { method: 'DELETE' });
      toast(`Removed ${rm}`, 'ok');
      viewSettings();
    }
  });
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

async function viewKeys() {
  renderNav('#/keys');
  const view = $('#view');
  const [{ secrets }, status] = await Promise.all([api('/api/secrets'), api('/api/status')]);

  view.innerHTML = `
    <div class="dash-head"><div><h2>API Keys</h2>
      <p class="muted">Stored encrypted on the server (AES-256-GCM). Full keys are never returned to the browser.</p></div></div>

    <div class="settings-grid">
      ${secrets.map((s) => `
        <div class="card">
          <div class="sec-head"><h2>${esc(s.label)}</h2>
            <span class="pill ${s.configured ? (s.status === 'valid' ? 'ok' : 'warn') : 'muted'}">${esc(s.configured ? s.status : 'not set')}</span></div>
          <label class="field">Value <input id="key-${esc(s.name)}" type="password" placeholder="${s.configured ? esc(s.masked) : 'paste key'}" /></label>
          <div class="muted">${s.configured ? `stored · last4 ${esc(s.last4 || '')}` : 'no key stored'}
            ${s.lastValidatedAt ? ` · validated ${relTime(s.lastValidatedAt)}` : ''}</div>
          <div class="actions" style="margin-top:10px">
            <button class="btn small" data-key="${esc(s.name)}" data-op="save">Save &amp; validate</button>
            <button class="btn small ghost" data-key="${esc(s.name)}" data-op="validate">Validate</button>
            <button class="btn small ghost" data-key="${esc(s.name)}" data-op="delete">Delete</button>
          </div>
        </div>`).join('')}

      <div class="card">
        <div class="sec-head"><h2>Ollama (local)</h2>
          <span class="pill ${status.ollama.available ? 'ok' : 'warn'}">${status.ollama.available ? 'available' : 'offline'}</span></div>
        <div class="muted">host: ${esc(status.ollama.host)}<br>models: ${esc((status.ollama.models || []).join(', ') || 'none')}<br>selected: ${esc(status.ollama.selectedModel || '—')}</div>
        <p class="muted">Ollama runs on your machine. A cloud deployment cannot reach localhost:11434 — keep it local.</p>
      </div>
    </div>`;

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const name = btn.dataset.key;
    const op = btn.dataset.op;
    try {
      if (op === 'save') {
        const value = $('#key-' + name).value;
        if (!value) return toast('Enter a key first', 'warn');
        const r = await api(`/api/secrets/${name}`, { method: 'PUT', body: { value } });
        $('#key-' + name).value = '';
        toast(r.validation.ok ? `Validated: ${r.validation.detail}` : `Saved, but invalid: ${r.validation.detail}`, r.validation.ok ? 'ok' : 'warn');
        viewKeys();
      } else if (op === 'validate') {
        const r = await api(`/api/secrets/${name}/validate`, { method: 'POST', body: {} });
        toast(r.validation.ok ? `Valid: ${r.validation.detail}` : `Invalid: ${r.validation.detail}`, r.validation.ok ? 'ok' : 'warn');
        viewKeys();
      } else if (op === 'delete') {
        await api(`/api/secrets/${name}`, { method: 'DELETE' });
        toast(`Deleted ${name}`, 'ok');
        viewKeys();
      }
    } catch (err) {
      toast(err.message, 'warn');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

async function viewReplay() {
  renderNav('#/replay');
  const view = $('#view');
  const { scenarios } = await api('/api/replay/scenarios');
  view.innerHTML = `
    <div class="dash-head"><div><h2>Historical Replay</h2>
      <p class="muted">Reconstructs what the system could have known at each decision point — no look-ahead.</p></div></div>
    <div class="card">
      <div class="sec-head"><h2>Scenarios (labelled fixtures)</h2></div>
      <ul class="scenarios">${scenarios.map((s) => `<li><strong>${esc(s.title)}</strong>
        <div class="muted">${esc(s.description)}</div>
        <button class="btn small" data-scenario="${esc(s.id)}">Run replay</button></li>`).join('')}</ul>
    </div>
    <div id="replay-out"></div>`;

  view.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-scenario]')?.dataset.scenario;
    if (!id) return;
    const out = $('#replay-out');
    out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Replaying…</p></div>`;
    const r = await api(`/api/replay/run`, { method: 'POST', body: { scenarioId: id } });
    out.innerHTML = `
      <div class="card"><div class="sec-head"><h2>${esc(r.title)}</h2><span class="pill">no look-ahead</span></div>
        <p class="muted">${esc(r.description)}</p></div>
      <div class="card"><div class="sec-head"><h2>Timeline</h2></div>
        <ul class="timeline">${r.steps.map((s) => `<li class="tl-${esc(s.kind)}"><span class="tl-time">${dt(s.ts)}</span><span class="tl-label">${esc(s.label)}</span></li>`).join('')}</ul>
      </div>
      <div class="metric-grid">
        <div class="metric"><div class="k">Articles known</div><div class="v">${r.summary.articlesKnown}</div></div>
        <div class="metric"><div class="k">Independent sources</div><div class="v">${r.summary.independentSources}</div></div>
        <div class="metric"><div class="k">Divergence at decision</div><div class="v">${r.summary.divergence == null ? '—' : pct(r.summary.divergence)}</div></div>
        <div class="metric"><div class="k">Outcome</div><div class="v small ${DECISION[r.summary.decision]?.cls || ''}">${esc(DECISION[r.summary.decision]?.label || r.summary.decision || '—')}</div><div class="d">score ${r.summary.score ?? '—'}</div></div>
      </div>
      <div class="card"><div class="sec-head"><h2>Why</h2></div>
        <div class="components">${Object.entries(r.summary.components || {}).map(([k, v]) => `<div class="comp"><span>${esc(k)}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div><span class="muted">${v}</span></div>`).join('')}</div>
      </div>`;
  });
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

async function route() {
  const hash = location.hash || '#/radar';
  try {
    if (hash.startsWith('#/event/')) return await viewEvent(hash.split('/')[2]);
    if (hash === '#/events') return await viewEvents();
    if (hash === '#/settings') return await viewSettings();
    if (hash === '#/keys') return await viewKeys();
    if (hash === '#/replay') return await viewReplay();
    return await viewRadar();
  } catch (err) {
    $('#view').innerHTML = `<div class="alert">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  renderStatusBar();
  await route();
  setInterval(renderStatusBar, 30000);
});
