/* InfoMark — market research SPA (vanilla JS, no build step). */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(v, currency) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  try {
    if (currency && /^[A-Z]{3}$/.test(currency)) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
    }
  } catch { /* fall through */ }
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
const dirCls = (v) => (Number(v) < 0 ? 'down' : Number(v) > 0 ? 'up' : '');
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function dt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function rel(iso) {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(m)) return '—';
  if (Math.abs(m) < 1) return 'just now';
  if (Math.abs(m) < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
const compact = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const a = Math.abs(Number(n));
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(n);
};

/* ---------------- session / api ---------------- */

const state = { session: { authenticated: false, mode: 'required' }, watchlist: [], chart: null, markets: null };

async function api(path, opts) {
  const res = await fetch(path, {
    headers: opts?.body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const err = new Error('Sign-in required.');
    err.code = 401;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

const isDemo = () => state.session.mode === 'demo';
const isOpen = () => state.session.mode === 'hackathon' || state.session.mode === 'disabled' || isDemo();

/* ---------------- chrome ---------------- */

const NAV = [
  ['#/markets', 'Markets'],
  ['#/watchlist', 'Watchlist'],
  ['#/news', 'News'],
  ['#/settings', 'Settings'],
];

function renderChrome(active) {
  $('#nav').innerHTML = NAV.map(
    ([href, label]) => `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`,
  ).join('');

  const theme = window.tiTheme ? window.tiTheme.current() : 'dark';
  const mode = state.session.mode;
  const modePill =
    mode === 'hackathon' ? '<span class="pill warn" title="No sign-in; loopback only">hackathon · no login</span>'
    : mode === 'demo' ? '<span class="pill warn" title="Read-only synthetic fixtures">demo · read-only</span>'
    : mode === 'disabled' ? '<span class="pill warn">auth disabled</span>'
    : '<span class="pill ok">signed in</span>';
  $('#topbar-right').innerHTML = `
    ${modePill}
    <button class="btn ghost small" id="theme-toggle" type="button" title="Toggle light/dark theme">
      ${theme === 'dark' ? '☀ Light' : '🌙 Dark'}
    </button>`;
  $('#theme-toggle').addEventListener('click', () => {
    window.tiTheme.toggle();
    renderChrome(location.hash || '#/markets');
    if (state.chart) renderChartForCurrent();
  });
  renderBanner();
}

function renderBanner() {
  const el = $('#banner');
  const mode = state.session.mode;
  if (isDemo()) {
    el.innerHTML = '<div class="banner warn"><strong>DEMO MODE</strong> — read-only synthetic fixture data. No live provider or Ollama calls are made.</div>';
  } else if (mode === 'hackathon') {
    el.innerHTML = '<div class="banner info"><strong>HACKATHON MODE</strong> — no sign-in, bound to localhost. Provider keys stay on the server and are never sent to the browser.</div>';
  } else {
    el.innerHTML = '';
  }
}

/* ---------------- router ---------------- */

/** Single delegated click handler for the current view (avoids listener accumulation). */
let viewClickHandler = null;
function onViewClick(handler) {
  const view = $('#view');
  if (viewClickHandler) view.removeEventListener('click', viewClickHandler);
  viewClickHandler = handler;
  view.addEventListener('click', viewClickHandler);
}

async function route() {
  const hash = location.hash || '#/markets';
  renderChrome(hash.startsWith('#/stock') ? '#' + hash.split('/').slice(0, 2).join('/').replace('#/stock', '#/markets') : hash.split('/').slice(0, 2).join('/'));
  const view = $('#view');
  try {
    if (hash.startsWith('#/stock/')) return await viewStock(decodeURIComponent(hash.split('/')[2]));
    if (hash.startsWith('#/news/')) return await viewNews(hash.split('/')[2]);
    if (hash === '#/watchlist') return await viewWatchlist();
    if (hash === '#/news') return await viewNews();
    if (hash === '#/settings') return await viewSettings();
    return await viewMarkets();
  } catch (err) {
    if (err.code === 401) {
      view.innerHTML = `<div class="state"><h3>Sign-in required</h3><p>This deployment requires authentication.</p><a class="btn" href="/dashboard.html">Open the sign-in page</a></div>`;
      return;
    }
    view.innerHTML = `<div class="state error"><h3>Something went wrong</h3><p>${esc(err.message)}</p><button class="btn ghost" onclick="location.reload()">Retry</button></div>`;
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('ti:theme', () => {
  renderChrome(location.hash || '#/markets');
  if (state.chart) renderChartForCurrent();
});

/* ---------------- Markets ---------------- */

const mkt = { tab: 'etfs', search: '', results: [], loading: false, error: null, sort: { key: 'changePct', dir: -1 }, filter: '', page: 1, pageSize: 15, batchMeta: null };

async function loadWatchlist() {
  try {
    const { watchlist } = await api('/api/watchlist');
    state.watchlist = watchlist || [];
  } catch {
    state.watchlist = [];
  }
  return state.watchlist;
}

async function viewMarkets() {
  const view = $('#view');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Markets</h1><p>Live quotes and candles from your configured data provider. Search any supported symbol to open its research page.</p></div>
      <button class="btn ghost small" id="mk-refresh" type="button">Refresh</button>
    </div>
    <div class="mk-grid">
      <section class="mk-left">
        <div id="overview" class="overview"></div>
        <div class="card" style="margin-top:16px">
          <div class="toolbar">
            <div class="tabs" id="mk-tabs">
              <button data-tab="watchlist" class="${mkt.tab === 'watchlist' ? 'active' : ''}">Watchlist</button>
              <button data-tab="etfs" class="${mkt.tab === 'etfs' ? 'active' : ''}">Market ETFs</button>
              <button data-tab="search" class="${mkt.tab === 'search' ? 'active' : ''}">Search</button>
            </div>
          </div>
          <div class="toolbar" style="margin-top:-4px">
            <input type="search" id="mk-q" class="grow" placeholder="Search symbol or company (e.g. Apple, NVDA, TSLA)" value="${esc(mkt.search)}" />
            <input type="text" id="mk-filter" placeholder="Filter exchange" value="${esc(mkt.filter)}" style="width:140px" />
          </div>
          <div id="mk-body"></div>
        </div>
      </section>
      <aside class="mk-right" aria-label="AI Opportunity Intelligence">
        <div class="opp-head">
          <div>
            <h2>AI Opportunity Intelligence</h2>
            <p class="faint">Automated news scan &rarr; dedupe &rarr; event clustering &rarr; local-model analysis. Research aid, not investment advice.</p>
          </div>
          <span class="pill" id="opp-updated">loading…</span>
        </div>
        <div id="opp-status" class="opp-status"></div>
        <div id="opp-list" class="opp-list"></div>
      </aside>
    </div>`;

  $('#mk-refresh').addEventListener('click', () => { loadOverview(); paintMarketTable(); loadOpportunities(); });
  $('#mk-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    mkt.tab = b.dataset.tab;
    mkt.page = 1;
    $$('#mk-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    if (mkt.tab === 'watchlist') paintMarketTable();
    else if (mkt.tab === 'etfs') paintMarketTable();
    else $('#mk-q').focus();
  });
  let t;
  $('#mk-q').addEventListener('input', (e) => {
    mkt.search = e.target.value;
    clearTimeout(t);
    t = setTimeout(runSearch, 400);
  });
  $('#mk-filter').addEventListener('input', (e) => {
    mkt.filter = e.target.value.trim().toUpperCase();
    mkt.page = 1;
    paintMarketTable();
  });

  await Promise.all([loadWatchlist(), loadOverview(), loadOpportunities()]);
  startOppRefresh();
  if (mkt.tab === 'search' && mkt.results.length) paintMarketTable();
  else paintMarketTable();
}

/* ---------------- AI Opportunity Intelligence panel ---------------- */

function startOppRefresh() {
  clearInterval(mkt.oppTimer);
  mkt.oppTimer = setInterval(() => {
    if (!document.getElementById('opp-list')) { clearInterval(mkt.oppTimer); mkt.oppTimer = null; return; }
    loadOpportunities();
  }, 60_000);
}

const OPP_STATUS_LABEL = {
  potential_opportunity: 'Potential opportunity',
  watch: 'Watch',
  insufficient_evidence: 'Insufficient evidence',
  no_trade: 'No trade',
  pending: 'Analysis pending',
  rejected: 'Rejected',
};

async function loadOpportunities() {
  const list = $('#opp-list');
  const statusBox = $('#opp-status');
  if (!list || !statusBox) return;
  if (!mkt.opp) {
    list.innerHTML = '<div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:96px;margin-top:10px"></div>';
  }
  try {
    const data = await api('/api/opportunities?limit=25&hours=168');
    if (!document.getElementById('opp-list')) return; // navigated away
    mkt.opp = data;
    renderOppStatus(data.status);
    renderOppList(data.opportunities || [], data.status);
  } catch (err) {
    if (!document.getElementById('opp-list')) return;
    list.innerHTML = `<div class="state error"><strong>Opportunity panel unavailable</strong><p class="faint">${esc(err.message)}</p></div>`;
  }
}

function renderOppStatus(st) {
  const box = $('#opp-status');
  const up = $('#opp-updated');
  if (up) up.textContent = `updated ${rel(new Date().toISOString())}`;
  if (!box || !st) return;
  const last = st.lastScan;
  const lastTxt = last
    ? `${rel(last.finishedAt || last.startedAt)} · ${last.status}`
    : 'none yet';
  const nextTxt = !st.monitoring
    ? 'scheduler off'
    : st.nextScanAt
      ? rel(st.nextScanAt)
      : 'pending';
  const rows = [
    ['Last news scan', lastTxt],
    ['Next scan', nextTxt],
    ['News provider', `${st.newsProvider.id}${st.newsProvider.configured ? '' : ' (no key configured)'}`],
    ['Ollama', st.ollama.available ? `available · ${st.ollama.model || 'auto model'}` : 'unavailable — deterministic only'],
    ['New articles (last scan)', String(st.counts.newArticles ?? 0)],
    ['Duplicates removed', st.counts.duplicatesRemoved == null ? '—' : String(st.counts.duplicatesRemoved)],
    ['Clusters analysed', String(st.counts.clustersAnalyzed ?? 0)],
    ['Needing attention', String(st.counts.needsAttention ?? 0)],
  ];
  box.innerHTML = rows.map(([k, v]) => `<div class="opp-stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
}

function evidenceQuality(o) {
  const indep = o.evidence.independentReports || 0;
  const sources = o.evidence.independentSources || 0;
  if (indep >= 3 && sources >= 3) return { label: 'strong', cls: 'ok' };
  if (indep >= 2) return { label: 'moderate', cls: 'warn' };
  return { label: 'single-source', cls: '' };
}

function oppCard(o) {
  const a = o.analysis;
  const eq = evidenceQuality(o);
  const t = o.technical;
  const conf = typeof o.confidence === 'number'
    ? `evidence confidence ${o.confidence <= 1 ? Math.round(o.confidence * 100) : Math.round(o.confidence)}%`
    : null;
  const reaction = t
    ? `<div class="muted-line">${esc(t.symbol)} ${esc(money(t.price))} <span class="${dirCls(t.changePct)}">${esc(pct(t.changePct))}</span>${t.divergence != null ? ` · vs ${esc(t.benchmarkSymbol || 'benchmark')} ${esc(pct(t.divergence))} divergence` : ''}${t.stale ? ' · <span class="pill warn">stale</span>' : ''}</div>`
    : '<div class="muted-line faint">No market observation for this ticker</div>';
  const claims = a && a.keyClaims.length
    ? `<ul class="opp-claims">${a.keyClaims.slice(0, 4).map((c) => `<li>${esc(c.claim)}${c.attribution ? ` <span class="faint">— ${esc(c.attribution)}</span>` : ''}</li>`).join('')}</ul>`
    : '';
  const contra = a && a.contradictions.length
    ? `<div class="opp-block"><div class="k">Contradictions / risks</div><ul class="opp-claims">${a.contradictions.slice(0, 3).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`
    : (a ? '<div class="opp-block"><div class="k">Contradictions / risks</div><div class="faint">None reported by the model.</div></div>' : '');
  const summary = a
    ? `<p class="opp-summary">${esc(a.summary)}</p>`
    : '<p class="opp-summary faint">AI analysis pending — no local-model output stored for this cluster yet. News is still deduplicated and clustered.</p>';
  const impact = a && a.impact && a.impact.rationale
    ? `<div class="opp-block"><div class="k">Model read — ${esc(a.impact.direction || 'unclear')} / ${esc(a.impact.magnitude || 'unknown')}</div><div class="faint">${esc(a.impact.rationale)}</div></div>`
    : '';
  const uncertain = a && a.uncertainty.length
    ? `<div class="opp-block"><div class="k">What remains uncertain</div><ul class="opp-claims">${a.uncertainty.slice(0, 3).map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>`
    : '';
  return `
    <article class="opp-card" data-status="${esc(o.status)}">
      <div class="opp-top">
        <span class="badge ${esc(o.status)}">${esc(OPP_STATUS_LABEL[o.status] || o.status)}</span>
        <span class="pill ${eq.cls}">${esc(eq.label)} evidence</span>
        ${a && a.sample ? '<span class="pill warn">demo analysis</span>' : ''}
      </div>
      <h3 class="opp-title">${esc(o.title)}</h3>
      <div class="opp-meta">
        ${o.symbols.length ? `<span class="tag">${o.symbols.map(esc).join(' · ')}</span>` : ''}
        <span class="tag">${esc(o.category)}</span>
        <span class="faint">first ${esc(rel(o.firstSeenTs))} · updated ${esc(rel(o.lastUpdatedTs))}</span>
      </div>
      ${summary}
      ${reaction}
      ${claims ? `<div class="opp-block"><div class="k">What sources report</div>${claims}</div>` : ''}
      ${impact}
      ${uncertain}
      ${contra}
      <div class="opp-foot">
        <span class="faint">${o.evidence.articleCount} report${o.evidence.articleCount === 1 ? '' : 's'} · ${o.evidence.independentSources} source${o.evidence.independentSources === 1 ? '' : 's'}${conf ? ` · ${esc(conf)}` : ''}</span>
        <a class="btn ghost small" href="#/news/${encodeURIComponent(o.id)}">Investigate</a>
      </div>
    </article>`;
}

function renderOppList(opps, st) {
  const list = $('#opp-list');
  if (!list) return;
  if (!opps.length) {
    list.innerHTML = `<div class="state empty"><strong>No new opportunities detected</strong>
      <p class="faint">${st && st.monitoring ? 'Waiting for the next news scan.' : 'The background schedule is off, so new stories are not being retrieved.'}</p></div>`;
    return;
  }
  const pending = opps.filter((o) => !o.analysis).length;
  list.innerHTML =
    (pending ? `<div class="banner" style="margin-bottom:10px">${pending} of ${opps.length} clusters are awaiting AI analysis${st && !st.ollama.available ? ' (Ollama unavailable)' : ''}.</div>` : '') +
    opps.map(oppCard).join('');
}

async function loadOverview() {
  const box = $('#overview');
  box.innerHTML = Array.from({ length: 4 }).map(() => '<div class="ov-card"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%;height:20px;margin-top:10px"></div></div>').join('');
  try {
    const [ov, radar] = await Promise.all([api('/api/market/overview'), api('/api/market/radar').catch(() => null)]);
    mkt.overview = ov;
    if (ov.error) {
      box.innerHTML = `<div class="state error" style="grid-column:1/-1"><h3>Market data unavailable</h3><p>${esc(ov.error)}</p><button class="btn ghost" onclick="location.reload()">Retry</button></div>`;
      return;
    }
    const ms = radar?.marketStatus;
    const statusPill = ms
      ? (ms.open ? '<span class="pill ok">market open</span>' : `<span class="pill">market closed (${esc(ms.reason)})</span>`)
      : '';
    box.innerHTML = `
      <div class="banner" style="margin:0 0 12px;grid-column:1/-1">
        <strong>${ov.synthetic ? 'Synthetic (demo)' : 'Live'}</strong> · source ${esc(ov.source)} · fetched ${rel(ov.fetchedAt)} ${statusPill}
      </div>
      ${(ov.quotes || []).map((q) => `
        <a class="ov-card" href="#/stock/${encodeURIComponent(q.symbol)}" style="text-decoration:none">
          <div class="name"><span>${esc(q.label || q.symbol)}</span><span class="sym">${esc(q.symbol)}</span></div>
          <div class="price">${esc(money(q.price, q.currency))}</div>
          <div class="chg ${dirCls(q.changePct)}">${esc(pct(q.changePct))}</div>
        </a>`).join('')}`;
  } catch (err) {
    box.innerHTML = `<div class="state error" style="grid-column:1/-1"><h3>Market overview unavailable</h3><p>${esc(err.message)}</p></div>`;
  }
}

async function runSearch() {
  const q = mkt.search.trim();
  if (!q) { mkt.results = []; paintMarketTable(); return; }
  mkt.tab = 'search';
  $$('#mk-tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'search'));
  mkt.loading = true; mkt.error = null;
  paintMarketTable();
  try {
    const data = await api(`/api/market/search?q=${encodeURIComponent(q)}`);
    mkt.results = (data.results || []).map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange, type: r.type, _search: true }));
    mkt.error = data.error || null;
  } catch (err) {
    mkt.results = []; mkt.error = err.message;
  } finally {
    mkt.loading = false; mkt.page = 1;
    paintMarketTable();
  }
}

function rowsForTab() {
  if (mkt.tab === 'search') return mkt.results;
  if (mkt.tab === 'etfs') return (mkt.overview?.quotes || []).map((q) => ({ ...q, name: q.label, exchange: q.exchange }));
  // watchlist: use live batch quotes when available, else nothing
  return mkt.watchRows || [];
}

async function ensureWatchRows(force) {
  if (state.watchlist.length === 0) await loadWatchlist();
  const symbols = state.watchlist.map((w) => w.symbol);
  if (!symbols.length) { mkt.watchRows = []; return; }
  if (mkt.watchRows && !force) return;
  mkt.loading = true; mkt.error = null; paintMarketTable();
  try {
    const data = await api(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
    const bySym = Object.fromEntries((data.quotes || []).map((q) => [q.symbol, q]));
    mkt.watchRows = state.watchlist.map((w) => ({ ...(bySym[w.symbol] || {}), symbol: w.symbol, name: w.companyName, exchange: w.exchange }));
    mkt.batchMeta = { requested: data.requested, truncated: Boolean(data.truncated) };
    mkt.error = data.error || null;
  } catch (err) {
    mkt.watchRows = state.watchlist.map((w) => ({ symbol: w.symbol, name: w.companyName, exchange: w.exchange }));
    mkt.error = err.message;
  } finally {
    mkt.loading = false;
    paintMarketTable();
  }
}

function paintMarketTable() {
  const body = $('#mk-body');
  if (!body) return;
  if (mkt.tab === 'watchlist' && (!mkt.watchRows || !state.watchlist.length)) {
    if (!state.watchlist.length) {
      body.innerHTML = '<div class="state"><h3>Your watchlist is empty</h3><p>Search for a symbol and add it to your watchlist.</p></div>';
      return;
    }
    ensureWatchRows(false);
    return;
  }
  if (mkt.loading) {
    body.innerHTML = `<table class="grid"><tbody>${Array.from({ length: 6 }).map(() => '<tr>' + Array.from({ length: 5 }).map(() => '<td><div class="skeleton"></div></td>').join('') + '</tr>').join('')}</tbody></table>`;
    return;
  }
  if (mkt.error) {
    body.innerHTML = `<div class="state error"><h3>Could not load data</h3><p>${esc(mkt.error)}</p><button class="btn ghost" id="mk-retry">Retry</button></div>`;
    $('#mk-retry')?.addEventListener('click', () => (mkt.tab === 'watchlist' ? ensureWatchRows(true) : runSearch()));
    return;
  }

  let rows = rowsForTab();
  if (mkt.filter) rows = rows.filter((r) => String(r.exchange || '').toUpperCase().includes(mkt.filter));
  const dir = mkt.sort.dir;
  const key = mkt.sort.key;
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  if (!rows.length) {
    body.innerHTML = `<div class="state"><h3>No results</h3><p>${mkt.tab === 'search' ? 'No symbols matched your search.' : 'Nothing to show yet.'}</p></div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / mkt.pageSize));
  mkt.page = Math.min(mkt.page, totalPages);
  const slice = rows.slice((mkt.page - 1) * mkt.pageSize, mkt.page * mkt.pageSize);
  const watched = new Set(state.watchlist.map((w) => w.symbol));
  const arrow = (k) => (mkt.sort.key === k ? (mkt.sort.dir > 0 ? ' ▲' : ' ▼') : '');

  body.innerHTML = `
    <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th class="l sortable" data-sort="symbol">Symbol${arrow('symbol')}</th>
          <th class="l sortable" data-sort="name">Name${arrow('name')}</th>
          <th class="l sortable" data-sort="exchange">Exchange${arrow('exchange')}</th>
          <th class="num sortable" data-sort="price">Price${arrow('price')}</th>
          <th class="num sortable" data-sort="changePct">Change %${arrow('changePct')}</th>
          <th class="num">&nbsp;</th>
        </tr></thead>
        <tbody>
          ${slice.map((r) => `
            <tr>
              <td class="l"><a class="sym-cell" href="#/stock/${encodeURIComponent(r.symbol)}" style="text-decoration:none"><span class="s">${esc(r.symbol)}</span>${r.type ? `<span class="n">${esc(r.type)}</span>` : ''}</a></td>
              <td class="l"><span class="muted">${esc(r.name || '—')}</span></td>
              <td class="l">${esc(r.exchange || '—')}</td>
              <td class="num">${esc(money(r.price, r.currency))}${r.stale ? ' <span class="pill">stale</span>' : ''}</td>
              <td class="num ${dirCls(r.changePct)}">${esc(pct(r.changePct))}</td>
              <td class="num">${
                isDemo() ? '<span class="faint">demo</span>'
                : `<button class="btn ghost small" data-watch="${esc(r.symbol)}" data-on="${watched.has(r.symbol) ? '1' : '0'}">${watched.has(r.symbol) ? 'Remove' : 'Add'}</button>`
              }</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="toolbar" style="margin-top:12px">
      <span class="faint">${rows.length} result(s)</span>
      ${mkt.tab === 'watchlist' && mkt.batchMeta?.truncated ? `<span class="pill warn" title="The provider's per-minute credit cap limits how many quotes fit in one request.">showing ${(mkt.watchRows || []).length} of ${mkt.batchMeta.requested} (provider rate cap)</span>` : ''}
      <span style="margin-left:auto"></span>
      <button class="btn ghost small" id="pg-prev" ${mkt.page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="faint">page ${mkt.page} / ${totalPages}</span>
      <button class="btn ghost small" id="pg-next" ${mkt.page >= totalPages ? 'disabled' : ''}>Next</button>
    </div>`;

  body.querySelectorAll('th.sortable').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      mkt.sort = { key: k, dir: mkt.sort.key === k ? -mkt.sort.dir : 1 };
      paintMarketTable();
    }),
  );
  $('#pg-prev')?.addEventListener('click', () => { mkt.page -= 1; paintMarketTable(); });
  $('#pg-next')?.addEventListener('click', () => { mkt.page += 1; paintMarketTable(); });
  body.querySelectorAll('[data-watch]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const sym = btn.dataset.watch;
      const on = btn.dataset.on === '1';
      btn.disabled = true;
      try {
        if (on) await api(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' });
        else await api('/api/watchlist', { method: 'PUT', body: { symbol: sym } });
        await loadWatchlist();
        mkt.watchRows = null;
        toast(`${sym} ${on ? 'removed from' : 'added to'} watchlist`, 'ok');
        paintMarketTable();
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    }),
  );
}

/* ---------------- Stock detail ---------------- */

/**
 * Chart timeframes. `outputsize` is bars per request — a request costs 1 provider credit
 * regardless of size, so we ask for generous history (depth is limited by the provider's
 * plan, and the UI reports the actual returned range).
 */
const INTERVAL_CONFIG = {
  '5min': { label: '5M', outputsize: 500 },
  '15min': { label: '15M', outputsize: 500 },
  '1h': { label: '1H', outputsize: 500 },
  '1day': { label: '1D', outputsize: 365 },
  '1week': { label: '1W', outputsize: 300 },
  '1month': { label: '1M', outputsize: 120 },
};
const INTRADAY = new Set(['5min', '15min', '1h']);
let stockState = { symbol: null, interval: '1day' };
let candleSeq = 0;

async function viewStock(symbol) {
  const sym = String(symbol || '').toUpperCase();
  stockState = { symbol: sym, interval: stockState.symbol === sym ? stockState.interval : '1day' };
  const view = $('#view');
  view.innerHTML = `
    <div class="page-head">
      <div><a class="muted" href="#/markets">← Markets</a><h1 id="st-name">${esc(sym)}</h1><p id="st-meta" class="muted"></p></div>
      <div id="st-watch"></div>
    </div>
    <div class="card">
      <div class="stock-head">
        <div class="stock-title"></div>
        <div class="stock-price" id="st-price"><div class="skeleton" style="width:110px;height:26px"></div></div>
      </div>
      <div class="metric-grid" id="st-metrics"></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <strong style="font-size:14px">Price history</strong>
        <div class="tabs" id="st-intervals" style="margin-left:auto">
          ${Object.entries(INTERVAL_CONFIG).map(([v, c]) => `<button data-iv="${v}" class="${stockState.interval === v ? 'active' : ''}">${c.label}</button>`).join('')}
        </div>
      </div>
      <div id="chart"></div>
      <div id="chart-note" class="faint" style="font-size:11.5px;margin-top:8px"></div>
    </div>
    <div class="card">
      <h2 style="margin:0 0 12px;font-size:16px">Related news</h2>
      <div id="st-news"><div class="skeleton" style="width:60%"></div></div>
    </div>`;

  $('#st-intervals').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-iv]');
    if (!b) return;
    stockState.interval = b.dataset.iv;
    $$('#st-intervals button').forEach((x) => x.classList.toggle('active', x === b));
    loadCandles(sym);
  });

  await Promise.all([loadQuote(sym), loadCandles(sym), loadStockNews(sym)]);
  refreshWatchButton(sym);
}

async function loadQuote(sym) {
  const el = $('#st-price');
  try {
    const data = await api(`/api/market/quote/${encodeURIComponent(sym)}`);
    if (data.error || !data.quote) {
      el.innerHTML = `<div class="faint">${esc(data.error || 'No quote available')}</div>`;
      return;
    }
    const q = data.quote;
    $('#st-name').textContent = q.symbol;
    $('#st-meta').innerHTML = `${q.exchange ? `<span class="pill">${esc(q.exchange)}</span>` : ''}<span class="pill">source: ${esc(data.source)}${data.synthetic ? ' (synthetic)' : ''}</span>${q.stale ? '<span class="pill warn">stale</span>' : '<span class="pill ok">fresh</span>'}`;
    el.innerHTML = `
      <div class="p">${esc(money(q.price, q.currency))}</div>
      <div class="c ${dirCls(q.changePct)}">${esc(q.change != null ? money(q.change, q.currency) : '')} ${esc(pct(q.changePct))}</div>
      <div class="ts">observation ${esc(dt(q.marketTs))} · updated ${esc(rel(q.retrievedTs || data.fetchedAt))}</div>`;
    $('#st-metrics').dataset.quote = JSON.stringify({ price: q.price, changePct: q.changePct, currency: q.currency });
  } catch (err) {
    el.innerHTML = `<div class="state error">${esc(err.message)}</div>`;
  }
}

async function renderChartForCurrent() {
  if (stockState.symbol) loadCandles(stockState.symbol);
}

async function loadCandles(sym) {
  const el = $('#chart');
  const note = $('#chart-note');
  const interval = stockState.interval;
  const cfg = INTERVAL_CONFIG[interval] || INTERVAL_CONFIG['1day'];
  const seq = ++candleSeq; // guards against an older response overwriting a newer interval
  el.innerHTML = '<div class="chart-empty">Loading candles…</div>';
  if (note) note.textContent = '';

  const unavailable = (title, detail) => {
    el.innerHTML = `<div class="chart-empty"><div><strong>${esc(title)}</strong><div class="faint">${esc(detail)}</div></div></div>`;
    const m = $('#st-metrics');
    if (m) m.innerHTML = '<div class="metric"><div class="k">Chart</div><div class="v" style="font-size:13px">unavailable</div></div>';
  };

  try {
    const data = await api(
      `/api/market/candles/${encodeURIComponent(sym)}?interval=${interval}&outputsize=${cfg.outputsize}`,
    );
    if (seq !== candleSeq) return; // superseded
    if (data.error) return unavailable('Chart unavailable', data.error);

    const bars = Array.isArray(data.bars) ? data.bars : [];
    if (!bars.length) return unavailable('No candle data', 'The provider returned no history for this symbol and interval.');

    drawChart(el, bars, { interval });

    const first = bars[0];
    const last = bars[bars.length - 1];
    const hi = Math.max(...bars.map((b) => b.high));
    const lo = Math.min(...bars.map((b) => b.low));
    const periodChange = first.open ? ((last.close - first.open) / first.open) * 100 : null;
    const fmtTime = (t) => dt(typeof t === 'number' ? t * 1000 : `${t}T00:00:00`);

    $('#st-metrics').innerHTML = `
      <div class="metric"><div class="k">Period change (${esc(interval)})</div><div class="v ${dirCls(periodChange)}">${esc(pct(periodChange))}</div><div class="faint" style="font-size:11px">${esc(bars.length)} bars · ${esc(data.meta?.exchange || '')}</div></div>
      <div class="metric"><div class="k">High (period)</div><div class="v">${esc(money(hi, data.meta?.currency))}</div></div>
      <div class="metric"><div class="k">Low (period)</div><div class="v">${esc(money(lo, data.meta?.currency))}</div></div>
      <div class="metric"><div class="k">Last volume</div><div class="v">${esc(compact(last.volume))}</div></div>
      <div class="metric"><div class="k">Last bar</div><div class="v" style="font-size:13px">${esc(fmtTime(last.time))}</div></div>`;

    if (note) {
      const synthetic = Boolean(data.synthetic);
      note.innerHTML = `${synthetic ? '<span class="pill warn">synthetic (demo)</span> ' : ''}source: ${esc(data.source || 'unknown')} · ${esc(interval)} · ${bars.length} bars · ${esc(fmtTime(first.time))} → ${esc(fmtTime(last.time))}` +
        (INTRADAY.has(interval) ? ' · intraday charts show trading sessions only, so overnight/weekend gaps are real market closures' : '');
    }
  } catch (err) {
    if (seq !== candleSeq) return;
    unavailable('Could not load chart', err.message);
  }
}

function drawChart(el, bars, { interval }) {
  el.innerHTML = '';
  if (!window.LightweightCharts) { el.innerHTML = '<div class="chart-empty">Chart library failed to load (offline?).</div>'; return; }
  if (state.chart) { try { state.chart.remove(); } catch { /* ignore */ } state.chart = null; }
  const intraday = !['1day', '1week', '1month'].includes(interval);
  const chart = window.LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: cssVar('--text-dim'), fontFamily: 'inherit' },
    grid: { vertLines: { color: cssVar('--border-soft') }, horzLines: { color: cssVar('--border-soft') } },
    rightPriceScale: { borderColor: cssVar('--border') },
    timeScale: { borderColor: cssVar('--border'), timeVisible: intraday, secondsVisible: false },
    crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal },
  });
  const up = cssVar('--up');
  const down = cssVar('--down');
  const candles = chart.addCandlestickSeries({
    upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
  });
  candles.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));

  if (bars.some((b) => b.volume != null)) {
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(bars.filter((b) => b.volume != null).map((b) => ({
      time: b.time, value: b.volume, color: b.close >= b.open ? `${up}66` : `${down}66`,
    })));
  }
  chart.timeScale().fitContent();
  state.chart = chart;
}

