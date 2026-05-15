// trainingView.js — Recipe training: walkthrough + quiz for staff,
// certification dashboard for managers.
//
// Two layouts based on role:
//   - Manager/Owner: dashboard grid (rows = staff, cols = published recipes)
//                    with cert status; click a cell to override certify.
//   - Staff: their own recipe list with status per recipe; click to walk through.
//
// Exports: initTraining({ tenantId, userId, role, staffId })
//          renderTraining()

import {
  listRecipes,
  getRecipe,
  listStaff,
  listTrainingForStaff,
  getOrInitTraining,
  completeTrainingWalkthrough,
  submitQuizResult,
  certifyStaff,
} from './recipesRepo.js';

let _ctx = null; // { tenantId, userId, role, staffId }
let _recipes = [];
let _staff = [];
let _training = []; // all training rows (manager view) or filtered to me (staff view)
let _selectedStaffId = null; // for manager view filter

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
));

const isManager = () => _ctx?.role === 'owner' || _ctx?.role === 'manager';

export async function initTraining({ tenantId, userId, role, staffId }) {
  _ctx = { tenantId, userId, role, staffId };
  await renderTraining();
}

export async function renderTraining() {
  const mount = document.getElementById('training-root');
  if (!mount) return;
  mount.innerHTML = `<div class="muted" style="padding:24px">Loading training data…</div>`;

  try {
    const [recipes, staff] = await Promise.all([listRecipes(), listStaff()]);
    _recipes = recipes.filter(r => r.status === 'published');
    _staff = staff;

    if (isManager()) {
      // Pull training rows for all staff in parallel
      const all = await Promise.all(_staff.map(s => listTrainingForStaff(s.id).catch(() => [])));
      _training = all.flat();
    } else {
      _training = await listTrainingForStaff(_ctx.staffId || _ctx.userId);
    }
  } catch (err) {
    console.error('[training] load failed', err);
    mount.innerHTML = `<div class="card" style="padding:24px">
      <h3>Couldn't load training</h3>
      <p class="muted">${esc(err?.message || err)}</p>
    </div>`;
    return;
  }

  mount.innerHTML = isManager() ? managerTemplate() : staffTemplate();
  wireEvents(mount);
}

// ---------------------------------------------------------------------------
// MANAGER DASHBOARD
// ---------------------------------------------------------------------------

