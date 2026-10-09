/* Google Finance Viewer - renders everything the SerpAPI google_finance engine returns. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const RANGES = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX'];
const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const state = {
  base: null, // full dataset (fetched without a window)
  range: '1D',
  rangeData: null, // windowed { summary, graph, key_events }
  currentQuery: '',
  hasServerKey: false,
  key: localStorage.getItem('serpapi_key') || '',
  chart: null,
  newsToken: 0,
};

const el = {
  form: $('#search-form'),
  query: $('#query'),
  searchBtn: $('#search-btn'),
  alert: $('#alert'),
  loading: $('#loading'),
  empty: $('#empty'),
  emptyKeyNote: $('#empty-key-note'),
  view: $('#view'),
  nav: $('#section-nav'),
  apiKey: $('#api-key'),
  keyHint: $('#key-hint'),
  suggestions: $('#suggestions'),
  directory: $('#sec-directory'),
};

/* Prices seen so far, keyed by bare symbol - lets the directory show a price
   once an instrument has appeared in any response. */
const priceCache = new Map();

function bareSymbol(text) {
  return String(text || '').split(':')[0].trim().toUpperCase();
}

function rememberPrice(symbol, item) {
  if (!symbol || item == null) return;
  const price = item.extracted_price ?? parseNumber(item.price);
  if (!Number.isFinite(price)) return;
  priceCache.set(bareSymbol(symbol), {
    price,
    currency: item.currency || '',
    movement: item.price_movement?.movement,
    percentage: item.price_movement?.percentage,
  });
}

function recordPrices(data) {
  if (!data) return;
  const s = data.summary;
  if (s?.stock) rememberPrice(s.stock, s);
  (data.suggestions || []).forEach((i) => rememberPrice(i.stock, i));
  (data.discover_more || []).forEach((g) => (g.items || []).forEach((i) => rememberPrice(i.stock, i)));
  Object.values(data.markets || {}).forEach((region) => {
    if (Array.isArray(region)) region.forEach((i) => rememberPrice(i.stock, i));
  });
}

