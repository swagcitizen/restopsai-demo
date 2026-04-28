// Smart Scheduler — forecast next-week sales by hour from POS history,
// suggest staff coverage to hit target labor %, optionally apply to schedule_shifts.
// Initialized from app.js bootApp() once tenant context is ready.

import { supabase } from './supabaseClient.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8); // 8am – 11pm
const HISTORY_WEEKS = 8;
const DEFAULT_TARGET_PCT = 28;
const FALLBACK_WAGE = 17; // used when no staff wages available

let _state = {
  tenantId: null,
  forecast: null,    // { 'dow_hour' -> medianGross }
  suggestion: null,  // { 'dow_hour' -> headcount }
  weekTotals: null,  // { sales, laborCost, laborPct, totalHours }
  weekStart: null,   // Date (next Sunday)
  avgWage: FALLBACK_WAGE,
  staff: [],
};

export async function initSmartScheduler({ tenantId }) {
  if (!tenantId) return;
  _state.tenantId = tenantId;

  const card = document.getElementById('smart-sched-card');
  if (!card) return;

  const forecastBtn = document.getElementById('smart-sched-forecast-btn');
  const applyBtn = document.getElementById('smart-sched-apply-btn');
  const targetInput = document.getElementById('smart-sched-target');

  if (forecastBtn) {
    forecastBtn.addEventListener('click', async () => {
      const targetPct = clamp(Number(targetInput?.value) || DEFAULT_TARGET_PCT, 15, 45);
      forecastBtn.disabled = true;
      forecastBtn.textContent = 'Forecasting…';
      try {
        await runForecast(targetPct);
      } catch (err) {
        console.error('[smart-sched] forecast failed', err);
        renderError(err?.message || 'Forecast failed.');
      } finally {
        forecastBtn.disabled = false;
        forecastBtn.textContent = 'Forecast next week';
      }
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      if (!_state.suggestion) return;
      if (!confirm('Apply suggested coverage to next week\'s schedule? This will create draft shifts you can edit before publishing.')) return;
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying…';
      try {
        const result = await applySuggestion();
        renderApplied(result);
      } catch (err) {
        console.error('[smart-sched] apply failed', err);
        renderError(err?.message || 'Failed to apply suggestion.');
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply suggestion';
      }
    });
  }

  if (targetInput) {
    targetInput.addEventListener('change', () => {
      if (_state.forecast) {
        const targetPct = clamp(Number(targetInput.value) || DEFAULT_TARGET_PCT, 15, 45);
        recomputeSuggestion(targetPct);
      }
    });
  }
}

// ───────── Forecast ─────────

async function runForecast(targetPct) {
  // Pull last 8 weeks of POS transactions for this tenant
  const since = new Date();
  since.setDate(since.getDate() - HISTORY_WEEKS * 7);
  since.setHours(0, 0, 0, 0);

  const { data: txns, error } = await supabase
    .from('pos_transactions')
    .select('occurred_at, gross_amount')
    .eq('tenant_id', _state.tenantId)
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: true });

  if (error) throw error;

  // Pull active staff for wage avg
  const { data: staff } = await supabase
    .from('staff')
    .select('id, name, role, hourly_rate, active')
    .eq('tenant_id', _state.tenantId)
    .eq('active', true);
  _state.staff = staff || [];

  const wages = (staff || []).map(s => Number(s.hourly_rate) || 0).filter(w => w > 0);
  _state.avgWage = wages.length ? wages.reduce((a, b) => a + b, 0) / wages.length : FALLBACK_WAGE;

  // Group: dow_hour_week -> sumGross   (so we can take median across weeks)
  const cellWeekSums = {}; // 'dow_hour' -> { weekIdx -> sum }

  if (!txns || txns.length === 0) {
    _state.forecast = null;
    _state.suggestion = null;
    renderEmptyHistory();
    return;
  }

  for (const tx of txns) {
    const d = new Date(tx.occurred_at);
    const dow = d.getDay();
    const hour = d.getHours();
    if (hour < HOURS[0] || hour > HOURS[HOURS.length - 1]) continue;
    // Bucket by week-since-start so each week contributes one observation
    const weekIdx = Math.floor((d.getTime() - since.getTime()) / (7 * 86400000));
    const key = `${dow}_${hour}`;
    if (!cellWeekSums[key]) cellWeekSums[key] = {};
    cellWeekSums[key][weekIdx] = (cellWeekSums[key][weekIdx] || 0) + Number(tx.gross_amount || 0);
  }

  // Median across weeks per cell
  const forecast = {};
  for (const key of Object.keys(cellWeekSums)) {
    const values = Object.values(cellWeekSums[key]).sort((a, b) => a - b);
    forecast[key] = median(values);
  }
  _state.forecast = forecast;

  // Compute next week's start (next Sunday)
  const now = new Date();
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
  nextSunday.setHours(0, 0, 0, 0);
  _state.weekStart = nextSunday;

  recomputeSuggestion(targetPct);
}

