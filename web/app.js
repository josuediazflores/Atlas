'use strict';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

// Chart geometry
const CH = { w: 720, h: 320, l: 52, r: 22, t: 22, b: 38 };
CH.pw = CH.w - CH.l - CH.r;
CH.ph = CH.h - CH.t - CH.b;
const chX = (i, n) => CH.l + (n <= 1 ? 0 : ((i - 1) / (n - 1)) * CH.pw);
const chY = (v) => CH.t + (1 - clamp01(v)) * CH.ph;
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function fmtUsd(n) { return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

let state = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const res = await fetch('/api/studies');
    const { studies } = await res.json();
    const sel = $('study');
    sel.innerHTML = '';
    for (const s of studies) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = `${s.name} (${s.sessionCount} sessions)`;
      o.dataset.desc = s.description;
      sel.appendChild(o);
    }
    updateDesc();
    sel.addEventListener('change', updateDesc);
  } catch {
    $('studyDesc').textContent = 'Could not reach the server.';
  }
  $('run').addEventListener('click', startRun);
  $('stop').addEventListener('click', stopRun);
  $('newRun').addEventListener('click', resetToSetup);
  $('inspClose').addEventListener('click', closeInspector);
  $('scrim').addEventListener('click', closeInspector);

  // Deep-link: /?run=1[&study=&threshold=&k=&budget=&pace=] auto-starts a run.
  const p = new URLSearchParams(location.search);
  if (p.get('run') === '1') {
    for (const key of ['threshold', 'k', 'qualityFloor', 'budget', 'pace']) {
      if (p.has(key) && $(key)) $(key).value = p.get(key);
    }
    if (p.has('study') && $('study')) $('study').value = p.get('study');
    startRun();
  }
}

function updateDesc() {
  const o = $('study').selectedOptions[0];
  $('studyDesc').textContent = o ? o.dataset.desc : '';
}

function setStatus(kind, text) {
  const el = $('status');
  el.className = 'status ' + kind;
  $('statusText').textContent = text;
}

// ─── Run lifecycle ──────────────────────────────────────────────────────────

function startRun() {
  const cfg = {
    study: $('study').value,
    threshold: $('threshold').value,
    k: $('k').value,
    qualityFloor: $('qualityFloor').value,
    budget: $('budget').value,
    pace: $('pace').value,
  };
  state = {
    cfg,
    study: null,
    available: 0,
    analysed: 0,
    toolCalls: 0,
    minVerifier: 1,
    iterations: [],
    themes: new Map(),
    pending: [],
    points: [],
    es: null,
  };

  $('setup').classList.add('hidden');
  $('report').classList.add('hidden');
  $('live').classList.remove('hidden');
  $('themes').innerHTML = '';
  $('log').innerHTML = '';
  $('chart').innerHTML = '';
  setStatus('running', 'running');

  const qs = new URLSearchParams({
    study: cfg.study,
    threshold: cfg.threshold,
    k: cfg.k,
    qualityFloor: cfg.qualityFloor,
    budget: cfg.budget,
    pace: cfg.pace,
  });
  const es = new EventSource('/api/run?' + qs.toString());
  state.es = es;
  es.addEventListener('run_started', (e) => onRunStarted(JSON.parse(e.data)));
  es.addEventListener('tool_call', (e) => onToolCall(JSON.parse(e.data)));
  es.addEventListener('phase', (e) => onPhase(JSON.parse(e.data)));
  es.addEventListener('iteration_complete', (e) => onIteration(JSON.parse(e.data)));
  es.addEventListener('pending_approval', (e) => state.pending.push(JSON.parse(e.data).approval));
  es.addEventListener('verdict', (e) => onVerdict(JSON.parse(e.data)));
  es.addEventListener('done', () => es.close());
  es.addEventListener('error', () => { setStatus('error', 'stream error'); es.close(); });
}

function stopRun() {
  if (state && state.es) state.es.close();
  setStatus('halted', 'stopped');
}

function resetToSetup() {
  if (state && state.es) state.es.close();
  $('live').classList.add('hidden');
  $('report').classList.add('hidden');
  $('setup').classList.remove('hidden');
  setStatus('', 'idle');
}