async function loadStockNews(sym) {
  const el = $('#st-news');
  try {
    const data = await api(`/api/market/news/${encodeURIComponent(sym)}?limit=12`);
    if (!data.articles || !data.articles.length) {
      el.innerHTML = '<div class="state"><h3>No related news yet</h3><p>Nothing in the ingested news store mentions this symbol. Run a news refresh in Settings, or check back after the next scheduled cycle.</p></div>';
      return;
    }
    el.innerHTML = `<div class="feed">${data.articles.map((a) => `
      <div class="news-card">
        <h3><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.headline)}</a></h3>
        ${a.excerpt ? `<div class="summary">${esc(a.excerpt)}</div>` : ''}
        <div class="news-meta"><span>${esc(a.source || a.domain || 'source')}</span><span>published ${esc(dt(a.publishedTs))}</span><span>first seen ${esc(rel(a.firstSeenTs))}</span></div>
      </div>`).join('')}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="state error">${esc(err.message)}</div>`;
  }
}

function refreshWatchButton(sym) {
  const el = $('#st-watch');
  if (!el) return;
  if (isDemo()) { el.innerHTML = '<span class="faint">watchlist disabled in demo</span>'; return; }
  const on = state.watchlist.some((w) => w.symbol === sym);
  el.innerHTML = `<button class="btn ghost" id="st-watch-btn" type="button">${on ? '★ In watchlist' : '☆ Add to watchlist'}</button>`;
  $('#st-watch-btn').addEventListener('click', async () => {
    try {
      if (on) await api(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' });
      else await api('/api/watchlist', { method: 'PUT', body: { symbol: sym } });
      await loadWatchlist();
      mkt.watchRows = null;
      toast(`${sym} ${on ? 'removed' : 'added'}`, 'ok');
      refreshWatchButton(sym);
    } catch (err) { toast(err.message, 'bad'); }
  });
}

/* ---------------- Watchlist ---------------- */

async function viewWatchlist() {
  const view = $('#view');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Watchlist</h1><p>Your tracked symbols with the latest available quotes.</p></div>
      <button class="btn ghost small" id="wl-refresh" type="button">Refresh quotes</button>
    </div>
    <div class="card"><div id="wl-body"><div class="skeleton" style="width:50%"></div></div></div>`;
  $('#wl-refresh').addEventListener('click', () => loadWatchlistPage(true));
  await loadWatchlistPage(false);
}

async function loadWatchlistPage(force) {
  const body = $('#wl-body');
  await loadWatchlist();
  if (!state.watchlist.length) {
    body.innerHTML = '<div class="state"><h3>No symbols yet</h3><p>Search for a symbol in Markets and add it to your watchlist.</p><a class="btn" href="#/markets">Go to Markets</a></div>';
    return;
  }
  if (force) mkt.watchRows = null;
  await ensureWatchRows(force);
  const rows = mkt.watchRows || [];
  if (!rows.length) { body.innerHTML = '<div class="state"><h3>No data</h3><p>No quotes available for your watchlist.</p></div>'; return; }
  body.innerHTML = `
    ${mkt.error ? `<div class="state error">${esc(mkt.error)}</div>` : ''}
    <div class="table-wrap"><table class="grid">
      <thead><tr><th class="l">Symbol</th><th class="l">Name</th><th class="num">Price</th><th class="num">Change %</th><th class="num">Updated</th><th class="num"></th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td class="l"><a class="sym-cell" href="#/stock/${encodeURIComponent(r.symbol)}" style="text-decoration:none"><span class="s">${esc(r.symbol)}</span></a></td>
          <td class="l"><span class="muted">${esc(r.name || '—')}</span></td>
          <td class="num">${esc(money(r.price, r.currency))}${r.stale ? ' <span class="pill">stale</span>' : ''}</td>
          <td class="num ${dirCls(r.changePct)}">${esc(pct(r.changePct))}</td>
          <td class="num faint">${esc(r.marketTs ? rel(r.marketTs) : '—')}</td>
          <td class="num">${isDemo() ? '' : `<button class="btn ghost small" data-rm="${esc(r.symbol)}">Remove</button>`}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  body.querySelectorAll('[data-rm]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/api/watchlist/${encodeURIComponent(b.dataset.rm)}`, { method: 'DELETE' });
        toast('Removed', 'ok');
        await loadWatchlistPage(true);
      } catch (err) { toast(err.message, 'bad'); }
    }),
  );
}