function recomputeSuggestion(targetPct) {
  const forecast = _state.forecast || {};
  const wage = _state.avgWage || FALLBACK_WAGE;
  const maxStaff = Math.max(1, _state.staff.length || 4);

  const suggestion = {};
  let totalSales = 0;
  let totalHours = 0;

  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    for (const hour of HOURS) {
      const key = `${day}_${hour}`;
      const sales = forecast[key] || 0;
      totalSales += sales;
      let head = 0;
      if (sales > 0) {
        const neededLabor = sales * (targetPct / 100);
        head = Math.max(1, Math.min(maxStaff, Math.ceil(neededLabor / wage)));
      }
      suggestion[key] = head;
      totalHours += head;
    }
  }

  const laborCost = totalHours * wage;
  const laborPct = totalSales > 0 ? (laborCost / totalSales) * 100 : 0;

  _state.suggestion = suggestion;
  _state.weekTotals = {
    sales: totalSales,
    laborCost,
    laborPct,
    totalHours,
    targetPct,
  };

  renderHeatmap();
  const applyBtn = document.getElementById('smart-sched-apply-btn');
  if (applyBtn) applyBtn.disabled = false;
}

// ───────── Apply ─────────

async function applySuggestion() {
  if (!_state.suggestion || !_state.weekStart) {
    throw new Error('No suggestion to apply. Run Forecast first.');
  }
  const staff = _state.staff;
  if (!staff || staff.length === 0) {
    throw new Error('Add active staff first — no one to schedule.');
  }

  // Build per-day total hours from suggestion
  const perDayHours = [0, 0, 0, 0, 0, 0, 0];
  const perDayPeakHead = [0, 0, 0, 0, 0, 0, 0];
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    for (const hour of HOURS) {
      const head = _state.suggestion[`${day}_${hour}`] || 0;
      perDayHours[day] += head;
      if (head > perDayPeakHead[day]) perDayPeakHead[day] = head;
    }
  }

  // Find each day's open/close from non-zero hours
  const perDayWindow = [];
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    let open = null, close = null;
    for (const hour of HOURS) {
      if ((_state.suggestion[`${day}_${hour}`] || 0) > 0) {
        if (open === null) open = hour;
        close = hour + 1;
      }
    }
    perDayWindow[day] = open !== null ? { open, close } : null;
  }

  const rows = [];
  // Round-robin staff per day; shift length = total hours / peak head, capped 4–10
  for (let d = 0; d < 7; d++) {
    const win = perDayWindow[d];
    if (!win || perDayPeakHead[d] === 0) continue;
    const headcount = Math.min(staff.length, perDayPeakHead[d]);
    const shiftDate = new Date(_state.weekStart);
    shiftDate.setDate(shiftDate.getDate() + d);
    const dateStr = shiftDate.toISOString().slice(0, 10);
    const totalHrs = perDayHours[d];
    const hoursPerStaff = Math.min(10, Math.max(4, Math.round(totalHrs / headcount)));
    const windowLen = win.close - win.open;
    const stagger = headcount > 1 ? Math.max(0, Math.floor((windowLen - hoursPerStaff) / (headcount - 1))) : 0;

    // Pick staff for the day (round-robin starting offset by day so it spreads)
    for (let i = 0; i < headcount; i++) {
      const s = staff[(d + i) % staff.length];
      const startHour = Math.min(win.close - hoursPerStaff, win.open + i * stagger);
      const endHour = Math.min(win.close, startHour + hoursPerStaff);
      const hrs = endHour - startHour;
      rows.push({
        tenant_id: _state.tenantId,
        staff_id: s.id,
        shift_date: dateStr,
        start_time: pad2(startHour) + ':00',
        end_time: pad2(endHour) + ':00',
        hours: hrs,
        notes: 'Smart suggestion',
      });
    }
  }

  if (rows.length === 0) {
    throw new Error('No coverage suggested — projected sales were too low.');
  }

  const { error } = await supabase
    .from('schedule_shifts')
    .upsert(rows, { onConflict: 'tenant_id,staff_id,shift_date' });
  if (error) throw error;

  return { count: rows.length, weekStart: _state.weekStart };
}