// ─── Event handlers ─────────────────────────────────────────────────────────

function onRunStarted(ev) {
  state.study = ev.study;
  state.available = ev.study.sessionCount;
  state.cfgResolved = ev.config;
  $('studyName').textContent = ev.study.name;
  $('runMeta').textContent =
    `threshold ${ev.config.noveltyThreshold} · k=${ev.config.kConsecutive} · ` +
    `floor ${ev.config.qualityFloor} · cap ${fmtUsd(ev.config.budgetCapUsd)}`;
  $('chartCaption').textContent = `threshold ${ev.config.noveltyThreshold} · k=${ev.config.kConsecutive}`;
  initChart(ev.study.sessionCount, ev.config.noveltyThreshold);
  renderTotals();
  updateHalts({ thresholdStreak: 0, verifier: 1, spend: 0 });
}

function onToolCall(ev) {
  state.toolCalls++;
  const c = ev.call;
  const li = document.createElement('li');
  const argTxt = c.args.session_id
    ? c.args.session_id
    : c.args.study_id
    ? c.args.study_id
    : '';
  li.innerHTML =
    `<span class="dim">→</span> <span class="tname">${c.tool}</span> ` +
    `<span class="dim">${argTxt}</span> ` +
    `<span class="${c.status === 'ok' ? 'tok' : 'terr'}">${c.status === 'ok' ? '✓' : '✗'}</span>` +
    `<span class="tdur">${c.durationMs}ms</span>`;
  $('log').prepend(li);
  $('logCount').textContent = state.toolCalls;
  renderTotals();
}

const PHASES = ['fetching', 'extracting', 'comparing', 'verifying', 'complete'];
function onPhase(ev) {
  const cur = PHASES.indexOf(ev.phase);
  document.querySelectorAll('#phaseSteps span').forEach((sp) => {
    const i = PHASES.indexOf(sp.dataset.phase);
    sp.classList.toggle('active', i === cur);
    sp.classList.toggle('done', i < cur);
  });
}

function onIteration(ev) {
  const it = ev.iteration;
  state.iterations[it.index - 1] = it;
  state.analysed = it.index;
  state.minVerifier = Math.min(state.minVerifier, it.verifier.score);

  addPoint(it.index, it.novelty);
  mergeThemes(it);
  renderThemes();
  renderTotals();
  updateHalts({
    thresholdStreak: ev.thresholdStreak,
    verifier: it.verifier.score,
    spend: ev.runningCostUsd,
  });
  // brief "decide" pulse then ready for next session
}

function onVerdict(ev) {
  setStatus('halted', ev.verdict.kind);
  markHalt(ev.verdict.haltedAtIndex);
  fireHalt(ev.verdict.kind);
  // leave the live view up a beat, then show the report
  setTimeout(() => renderReport(ev.report, ev.verdict), 700);
}

