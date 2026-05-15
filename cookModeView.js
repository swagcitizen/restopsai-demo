// cookModeView.js — full-screen "station view" for cooking from a recipe.
//
// Big text. Photo per step. Per-step timer with chime. Batch multiplier slider.
// Glove-friendly buttons (large hit targets). Opens via openCookMode({ recipeId }).
//
// Exports: openCookMode({ recipeId, tenantId, userId, role })
//          closeCookMode()

import {
  getRecipe,
  scaleQty,
  startCookSession,
  completeCookSession,
} from './recipesRepo.js';

let _state = null;
// _state = {
//   ctx: { tenantId, userId, role },
//   recipe, ingredients, steps,
//   stepIdx, batch, sessionId,
//   timer: { remaining, total, ticking, intervalId, audio },
//   completedSteps: Set<number>,
//   deductInventory: boolean,
//   printLabel: boolean,
// }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
));

window.__cookModeOpen = (recipeId) => openCookMode({ recipeId });

export async function openCookMode({ recipeId, tenantId, userId, role } = {}) {
  if (!recipeId) return;
  closeCookMode();

  // Show a loading shell immediately
  const wrap = document.createElement('div');
  wrap.id = 'cook-mode-root';
  wrap.className = 'cook-mode';
  wrap.innerHTML = `<div class="cook-loading">Loading recipe…</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('cook-mode-active');

  try {
    const { recipe, ingredients, steps } = await getRecipe(recipeId);
    if (recipe.status !== 'published') {
      wrap.innerHTML = `<div class="cook-error">
        <h2>Recipe not published</h2>
        <p>Publish the recipe to use Cook Mode.</p>
        <button class="btn-primary cook-close-x">Close</button>
      </div>`;
      wrap.querySelector('.cook-close-x')?.addEventListener('click', closeCookMode);
      return;
    }

    let sessionId = null;
    try {
      const session = await startCookSession(recipeId, userId, 1);
      sessionId = session?.id || null;
    } catch (err) {
      console.warn('[cook] start session failed (non-fatal)', err);
    }

    _state = {
      ctx: { tenantId, userId, role },
      recipe, ingredients, steps,
      stepIdx: 0,
      batch: 1,
      sessionId,
      timer: { remaining: 0, total: 0, ticking: false, intervalId: null, audio: null },
      completedSteps: new Set(),
      deductInventory: false,
      printLabel: false,
    };
    render();
  } catch (err) {
    console.error('[cook] load failed', err);
    wrap.innerHTML = `<div class="cook-error">
      <h2>Couldn't load recipe</h2>
      <p>${esc(err?.message || err)}</p>
      <button class="btn-primary cook-close-x">Close</button>
    </div>`;
    wrap.querySelector('.cook-close-x')?.addEventListener('click', closeCookMode);
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!_state) return;
  if (e.key === 'Escape') { closeCookMode(); return; }
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextStep(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); prevStep(); }
}

export function closeCookMode() {
  if (_state?.timer?.intervalId) clearInterval(_state.timer.intervalId);
  document.removeEventListener('keydown', onKey);
  document.getElementById('cook-mode-root')?.remove();
  document.body.classList.remove('cook-mode-active');
  _state = null;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  const root = document.getElementById('cook-mode-root');
  if (!root || !_state) return;
  const { recipe, steps, stepIdx, batch, completedSteps } = _state;
  const total = steps.length;
  const done = completedSteps.size;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = total > 0 && done === total;

  root.innerHTML = `
    <div class="cook-shell">
      <header class="cook-head">
        <button class="cook-icon-btn" id="cook-close" aria-label="Close">✕</button>
        <div class="cook-head-title">
          <div class="cook-recipe-name">${esc(recipe.name || 'Untitled')}</div>
          <div class="cook-meta">${esc(recipe.category || '')} ${recipe.yield_qty ? `· yields ${recipe.yield_qty} ${esc(recipe.yield_unit || '')}` : ''}</div>
        </div>
        <div class="cook-batch">
          <button class="cook-icon-btn" id="cook-batch-down" aria-label="Decrease batch">−</button>
          <div class="cook-batch-display"><span class="cook-batch-num">${batch}×</span><span class="cook-batch-label">batch</span></div>
          <button class="cook-icon-btn" id="cook-batch-up" aria-label="Increase batch">+</button>
        </div>
      </header>

      <div class="cook-progress">
        <div class="cook-progress-bar" style="width:${progressPct}%"></div>
        <div class="cook-progress-label">${done} of ${total} steps · ${progressPct}%</div>
      </div>

      <div class="cook-body">
        <aside class="cook-sidebar">
          <div class="cook-sidebar-title">Ingredients</div>
          <ul class="cook-ing-list">
            ${_state.ingredients.map(ing => {
              const scaled = scaleQty(ing.qty || 0, batch);
              const name = ing.display_name || ing.name || '—';
              return `<li>
                <span class="cook-ing-qty">${formatQty(scaled)} ${esc(ing.unit || '')}</span>
                <span class="cook-ing-name">${esc(name)}</span>
                ${ing.prep_note ? `<span class="cook-ing-note">${esc(ing.prep_note)}</span>` : ''}
              </li>`;
            }).join('')}
          </ul>

          ${recipe.pizza_template && recipe.pizza_sizes ? renderPizzaSidebar(recipe.pizza_sizes) : ''}

          <div class="cook-sidebar-title" style="margin-top:24px">Steps</div>
          <ol class="cook-step-mini">
            ${steps.map((s, i) => `
              <li class="${i === stepIdx ? 'current' : ''} ${completedSteps.has(i) ? 'done' : ''}" data-go="${i}">
                <span class="cook-step-mini-num">${i+1}</span>
                <span class="cook-step-mini-text">${esc(truncate(s.instruction || '', 60))}</span>
                ${s.critical ? '<span class="cook-crit">!</span>' : ''}
              </li>
            `).join('')}
          </ol>
        </aside>

        <main class="cook-main">
          ${isComplete ? renderCompletion() : renderCurrentStep()}
        </main>
      </div>

      ${isComplete ? '' : `
        <footer class="cook-foot">
          <button class="cook-nav-btn cook-prev" id="cook-prev" ${stepIdx === 0 ? 'disabled' : ''}>← Back</button>
          <button class="cook-done-btn" id="cook-done">${completedSteps.has(stepIdx) ? '✓ Step complete' : 'Mark step done'}</button>
          <button class="cook-nav-btn cook-next" id="cook-next" ${stepIdx >= total - 1 && !completedSteps.has(stepIdx) ? '' : ''}>Next →</button>
        </footer>
      `}
    </div>
  `;

  wireEvents();
  if (_state.timer.ticking) startTimerTick(); // resume if needed
}

function renderCurrentStep() {
  const { steps, stepIdx } = _state;
  const s = steps[stepIdx];
  if (!s) return `<div class="cook-empty">No steps defined for this recipe.</div>`;

  const timerHtml = s.timer_seconds
    ? renderTimer(s.timer_seconds)
    : '';

  return `
    <div class="cook-step ${s.critical ? 'critical' : ''}">
      <div class="cook-step-num-big">Step ${stepIdx + 1} of ${steps.length}</div>
      ${s.critical ? '<div class="cook-critical-banner">⚠ Critical step</div>' : ''}
      <div class="cook-step-text">${esc(s.instruction || '')}</div>
      ${s.photo_url ? `<div class="cook-step-photo"><img src="${esc(s.photo_url)}" alt="Step ${stepIdx+1}" /></div>` : ''}
      ${s.tip ? `<div class="cook-step-tip">💡 ${esc(s.tip)}</div>` : ''}
      ${timerHtml}
    </div>
  `;
}

function renderTimer(seconds) {
  const t = _state.timer;
  const display = t.total === seconds ? t.remaining : seconds;
  return `
    <div class="cook-timer" data-default="${seconds}">
      <div class="cook-timer-display" id="cook-timer-display">${fmtTime(display)}</div>
      <div class="cook-timer-actions">
        <button class="cook-timer-btn" id="cook-timer-start">${t.ticking ? 'Pause' : 'Start timer'}</button>
        <button class="cook-timer-btn cook-timer-reset" id="cook-timer-reset">Reset</button>
      </div>
    </div>
  `;
}

function renderCompletion() {
  const { recipe } = _state;
  return `
    <div class="cook-done-screen">
      <div class="cook-done-emoji">🍕</div>
      <h2>${esc(recipe.name)} — complete</h2>
      <p class="cook-done-sub">Great job. Log this batch so it counts toward inventory and variance.</p>

      <div class="cook-done-options">
        <label class="cook-checkbox">
          <input type="checkbox" id="cook-deduct" ${_state.deductInventory ? 'checked' : ''} />
          <span>Deduct ingredients from inventory</span>
        </label>
        <label class="cook-checkbox">
          <input type="checkbox" id="cook-print" ${_state.printLabel ? 'checked' : ''} />
          <span>Print prep label</span>
        </label>
      </div>

      <div class="cook-done-actions">
        <button class="btn-ghost cook-restart" id="cook-restart">Restart recipe</button>
        <button class="btn-primary cook-finish" id="cook-finish">Finish & log batch</button>
      </div>
    </div>
  `;
}

function renderPizzaSidebar(sizes) {
  if (!sizes || typeof sizes !== 'object') return '';
  const order = ['10', '12', '16'];
  return `
    <div class="cook-sidebar-title" style="margin-top:24px">Pizza build-card</div>
    <div class="cook-pizza-card">
      ${order.filter(sz => sizes[sz]).map(sz => {
        const s = sizes[sz];
        return `<div class="cook-pizza-size">
          <div class="cook-pizza-size-head">${sz}"</div>
          <div class="cook-pizza-row"><span>Sauce</span><strong>${s.sauce_oz || 0} oz</strong></div>
          <div class="cook-pizza-row"><span>Cheese</span><strong>${s.cheese_oz || 0} oz</strong></div>
          ${s.toppings ? `<div class="cook-pizza-toppings">${esc(s.toppings).replace(/\n/g,'<br/>')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function wireEvents() {
  document.getElementById('cook-close')?.addEventListener('click', closeCookMode);
  document.getElementById('cook-batch-up')?.addEventListener('click', () => setBatch(_state.batch + 1));
  document.getElementById('cook-batch-down')?.addEventListener('click', () => setBatch(Math.max(1, _state.batch - 1)));
  document.getElementById('cook-prev')?.addEventListener('click', prevStep);
  document.getElementById('cook-next')?.addEventListener('click', nextStep);
  document.getElementById('cook-done')?.addEventListener('click', markStepDone);

  document.querySelectorAll('.cook-step-mini li[data-go]').forEach(li => {
    li.addEventListener('click', () => goToStep(Number(li.dataset.go)));
  });

  // Timer
  document.getElementById('cook-timer-start')?.addEventListener('click', toggleTimer);
  document.getElementById('cook-timer-reset')?.addEventListener('click', resetTimer);

  // Completion screen
  document.getElementById('cook-deduct')?.addEventListener('change', (e) => { _state.deductInventory = !!e.target.checked; });
  document.getElementById('cook-print')?.addEventListener('change', (e) => { _state.printLabel = !!e.target.checked; });
  document.getElementById('cook-finish')?.addEventListener('click', finishSession);
  document.getElementById('cook-restart')?.addEventListener('click', () => {
    _state.completedSteps.clear();
    _state.stepIdx = 0;
    render();
  });
}

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------

function setBatch(n) {
  _state.batch = Math.max(1, Math.min(99, n));
  render();
}

function goToStep(i) {
  if (i < 0 || i >= _state.steps.length) return;
  stopTimer();
  _state.timer = { remaining: 0, total: 0, ticking: false, intervalId: null, audio: null };
  _state.stepIdx = i;
  render();
}

function nextStep() {
  // Auto-mark current step done if not already
  if (!_state.completedSteps.has(_state.stepIdx)) _state.completedSteps.add(_state.stepIdx);
  if (_state.stepIdx < _state.steps.length - 1) {
    goToStep(_state.stepIdx + 1);
  } else {
    render(); // completion screen
  }
}

function prevStep() {
  if (_state.stepIdx > 0) goToStep(_state.stepIdx - 1);
}

function markStepDone() {
  if (_state.completedSteps.has(_state.stepIdx)) {
    _state.completedSteps.delete(_state.stepIdx);
    render();
  } else {
    nextStep();
  }
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

function toggleTimer() {
  const s = _state.steps[_state.stepIdx];
  if (!s?.timer_seconds) return;
  if (_state.timer.ticking) {
    stopTimer();
  } else {
    if (!_state.timer.total) {
      _state.timer.total = s.timer_seconds;
      _state.timer.remaining = s.timer_seconds;
    }
    _state.timer.ticking = true;
    startTimerTick();
    const btn = document.getElementById('cook-timer-start');
    if (btn) btn.textContent = 'Pause';
  }
}

function startTimerTick() {
  if (_state.timer.intervalId) clearInterval(_state.timer.intervalId);
  _state.timer.intervalId = setInterval(() => {
    if (!_state || !_state.timer.ticking) return;
    _state.timer.remaining = Math.max(0, _state.timer.remaining - 1);
    const disp = document.getElementById('cook-timer-display');
    if (disp) disp.textContent = fmtTime(_state.timer.remaining);
    if (_state.timer.remaining <= 0) {
      stopTimer();
      chime();
      const disp2 = document.getElementById('cook-timer-display');
      if (disp2) disp2.classList.add('done');
    }
  }, 1000);
}

function stopTimer() {
  if (_state?.timer?.intervalId) clearInterval(_state.timer.intervalId);
  if (_state?.timer) {
    _state.timer.ticking = false;
    _state.timer.intervalId = null;
  }
  const btn = document.getElementById('cook-timer-start');
  if (btn) btn.textContent = 'Start timer';
}

function resetTimer() {
  const s = _state.steps[_state.stepIdx];
  if (!s?.timer_seconds) return;
  stopTimer();
  _state.timer.total = s.timer_seconds;
  _state.timer.remaining = s.timer_seconds;
  const disp = document.getElementById('cook-timer-display');
  if (disp) { disp.textContent = fmtTime(s.timer_seconds); disp.classList.remove('done'); }
}

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(delay => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.2);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + 0.21);
    });
  } catch (e) { /* audio not available */ }

  // Vibrate on mobile if supported
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// ---------------------------------------------------------------------------
// Finish session
// ---------------------------------------------------------------------------

async function finishSession() {
  const btn = document.getElementById('cook-finish');
  if (btn) { btn.disabled = true; btn.textContent = 'Logging…'; }

  try {
    if (_state.sessionId) {
      await completeCookSession(_state.sessionId, { deductInventory: _state.deductInventory });
    }

    if (_state.printLabel) {
      try {
        // Try to use the existing prep label printer driver if available.
        const driver = await import('./printerDriver.js');
        if (driver?.printLabel) {
          await driver.printLabel({
            title: _state.recipe.name,
            subtitle: `Batch ${_state.batch}× · ${new Date().toLocaleString()}`,
            lines: [
              _state.recipe.category || '',
              `Yield: ${_state.recipe.yield_qty || 1} ${_state.recipe.yield_unit || ''}`,
            ].filter(Boolean),
          });
        }
      } catch (e) {
        console.warn('[cook] print label failed (non-fatal)', e);
      }
    }

    // Toast and close
    showToast(`Batch logged${_state.deductInventory ? ' & inventory updated' : ''}.`);
    setTimeout(closeCookMode, 900);
  } catch (err) {
    console.error('[cook] finish failed', err);
    alert('Could not log the batch: ' + (err?.message || err));
    if (btn) { btn.disabled = false; btn.textContent = 'Finish & log batch'; }
  }
}

function showToast(msg) {
  let toast = document.querySelector('.cook-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'cook-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

function formatQty(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/\.?0+$/, '');
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