const SECTIONS = [
  ['sec-summary', 'Overview'],
  ['sec-chart', 'Price chart'],
  ['sec-stats', 'Key stats'],
  ['sec-about', 'About'],
  ['sec-financials', 'Financials'],
  ['sec-news', 'News'],
  ['sec-stocknews', 'Latest news'],
  ['sec-related', 'Related'],
  ['sec-raw', 'Raw JSON'],
];

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function parseNumber(value) {
  if (value == null) return NaN;
  const n = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function fmtCompact(value) {
  const n = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(n)) return value == null || value === '' ? '—' : String(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  if (abs >= 1) return `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `${sign}${abs}`;
}

function fmtMoney(value, currency) {
  const n = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(n)) return value == null || value === '' ? '—' : String(value);
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
    } catch {
      /* fall through */
    }
  }
  const prefix = currency && currency !== 'USD' ? `${currency} ` : '';
  return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}

function fmtPercent(value) {
  const n = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function moveClass(movement) {
  return String(movement || '').toLowerCase() === 'down' ? 'down' : 'up';
}

function arrow(movement) {
  return String(movement || '').toLowerCase() === 'down' ? '▼' : '▲';
}

function fmtChange(change) {
  if (!change) return '';
  return String(change);
}

/** Parse SerpAPI date strings like "May 22 2026, 09:30 AM UTC-04:00". */
function parseSerpDate(str) {
  if (!str) return null;
  const m = String(str).match(
    /^([A-Za-z]{3})\w*\s+(\d{1,2})\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*UTC([+-]\d{2}):?(\d{2})?/,
  );
  if (!m) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let [, mon, day, year, hour, min, ampm, tzh, tzm] = m;
  hour = Number(hour) % 12 + (ampm === 'PM' ? 12 : 0);
  const utcMs = Date.UTC(Number(year), MONTHS[mon] ?? 0, Number(day), hour, Number(min));
  const offsetMin =
    (tzh.startsWith('-') ? -1 : 1) * (Math.abs(Number(tzh)) * 60 + Number(tzm || 0));
  return new Date(utcMs - offsetMin * 60 * 1000);
}

function shortDateLabel(date) {
  if (!date) return '';
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function apiSearch(query, range) {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, window: range || undefined, apiKey: state.key || undefined }),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: `Server returned ${res.status}` };
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  if (data.error) throw new Error(data.error);
  if (data.search_metadata?.status === 'Error') throw new Error(data.error || 'Search failed');
  return data;
}

async function apiSuggest(query, signal) {
  const res = await fetch('/api/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, apiKey: state.key || undefined }),
    signal,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

async function apiNews(query) {
  const res = await fetch('/api/news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, apiKey: state.key || undefined }),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: `Server returned ${res.status}` };
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  if (data.error) throw new Error(data.error);
  return data;
}

/* ------------------------------------------------------------------ */
/* Flow                                                                */
/* ------------------------------------------------------------------ */

async function runSearch(query) {
  const q = (query || '').trim();
  if (!q) return;

  state.currentQuery = q;
  el.query.value = q;
  hideSuggestions();
  state.newsToken += 1;
  showSection('sec-stocknews', false);
  setBusy(true);
  clearAlert();
  state.range = '1D';
  state.rangeData = null;

  try {
    const data = await apiSearch(q);
    if (data._cached) noteCache();
    state.base = data;
    renderAll(data);
  } catch (err) {
    showError(err.message || String(err));
    if (!state.base) showEmpty();
  } finally {
    setBusy(false);
  }
}

async function changeRange(range) {
  if (range === state.range || !state.currentQuery) return;
  state.range = range;
  updateRangeButtons();

  const fullGraph = state.base?.graph;
  if (range === '1D' && fullGraph) {
    state.rangeData = null;
    renderChart(fullGraph);
    return;
  }

  setBusy(true, 'Loading chart…');
  try {
    const data = await apiSearch(state.currentQuery, range);
    state.rangeData = data;
    if (Array.isArray(data.graph) && data.graph.length) renderChart(data.graph);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ */
/* Render orchestration                                                */
/* ------------------------------------------------------------------ */

function renderAll(data) {
  recordPrices(data);
  const summary = data.summary || {};
  const suggestions = data.suggestions || [];

  const hasSummary = Boolean(summary.title || summary.stock);
  if (!hasSummary && suggestions.length) {
    renderSuggestionsOnly(suggestions);
    return;
  }
  if (!hasSummary) {
    showError('No data was returned for that query. Try adding the exchange, e.g. AAPL:NASDAQ.');
    showEmpty();
    return;
  }

  el.empty.classList.add('hidden');
  el.view.classList.remove('hidden');

  renderSummary(summary, data);
  renderChart(state.rangeData?.graph || data.graph || []);
  const kg = data.knowledge_graph || {};
  renderStats(kg, summary);
  renderAbout(kg);
  renderFinancials(data.financials || []);
  renderNews(data.news_results || []);
  loadStockNews(summary);
  renderRelated(data, suggestions);
  renderRaw(data);

  buildNav();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSection(id, visible) {
  const node = document.getElementById(id);
  if (!node) return;
  node.classList.toggle('hidden', !visible);
}

function section(id, title) {
  const node = document.getElementById(id);
  node.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'sec-head';
  head.innerHTML = `<h2>${esc(title)}</h2><div class="sec-tools"></div>`;
  node.appendChild(head);
  return { node, tools: head.querySelector('.sec-tools') };
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function renderSummary(summary, data) {
  showSection('sec-summary', true);
  const node = document.getElementById('sec-summary');
  node.innerHTML = '';

  const movement = summary.price_movement || {};
  const cls = moveClass(movement.movement);
  const price = summary.extracted_price ?? summary.price;
  const changeValue =
    movement.value != null ? `${parseNumber(movement.value) >= 0 ? '+' : ''}${fmtMoney(movement.value, summary.currency)}` : '';

  const market = summary.market;
  const extensions = summary.extensions || [];

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="hero">
      <div class="hero-id">
        <h3>${esc(summary.title || summary.stock)}</h3>
        <p class="ticker">${esc(summary.stock || '')}${summary.exchange ? ` : ${esc(summary.exchange)}` : ''}</p>
      </div>
      <div class="hero-price">
        <div class="price">${esc(fmtMoney(price, summary.currency))}</div>
        <div class="change ${cls}">
          ${movement.movement ? `<span class="arrow">${arrow(movement.movement)}</span> ` : ''}
          ${esc(changeValue)} ${movement.percentage != null ? `(${esc(fmtPercent(movement.percentage))})` : ''}
        </div>
      </div>
      ${(() => {
        const meta = [];
        if (summary.date) meta.push(summary.date);
        const metaHtml = meta.map((m) => `<span class="badge">${esc(m)}</span>`).join('');
        const link = data.search_metadata?.google_finance_url
          ? `<a class="badge" href="${esc(data.search_metadata.google_finance_url)}" target="_blank" rel="noopener">Open on Google Finance ↗</a>`
          : '';
        const ext = extensions.length
          ? `<span class="badge">${esc(extensions.join(' · '))}</span>`
          : summary.currency
            ? `<span class="badge">${esc(summary.currency)}</span>`
            : '';
        return `<div class="hero-meta">${metaHtml}${link}${ext}</div>`;
      })()}
      ${market
        ? `<div class="market-box">
             <span class="label">${esc(market.trading || 'Market')}</span>
             <strong>${esc(fmtMoney(market.extracted_price ?? market.price, market.currency || summary.currency))}</strong>
             <span class="${moveClass(market.price_movement?.movement)}">
               ${market.price_movement ? `${arrow(market.price_movement.movement)} ${esc(fmtMoney(market.price_movement.value, market.currency || summary.currency))} (${esc(fmtPercent(market.price_movement.percentage))})` : ''}
             </span>
           </div>`
        : ''}
    </div>`;
  node.appendChild(card);
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

function prepareGraph(graph) {
  let rows = graph.filter((p) => p && p.price != null);
  const total = rows.length;
  if (total > 1600) {
    const step = Math.ceil(total / 1600);
    rows = rows.filter((_, i) => i % step === 0 || i === total - 1);
  }
  return rows.map((p) => {
    const d = parseSerpDate(p.date);
    return {
      label: shortDateLabel(d) || String(p.date || ''),
      full: String(p.date || ''),
      price: typeof p.price === 'number' ? p.price : parseNumber(p.price),
      volume: p.volume,
      currency: p.currency,
    };
  });
}

function renderChart(graph) {
  const node = document.getElementById('sec-chart');
  const hasGraph = Array.isArray(graph) && graph.length > 0;
  showSection('sec-chart', hasGraph);
  if (!hasGraph) {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    return;
  }

  const rows = prepareGraph(graph);
  const first = rows[0].price;
  const last = rows[rows.length - 1].price;
  const up = last >= first;
  const color = up ? '#26b57a' : '#f0556b';
  const currency = rows[0].currency || state.base?.summary?.currency || '';

  node.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'sec-head';
  head.innerHTML = `
    <h2>Price chart</h2>
    <div class="range-toggle" id="range-toggle">
      ${RANGES.map(
        (r) => `<button type="button" data-range="${r}" class="${r === state.range ? 'active' : ''}">${r}</button>`,
      ).join('')}
    </div>`;
  node.appendChild(head);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="chart-wrap"><canvas id="price-chart"></canvas></div>`;
  node.appendChild(card);

  $('#range-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (btn) changeRange(btn.dataset.range);
  });

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  const ctx = $('#price-chart').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 340);
  gradient.addColorStop(0, up ? 'rgba(38,181,122,0.30)' : 'rgba(240,85,107,0.30)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  if (typeof window.Chart === 'undefined') {
    card.innerHTML = '<p class="muted">Chart library failed to load (offline?). The data is still available in the table and Raw JSON sections.</p>';
    return;
  }

  state.chart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map((r) => r.label),
      datasets: [
        {
          data: rows.map((r) => r.price),
          borderColor: color,
          backgroundColor: gradient,
          borderWidth: 1.8,
          pointRadius: 0,
          pointHitRadius: 8,
          fill: true,
          tension: 0.12,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => rows[items[0].dataIndex].full || items[0].label,
            label: (item) => {
              const r = rows[item.dataIndex];
              const priceLine = `Price: ${fmtMoney(r.price, currency)}`;
              const vol = r.volume != null ? `\nVolume: ${Number(r.volume).toLocaleString('en-US')}` : '';
              return priceLine + vol;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(36,48,74,0.5)' },
          ticks: { color: '#6b7a97', maxTicksLimit: 8, maxRotation: 0, autoSkip: true },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(36,48,74,0.5)' },
          ticks: {
            color: '#6b7a97',
            callback: (v) => fmtMoney(v, currency),
          },
        },
      },
    },
  });
}

function updateRangeButtons() {
  $$('#range-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.range === state.range),
  );
}

/* ------------------------------------------------------------------ */
/* Key stats                                                           */
/* ------------------------------------------------------------------ */

function renderStats(kg, summary) {
  const keyStats = kg.key_stats || {};
  const stats = keyStats.stats || [];
  const tags = keyStats.tags || [];
  const climate = keyStats.climate_change;
  const hasData = stats.length || tags.length || climate;

  showSection('sec-stats', Boolean(hasData));
  if (!hasData) return;

  const { node } = section('sec-stats', 'Key stats');
  const card = document.createElement('div');
  card.className = 'card';

  const tagsHtml = tags.length
    ? `<div class="tags">${tags
        .map((t) => {
          const title = t.description ? ` title="${esc(t.description)}"` : '';
          return `<span class="tag"${title}>${esc(t.text)}</span>`;
        })
        .join('')}</div>`
    : '';

  const statsHtml = stats.length
    ? `<div class="stats-grid">${stats
        .map(
          (s) => `
          <div class="stat">
            <div class="label">${esc(s.label)}</div>
            <div class="value">${esc(s.value)}</div>
            ${s.description ? `<div class="desc">${esc(s.description)}</div>` : ''}
          </div>`,
        )
        .join('')}</div>`
    : '';

  const climateHtml = climate
    ? `<div class="stat" style="margin-top:12px;max-width:260px">
         <div class="label">Climate change score</div>
         <div class="value">${esc(climate.score)} ${climate.link ? `<a class="inline" href="${esc(climate.link)}" target="_blank" rel="noopener">↗</a>` : ''}</div>
       </div>`
    : '';

  card.innerHTML = `${tagsHtml}${statsHtml}${climateHtml}`;
  node.appendChild(card);
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

function renderAbout(kg) {
  const about = kg.about || [];
  showSection('sec-about', about.length > 0);
  if (!about.length) return;

  const { node } = section('sec-about', 'About');
  const card = document.createElement('div');
  card.className = 'card about-grid';

  card.innerHTML = about
    .map((block) => {
      const desc = block.description || {};
      const snippet = desc.snippet
        ? `<p class="about-snippet">${esc(desc.snippet)}</p>`
        : '';
      const source = desc.link
        ? `<p class="muted" style="margin:0">Source: <a class="inline" href="${esc(desc.link)}" target="_blank" rel="noopener">${esc(desc.link_text || desc.link)}</a></p>`
        : '';
      const info = block.info || [];
      const infoHtml = info.length
        ? `<div class="info-grid">${info
            .map((i) => {
              const value = i.link
                ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.value)}</a>`
                : esc(i.value);
              return `<div class="info-item"><div class="label">${esc(i.label)}</div><div class="value">${value}</div></div>`;
            })
            .join('')}</div>`
        : '';
      const title = block.title ? `<h3 style="margin:0;font-size:15px">${esc(block.title)}</h3>` : '';
      return `<div>${title}${snippet}${source}${infoHtml}</div>`;
    })
    .join('');

  node.appendChild(card);
}

/* ------------------------------------------------------------------ */
/* Financials                                                          */
/* ------------------------------------------------------------------ */

function normalizeFinancialValue(value) {
  if (value == null || value === '') return { display: '—', full: '' };
  const raw = String(value);
  if (raw.includes('%')) return { display: raw, full: raw };
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) return { display: raw, full: raw };
  return { display: fmtCompact(n), full: n.toLocaleString('en-US') };
}

