// Messages screen — minimal placeholder. Phase 3.5 messaging is not yet
// merged into this repo, so we surface a friendly "no messages yet" state.
// When Phase 3.5 lands, swap this for a Realtime-bound thread list.

import { renderShell } from '../components.js';

export const route = 'messages';
export const tabId = 'messages';

export function render(host, ctx) {
  renderShell(host, { title: 'Messages', activeTab: 'messages', ctx });
  const main = host.querySelector('#screen-main');

  main.innerHTML = `
    <div class="card text-center" style="padding:40px 16px;">
      <div class="staff-logo" style="margin: 0 auto 12px; background: var(--bg-deep); color: var(--text-muted);">…</div>
      <h2>No messages yet</h2>
      <p class="text-muted mt-1">When your manager sends you a shift note, it'll show up here.</p>
    </div>
    <p class="text-faint text-center mt-3" style="font-size:12px;">
      In-app messaging arrives in the next update.
    </p>
  `;
}
