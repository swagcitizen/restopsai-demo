// QuickBooks / accounting export
// Generates two file formats from the current P&L state:
//   1. IIF — QuickBooks Desktop native journal-entry import format
//   2. CSV — universal journal entry that imports into QBO, Xero, Wave, etc.
//
// Both files represent ONE journal entry that summarizes the current period's P&L:
//   Debits  = expense categories (COGS, Labor, Operating)
//   Credits = revenue categories (Dine-in, Take-out, Delivery, Catering)
//   The plug = a Sales-Clearing or Owner-Equity line to balance, in case the
//             P&L isn't perfectly balanced (which it usually isn't, since net
//             income is the residual).
//
// Account mapping is intentionally conservative — it uses standard restaurant
// QuickBooks chart-of-accounts names so the import works with any default COA.

// data-pl key → { account, type } mapping
// type: 'income' (credit) or 'expense' (debit)
export const ACCOUNT_MAP = {
  // Revenue
  rev_dinein:   { account: 'Sales:Dine-In',                type: 'income'  },
  rev_takeout:  { account: 'Sales:Take-Out',               type: 'income'  },
  rev_delivery: { account: 'Sales:Third-Party Delivery',   type: 'income'  },
  rev_catering: { account: 'Sales:Catering',               type: 'income'  },

  // COGS
  cog_flour:    { account: 'Cost of Goods Sold:Flour & Dough',     type: 'expense' },
  cog_cheese:   { account: 'Cost of Goods Sold:Cheese',            type: 'expense' },
  cog_sauce:    { account: 'Cost of Goods Sold:Sauce & Tomatoes',  type: 'expense' },
  cog_meats:    { account: 'Cost of Goods Sold:Meats',             type: 'expense' },
  cog_produce:  { account: 'Cost of Goods Sold:Produce',           type: 'expense' },
  cog_bev:      { account: 'Cost of Goods Sold:Beverages',         type: 'expense' },
  cog_paper:    { account: 'Cost of Goods Sold:Paper & Packaging', type: 'expense' },

  // Labor
  lab_kitchen:  { account: 'Payroll:Kitchen Wages',     type: 'expense' },
  lab_foh:      { account: 'Payroll:FOH Wages',         type: 'expense' },
  lab_drivers:  { account: 'Payroll:Driver Wages',      type: 'expense' },
  lab_mgr:      { account: 'Payroll:Management Salary', type: 'expense' },
  lab_tax:      { account: 'Payroll:Taxes & WC',        type: 'expense' },
  lab_bene:     { account: 'Payroll:Benefits',          type: 'expense' },

  // Occupancy & Operating
  op_rent:   { account: 'Occupancy:Rent & CAM',          type: 'expense' },
  op_util:   { account: 'Utilities',                     type: 'expense' },
  op_net:    { account: 'Telephone & Internet',          type: 'expense' },
  op_pos:    { account: 'Software Subscriptions',        type: 'expense' },
  op_proc:   { account: 'Merchant Processing Fees',      type: 'expense' },
  op_3p:     { account: 'Third-Party Delivery Fees',     type: 'expense' },
  op_mkt:    { account: 'Advertising & Marketing',       type: 'expense' },
  op_ins:    { account: 'Insurance',                     type: 'expense' },
  op_rep:    { account: 'Repairs & Maintenance',         type: 'expense' },
  op_clean:  { account: 'Cleaning & Pest Control',       type: 'expense' },
  op_lic:    { account: 'Licenses & Permits',            type: 'expense' },
  op_acct:   { account: 'Professional Fees',             type: 'expense' },
  op_small:  { account: 'Uniforms & Smallwares',         type: 'expense' },
};

// The plug account that absorbs the difference (net income for the period).
const PLUG_ACCOUNT = 'Owner Equity:Net Income (Period)';

// ---------- helpers ----------