function changeClass(change) {
  const s = String(change || '');
  if (s.startsWith('-')) return 'down';
  if (s.startsWith('+') || parseNumber(s) > 0) return 'up';
  return '';
}

function buildFinancialTable(results) {
  if (!results.length) return '<p class="muted">No data.</p>';
  const columns = results;
  const metricOrder = [];
  const seen = new Set();
  columns.forEach((r) => {
    (r.table || []).forEach((row) => {
      if (!seen.has(row.title)) {
        seen.add(row.title);
        metricOrder.push(row.title);
      }
    });
  });

  const head = `<tr><th>Metric</th>${columns
    .map((c) => `<th>${esc(c.date)}${c.period_type ? `<br><span class="muted" style="font-weight:400">${esc(c.period_type)}</span>` : ''}</th>`)
    .join('')}</tr>`;

  const body = metricOrder
    .map((metric) => {
      const cells = columns
        .map((c) => {
          const row = (c.table || []).find((x) => x.title === metric);
          if (!row) return '<td>—</td>';
          const { display, full } = normalizeFinancialValue(row.value);
          const change = row.change
            ? `<span class="cell-change ${changeClass(row.change)}">${esc(fmtChange(row.change))}</span>`
            : '';
          return `<td title="${esc(full)}"><strong>${esc(display)}</strong>${change}</td>`;
        })
        .join('');
      return `<tr><td title="${esc(metric)}">${esc(metric)}</td>${cells}</tr>`;
    })
    .join('');

  return `<div class="table-scroll"><table class="data"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderFinancials(financials) {
  showSection('sec-financials', financials.length > 0);
  if (!financials.length) return;

  const { node } = section('sec-financials', 'Financials');
  const card = document.createElement('div');
  card.className = 'card';

  card.innerHTML = financials
    .map((stmt, idx) => {
      const results = stmt.results || [];
      const periodTypes = [];
      results.forEach((r) => {
        if (r.period_type && !periodTypes.includes(r.period_type)) periodTypes.push(r.period_type);
      });
      const initial = periodTypes[0] || '';

      const periodSeg = periodTypes.length > 1
        ? `<div class="seg" data-stmt="${idx}">
             ${periodTypes.map((p) => `<button type="button" data-period="${esc(p)}" class="${p === initial ? 'active' : ''}">${esc(p)}</button>`).join('')}
           </div>`
        : `<span class="muted">${esc(initial)}</span>`;

      return `
        <div class="stmt" data-stmt="${idx}">
          <div class="sec-head"><h2 style="font-size:13px">${esc(stmt.title)}</h2></div>
          <div class="stmt-controls">${periodSeg}</div>
          <div class="stmt-table" data-stmt="${idx}" data-period="${esc(initial)}"></div>
        </div>`;
    })
    .join('');

  node.appendChild(card);

  function paint(stmtIdx, period) {
    const results = (financials[stmtIdx].results || []).filter((r) => r.period_type === period);
    const holder = card.querySelector(`.stmt-table[data-stmt="${stmtIdx}"]`);
    if (holder) holder.innerHTML = buildFinancialTable(results);
  }

  financials.forEach((stmt, idx) => {
    const periodTypes = [];
    (stmt.results || []).forEach((r) => {
      if (r.period_type && !periodTypes.includes(r.period_type)) periodTypes.push(r.period_type);
    });
    paint(idx, periodTypes[0] || '');
  });

  card.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg button[data-period]');
    if (!btn) return;
    const stmtIdx = Number(btn.closest('.seg').dataset.stmt);
    btn.closest('.seg')
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('active', b === btn));
    paint(stmtIdx, btn.dataset.period);
  });
}

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

function newsCard(item, fallbackTitle) {
  const title = item.snippet || item.title || fallbackTitle || 'News';
  const thumb = item.thumbnail
    ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';
  return `
    <a class="news-card" href="${esc(item.link || '#')}" target="_blank" rel="noopener">
      ${thumb}
      <div class="body">
        <div class="snippet">${esc(title)}</div>
        <div class="meta">
          ${item.source ? `<span class="src">${esc(item.source)}</span> · ` : ''}${esc(item.date || '')}
        </div>
      </div>
    </a>`;
}

function renderNews(news) {
  const list = Array.isArray(news) ? news : [];
  const groups = [];
  list.forEach((entry) => {
    if (Array.isArray(entry.items)) groups.push({ title: entry.title, items: entry.items });
    else groups.push({ title: null, items: [entry] });
  });
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  showSection('sec-news', total > 0);
  if (!total) return;

  const { node } = section('sec-news', 'News');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = groups
    .map((g) => {
      const title = g.title ? `<div class="news-group-title">${esc(g.title)}</div>` : '';
      return `${title}<div class="news-grid">${g.items.map((i) => newsCard(i, g.title)).join('')}</div>`;
    })
    .join('');
  node.appendChild(card);
}

/* ------------------------------------------------------------------ */
/* Stock news (Google News engine)                                     */
/* ------------------------------------------------------------------ */

function newsQueryFor(summary) {
  let q = String(summary.title || summary.stock || '').trim();
  q = q.replace(/\s+Class\s+[A-Z]\s*$/i, '').trim();
  if (!q) q = bareSymbol(summary.stock) || state.currentQuery || '';
  return q;
}

function fmtNewsDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function googleNewsCard(item) {
  const source = item.source || {};
  const icon = source.icon || item.thumbnail || '';
  const date = fmtNewsDate(item.iso_date);
  const authors = (source.authors || []).slice(0, 2).join(', ');
  const meta = [
    source.name ? `<span class="src">${esc(source.name)}</span>` : '',
    date ? esc(date) : '',
    item.type ? esc(item.type) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <a class="news-card" href="${esc(item.link || '#')}" target="_blank" rel="noopener">
      ${icon ? `<img src="${esc(icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}
      <div class="body">
        <div class="snippet">${esc(item.title || '')}</div>
        <div class="meta">${meta}${authors ? ` · ${esc(authors)}` : ''}</div>
      </div>
    </a>`;
}

function renderStockNews(node, tools, query, items, data) {
  const groups = [];
  items.forEach((entry) => {
    if (Array.isArray(entry.stories) && entry.stories.length) {
      groups.push({ title: entry.title, items: entry.stories });
    } else if (entry.highlight) {
      groups.push({ title: entry.title, items: [entry.highlight, ...(entry.stories || [])] });
    } else {
      groups.push({ title: null, items: [entry] });
    }
  });

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  tools.innerHTML = `<span class="dir-count">${total} article${total === 1 ? '' : 's'} for “${esc(query)}” · Google News</span>`;

  const card = document.createElement('div');
  card.className = 'card';

  const body = groups
    .filter((g) => g.items.length)
    .map((g) => {
      const heading = g.title ? `<div class="news-group-title">${esc(g.title)}</div>` : '';
      return `${heading}<div class="news-grid">${g.items.map(googleNewsCard).join('')}</div>`;
    })
    .join('');

  const topics = (data.related_topics || []).map((t) => t.title).filter(Boolean);
  const topicsHtml = topics.length
    ? `<div class="news-group-title" style="margin-top:18px">Related topics</div>
       <div class="tags">${topics.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
    : '';

  card.innerHTML = body + topicsHtml;
  node.appendChild(card);
}

async function loadStockNews(summary) {
  const query = newsQueryFor(summary);
  if (!query) {
    showSection('sec-stocknews', false);
    return;
  }

  const token = ++state.newsToken;
  showSection('sec-stocknews', true);
  const { node, tools } = section('sec-stocknews', 'Latest news');
  tools.innerHTML = `<span class="dir-count">Loading headlines for “${esc(query)}”…</span>`;

  try {
    const data = await apiNews(query);
    if (token !== state.newsToken) return;

    const items = data.news_results || [];
    if (!items.length) {
      showSection('sec-stocknews', false);
      buildNav();
      return;
    }

    renderStockNews(node, tools, query, items, data);
    buildNav();
  } catch {
    if (token !== state.newsToken) return;
    showSection('sec-stocknews', false);
    buildNav();
  }
}

/* ------------------------------------------------------------------ */
/* Related / discover more / markets / suggestions                     */
/* ------------------------------------------------------------------ */

function tickerChip(item) {
  const q = item.stock || item.serpapi_link || '';
  const price = item.extracted_price != null
    ? fmtMoney(item.extracted_price, item.currency)
    : item.price || '';
  const mv = item.price_movement;
  const cls = mv ? moveClass(mv.movement) : '';
  const move = mv
    ? `<span class="price ${cls}">${arrow(mv.movement)} ${esc(fmtPercent(mv.percentage))}</span>`
    : `<span class="price">${esc(price)}</span>`;
  return `
    <button class="chip" data-q="${esc(q)}" title="${esc(item.name || '')}">
      <span class="sym">${esc(item.stock || item.name || '')}</span>
      ${item.name && item.stock ? `<span class="name">${esc(item.name)}</span>` : ''}
      ${move}
    </button>`;
}

function renderRelated(data, suggestions) {
  const discover = data.discover_more || [];
  const markets = data.markets || {};
  const hasSuggestions = suggestions.length > 0;
  const hasDiscover = discover.length > 0;
  const marketRegions = Object.entries(markets).filter(([, v]) => Array.isArray(v) && v.length);
  const hasMarkets = marketRegions.length > 0 || Boolean(markets.top_news);

  showSection('sec-related', hasSuggestions || hasDiscover || hasMarkets);
  if (!hasSuggestions && !hasDiscover && !hasMarkets) return;

  const { node } = section('sec-related', 'Related');
  const card = document.createElement('div');
  card.className = 'card';

  const parts = [];

  if (hasSuggestions) {
    parts.push(
      `<div class="news-group-title">Did you mean</div><div class="chips">${suggestions.map(tickerChip).join('')}</div>`,
    );
  }

  discover.forEach((group) => {
    const title = group.title || 'You may be interested in';
    const items = group.items || [];
    if (items.length) {
      parts.push(`<div class="news-group-title" style="margin-top:16px">${esc(title)}</div><div class="chips">${items.map(tickerChip).join('')}</div>`);
    } else {
      parts.push(`<div class="chips">${tickerChip(group)}</div>`);
    }
  });

  marketRegions.forEach(([region, items]) => {
    parts.push(
      `<div class="news-group-title" style="margin-top:16px">${esc(region[0].toUpperCase() + region.slice(1))} markets</div><div class="chips">${items.map(tickerChip).join('')}</div>`,
    );
  });

  if (markets.top_news) {
    parts.push(`<div class="news-group-title" style="margin-top:16px">Top news</div><div class="news-grid">${newsCard(markets.top_news)}</div>`);
  }

  card.innerHTML = parts.join('');
  node.appendChild(card);
}

function renderSuggestionsOnly(suggestions) {
  el.empty.classList.add('hidden');
  el.view.classList.remove('hidden');
  SECTIONS.forEach(([id]) => showSection(id, false));

  showSection('sec-related', true);
  const { node } = section('sec-related', 'Did you mean');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<p class="muted" style="margin-top:0">No direct match. Pick the instrument you meant:</p>
    <div class="chips">${suggestions.map(tickerChip).join('')}</div>`;
  node.appendChild(card);

  el.nav.innerHTML = '';
  const a = document.createElement('a');
  a.href = '#sec-related';
  a.textContent = 'Did you mean';
  el.nav.appendChild(a);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* Raw JSON                                                            */
/* ------------------------------------------------------------------ */

function renderRaw(data) {
  showSection('sec-raw', true);
  const { node, tools } = section('sec-raw', 'Raw JSON');
  const card = document.createElement('div');
  card.className = 'card';
  const details = document.createElement('details');
  details.className = 'raw';
  const size = (JSON.stringify(data).length / 1024).toFixed(1);
  details.innerHTML = `<summary>Show full SerpAPI response (${size} KB)</summary>`;
  const pre = document.createElement('pre');
  pre.className = 'raw-json';
  pre.textContent = JSON.stringify(data, null, 2);
  details.appendChild(pre);
  card.appendChild(details);

  const copy = document.createElement('button');
  copy.className = 'chip';
  copy.textContent = 'Copy JSON';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      copy.textContent = 'Copied!';
      setTimeout(() => (copy.textContent = 'Copy JSON'), 1500);
    } catch {
      copy.textContent = 'Copy failed';
    }
  });
  tools.appendChild(copy);

  node.appendChild(card);
}

/* ------------------------------------------------------------------ */
/* Nav + status                                                        */
/* ------------------------------------------------------------------ */

function buildNav() {
  el.nav.innerHTML = '';
  const addLink = (id, title) => {
    const a = document.createElement('a');
    a.href = `#${id}`;
    a.textContent = title;
    el.nav.appendChild(a);
  };

  if (!el.view.classList.contains('hidden')) {
    SECTIONS.forEach(([id, title]) => {
      const node = document.getElementById(id);
      if (!node || node.classList.contains('hidden')) return;
      addLink(id, title);
    });
  }
  if (el.directory && !el.directory.classList.contains('hidden')) {
    addLink('sec-directory', 'Browse stocks');
  }
  highlightNavOnScroll();
}