/* ---------------- News (event feed) ---------------- */

const newsState = { q: '', category: '', sort: 'recent' };

async function viewNews(eventId) {
  const view = $('#view');
  if (eventId) return viewEventDetail(eventId);
  view.innerHTML = `
    <div class="page-head">
      <div><h1>News</h1><p>Deduplicated financial events, grouped across publishers. Sources are linked; summaries are labelled.</p></div>
      <button class="btn ghost small" id="nw-refresh" type="button" ${isDemo() ? 'disabled title="Disabled in demo mode"' : ''}>Refresh news</button>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" id="nw-q" class="grow" placeholder="Search headlines, symbols, sources" value="${esc(newsState.q)}" />
        <select id="nw-sort">
          <option value="recent" ${newsState.sort === 'recent' ? 'selected' : ''}>Newest first</option>
          <option value="score" ${newsState.sort === 'score' ? 'selected' : ''}>Highest score</option>
          <option value="evidence" ${newsState.sort === 'evidence' ? 'selected' : ''}>Most evidence</option>
        </select>
        <span class="faint" id="nw-count"></span>
      </div>
      <div id="nw-body"><div class="skeleton" style="width:60%"></div></div>
    </div>`;
  let t;
  $('#nw-q').addEventListener('input', (e) => { newsState.q = e.target.value; clearTimeout(t); t = setTimeout(paintNews, 250); });
  $('#nw-sort').addEventListener('change', (e) => { newsState.sort = e.target.value; paintNews(); });
  $('#nw-refresh').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Refreshing…';
    try {
      const r = await api('/api/news/run', { method: 'POST', body: { force: true } });
      toast(`Refresh: ${r.summary.articlesNew} new articles, ${r.summary.eventsNew} events`, 'ok');
      await loadEvents();
      paintNews();
    } catch (err) { toast(err.message, 'bad'); }
    finally { e.target.disabled = false; e.target.textContent = 'Refresh news'; }
  });
  if (!newsState.events) await loadEvents();
  paintNews();
}