function todayMDY() {
  const d = new Date();
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- core: build entries from state.pl ----------

/**
 * Build journal-entry lines from a flat P&L map (data-pl keys → numbers).
 * Returns { lines: [{ account, debit, credit, memo }], totalDebit, totalCredit, plug }
 */
export function buildJournalEntry(pl, opts = {}) {
  const memo = opts.memo || `Stationly P&L ${todayISO()}`;
  const lines = [];
  let totalIncome = 0;
  let totalExpense = 0;

  for (const [key, val] of Object.entries(pl)) {
    const amt = Math.round((Number(val) || 0) * 100) / 100;
    if (amt === 0) continue;
    const map = ACCOUNT_MAP[key];
    if (!map) continue; // skip unmapped lines

    if (map.type === 'income') {
      lines.push({ account: map.account, debit: 0,   credit: amt, memo });
      totalIncome += amt;
    } else {
      lines.push({ account: map.account, debit: amt, credit: 0,   memo });
      totalExpense += amt;
    }
  }

  // Plug: net income = income - expense. If positive, credit Owner Equity;
  // if negative, debit Owner Equity.
  const netIncome = Math.round((totalIncome - totalExpense) * 100) / 100;
  if (netIncome > 0) {
    lines.push({ account: PLUG_ACCOUNT, debit: netIncome, credit: 0, memo: memo + ' (net income to equity)' });
  } else if (netIncome < 0) {
    lines.push({ account: PLUG_ACCOUNT, debit: 0, credit: Math.abs(netIncome), memo: memo + ' (net loss to equity)' });
  }

  const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  return { lines, totalDebit: Math.round(totalDebit * 100) / 100, totalCredit: Math.round(totalCredit * 100) / 100, netIncome };
}

// ---------- CSV ----------

/**
 * Generate a universal Journal Entry CSV.
 * Columns chosen to import cleanly into QuickBooks Online (via Receipts/Journal),
 * Xero (Manual Journal CSV), and Wave.
 */
export function buildCSV(pl, opts = {}) {
  const date = opts.date || todayMDY();
  const memo = opts.memo || `Stationly P&L ${todayISO()}`;
  const ref  = opts.ref  || `STATIONLY-${todayISO().replace(/-/g, '')}`;
  const { lines } = buildJournalEntry(pl, { memo });

  const headers = ['Date', 'Journal No', 'Account', 'Description', 'Debit', 'Credit'];
  const rows = lines.map(l => [
    date,
    ref,
    l.account,
    l.memo,
    l.debit  ? l.debit.toFixed(2)  : '',
    l.credit ? l.credit.toFixed(2) : '',
  ]);

  return [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

// ---------- IIF ----------

/**
 * Generate a QuickBooks Desktop IIF file.
 * IIF is tab-delimited and uses three record types per journal entry:
 *   !TRNS / !SPL / !ENDTRNS — header rows (only emitted once)
 *   TRNS  — one transaction header
 *   SPL   — one split per debit/credit line
 *   ENDTRNS — closes the transaction
 *
 * Reference: Intuit "IIF File Format Reference" — General Journal example.
 * QuickBooks expects amounts as positive for debits and negative for credits in TRNS;
 * SPL amounts use the OPPOSITE sign convention from TRNS.
 */
export function buildIIF(pl, opts = {}) {
  const date = opts.date || todayMDY();
  const memo = opts.memo || `Stationly P&L ${todayISO()}`;
  const ref  = opts.ref  || `STATIONLY-${todayISO().replace(/-/g, '')}`;
  const { lines } = buildJournalEntry(pl, { memo });

  const out = [];
  // Header rows (declare column layout)
  out.push(['!TRNS','TRNSID','TRNSTYPE','DATE','ACCNT','NAME','CLASS','AMOUNT','DOCNUM','MEMO','CLEAR','TOPRINT','NAMEISTAXABLE','ADDR1','ADDR2','ADDR3','ADDR4','ADDR5','DUEDATE','TERMS','PAID','PAYMETH','SHIPVIA','SHIPDATE','REP'].join('\t'));
  out.push(['!SPL','SPLID','TRNSTYPE','DATE','ACCNT','NAME','CLASS','AMOUNT','DOCNUM','MEMO','CLEAR','QNTY','PRICE','INVITEM','PAYMETH','TAXABLE','VALADJ','REIMBEXP','SERVICEDATE','OTHER2','OTHER3','EXTRA'].join('\t'));
  out.push(['!ENDTRNS'].join('\t'));

  // The first split is treated as the TRNS line (its amount is the offsetting total).
  // Convention: emit TRNS with amount = first line's signed amount, then the rest as SPLs.
  // For a journal entry in QBD, TRNSTYPE = 'GENERAL JOURNAL'.
  if (!lines.length) return out.join('\r\n') + '\r\n';

  const first = lines[0];
  const firstAmount = first.debit ? first.debit : -first.credit;

  out.push([
    'TRNS', '', 'GENERAL JOURNAL', date, first.account, '', '',
    firstAmount.toFixed(2), ref, first.memo, 'N', 'N', 'N',
    '', '', '', '', '', '', '', 'N', '', '', '', ''
  ].join('\t'));

  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    // SPL convention is opposite of TRNS, so flip sign:
    // TRNS positive (debit) → SPL negative; TRNS negative (credit) → SPL positive.
    const splAmount = l.debit ? -l.debit : l.credit;
    out.push([
      'SPL', '', 'GENERAL JOURNAL', date, l.account, '', '',
      splAmount.toFixed(2), ref, l.memo, 'N', '', '', '', '', 'N', 'N', 'NOTHING', '', '', '', ''
    ].join('\t'));
  }

  out.push(['ENDTRNS'].join('\t'));

  return out.join('\r\n') + '\r\n';
}

// ---------- public download helpers ----------

export function downloadCSV(pl, opts) {
  const csv = buildCSV(pl, opts);
  const fn = `stationly-journal-${todayISO()}.csv`;
  downloadFile(fn, csv, 'text/csv;charset=utf-8');
  return fn;
}

export function downloadIIF(pl, opts) {
  const iif = buildIIF(pl, opts);
  const fn = `stationly-journal-${todayISO()}.iif`;
  // QuickBooks Desktop requires CRLF line endings and Windows-1252; UTF-8 with ASCII account
  // names works fine in practice. Set MIME accordingly.
  downloadFile(fn, iif, 'application/octet-stream');
  return fn;
}

// ---------- UI mount ----------

/**
 * Inject an "Export to QuickBooks" dropdown button into the Costs & P&L card head.
 * Idempotent: safe to call repeatedly.
 *
 * Reads the current P&L from the global state via the supplied getter, so it
 * always exports what the user is looking at right now (including AI-imported values).
 */
function readPlFromDOM() {
  const pl = {};
  document.querySelectorAll('[data-pl]').forEach(el => {
    pl[el.dataset.pl] = Number(el.value) || 0;
  });
  return pl;
}

export function mountQboExport(getPlState) {
  const getter = typeof getPlState === 'function' ? getPlState : readPlFromDOM;
  const cardHead = document.querySelector('section[data-view="costs"] .card .card-head');
  if (!cardHead || cardHead.querySelector('#qbo-export-btn')) return;

  // Match the existing pnl-import-btn aesthetic but use a subtler outlined treatment
  // so the two buttons don't fight each other for attention.
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center';

  wrap.innerHTML = `
    <style>
      #qbo-export-btn{background:#fffdf7;color:#1c1a15;border:1px solid #d9ccaf;border-radius:10px;padding:8px 12px;font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:Inter,system-ui,sans-serif;transition:background .15s,border-color .15s}
      #qbo-export-btn:hover{background:#fdf3dc;border-color:#e8a33d}
      #qbo-export-btn svg{flex-shrink:0}
      #qbo-export-menu{position:absolute;top:calc(100% + 6px);right:0;background:#faf5ea;border:1px solid #ece3cf;border-radius:12px;box-shadow:0 10px 30px rgba(28,26,21,.18);min-width:280px;z-index:20;overflow:hidden;font-family:Inter,system-ui,sans-serif}
      #qbo-export-menu button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:12px 14px;background:transparent;border:0;cursor:pointer;border-bottom:1px solid #ece3cf;font-family:inherit}
      #qbo-export-menu button:last-child{border-bottom:0}
      #qbo-export-menu button:hover{background:#fdf3dc}
      #qbo-export-menu strong{font-size:13px;color:#1c1a15;font-weight:600}
      #qbo-export-menu span{font-size:12px;color:#6b6459;font-weight:400}
      .qbo-export-flash{position:fixed;bottom:24px;right:24px;background:#3b6e3b;color:#faf5ea;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;box-shadow:0 10px 30px rgba(28,26,21,.25);z-index:10000;font-family:Inter,system-ui,sans-serif;animation:qbo-flash-in .2s ease-out}
      @keyframes qbo-flash-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    </style>
    <button type="button" id="qbo-export-btn" title="Export current P&L for your accountant">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export for accountant
    </button>
    <div id="qbo-export-menu" hidden role="menu" aria-label="Export format">
      <button type="button" data-fmt="csv" role="menuitem">
        <strong>CSV (universal)</strong>
        <span>QuickBooks Online, Xero, Wave</span>
      </button>
      <button type="button" data-fmt="iif" role="menuitem">
        <strong>IIF (QuickBooks Desktop)</strong>
        <span>Native journal-entry import</span>
      </button>
    </div>
  `;
  cardHead.appendChild(wrap);

  const btn  = wrap.querySelector('#qbo-export-btn');
  const menu = wrap.querySelector('#qbo-export-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) menu.hidden = true;
  });

  menu.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const pl = getter() || {};
      const fmt = b.dataset.fmt;
      try {
        const fn = fmt === 'iif' ? downloadIIF(pl) : downloadCSV(pl);
        menu.hidden = true;
        // Brief confirmation
        const flash = document.createElement('div');
        flash.className = 'qbo-export-flash';
        flash.textContent = `Downloaded ${fn}. Send this to your accountant.`;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 2800);
      } catch (err) {
        console.error('export failed', err);
        alert('Export failed: ' + err.message);
      }
    });
  });
}