function highlightNavOnScroll() {
  const links = $$('#section-nav a');
  if (!links.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === `#${entry.target.id}`));
        }
      });
    },
    { rootMargin: '-90px 0px -70% 0px', threshold: 0 },
  );
  SECTIONS.forEach(([id]) => {
    const node = document.getElementById(id);
    if (node && !node.classList.contains('hidden')) observer.observe(node);
  });
  if (el.directory && !el.directory.classList.contains('hidden')) observer.observe(el.directory);
}

function setBusy(busy, label) {
  el.searchBtn.disabled = busy;
  el.loading.classList.toggle('hidden', !busy);
  if (busy) {
    el.empty.classList.add('hidden');
    if (label) el.loading.querySelector('p').textContent = label;
    else el.loading.querySelector('p').textContent = 'Fetching data from Google Finance…';
  }
}

function showError(message) {
  el.alert.textContent = message;
  el.alert.classList.remove('hidden', 'info');
  el.alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

let cacheNoteTimer = null;
function noteCache() {
  el.alert.textContent = 'Served from the local 10-minute cache - no SerpAPI credits used.';
  el.alert.classList.remove('hidden');
  el.alert.classList.add('info');
  clearTimeout(cacheNoteTimer);
  cacheNoteTimer = setTimeout(() => clearAlert(), 4000);
}

function clearAlert() {
  el.alert.classList.add('hidden');
  el.alert.textContent = '';
}

function showEmpty() {
  el.view.classList.add('hidden');
  el.empty.classList.remove('hidden');
  buildNav();
}

/* ------------------------------------------------------------------ */
/* Search recommendations (live SerpAPI suggestions)                   */
/* ------------------------------------------------------------------ */

const suggest = {
  items: [],
  active: -1,
  token: 0,
  controller: null,
  timer: null,
  cache: new Map(),
};

function hideSuggestions() {
  suggest.active = -1;
  suggest.items = [];
  clearTimeout(suggest.timer);
  el.suggestions.classList.add('hidden');
  el.suggestions.innerHTML = '';
}

function onQueryInput() {
  const q = el.query.value.trim();
  clearTimeout(suggest.timer);
  if (q.length < 2) {
    hideSuggestions();
    return;
  }
  suggest.timer = setTimeout(() => loadSuggestions(q), 320);
}

async function loadSuggestions(q) {
  const cacheKey = q.toLowerCase();
  if (suggest.cache.has(cacheKey)) {
    renderSuggestions(suggest.cache.get(cacheKey), q);
    return;
  }
  if (!state.hasServerKey && !state.key) {
    renderSuggestionNote('Add a SerpAPI key in Settings to get recommendations while typing.');
    return;
  }

  const token = ++suggest.token;
  if (suggest.controller) suggest.controller.abort();
  suggest.controller = new AbortController();
  renderSuggestionNote('Searching…');

  try {
    const data = await apiSuggest(q, suggest.controller.signal);
    if (token !== suggest.token) return;
    const items = data.recommendations || [];
    items.forEach((r) => rememberPrice(r.symbol || r.q, r));
    suggest.cache.set(cacheKey, items);
    renderSuggestions(items, q);
    renderDirectoryPrices();
  } catch (err) {
    if (err.name === 'AbortError' || token !== suggest.token) return;
    renderSuggestionNote(err.message || 'Could not load recommendations.');
  }
}

function suggestionMove(item) {
  const mv = item.price_movement;
  if (!mv || mv.percentage == null) return '';
  return `<span class="move ${moveClass(mv.movement)}">${arrow(mv.movement)} ${esc(fmtPercent(mv.percentage))}</span>`;
}

function renderSuggestions(items, q) {
  suggest.items = items;
  suggest.active = -1;

  if (!items.length) {
    renderSuggestionNote(`No matches for &ldquo;${esc(q)}&rdquo;. Press Enter to search anyway.`);
    return;
  }

  el.suggestions.innerHTML = items
    .map(
      (item, i) => `
      <div class="suggestion" role="option" data-index="${i}" data-q="${esc(item.q)}">
        <span class="sym">${esc(item.symbol || item.q)}</span>
        <span class="name">${esc(item.name || '')}</span>
        ${suggestionMove(item)}
      </div>`,
    )
    .join('');
  el.suggestions.classList.remove('hidden');
}

function renderSuggestionNote(text) {
  suggest.items = [];
  suggest.active = -1;
  el.suggestions.innerHTML = `<div class="sug-note">${text}</div>`;
  el.suggestions.classList.remove('hidden');
}

function moveSuggestion(delta) {
  if (!suggest.items.length) return;
  suggest.active = (suggest.active + delta + suggest.items.length) % suggest.items.length;
  $$('.suggestion', el.suggestions).forEach((node, i) =>
    node.classList.toggle('active', i === suggest.active),
  );
  el.suggestions.querySelector('.suggestion.active')?.scrollIntoView({ block: 'nearest' });
}

function onQueryKeydown(e) {
  if (el.suggestions.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSuggestion(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSuggestion(-1);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  } else if (e.key === 'Enter' && suggest.active >= 0) {
    e.preventDefault();
    runSearch(suggest.items[suggest.active].q);
  }
}

/* ------------------------------------------------------------------ */
/* Browse directory                                                    */
/* ------------------------------------------------------------------ */

const dirState = { filter: '', type: 'All', limit: 250 };

function catalogEntries() {
  const list = Array.isArray(window.STOCK_CATALOG) ? window.STOCK_CATALOG : [];
  return list.map((e) => ({ ...e, q: e.exchange ? `${e.symbol}:${e.exchange}` : e.symbol }));
}

function renderDirectory() {
  const entries = catalogEntries();
  if (!entries.length) {
    el.directory.classList.add('hidden');
    return;
  }

  const types = ['All', ...Array.from(new Set(entries.map((e) => e.type)))];
  el.directory.classList.remove('hidden');
  el.directory.innerHTML = `
    <div class="sec-head">
      <h2>Browse stocks &amp; instruments</h2>
      <div class="sec-tools"><span class="dir-count" id="dir-count"></span></div>
    </div>
    <div class="card">
      <div class="dir-toolbar">
        <input id="dir-filter" class="dir-filter" type="search" placeholder="Filter by symbol or name…" autocomplete="off" />
        <div class="seg" id="dir-types">
          ${types
            .map(
              (t) =>
                `<button type="button" data-type="${esc(t)}" class="${t === 'All' ? 'active' : ''}">${esc(t)}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="dir-list">
        <div class="dir-head"><span>Symbol</span><span>Name</span><span>Exchange</span><span>Type</span><span>Last price</span></div>
        <div class="dir-scroll" id="dir-rows"></div>
      </div>
    </div>`;

  $('#dir-filter').addEventListener('input', (e) => {
    dirState.filter = e.target.value.trim().toLowerCase();
    paintDirectory();
  });
  $('#dir-types').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    dirState.type = btn.dataset.type;
    $$('#dir-types button').forEach((b) => b.classList.toggle('active', b === btn));
    paintDirectory();
  });

  paintDirectory();
}

function dirRow(entry) {
  const cached = priceCache.get(bareSymbol(entry.symbol));
  const price = cached
    ? `<span class="dir-price ${moveClass(cached.movement)}">${esc(fmtMoney(cached.price, cached.currency))}</span>`
    : '<span class="dir-price muted">—</span>';
  return `
    <button class="dir-row" data-q="${esc(entry.q)}" title="Load ${esc(entry.symbol)}">
      <span class="dir-sym">${esc(entry.symbol)}</span>
      <span class="dir-name">${esc(entry.name)}</span>
      <span class="dir-exch">${esc(entry.exchange || '—')}</span>
      <span class="dir-type">${esc(entry.type)}</span>
      ${price}
    </button>`;
}

function paintDirectory() {
  const rows = el.directory.querySelector('#dir-rows');
  if (!rows) return;

  const matches = catalogEntries().filter((e) => {
    if (dirState.type !== 'All' && e.type !== dirState.type) return false;
    if (!dirState.filter) return true;
    return (
      e.symbol.toLowerCase().includes(dirState.filter) ||
      e.name.toLowerCase().includes(dirState.filter)
    );
  });

  const shown = matches.slice(0, dirState.limit);
  rows.innerHTML = shown.map(dirRow).join('');

  const count = el.directory.querySelector('#dir-count');
  if (count) {
    count.textContent =
      matches.length > shown.length
        ? `Showing ${shown.length} of ${matches.length}`
        : `${matches.length} instrument${matches.length === 1 ? '' : 's'}`;
  }
}

function renderDirectoryPrices() {
  if (!el.directory || el.directory.classList.contains('hidden')) return;
  paintDirectory();
}

/* ------------------------------------------------------------------ */
/* Settings / key                                                      */
/* ------------------------------------------------------------------ */

function refreshKeyHint() {
  if (state.hasServerKey) {
    el.keyHint.textContent =
      'A key from .env is active. Anything you paste here overrides it and is only stored in this browser.';
  } else if (state.key) {
    el.keyHint.textContent = 'Using the key saved in this browser.';
  } else {
    el.keyHint.textContent =
      'No key configured. Add SERPAPI_API_KEY to .env, or paste your private key here (stored only in this browser via localStorage).';
  }
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

function bindGlobalClicks() {
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-q]');
    if (chip) {
      const q = chip.dataset.q;
      if (q) runSearch(q);
      return;
    }
    if (!e.target.closest('.search-field')) hideSuggestions();
  });
}

async function init() {
  el.apiKey.value = state.key;
  refreshKeyHint();

  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    state.hasServerKey = Boolean(cfg.hasServerKey);
    refreshKeyHint();
  } catch {
    /* server config optional */
  }

  if (!state.hasServerKey) {
    el.emptyKeyNote.textContent =
      'Tip: open Settings (top right) and paste your SerpAPI key, or add it to .env.';
  }

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch(el.query.value);
  });

  el.query.addEventListener('input', onQueryInput);
  el.query.addEventListener('keydown', onQueryKeydown);
  el.query.addEventListener('focus', onQueryInput);

  el.apiKey.addEventListener('input', () => {
    state.key = el.apiKey.value.trim();
    if (state.key) localStorage.setItem('serpapi_key', state.key);
    else localStorage.removeItem('serpapi_key');
    refreshKeyHint();
  });

  bindGlobalClicks();

  renderDirectory();
  buildNav();
}

document.addEventListener('DOMContentLoaded', init);