function managerTemplate() {
  if (_recipes.length === 0) {
    return `<div class="card" style="padding:32px;text-align:center">
      <h3>No published recipes yet</h3>
      <p class="muted">Publish recipes in the Recipe Book to start tracking training.</p>
    </div>`;
  }
  if (_staff.length === 0) {
    return `<div class="card" style="padding:32px;text-align:center">
      <h3>No staff yet</h3>
      <p class="muted">Add staff in the Team section first.</p>
    </div>`;
  }

  const totalCells = _staff.length * _recipes.length;
  const certified = _training.filter(t => t.certified).length;
  const inProgress = _training.filter(t => !t.certified).length;
  const pct = totalCells > 0 ? Math.round((certified / totalCells) * 100) : 0;

  return `
    <div class="training-wrap">
      <div class="training-summary">
        <div class="training-stat">
          <div class="training-stat-num">${pct}%</div>
          <div class="training-stat-label">Team certified</div>
        </div>
        <div class="training-stat">
          <div class="training-stat-num">${certified}</div>
          <div class="training-stat-label">Cert. recipes</div>
        </div>
        <div class="training-stat">
          <div class="training-stat-num">${inProgress}</div>
          <div class="training-stat-label">In progress</div>
        </div>
        <div class="training-stat">
          <div class="training-stat-num">${_recipes.length}</div>
          <div class="training-stat-label">Recipes published</div>
        </div>
        <div class="training-stat">
          <div class="training-stat-num">${_staff.length}</div>
          <div class="training-stat-label">Staff</div>
        </div>
      </div>

      <div class="training-grid-wrap">
        <table class="training-grid">
          <thead>
            <tr>
              <th class="training-staff-head">Staff</th>
              ${_recipes.map(r => `<th class="training-recipe-head" title="${esc(r.name)}">${esc(truncate(r.name, 18))}</th>`).join('')}
              <th class="training-staff-head">Coverage</th>
            </tr>
          </thead>
          <tbody>
            ${_staff.map(s => trainingRow(s)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function trainingRow(staff) {
  const cells = _recipes.map(r => {
    const t = _training.find(x => x.staff_id === staff.id && x.recipe_id === r.id);
    return trainingCell(staff.id, r.id, t);
  });
  const myRows = _recipes.map(r => _training.find(x => x.staff_id === staff.id && x.recipe_id === r.id));
  const myCertified = myRows.filter(t => t?.certified).length;
  const coveragePct = _recipes.length > 0 ? Math.round((myCertified / _recipes.length) * 100) : 0;
  return `
    <tr>
      <td class="training-staff-name">${esc(staff.name || staff.id)}</td>
      ${cells.join('')}
      <td class="training-coverage">${myCertified}/${_recipes.length} <span class="muted small">(${coveragePct}%)</span></td>
    </tr>
  `;
}

function trainingCell(staffId, recipeId, t) {
  if (!t) {
    return `<td class="training-cell training-cell-empty" data-staff="${esc(staffId)}" data-recipe="${esc(recipeId)}" title="Not started">·</td>`;
  }
  if (t.certified) {
    return `<td class="training-cell training-cell-certified" data-staff="${esc(staffId)}" data-recipe="${esc(recipeId)}" title="Certified ${t.certified_at ? new Date(t.certified_at).toLocaleDateString() : ''}">✓</td>`;
  }
  const partial = t.walked_through_at ? '◐' : '○';
  const score = t.quiz_score != null && t.quiz_total ? `${t.quiz_score}/${t.quiz_total}` : '';
  return `<td class="training-cell training-cell-partial" data-staff="${esc(staffId)}" data-recipe="${esc(recipeId)}" title="In progress ${score}">${partial}</td>`;
}

// ---------------------------------------------------------------------------
// STAFF VIEW
// ---------------------------------------------------------------------------

function staffTemplate() {
  if (_recipes.length === 0) {
    return `<div class="card" style="padding:32px;text-align:center">
      <h3>No recipes yet</h3>
      <p class="muted">Your manager hasn't published any recipes.</p>
    </div>`;
  }
  const certified = _training.filter(t => t.certified).length;
  return `
    <div class="training-wrap">
      <div class="training-summary">
        <div class="training-stat">
          <div class="training-stat-num">${certified}</div>
          <div class="training-stat-label">Certified</div>
        </div>
        <div class="training-stat">
          <div class="training-stat-num">${_recipes.length - certified}</div>
          <div class="training-stat-label">To learn</div>
        </div>
      </div>

      <div class="training-staff-list">
        ${_recipes.map(r => {
          const t = _training.find(x => x.recipe_id === r.id);
          const status = t?.certified
            ? `<span class="badge badge-success">Certified</span>`
            : t?.walked_through_at
              ? `<span class="badge badge-warn">In progress</span>`
              : `<span class="badge">Not started</span>`;
          return `
            <div class="training-staff-card" data-recipe="${esc(r.id)}">
              <div class="training-staff-card-hero" style="${r.hero_photo_url ? `background-image:url('${esc(r.hero_photo_url)}')` : ''}"></div>
              <div class="training-staff-card-body">
                <div class="training-staff-card-head">
                  <h4>${esc(r.name)}</h4>
                  ${status}
                </div>
                <div class="muted small">${esc(r.category || '')}</div>
                <button class="btn-primary btn-sm tw-start" data-recipe="${esc(r.id)}">
                  ${t?.certified ? 'Review' : t?.walked_through_at ? 'Take quiz' : 'Start training'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------

function wireEvents(mount) {
  // Manager dashboard cells — click to manually certify/uncertify
  mount.querySelectorAll('.training-cell').forEach(cell => {
    cell.addEventListener('click', async () => {
      if (!isManager()) return;
      const staffId = cell.dataset.staff;
      const recipeId = cell.dataset.recipe;
      await openManagerCellMenu(staffId, recipeId);
    });
  });
  // Staff card → walkthrough
  mount.querySelectorAll('.tw-start').forEach(btn => {
    btn.addEventListener('click', () => openWalkthrough(btn.dataset.recipe));
  });
}

async function openManagerCellMenu(staffId, recipeId) {
  const staff = _staff.find(s => s.id === staffId);
  const recipe = _recipes.find(r => r.id === recipeId);
  const t = _training.find(x => x.staff_id === staffId && x.recipe_id === recipeId);
  const isCertified = !!t?.certified;
  const choice = confirm(
    `${staff?.name || 'Staff'} — ${recipe?.name || 'Recipe'}\n\n` +
    (isCertified ? 'Currently certified. OK = revoke certification.' : 'Not certified. OK = manually certify.')
  );
  if (!choice) return;
  try {
    await certifyStaff(recipeId, staffId, _ctx.staffId || _ctx.userId, !isCertified);
    await renderTraining();
  } catch (err) {
    console.error('[training] override failed', err);
    alert('Could not update: ' + (err?.message || err));
  }
}

// ---------------------------------------------------------------------------
// WALKTHROUGH (staff)
// ---------------------------------------------------------------------------

async function openWalkthrough(recipeId) {
  // Load full recipe + ensure a training row
  let recipe, ingredients, steps, quiz, training;
  try {
    [{ recipe, ingredients, steps, quiz }, training] = await Promise.all([
      getRecipe(recipeId),
      getOrInitTraining(recipeId, _ctx.staffId || _ctx.userId),
    ]);
  } catch (err) {
    console.error('[training] open walkthrough failed', err);
    alert('Could not open training: ' + (err?.message || err));
    return;
  }

  const state = {
    recipe, ingredients, steps, quiz, training,
    phase: training?.walked_through_at ? 'quiz' : 'walkthrough',
    stepIdx: 0,
    quizIdx: 0,
    answers: {}, // questionIdx -> selectedChoiceIdx
  };

  document.getElementById('training-walkthrough-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'training-walkthrough-modal';
  wrap.className = 'modal-backdrop';
  document.body.appendChild(wrap);

  function render() {
    wrap.innerHTML = `
      <div class="modal modal-lg training-walk">
        <div class="modal-head">
          <div class="modal-title-wrap">
            <h2 class="modal-title">${esc(recipe.name)}</h2>
            <div class="muted small">${state.phase === 'walkthrough' ? 'Walkthrough' : state.phase === 'quiz' ? 'Quiz' : 'Result'}</div>
          </div>
          <button class="btn-ghost btn-icon" id="tw-close">✕</button>
        </div>
        <div class="modal-body">
          ${state.phase === 'walkthrough' ? renderWalkPhase(state)
            : state.phase === 'quiz' ? renderQuizPhase(state)
            : renderResultPhase(state)}
        </div>
      </div>
    `;
    wireWalkEvents();
  }

  function wireWalkEvents() {
    wrap.querySelector('#tw-close')?.addEventListener('click', () => {
      wrap.remove();
      renderTraining();
    });
    wrap.querySelectorAll('[data-tw-action]').forEach(el => {
      el.addEventListener('click', () => handleAction(el.dataset.twAction));
    });
    wrap.querySelectorAll('input[name^="tw-q"]').forEach(el => {
      el.addEventListener('change', (e) => {
        const qi = Number(e.target.dataset.qi);
        state.answers[qi] = Number(e.target.value);
      });
    });
  }

  async function handleAction(action) {
    if (action === 'walk-next') {
      if (state.stepIdx < state.steps.length - 1) {
        state.stepIdx++;
        render();
      } else {
        // mark walkthrough complete
        try {
          await completeTrainingWalkthrough(recipeId, _ctx.staffId || _ctx.userId);
        } catch (err) {
          console.warn('[training] mark walkthrough failed', err);
        }
        if (state.quiz.length > 0) {
          state.phase = 'quiz';
          state.quizIdx = 0;
          render();
        } else {
          // No quiz → straight to result
          state.phase = 'result';
          state.passed = true;
          state.score = 0;
          state.total = 0;
          render();
        }
      }
    } else if (action === 'walk-prev') {
      if (state.stepIdx > 0) { state.stepIdx--; render(); }
    } else if (action === 'quiz-submit') {
      // Validate all answered
      const unanswered = state.quiz.findIndex((_, i) => state.answers[i] == null);
      if (unanswered >= 0) {
        alert(`Please answer question ${unanswered + 1}.`);
        return;
      }
      let score = 0;
      state.quiz.forEach((q, i) => { if (state.answers[i] === q.correct_idx) score++; });
      state.score = score;
      state.total = state.quiz.length;
      state.passed = (score / state.total) >= 0.8;
      try {
        await submitQuizResult(recipeId, _ctx.staffId || _ctx.userId, { score, total: state.total });
      } catch (err) {
        console.warn('[training] submit quiz failed', err);
      }
      state.phase = 'result';
      render();
    } else if (action === 'quiz-retake') {
      state.phase = 'quiz';
      state.quizIdx = 0;
      state.answers = {};
      render();
    } else if (action === 'finish') {
      wrap.remove();
      renderTraining();
    }
  }

  render();
}

function renderWalkPhase(state) {
  const s = state.steps[state.stepIdx];
  if (!s) {
    // No steps — let them go directly to quiz
    return `
      <div class="tw-empty">
        <p>This recipe doesn't have steps yet. Continue to the quiz.</p>
        <div class="tw-actions">
          <button class="btn-primary" data-tw-action="walk-next">Continue to quiz →</button>
        </div>
      </div>
    `;
  }
  const total = state.steps.length;
  const progressPct = Math.round(((state.stepIdx + 1) / total) * 100);
  return `
    <div class="tw-walk">
      <div class="tw-progress">
        <div class="tw-progress-bar" style="width:${progressPct}%"></div>
        <div class="tw-progress-label">Step ${state.stepIdx + 1} of ${total}</div>
      </div>
      <div class="tw-step ${s.critical ? 'critical' : ''}">
        ${s.critical ? '<div class="cook-critical-banner">⚠ Critical step</div>' : ''}
        <div class="tw-step-text">${esc(s.instruction || '')}</div>
        ${s.photo_url ? `<div class="tw-step-photo"><img src="${esc(s.photo_url)}" alt="Step ${state.stepIdx+1}" /></div>` : ''}
        ${s.tip ? `<div class="cook-step-tip">💡 ${esc(s.tip)}</div>` : ''}
      </div>
      <div class="tw-actions">
        <button class="btn-ghost" data-tw-action="walk-prev" ${state.stepIdx === 0 ? 'disabled' : ''}>← Back</button>
        <button class="btn-primary" data-tw-action="walk-next">
          ${state.stepIdx === total - 1 ? (state.quiz.length > 0 ? 'Continue to quiz →' : 'Finish →') : 'Next →'}
        </button>
      </div>
    </div>
  `;
}

function renderQuizPhase(state) {
  return `
    <div class="tw-quiz">
      <div class="muted small">Pass with 80% or higher to certify. Take your time.</div>
      ${state.quiz.map((q, qi) => {
        const choices = Array.isArray(q.choices) ? q.choices : [];
        return `
          <fieldset class="tw-q">
            <legend>Q${qi+1}. ${esc(q.question)}</legend>
            ${choices.map((c, ci) => `
              <label class="tw-choice">
                <input type="radio" name="tw-q${qi}" data-qi="${qi}" value="${ci}" ${state.answers[qi] === ci ? 'checked' : ''} />
                <span>${esc(c)}</span>
              </label>
            `).join('')}
          </fieldset>
        `;
      }).join('')}
      <div class="tw-actions">
        <button class="btn-primary" data-tw-action="quiz-submit">Submit answers</button>
      </div>
    </div>
  `;
}

function renderResultPhase(state) {
  const pct = state.total > 0 ? Math.round((state.score / state.total) * 100) : 100;
  return `
    <div class="tw-result ${state.passed ? 'passed' : 'failed'}">
      <div class="tw-result-emoji">${state.passed ? '🎉' : '📚'}</div>
      <h2>${state.passed ? 'Certified!' : 'Not quite there'}</h2>
      ${state.total > 0 ? `<p class="tw-result-score">You scored ${state.score}/${state.total} (${pct}%)</p>` : ''}
      <p class="muted">${state.passed
        ? `You're certified to make ${esc(state.recipe.name)}.`
        : 'Review the recipe and try the quiz again. Passing score is 80%.'}</p>
      <div class="tw-actions">
        ${state.passed
          ? `<button class="btn-primary" data-tw-action="finish">Done</button>`
          : `<button class="btn-ghost" data-tw-action="finish">Close</button>
             <button class="btn-primary" data-tw-action="quiz-retake">Retake quiz</button>`
        }
      </div>
    </div>
  `;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