// ───────── Render ─────────

function renderHeatmap() {
  const root = document.getElementById('smart-sched-content');
  if (!root) return;
  const f = _state.forecast || {};
  const sug = _state.suggestion || {};
  const totals = _state.weekTotals;
  const wage = _state.avgWage;

  // Find max sales for shading
  let maxSales = 0;
  for (const k of Object.keys(f)) maxSales = Math.max(maxSales, f[k] || 0);

  const headRow = `<tr><th class="ssch-corner">Hour</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr>`;
  const bodyRows = HOURS.map(h => {
    const cells = DAYS.map((_, d) => {
      const sales = f[`${d}_${h}`] || 0;
      const head = sug[`${d}_${h}`] || 0;
      const intensity = maxSales > 0 ? sales / maxSales : 0;
      const cls = head === 0 ? 'ssch-cell empty' : `ssch-cell heat-${intensityBucket(intensity)}`;
      const title = head > 0
        ? `${DAYS[d]} ${fmt12(h)}: $${Math.round(sales)} forecast → ${head} on staff`
        : `${DAYS[d]} ${fmt12(h)}: closed / no sales`;
      return `<td class="${cls}" title="${title}">${head > 0 ? `<span class="ssch-head">${head}</span>` : ''}</td>`;
    }).join('');
    return `<tr><th class="ssch-hour">${fmt12(h)}</th>${cells}</tr>`;
  }).join('');

  root.innerHTML = `
    <div class="smart-sched-summary">
      <div class="ssch-stat"><span class="muted">Forecast next-week sales</span><strong>$${fmtNum(totals.sales)}</strong></div>
      <div class="ssch-stat"><span class="muted">Suggested labor cost</span><strong>$${fmtNum(totals.laborCost)}</strong></div>
      <div class="ssch-stat"><span class="muted">Labor %</span><strong class="${labelPctClass(totals.laborPct, totals.targetPct)}">${totals.laborPct.toFixed(1)}%</strong></div>
      <div class="ssch-stat"><span class="muted">Total hours</span><strong>${totals.totalHours}</strong></div>
      <div class="ssch-stat"><span class="muted">Avg wage</span><strong>$${wage.toFixed(2)}/hr</strong></div>
    </div>
    <div class="ssch-table-wrap">
      <table class="ssch-table">
        <thead>${headRow}</thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div class="muted ssch-foot">Numbers in cells = recommended people on shift. Darker = busier hour. Based on median of last ${HISTORY_WEEKS} weeks of POS data.</div>
  `;
}

function renderEmptyHistory() {
  const root = document.getElementById('smart-sched-content');
  if (!root) return;
  root.innerHTML = `
    <div class="smart-sched-empty muted">
      No POS transactions found in the last ${HISTORY_WEEKS} weeks. Connect Toast or Square in <a href="#view=alerts">POS Integrations</a>, or import a CSV, then try Forecast again.
    </div>`;
  const applyBtn = document.getElementById('smart-sched-apply-btn');
  if (applyBtn) applyBtn.disabled = true;
}

function renderApplied({ count, weekStart }) {
  const root = document.getElementById('smart-sched-content');
  if (!root) return;
  const dateStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const banner = document.createElement('div');
  banner.className = 'smart-sched-applied';
  banner.innerHTML = `✓ Applied ${count} draft shifts for the week of ${dateStr}. Review them in the Weekly Schedule below, then publish.`;
  root.prepend(banner);
  setTimeout(() => banner.remove(), 8000);
}

function renderError(msg) {
  const root = document.getElementById('smart-sched-content');
  if (!root) return;
  const err = document.createElement('div');
  err.className = 'smart-sched-error';
  err.textContent = msg;
  root.prepend(err);
  setTimeout(() => err.remove(), 6000);
}

// ───────── Helpers ─────────

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function pad2(n) { return String(n).padStart(2, '0'); }
function fmt12(h) {
  const period = h >= 12 ? 'p' : 'a';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}
function fmtNum(n) {
  return Math.round(n).toLocaleString('en-US');
}
function intensityBucket(x) {
  if (x >= 0.8) return 5;
  if (x >= 0.6) return 4;
  if (x >= 0.4) return 3;
  if (x >= 0.2) return 2;
  if (x > 0) return 1;
  return 0;
}
function labelPctClass(pct, target) {
  if (pct <= target) return 'good';
  if (pct <= target + 4) return 'mid';
  return 'bad';
}