async function loadEvents() {
  try {
    const { events } = await api('/api/events?limit=200');
    newsState.events = events || [];
    newsState.error = null;
  } catch (err) {
    newsState.events = [];
    newsState.error = err.message;
  }
}

function paintNews() {
  const body = $('#nw-body');
  if (!body) return;
  if (newsState.error) { body.innerHTML = `<div class="state error"><h3>Could not load news</h3><p>${esc(newsState.error)}</p></div>`; return; }
  const q = newsState.q.trim().toLowerCase();
  let rows = (newsState.events || []).filter((e) => {
    if (!q) return true;
    return [e.title, e.summary, e.category, ...(e.symbols || []), ...(e.evidence?.sources || [])].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  if (newsState.sort === 'score') rows = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  else if (newsState.sort === 'evidence') rows = [...rows].sort((a, b) => (b.evidence?.articleCount || 0) - (a.evidence?.articleCount || 0));
  else rows = [...rows].sort((a, b) => Date.parse(b.lastUpdatedTs) - Date.parse(a.lastUpdatedTs));

  $('#nw-count').textContent = `${rows.length} event(s)`;
  if (!rows.length) {
    body.innerHTML = '<div class="state"><h3>No events yet</h3><p>Run a news refresh, or wait for the next scheduled cycle. If no provider key is configured, no news can be ingested.</p></div>';
    return;
  }
  body.innerHTML = `<div class="feed">${rows.map((e) => `
    <div class="news-card">
      <h3><a href="#/news/${e.id}">${esc(e.title)}</a></h3>
      ${e.summary ? `<div class="summary">${esc(String(e.summary).slice(0, 280))}</div>` : '<div class="summary faint">Not yet summarised.</div>'}
      <div class="news-meta">
        ${(e.symbols || []).map((s) => `<span class="pill">${esc(s)}</span>`).join('')}
        <span class="pill">${esc(e.category || 'uncategorised')}</span>
        <span>${esc(e.evidence?.articleCount || 0)} article(s) · ${esc(e.evidence?.independentReports || 0)} independent</span>
        <span>updated ${esc(rel(e.lastUpdatedTs))}</span>
        ${e.score != null ? `<span class="pill">score ${esc(e.score)}</span>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

async function viewEventDetail(id) {
  const view = $('#view');
  view.innerHTML = '<div class="skeleton" style="width:40%"></div>';
  try {
    const d = await api(`/api/events/${encodeURIComponent(id)}`);
    const e = d.event;
    view.innerHTML = `
      <div class="page-head"><div><a class="muted" href="#/news">← News</a><h1>${esc(e.title)}</h1>
        <p class="muted">${(e.symbols || []).map((s) => `<span class="pill">${esc(s)}</span>`).join(' ')} <span class="pill">${esc(e.category || '')}</span> <span class="pill">${esc(e.status)}</span></p></div>
        ${e.score != null ? `<div class="pill">score ${esc(e.score)} · ${esc(e.decision || '')}</div>` : ''}
      </div>
      ${e.summary ? `<div class="card"><h2 style="margin:0 0 8px;font-size:15px">Summary ${e.model?.sample ? '<span class="pill">sample</span>' : '<span class="pill">AI-generated</span>'}</h2><p style="margin:0">${esc(e.summary)}</p></div>` : ''}
      ${e.model?.key_claims?.length ? `<div class="card"><h2 style="margin:0 0 8px;font-size:15px">Key claims <span class="pill">reported, not verified</span></h2><ul style="margin:0;padding-left:18px">${e.model.key_claims.map((c) => `<li>${esc(c.claim)} ${c.source_url ? `<a class="muted" href="${esc(c.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${(e.model?.contradictions?.length || e.uncertain?.length) ? `<div class="card"><h2 style="margin:0 0 8px;font-size:15px">Contradictions &amp; uncertainty</h2>${(e.model?.contradictions || []).map((c) => `<div class="banner warn" style="margin:6px 0">${esc(c)}</div>`).join('')}${(e.uncertain || []).map((u) => `<div class="muted" style="font-size:13px">• ${esc(u)}</div>`).join('')}</div>` : ''}
      <div class="card">
        <h2 style="margin:0 0 12px;font-size:15px">Evidence (${d.evidence.articleCount} articles · ${d.evidence.independentReports} independent)</h2>
        <div class="feed">${d.articles.map((a) => `
          <div class="news-card">
            <h3><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.headline)}</a></h3>
            <div class="news-meta"><span>${esc(a.source || a.sourceDomain)}</span><span>published ${esc(dt(a.publishedTs))}</span><span>first seen ${esc(dt(a.firstSeenTs))}</span></div>
          </div>`).join('')}</div>
      </div>`;
  } catch (err) {
    view.innerHTML = `<div class="state error"><h3>Event unavailable</h3><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------------- Settings ---------------- */

async function viewSettings() {
  const view = $('#view');
  view.innerHTML = '<div class="skeleton" style="width:40%"></div>';
  const [secrets, settings, status, watchlist] = await Promise.all([
    api('/api/secrets').catch((e) => ({ secrets: [], error: e.message })),
    api('/api/settings').catch((e) => ({ settings: null, error: e.message })),
    api('/api/status').catch((e) => ({ error: e.message })),
    api('/api/watchlist').catch(() => ({ watchlist: [] })),
  ]);
  const s = settings.settings || {};
  const demo = isDemo();

  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Provider credentials, polling, and appearance. Keys are encrypted on the server and never returned to the browser.</p></div></div>

    <div class="card">
      <h2 style="margin:0 0 12px;font-size:16px">API keys</h2>
      ${demo ? '<div class="banner warn">Demo mode is read-only — key management is disabled.</div>' : ''}
      <div class="form-grid">
        ${(secrets.secrets || []).map((k) => `
          <div>
            <div class="field">
              <label>${esc(k.label)}</label>
              <div class="key-row">
                <input type="password" id="key-${esc(k.name)}" placeholder="${k.configured ? 'stored — enter a new value to replace' : 'paste your key'}" ${demo ? 'disabled' : ''} />
                <button class="btn small" data-save="${esc(k.name)}" ${demo ? 'disabled' : ''}>Save</button>
                <button class="btn ghost small" data-validate="${esc(k.name)}" ${demo ? 'disabled' : ''}>Validate</button>
                <button class="btn ghost small" data-delete="${esc(k.name)}" ${demo ? 'disabled' : ''}>Delete</button>
              </div>
              <div class="faint" style="font-size:11.5px">${k.configured ? `stored · last 4 ${esc(k.last4 || '')} · status ${esc(k.status || 'unknown')} · validated ${esc(rel(k.lastValidatedAt))}` : 'not configured'}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2 style="margin:0 0 12px;font-size:16px">Providers &amp; polling</h2>
      <div class="form-grid">
        <div>
          <label class="field">Market provider
            <select id="p-market" ${demo ? 'disabled' : ''}>
              ${['auto', 'twelvedata', 'fixture'].map((v) => `<option value="${v}" ${s.providers?.market === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="field">News provider
            <select id="p-news" ${demo ? 'disabled' : ''}>
              ${['auto', 'serpapi', 'fixture'].map((v) => `<option value="${v}" ${s.providers?.news === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
        </div>
        <div>
          <label class="field">News refresh interval (minutes)
            <input type="number" id="p-interval" min="1" max="1440" value="${esc(s.monitoring?.newsIntervalMinutes ?? 10)}" ${demo ? 'disabled' : ''} />
          </label>
          <label class="field">Monitoring
            <select id="p-enabled" ${demo ? 'disabled' : ''}>
              <option value="false" ${!s.monitoring?.enabled ? 'selected' : ''}>off (manual refresh)</option>
              <option value="true" ${s.monitoring?.enabled ? 'selected' : ''}>on (scheduled)</option>
            </select>
          </label>
        </div>
      </div>
      <button class="btn" id="p-save" ${demo ? 'disabled' : ''}>Save settings</button>
    </div>

    <div class="card">
      <h2 style="margin:0 0 12px;font-size:16px">Appearance</h2>
      <div class="toolbar">
        <span class="muted">Theme</span>
        <button class="btn ghost small" id="th-light">Light</button>
        <button class="btn ghost small" id="th-dark">Dark</button>
        <span class="faint">Current: ${esc(window.tiTheme ? window.tiTheme.current() : 'dark')} (saved in this browser only)</span>
      </div>
    </div>

    <div class="card">
      <h2 style="margin:0 0 12px;font-size:16px">Status</h2>
      <pre class="muted" style="margin:0;font-size:11.5px;white-space:pre-wrap">${esc(JSON.stringify({
        mode: state.session.mode,
        providers: status.providers,
        lastCycle: status.lastCycle,
        lastMarketUpdate: status.lastMarketUpdate,
        counts: status.counts,
        usage: status.usage,
        budget: status.budget,
        ollama: status.ollama ? { available: status.ollama.available, selected: status.ollama.selectedModel || null } : null,
        watchlistSymbols: (watchlist.watchlist || []).length,
      }, null, 2))}</pre>
      <p class="faint" style="font-size:11.5px;margin-top:10px">Other pages: <a href="/dashboard.html">Intelligence dashboard</a> · <a href="/explorer.html">Company explorer</a></p>
    </div>`;

  $('#th-light')?.addEventListener('click', () => window.tiTheme.set('light'));
  $('#th-dark')?.addEventListener('click', () => window.tiTheme.set('dark'));

  $('#p-save')?.addEventListener('click', async () => {
    try {
      const body = {
        monitoring: {
          newsIntervalMinutes: Number($('#p-interval').value),
          enabled: $('#p-enabled').value === 'true',
        },
        providers: { market: $('#p-market').value, news: $('#p-news').value },
      };
      await api('/api/settings', { method: 'PUT', body });
      toast('Settings saved', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  });

  onViewClick(async (e) => {
    const save = e.target.closest('[data-save]');
    const val = e.target.closest('[data-validate]');
    const del = e.target.closest('[data-delete]');
    try {
      if (save) {
        const name = save.dataset.save;
        const value = $(`#key-${name}`).value;
        if (!value) return toast('Enter a key first', 'bad');
        const r = await api(`/api/secrets/${name}`, { method: 'PUT', body: { value } });
        toast(r.validation?.ok ? 'Key saved and validated' : `Key saved — validation: ${r.validation?.detail || 'failed'}`, r.validation?.ok ? 'ok' : 'bad');
        viewSettings();
      } else if (val) {
        const r = await api(`/api/secrets/${val.dataset.validate}/validate`, { method: 'POST', body: {} });
        toast(r.validation?.ok ? `Valid — ${r.validation.detail}` : `Invalid — ${r.validation?.detail || 'rejected'}`, r.validation?.ok ? 'ok' : 'bad');
        viewSettings();
      } else if (del) {
        await api(`/api/secrets/${del.dataset.delete}`, { method: 'DELETE' });
        toast('Key deleted', 'ok');
        viewSettings();
      }
    } catch (err) { toast(err.message, 'bad'); }
  });
}

/* ---------------- boot ---------------- */

async function init() {
  try {
    const res = await fetch('/api/auth/session', { headers: { Accept: 'application/json' } });
    state.session = await res.json();
  } catch {
    state.session = { authenticated: false, mode: 'required' };
  }
  await loadWatchlist().catch(() => {});
  renderChrome(location.hash || '#/markets');
  mkt.watchRows = null;
  await route();
}

window.addEventListener('DOMContentLoaded', init);