// ─── Chart ──────────────────────────────────────────────────────────────────

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function initChart(n, threshold) {
  const svg = $('chart');
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  const grad = el('linearGradient', { id: 'nov-fill', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': 'oklch(0.8 0.1 85)', 'stop-opacity': 0.16 }, grad);
  el('stop', { offset: '100%', 'stop-color': 'oklch(0.8 0.1 85)', 'stop-opacity': 0 }, grad);

  // gridlines + y labels
  for (const v of [1, 0.5, 0]) {
    el('line', { class: 'ch-grid', x1: CH.l, y1: chY(v), x2: CH.w - CH.r, y2: chY(v) }, svg);
    const tx = el('text', { class: 'ch-text', x: CH.l - 10, y: chY(v) + 3, 'text-anchor': 'end' }, svg);
    tx.textContent = v.toFixed(1);
  }
  // axes
  el('line', { class: 'ch-axis', x1: CH.l, y1: CH.t, x2: CH.l, y2: CH.h - CH.b }, svg);
  el('line', { class: 'ch-axis', x1: CH.l, y1: CH.h - CH.b, x2: CH.w - CH.r, y2: CH.h - CH.b }, svg);

  // threshold line + label
  const ty = chY(threshold);
  el('line', { class: 'ch-thresh', x1: CH.l, y1: ty, x2: CH.w - CH.r, y2: ty }, svg);
  const tl = el('text', { class: 'ch-text lit', x: CH.w - CH.r, y: ty - 6, 'text-anchor': 'end' }, svg);
  tl.textContent = `threshold ${threshold}`;

  // x labels
  for (let i = 1; i <= n; i++) {
    const t = el('text', { class: 'ch-text', x: chX(i, n), y: CH.h - CH.b + 16, 'text-anchor': 'middle' }, svg);
    t.textContent = 's' + i;
    t.dataset.session = i;
  }

  state.area = el('path', { class: 'ch-area', d: '' }, svg);
  state.line = el('polyline', { class: 'ch-line', points: '' }, svg);
  state.ptsG = el('g', {}, svg);
  state.chartN = n;
}

function addPoint(i, v) {
  const n = state.chartN;
  const px = chX(i, n);
  const py = chY(v);
  state.points.push([px, py, i, v]);
  state.line.setAttribute('points', state.points.map((p) => `${p[0]},${p[1]}`).join(' '));
  // area under the curve
  const first = state.points[0];
  const last = state.points[state.points.length - 1];
  const d =
    `M ${first[0]} ${CH.h - CH.b} ` +
    state.points.map((p) => `L ${p[0]} ${p[1]}`).join(' ') +
    ` L ${last[0]} ${CH.h - CH.b} Z`;
  state.area.setAttribute('d', d);
  const c = el('circle', { class: 'ch-pt', cx: px, cy: py, r: 4.2 }, state.ptsG);
  c.dataset.index = i;
  c.addEventListener('click', () => openInspector(i));
  // light up the x label
  const lbl = $('chart').querySelector(`text[data-session="${i}"]`);
  if (lbl) lbl.classList.add('lit');
}

function markHalt(idx) {
  const c = state.ptsG.querySelector(`circle[data-index="${idx}"]`);
  if (c) c.classList.add('halt');
  // ghost crosses for sessions that never run
  for (let i = idx + 1; i <= state.chartN; i++) {
    const x = chX(i, state.chartN);
    const y = CH.h - CH.b - 14;
    el('path', { class: 'ch-ghost', d: `M ${x - 4} ${y - 4} l 8 8 M ${x + 4} ${y - 4} l -8 8` }, state.ptsG);
  }
}

// ─── Halt tracker ───────────────────────────────────────────────────────────

function updateHalts({ thresholdStreak, verifier, spend }) {
  const cfg = state.cfgResolved || {};
  const k = cfg.kConsecutive ?? 3;
  const floor = cfg.qualityFloor ?? 0.6;
  const cap = cfg.budgetCapUsd ?? 100000;
  const thr = cfg.noveltyThreshold ?? 0.15;

  // saturated
  setHalt('sat', Math.min(1, thresholdStreak / k) * 100,
    `${thresholdStreak} / ${k} consecutive below ${thr}`, thresholdStreak >= k);
  // quality (closeness to breaching the floor)
  const qWidth = floor >= 1 ? (verifier < floor ? 100 : 0) : clamp01((1 - verifier) / (1 - floor)) * 100;
  setHalt('qual', qWidth, `min verifier ${state.minVerifier.toFixed(2)} vs floor ${floor}`,
    state.minVerifier < floor, state.minVerifier < floor);
  // budget
  setHalt('budget', clamp01(spend / cap) * 100, `${fmtUsd(spend)} / ${fmtUsd(cap)}`, spend > cap);
  // not saturated (sessions consumed)
  setHalt('notsat', clamp01(state.analysed / state.available) * 100,
    `${state.analysed} / ${state.available} sessions analysed`, false);
}

function setHalt(id, width, detail, fired, warn) {
  $('bar-' + id).style.width = width + '%';
  $('det-' + id).textContent = detail;
  const card = document.querySelector(`.halt[data-kind="${id === 'sat' ? 'saturated' : id === 'qual' ? 'quality' : id === 'budget' ? 'budget' : 'notsat'}"]`);
  if (card) {
    card.classList.toggle('fired', !!fired);
    card.classList.toggle('warn', !!warn);
  }
}

function fireHalt(kind) {
  const map = { saturated: 'saturated', quality_halt: 'quality', budget_halt: 'budget', not_saturated: 'notsat' };
  const card = document.querySelector(`.halt[data-kind="${map[kind]}"]`);
  if (card) card.classList.add('fired');
}

// ─── Totals + themes ────────────────────────────────────────────────────────

function renderTotals() {
  const last = state.iterations[state.analysed - 1];
  const spend = last ? sumSpend() : 0;
  const cells = [
    ['Sessions', `${state.analysed} / ${state.available}`, ''],
    ['Tool calls', String(state.toolCalls), ''],
    ['Themes', String(state.themes.size), ''],
    ['Est. spend', fmtUsd(spend), 'gold'],
    ['Novelty', last ? last.novelty.toFixed(3) : '—', 'gold'],
    ['Verifier', last ? last.verifier.score.toFixed(2) : '—', last && last.verifier.score < (state.cfgResolved?.qualityFloor ?? 0.6) ? 'warn' : ''],
  ];
  $('totals').innerHTML = cells
    .map((c) => `<div class="total"><div class="k">${c[0]}</div><div class="v ${c[2]}">${c[1]}</div></div>`)
    .join('');
}

function sumSpend() {
  return state.iterations.reduce((s, it) => s + (it ? it.costUsd : 0), 0);
}

function mergeThemes(it) {
  it.themes.forEach((th, idx) => {
    const match = it.matches[idx];
    const cur = state.themes.get(th.key) || { label: th.label, sessions: new Set(), status: 'novel' };
    cur.sessions.add(it.sessionId);
    cur.status = match ? match.status : 'novel';
    state.themes.set(th.key, cur);
  });
}

function renderThemes() {
  const items = [...state.themes.values()].sort((a, b) => b.sessions.size - a.sessions.size);
  $('themeCount').textContent = `${items.length} unique`;
  $('themes').innerHTML = items
    .map(
      (t) =>
        `<li class="${t.status === 'matched' ? 'matched' : ''}"><span class="tdot"></span>` +
        `<span class="tlabel">${esc(t.label)}</span>` +
        `<span class="tcount">${t.sessions.size} ${t.sessions.size === 1 ? 'session' : 'sessions'}</span></li>`,
    )
    .join('');
}

// ─── Inspector ──────────────────────────────────────────────────────────────

async function openInspector(index) {
  const it = state.iterations[index - 1];
  if (!it) return;
  $('inspTitle').textContent = `Session ${it.sessionId.toUpperCase()} · novelty ${it.novelty.toFixed(3)}`;
  const body = $('inspBody');
  body.innerHTML = '<div class="dim mono">loading transcript…</div>';
  $('inspector').classList.remove('hidden');
  $('scrim').classList.remove('hidden');

  let tx = null;
  try {
    const r = await fetch(`/api/transcript?study=${encodeURIComponent(state.study.id)}&session=${encodeURIComponent(it.sessionId)}`);
    tx = await r.json();
  } catch { /* ignore */ }

  const quotedLines = new Set();
  it.themes.forEach((th) => th.quotes.forEach((q) => quotedLines.add(q.line)));

  let html = '';
  if (tx && tx.lines) {
    html += `<div class="insp-sec"><div class="ih">Transcript · ${esc(tx.participant.role)} (${esc(tx.participant.id)})</div><div class="tx">`;
    html += tx.lines
      .map(
        (l) =>
          `<div class="ln ${quotedLines.has(l.line) ? 'quoted' : ''}"><span class="lt">${l.t}</span>` +
          `<span class="lsp">${esc(l.speaker)}</span><span class="ltext">${esc(l.text)}</span></div>`,
      )
      .join('');
    html += `</div></div>`;
  }

  html += `<div class="insp-sec"><div class="ih">Themes extracted · novelty match</div>`;
  it.themes.forEach((th, idx) => {
    const m = it.matches[idx] || {};
    html += `<div class="itheme"><div class="il">${esc(th.label)}</div>` +
      `<div class="is">${esc(th.summary)}</div>` +
      th.quotes.map((q) => `<div class="iq">“${esc(q.text)}” <span class="imatch">— ${q.sessionId.toUpperCase()} · ${q.t}</span></div>`).join('') +
      `<div class="imatch">${m.status === 'novel' ? '<span class="novel">novel</span>' : 'matched ' + (m.matchedKey || '')} · similarity ${(m.similarity ?? 0).toFixed(2)} · novelty ${(m.novelty ?? 0).toFixed(2)}</div></div>`;
  });
  html += `</div>`;

  const v = it.verifier;
  html += `<div class="insp-sec"><div class="ih">Verifier verdict — faithfulness ${v.score.toFixed(2)}</div>` +
    `<div class="verdict-reason ${v.score < (state.cfgResolved?.qualityFloor ?? 0.6) ? 'low' : ''}">${esc(v.reasoning)} ` +
    `<span class="dim">(${v.supportedQuotes}/${v.totalQuotes} quotes grounded)</span></div></div>`;

  body.innerHTML = html;
}

function closeInspector() {
  $('inspector').classList.add('hidden');
  $('scrim').classList.add('hidden');
}

// ─── Report ─────────────────────────────────────────────────────────────────

const VK_LABEL = { saturated: 'Saturated', quality_halt: 'Quality halt', budget_halt: 'Budget halt', not_saturated: 'Not saturated' };

function renderReport(report, verdict) {
  $('live').classList.add('hidden');
  $('report').classList.remove('hidden');

  const banner = $('verdictBanner');
  banner.className = 'verdict-banner ' + verdict.kind;
  banner.innerHTML =
    `<div class="vk">Verdict · run ${esc(report.runId)}</div>` +
    `<h2>${esc(verdict.headline)} of ${report.sessionsAvailable}</h2>` +
    `<div class="vaction">${esc(verdict.action)}</div>` +
    (report.sessionsCancelled > 0
      ? `<div class="vsave">${report.sessionsCancelled} sessions cancelled · ≈ ${fmtUsd(report.estimatedSavingsUsd)} saved</div>`
      : '');

  $('outcome').innerHTML =
    row('Sessions analysed', `${report.sessionsAnalysed} of ${report.sessionsAvailable}`) +
    row('Sessions cancelled', String(report.sessionsCancelled)) +
    row('Est. cost / session', fmtUsd(report.costPerSessionUsd)) +
    row('Estimated savings', fmtUsd(report.estimatedSavingsUsd), 'gold') +
    row('Verifier floor', `${report.verifierFloorHeld ? 'held' : 'breached'} (min ${report.minVerifierScore})`);

  $('findings').innerHTML = report.findings
    .map(
      (f) =>
        `<div class="finding"><h4>${f.rank}. ${esc(f.title)}</h4>` +
        `<div class="fmeta">${f.participantCount} participants${f.stabilizedAtSession ? ` · stabilized by session ${f.stabilizedAtSession}` : ''}</div>` +
        `<p>${esc(f.detail)}</p>` +
        f.quotes
          .map((q) => `<blockquote>“${esc(q.text)}”</blockquote><div class="cite">— ${q.sessionId.toUpperCase()} · ${q.t}</div>`)
          .join('') +
        `</div>`,
    )
    .join('');

  if (report.pendingApprovals.length) {
    $('approvals').classList.remove('hidden');
    $('approvals').innerHTML =
      `<div class="ah">Pending approval · writes never auto-execute</div>` +
      report.pendingApprovals
        .map(
          (a) =>
            `<div class="arow"><span class="gold">⧖</span><div><strong>${esc(a.action)}</strong> ` +
            `<span class="dim">[${a.status}]</span><div class="dim">${esc(a.rationale)}</div></div></div>`,
        )
        .join('');
  } else {
    $('approvals').classList.add('hidden');
  }
}

function row(k, v, cls) {
  return `<div class="vc-row"><span class="k">${k}</span><span class="v ${cls || ''}">${esc(v)}</span></div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
