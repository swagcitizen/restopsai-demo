// Stationly — Operations Dashboard
// Vanilla JS + Chart.js. Supabase-backed (module by module).

import {
  DBPR_CHECKLIST,
  TOP_VIOLATIONS,
  MOCK_INSPECTION_QUESTIONS,
  MOCK_ANSWERS,
  SAMPLE_RECIPES,
  TASK_LIBRARY,
} from './phase2.js';
import * as tasksRepo from './tasksRepo.js';
import * as dataRepo from './dataRepo.js';
import * as invitesRepo from './invitesRepo.js';
import * as clockRepo from './clockRepo.js';
import { supabase } from './supabaseClient.js';

// In-memory state persistence. Data resets when the page reloads.
const STORAGE_KEY = "anthonys-pizza-dashboard-v1";
const memStore = { data: null };

const fmtUSD = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtUSD2 = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
const pct = (n) => `${(n || 0).toFixed(1)}%`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// -----------------------------------------------------------------------------
// SAMPLE DATA — realistic for a St Cloud FL pizzeria doing ~$70K/mo
// -----------------------------------------------------------------------------
const SAMPLE = {
  pl: {
    // ~$85K monthly revenue, healthy pizzeria P&L
    rev_dinein: 26000, rev_takeout: 34000, rev_delivery: 18000, rev_catering: 7000,
    cog_flour: 2100, cog_cheese: 9200, cog_sauce: 1800, cog_meats: 4400,
    cog_produce: 1600, cog_bev: 2100, cog_paper: 1500,
    lab_kitchen: 8400, lab_foh: 4800, lab_drivers: 2800, lab_mgr: 4500,
    lab_tax: 1700, lab_bene: 800,
    op_rent: 6800, op_util: 2100, op_net: 240, op_pos: 329, op_proc: 2295,
    op_3p: 3240, op_mkt: 1400, op_ins: 920, op_rep: 650, op_clean: 520,
    op_lic: 110, op_acct: 650, op_small: 380
  },
  menu: [
    { name: "Large Cheese Pizza",          price: 16.99, cost: 3.85, units: 420 },
    { name: "Large Pepperoni",             price: 18.99, cost: 4.70, units: 510 },
    { name: "Sicilian Square",             price: 21.99, cost: 5.60, units: 180 },
    { name: "Supreme 16\"",                price: 23.99, cost: 6.90, units: 210 },
    { name: "Margherita",                  price: 17.99, cost: 3.95, units: 145 },
    { name: "BBQ Chicken",                 price: 20.99, cost: 5.40, units: 165 },
    { name: "White Pizza",                 price: 18.99, cost: 4.30, units: 90 },
    { name: "Meat Lovers",                 price: 22.99, cost: 6.60, units: 240 },
    { name: "Garlic Knots (dozen)",        price: 7.99,  cost: 1.20, units: 380 },
    { name: "Caesar Salad",                price: 9.99,  cost: 2.60, units: 110 },
    { name: "Chicken Wings (10pc)",        price: 13.99, cost: 4.90, units: 260 },
    { name: "Calzone",                     price: 12.99, cost: 3.20, units: 150 },
    { name: "Stromboli",                   price: 13.99, cost: 3.80, units: 85 },
    { name: "Soda 2L",                     price: 4.49,  cost: 1.40, units: 340 },
    { name: "Tiramisu",                    price: 6.99,  cost: 1.85, units: 55 },
  ],
  inv: [
    { item: "00 Flour",           unit: "lb",   onHand: 180, par: 200, reorder: 150, cost: 0.68, vendor: "Sysco" },
    { item: "Mozzarella (block)", unit: "lb",   onHand: 42,  par: 80,  reorder: 60,  cost: 3.95, vendor: "Performance Food" },
    { item: "San Marzano tomato", unit: "#10",  onHand: 14,  par: 18,  reorder: 12,  cost: 8.20, vendor: "Sysco" },
    { item: "Pepperoni",          unit: "lb",   onHand: 22,  par: 30,  reorder: 22,  cost: 6.40, vendor: "Restaurant Depot" },
    { item: "Italian sausage",    unit: "lb",   onHand: 18,  par: 20,  reorder: 15,  cost: 5.10, vendor: "Performance Food" },
    { item: "Olive oil (gal)",    unit: "gal",  onHand: 4,   par: 6,   reorder: 4,   cost: 32.00, vendor: "Sysco" },
    { item: "Yeast (2lb bag)",    unit: "bag",  onHand: 6,   par: 8,   reorder: 6,   cost: 11.50, vendor: "Sysco" },
    { item: "Pizza boxes 16\"",   unit: "case", onHand: 9,   par: 14,  reorder: 10,  cost: 48.00, vendor: "WebstaurantStore" },
    { item: "Chicken wings",      unit: "lb",   onHand: 28,  par: 40,  reorder: 30,  cost: 3.85, vendor: "Restaurant Depot" },
    { item: "Romaine",            unit: "case", onHand: 2,   par: 4,   reorder: 3,   cost: 38.00, vendor: "Produce Alliance" },
    { item: "Parmesan",           unit: "lb",   onHand: 11,  par: 15,  reorder: 10,  cost: 9.20, vendor: "Performance Food" },
    { item: "Coca-Cola 2L",       unit: "case", onHand: 5,   par: 8,   reorder: 6,   cost: 18.60, vendor: "Coca-Cola" },
  ],
  waste: [
    { date: addDays(todayISO(), -1),  item: "Mozzarella",     qty: 2,   reason: "Spoilage",  loss: 7.90 },
    { date: addDays(todayISO(), -3),  item: "Large pizza",    qty: 1,   reason: "Burn / overcook", loss: 4.70 },
    { date: addDays(todayISO(), -5),  item: "Romaine",        qty: 1,   reason: "Spoilage",  loss: 38.00 },
    { date: addDays(todayISO(), -8),  item: "Chicken wings",  qty: 3,   reason: "Dropped",   loss: 11.55 },
    { date: addDays(todayISO(), -12), item: "Dough ball",     qty: 6,   reason: "Prep error", loss: 9.60 },
  ],
  staff: [
    { name: "Anthony R.",   role: "Owner/Manager",  hourly: 0,     hrs: 55, cert: "ServSafe Manager", exp: addDays(todayISO(), 280) },
    { name: "Luis M.",      role: "Pizzaiolo",      hourly: 22.00, hrs: 45, cert: "Food Handler", exp: addDays(todayISO(), 95) },
    { name: "Carlos D.",    role: "Pizzaiolo",      hourly: 20.00, hrs: 40, cert: "Food Handler", exp: addDays(todayISO(), 180) },
    { name: "Maria S.",     role: "Prep cook",      hourly: 16.00, hrs: 38, cert: "Food Handler", exp: addDays(todayISO(), 25) },
    { name: "Jessica T.",   role: "Cashier / FOH",  hourly: 14.50, hrs: 32, cert: "Food Handler", exp: addDays(todayISO(), 210) },
    { name: "Derek P.",     role: "Cashier / FOH",  hourly: 14.00, hrs: 28, cert: "Food Handler", exp: addDays(todayISO(), -10) },
    { name: "Miguel A.",    role: "Driver",         hourly: 12.50, hrs: 30, cert: "Food Handler", exp: addDays(todayISO(), 120) },
    { name: "Tyrone W.",    role: "Driver",         hourly: 12.50, hrs: 25, cert: "Food Handler", exp: addDays(todayISO(), 60) },
  ],
  temps: [
    { id: "walkin",    label: "Walk-in cooler",      min: 34, max: 41, last: 38, unit: "°F" },
    { id: "reachin",   label: "Reach-in cooler",     min: 34, max: 41, last: 40, unit: "°F" },
    { id: "freezer",   label: "Walk-in freezer",     min: -10, max: 10, last: 2, unit: "°F" },
    { id: "prep",      label: "Prep table (cold)",   min: 34, max: 41, last: 39, unit: "°F" },
    { id: "pizzaoven", label: "Pizza oven",          min: 500, max: 650, last: 575, unit: "°F" },
    { id: "hotHold",   label: "Hot holding (wings)", min: 135, max: 165, last: 142, unit: "°F" },
    { id: "dish3",     label: "3-compartment sink rinse", min: 110, max: 120, last: 115, unit: "°F" },
    { id: "sanit",     label: "Sanitizer (chlorine ppm)", min: 50, max: 100, last: 75, unit: "ppm" },
  ],
  checklist: [
    { id: "c1", task: "Sanitize all food-contact surfaces before open", time: "Open" },
    { id: "c2", task: "Verify handwash sinks stocked (soap + towels)", time: "Open" },
    { id: "c3", task: "Record opening temps (walk-in, reach-in, freezer)", time: "Open" },
    { id: "c4", task: "Check sanitizer bucket concentration", time: "Every 2hr" },
    { id: "c5", task: "Rotate stock — FIFO all prep items", time: "Prep" },
    { id: "c6", task: "Hair restraints & clean aprons verified", time: "Open" },
    { id: "c7", task: "Oven calibration check", time: "Open" },
    { id: "c8", task: "Record mid-shift cold holding temps", time: "3 PM" },
    { id: "c9", task: "Wipe down all prep tables", time: "Close" },
    { id: "c10", task: "Empty & sanitize mop sink + buckets", time: "Close" },
    { id: "c11", task: "Log closing temps + secure coolers", time: "Close" },
    { id: "c12", task: "Take out trash + lock dumpster", time: "Close" },
  ],
  cleaning: [
    { task: "Clean pizza oven interior",        freq: "Daily",    last: addDays(todayISO(), -1),  assigned: "Luis M." },
    { task: "Sanitize prep tables + slicers",   freq: "Daily",    last: addDays(todayISO(), 0),   assigned: "Maria S." },
    { task: "Empty & clean grease trap",        freq: "Weekly",   last: addDays(todayISO(), -5),  assigned: "Anthony R." },
    { task: "Deep clean walk-in cooler",        freq: "Weekly",   last: addDays(todayISO(), -9),  assigned: "Carlos D." },
    { task: "Clean hood / exhaust filters",     freq: "Weekly",   last: addDays(todayISO(), -3),  assigned: "Luis M." },
    { task: "Professional hood cleaning",       freq: "Quarterly",last: addDays(todayISO(), -65), assigned: "Vendor — HoodClean FL" },
    { task: "Pest control service",             freq: "Monthly",  last: addDays(todayISO(), -22), assigned: "Vendor — Orkin" },
    { task: "Fire suppression inspection",      freq: "Semi-annual", last: addDays(todayISO(), -140), assigned: "Vendor — Cintas" },
    { task: "Calibrate thermometers",           freq: "Monthly",  last: addDays(todayISO(), -14), assigned: "Anthony R." },
    { task: "Deep clean floor drains",          freq: "Weekly",   last: addDays(todayISO(), -6),  assigned: "Carlos D." },
  ],
  licenses: [
    { doc: "FL DBPR Restaurant License",    issuer: "FL DBPR",              num: "5812345",         issued: addDays(todayISO(), -280), exp: addDays(todayISO(), 85) },
    { doc: "Business Tax Receipt",          issuer: "City of St Cloud",     num: "BTR-2025-0423",   issued: addDays(todayISO(), -100), exp: addDays(todayISO(), 265) },
    { doc: "County Business Tax",           issuer: "Osceola County",       num: "OSC-88812",       issued: addDays(todayISO(), -100), exp: addDays(todayISO(), 265) },
    { doc: "Sales Tax Certificate",         issuer: "FL Dept of Revenue",   num: "78-8012345-67",   issued: addDays(todayISO(), -900), exp: "N/A" },
    { doc: "Food Manager Certification",    issuer: "ServSafe",             num: "SS-2401-AR",      issued: addDays(todayISO(), -420), exp: addDays(todayISO(), 280) },
    { doc: "Workers' Comp Insurance",       issuer: "FL CFO / Employers",   num: "WC-77881",        issued: addDays(todayISO(), -90),  exp: addDays(todayISO(), 275) },
    { doc: "General Liability Insurance",   issuer: "Next Insurance",       num: "GL-44512",        issued: addDays(todayISO(), -80),  exp: addDays(todayISO(), 285) },
    { doc: "Fire Inspection Certificate",   issuer: "St Cloud Fire Dept",   num: "FI-2025-331",     issued: addDays(todayISO(), -200), exp: addDays(todayISO(), 165) },
  ],
  inspections: [
    { date: addDays(todayISO(), -95),  type: "Routine",   violations: 3, high: 0, result: "Met" },
    { date: addDays(todayISO(), -210), type: "Routine",   violations: 5, high: 1, result: "Met w/ follow-up" },
    { date: addDays(todayISO(), -310), type: "Complaint", violations: 2, high: 0, result: "Met" },
    { date: addDays(todayISO(), -430), type: "Routine",   violations: 4, high: 0, result: "Met" },
  ],
};

// -----------------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------------
let state = loadState();

function loadState() {
  if (memStore.data) return memStore.data;
  return seed();
}
function seed() {
  return {
    pl: { ...SAMPLE.pl },
    menu: SAMPLE.menu.map(m => ({ ...m })),
    inv: SAMPLE.inv.map(i => ({ ...i })),
    waste: [...SAMPLE.waste],
    staff: SAMPLE.staff.map(s => ({ ...s })),
    temps: SAMPLE.temps.map(t => ({ ...t, history: genTempHistory(t) })),
    checklist: SAMPLE.checklist.map(c => ({ ...c, done: false })),
    cleaning: SAMPLE.cleaning.map(c => ({ ...c })),
    licenses: SAMPLE.licenses.map(l => ({ ...l })),
    inspections: [...SAMPLE.inspections],
    sales30: genSales(30),
    range: 30,
    beTicket: 22,
    // Phase 2 state
    role: "owner",
    inspChecks: seedInspChecks(),
    inspFilter: "all",
    recipes: SAMPLE_RECIPES.map(r => ({ ...r, ingredients: r.ingredients.map(i => ({...i})) })),
    selectedRecipe: "r1",
    schedule: seedSchedule(),
    forecastSales: 21000, // weekly forecast
    mockSession: null,
    tasks: seedTasks(),
    taskFreq: "all",
    taskCat: "all",
    taskAssignee: "all",
    prepLabels: [],
    invoices: [],
    reviewInvoice: null,
  };
}

function seedTasks() {
  // Generate completion state per task occurrence. Seed with realistic history:
  // most daily/weekly done recently, some overdue, monthly/quarterly mixed.
  const today = new Date();
  const isoDay = (d) => d.toISOString().slice(0, 10);
  const staffNames = ["Anthony R.", "Luis M.", "Carlos D.", "Maria S.", "Jessica T."];
  const randomStaff = () => staffNames[Math.floor(Math.random() * staffNames.length)];
  const tasks = {};
  TASK_LIBRARY.forEach(t => {
    // Pick realistic last-completed date per frequency
    let lastDone = null;
    let overdue = false;
    const r = Math.random();
    if (t.freq === "daily") {
      if (r > 0.22) lastDone = isoDay(new Date(today.getTime() - Math.floor(Math.random() * 1) * 86400000));
      else overdue = true;
    } else if (t.freq === "weekly") {
      const days = Math.floor(Math.random() * 9);
      if (days <= 7) lastDone = isoDay(new Date(today.getTime() - days * 86400000));
      else overdue = true;
    } else if (t.freq === "monthly") {
      const days = Math.floor(Math.random() * 40);
      if (days <= 30) lastDone = isoDay(new Date(today.getTime() - days * 86400000));
      else overdue = true;
    } else if (t.freq === "quarterly") {
      const days = Math.floor(Math.random() * 100);
      if (days <= 90) lastDone = isoDay(new Date(today.getTime() - days * 86400000));
      else overdue = true;
    } else {
      const days = Math.floor(Math.random() * 300) + 30;
      lastDone = isoDay(new Date(today.getTime() - days * 86400000));
    }
    // Force a few realistic overdues to highlight the feature
    if (["m-fire-inspect", "w-grease-trap", "d-close-hood-filters", "m-pest-service"].includes(t.id)) {
      overdue = true;
      lastDone = isoDay(new Date(today.getTime() - (t.freq === "daily" ? 2 : t.freq === "weekly" ? 10 : 45) * 86400000));
    }
    // And mark a few critical ones as just completed
    if (["d-open-temps", "d-open-fire-access", "d-open-sani"].includes(t.id)) {
      overdue = false;
      lastDone = isoDay(today);
    }
    tasks[t.id] = {
      lastDone,
      overdue,
      assignee: t.vendor ? "Vendor" : randomStaff(),
      history: [],
    };
  });
  return tasks;
}

function freqDays(f) { return { daily: 1, weekly: 7, monthly: 30, quarterly: 90, annual: 365 }[f] || 30; }

function taskStatus(t, rec) {
  // Returns: 'done-today' | 'due' | 'overdue'
  if (!rec) return "due";
  if (rec.overdue) return "overdue";
  if (!rec.lastDone) return "due";
  const today = new Date(); today.setHours(0,0,0,0);
  const last = new Date(rec.lastDone); last.setHours(0,0,0,0);
  const days = Math.round((today - last) / 86400000);
  if (days === 0) return "done-today";
  if (days >= freqDays(t.freq)) return "overdue";
  return "due";
}

function seedInspChecks() {
  // Pre-check ~70% of items so first impression is encouraging but actionable
  const checks = {};
  DBPR_CHECKLIST.forEach((it, i) => {
    // Fail a realistic mix of common violations
    const commonFails = ["35A", "22", "09", "02C", "31A", "03A"];
    checks[it.code] = !commonFails.includes(it.code) && Math.random() > 0.15;
  });
  return checks;
}

function seedSchedule() {
  // 7-day schedule keyed by staff index × day (0=Sun..6=Sat)
  // Values: { start: 'HH:MM', end: 'HH:MM', hours: number } or null for off
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const template = [
    // Staff 0 (typically mgr)
    { Sun: ["11:00","21:00"], Mon: null,          Tue: ["11:00","21:00"], Wed: ["11:00","21:00"], Thu: ["11:00","21:00"], Fri: ["11:00","23:00"], Sat: ["11:00","23:00"] },
    { Sun: ["15:00","23:00"], Mon: ["11:00","19:00"], Tue: null,              Wed: ["11:00","19:00"], Thu: ["11:00","19:00"], Fri: ["15:00","23:00"], Sat: ["15:00","23:00"] },
    { Sun: ["11:00","19:00"], Mon: ["11:00","19:00"], Tue: ["11:00","19:00"], Wed: null,              Thu: ["15:00","22:00"], Fri: ["15:00","23:00"], Sat: ["15:00","23:00"] },
    { Sun: null,              Mon: ["16:00","22:00"], Tue: ["16:00","22:00"], Wed: ["16:00","22:00"], Thu: ["16:00","22:00"], Fri: ["16:00","23:00"], Sat: ["16:00","23:00"] },
    { Sun: ["12:00","20:00"], Mon: ["12:00","20:00"], Tue: ["12:00","20:00"], Wed: ["12:00","20:00"], Thu: null,              Fri: ["17:00","23:00"], Sat: ["17:00","23:00"] },
    { Sun: ["17:00","22:00"], Mon: null,          Tue: ["17:00","22:00"], Wed: ["17:00","22:00"], Thu: ["17:00","22:00"], Fri: ["17:00","23:00"], Sat: ["17:00","23:00"] },
  ];
  const sched = {};
  template.forEach((row, sIdx) => {
    days.forEach((d, dIdx) => {
      const shift = row[d];
      const key = `${sIdx}_${dIdx}`;
      sched[key] = shift ? { start: shift[0], end: shift[1], hours: parseShiftHours(shift[0], shift[1]) } : null;
    });
  });
  return sched;
}

function parseShiftHours(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let h = (eh + em/60) - (sh + sm/60);
  if (h < 0) h += 24;
  return Math.round(h * 2) / 2;
}
function genTempHistory(t) {
  const arr = [];
  for (let i = 13; i >= 0; i--) {
    const jitter = (Math.random() - 0.5) * ((t.max - t.min) * 0.1);
    arr.push({ day: addDays(todayISO(), -i), value: Math.round((t.last + jitter) * 10) / 10 });
  }
  return arr;
}
function genSales(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dow = new Date(addDays(todayISO(), -i)).getDay();
    // Fri/Sat peaks, Mon/Tues troughs
    const base = [1800, 1400, 1500, 1700, 2100, 3400, 3100][dow];
    const noise = base * (0.85 + Math.random() * 0.3);
    const dinein = noise * 0.32;
    const takeout = noise * 0.42;
    const delivery = noise * 0.20;
    const catering = noise * 0.06;
    out.push({ day: addDays(todayISO(), -i), dinein, takeout, delivery, catering, total: dinein+takeout+delivery+catering });
  }
  return out;
}
function saveState() { memStore.data = state; }

// -----------------------------------------------------------------------------
// COMPUTATIONS
// -----------------------------------------------------------------------------
function totals() {
  const p = state.pl;
  const revenue = p.rev_dinein + p.rev_takeout + p.rev_delivery + p.rev_catering;
  const cogs = p.cog_flour + p.cog_cheese + p.cog_sauce + p.cog_meats + p.cog_produce + p.cog_bev + p.cog_paper;
  const labor = p.lab_kitchen + p.lab_foh + p.lab_drivers + p.lab_mgr + p.lab_tax + p.lab_bene;
  const ops = p.op_rent + p.op_util + p.op_net + p.op_pos + p.op_proc + p.op_3p + p.op_mkt + p.op_ins + p.op_rep + p.op_clean + p.op_lic + p.op_acct + p.op_small;
  const gp = revenue - cogs;
  const prime = cogs + labor;
  const opinc = revenue - cogs - labor - ops;
  const netPct = revenue ? (opinc / revenue) * 100 : 0;
  const foodPct = revenue ? (cogs / revenue) * 100 : 0;
  const laborPct = revenue ? (labor / revenue) * 100 : 0;
  const primePct = revenue ? (prime / revenue) * 100 : 0;
  return { revenue, cogs, labor, ops, gp, prime, opinc, netPct, foodPct, laborPct, primePct };
}

function complianceScore() {
  // 1) Licenses expiring soon
  const licWeights = state.licenses.map(l => {
    if (l.exp === "N/A") return 100;
    const days = daysBetween(todayISO(), l.exp);
    if (days < 0) return 0;
    if (days < 30) return 60;
    if (days < 60) return 85;
    return 100;
  });
  const licScore = licWeights.reduce((a,b)=>a+b,0) / licWeights.length;

  // 2) Staff certifications
  const certScores = state.staff.map(s => {
    const days = daysBetween(todayISO(), s.exp);
    if (days < 0) return 0;
    if (days < 30) return 70;
    return 100;
  });
  const certScore = certScores.reduce((a,b)=>a+b,0) / certScores.length;

  // 3) Temperatures in range
  const tempScores = state.temps.map(t => (t.last >= t.min && t.last <= t.max) ? 100 : 0);
  const tempScore = tempScores.reduce((a,b)=>a+b,0) / tempScores.length;

  // 4) Cleaning tasks on schedule
  const freqDays = { "Daily": 1, "Weekly": 7, "Monthly": 30, "Quarterly": 90, "Semi-annual": 180 };
  const cleanScores = state.cleaning.map(c => {
    const limit = freqDays[c.freq] || 30;
    const overdue = daysBetween(c.last, todayISO()) - limit;
    if (overdue <= 0) return 100;
    if (overdue <= 3) return 70;
    return 30;
  });
  const cleanScore = cleanScores.reduce((a,b)=>a+b,0) / cleanScores.length;

  // 5) Inspection score (recent)
  const last = state.inspections[0];
  const inspScore = last ? Math.max(0, 100 - last.violations * 8 - last.high * 20) : 80;

  const overall = Math.round(0.25*licScore + 0.20*certScore + 0.25*tempScore + 0.15*cleanScore + 0.15*inspScore);
  return {
    overall,
    breakdown: [
      { label: "Licenses & permits",       score: Math.round(licScore) },
      { label: "Staff certifications",     score: Math.round(certScore) },
      { label: "Temperature logs",         score: Math.round(tempScore) },
      { label: "Cleaning schedule",        score: Math.round(cleanScore) },
      { label: "Health inspection",        score: Math.round(inspScore) },
    ]
  };
}

function buildAlerts() {
  const alerts = [];
  // Inventory below par
  state.inv.forEach(i => {
    if (i.onHand <= i.reorder) {
      alerts.push({ level: i.onHand < i.reorder * 0.7 ? "err" : "warn", title: `Reorder: ${i.item}`, sub: `${i.onHand} ${i.unit} on hand · par ${i.par} (${i.vendor})` });
    }
  });
  // Temps out of range
  state.temps.forEach(t => {
    const label = t.label || t.equipment;
    if (t.last < t.min || t.last > t.max) {
      alerts.push({ level: "err", title: `Temperature out of range: ${label}`, sub: `Last ${t.last}${t.unit} · safe ${t.min}–${t.max}${t.unit}` });
    }
  });
  // Hot-hold stations not logged in the last 2 hours during service
  const now = Date.now();
  const HOT_OVERDUE_MS = 2 * 60 * 60 * 1000;
  state.temps.forEach(t => {
    if ((t.kind || (t.min >= 100 ? 'hot' : 'cold')) !== 'hot') return;
    if (!t.lastLoggedAt) return;
    const age = now - new Date(t.lastLoggedAt).getTime();
    if (age > HOT_OVERDUE_MS) {
      const hrs = Math.round(age / 3600000);
      alerts.push({ level: hrs >= 4 ? 'err' : 'warn', title: `Hot-hold log overdue: ${t.label || t.equipment}`, sub: `Last logged ${hrs}h ago · FDA requires every 2h during service` });
    }
  });
  // Prep labels past use-by
  if (Array.isArray(state.prepLabels)) {
    const expired = state.prepLabels.filter(l => !l.voided_at && new Date(l.use_by).getTime() < now);
    if (expired.length > 0) {
      const first = expired[0];
      alerts.push({
        level: 'err',
        title: `${expired.length} prep label${expired.length > 1 ? 's' : ''} past use-by`,
        sub: `${first.item}${expired.length > 1 ? ' and ' + (expired.length - 1) + ' more' : ''} · discard`,
      });
    }
  }
  // Certs expiring
  state.staff.forEach(s => {
    const d = daysBetween(todayISO(), s.exp);
    if (d < 0) alerts.push({ level: "err", title: `${s.name} — ${s.cert} EXPIRED`, sub: `Expired ${Math.abs(d)} days ago` });
    else if (d < 30) alerts.push({ level: "warn", title: `${s.name} — ${s.cert} expiring`, sub: `In ${d} days` });
  });
  // Licenses
  state.licenses.forEach(l => {
    if (l.exp === "N/A") return;
    const d = daysBetween(todayISO(), l.exp);
    if (d < 0) alerts.push({ level: "err", title: `${l.doc} EXPIRED`, sub: `${l.issuer} · ${Math.abs(d)} days ago` });
    else if (d < 60) alerts.push({ level: "warn", title: `${l.doc} expiring soon`, sub: `${l.issuer} · in ${d} days` });
  });
  // Cleaning overdue
  const freqDays = { "Daily": 1, "Weekly": 7, "Monthly": 30, "Quarterly": 90, "Semi-annual": 180 };
  state.cleaning.forEach(c => {
    const limit = freqDays[c.freq] || 30;
    const overdue = daysBetween(c.last, todayISO()) - limit;
    if (overdue > 0) alerts.push({ level: overdue > 3 ? "err" : "warn", title: `Cleaning overdue: ${c.task}`, sub: `${overdue} days past ${c.freq.toLowerCase()} schedule · ${c.assigned}` });
  });

  // Invoice price variance (reviewed but not posted): alert on >5% drift
  for (const inv of state.invoices || []) {
    if (inv.status === 'posted') continue;
    for (const l of inv.lines || []) {
      if (!l.variance) continue;
      const abs = Math.abs(l.variance.delta);
      if (abs <= 0.05) continue;
      const level = abs > 0.15 ? 'err' : 'warn';
      const sign = l.variance.delta >= 0 ? '+' : '';
      alerts.push({
        level,
        title: `Vendor price ${l.variance.delta > 0 ? 'hike' : 'drop'}: ${l.matchedName || l.desc}`,
        sub: `${inv.vendor} · ${sign}${(l.variance.delta * 100).toFixed(1)}% vs prior (${fmtUSD2 ? fmtUSD2(l.variance.prevPrice) : '$' + l.variance.prevPrice.toFixed(2)} → ${fmtUSD2 ? fmtUSD2(l.unitPrice) : '$' + l.unitPrice.toFixed(2)})`,
      });
    }
  }

  if (alerts.length === 0) alerts.push({ level: "ok", title: "All systems nominal", sub: "No active alerts right now" });
  return alerts;
}

// -----------------------------------------------------------------------------
// RENDER
// -----------------------------------------------------------------------------
const CHART_DEFAULTS = {
  color: "#b5a992",
  borderColor: "#2c2820",
  font: { family: "Inter, sans-serif", size: 11 },
};
Chart.defaults.color = CHART_DEFAULTS.color;
Chart.defaults.borderColor = CHART_DEFAULTS.borderColor;
Chart.defaults.font.family = CHART_DEFAULTS.font.family;
Chart.defaults.font.size = CHART_DEFAULTS.font.size;

const CHART_COLORS = ["#E8A33D", "#C9302C", "#3B6E3B", "#D7B26A", "#8D6E4B", "#6B8EAE", "#A87CA0", "#C08D3F"];

const charts = {};
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function renderAll() {
  renderKPIs();
  renderPL();
  renderBreakEven();
  renderMenu();
  renderInventory();
  renderWaste();
  renderStaff();
  renderTemps();
  renderChecklist();
  renderCleaning();
  renderPrepLabels();
  renderInvoices();
  renderLicenses();
  renderInspections();
  renderTraining();
  renderAlerts();
  renderCompliance();
  renderCharts();
  renderHealthPill();
  // Phase 2
  applyRole();
  renderBriefing();
  renderRecipes();
  renderScheduler();
  renderInspection();
  renderTasks();
  saveState();
}

function renderKPIs() {
  const t = totals();
  document.getElementById("kpi-rev").textContent = fmtUSD(t.revenue);
  document.getElementById("kpi-rev-d").textContent = "+4.2% vs prior";
  setKpi("kpi-prime", pct(t.primePct), t.primePct <= 60);
  setKpi("kpi-food",  pct(t.foodPct),  t.foodPct >= 28 && t.foodPct <= 32);
  setKpi("kpi-labor", pct(t.laborPct), t.laborPct <= 28);
  setKpi("kpi-margin", pct(t.netPct),  t.netPct >= 7);
  const comp = complianceScore();
  setKpi("kpi-comp", `${comp.overall}%`, comp.overall >= 85);
  document.getElementById("kpi-comp-foot").textContent = comp.overall >= 90 ? "Excellent" : comp.overall >= 75 ? "Good" : comp.overall >= 60 ? "Needs attention" : "Critical";
}
function setKpi(id, value, healthy) {
  const el = document.getElementById(id);
  el.textContent = value;
  el.style.color = healthy ? "" : "var(--warn)";
}

function renderPL() {
  Object.keys(state.pl).forEach(key => {
    const input = document.querySelector(`[data-pl="${key}"]`);
    if (input && document.activeElement !== input) input.value = state.pl[key];
  });
  const t = totals();
  document.getElementById("pl-revenue").textContent = fmtUSD(t.revenue);
  document.getElementById("pl-cogs").textContent = fmtUSD(t.cogs);
  document.getElementById("pl-labor").textContent = fmtUSD(t.labor);
  document.getElementById("pl-ops").textContent = fmtUSD(t.ops);
  document.getElementById("pl-gp").textContent = fmtUSD(t.gp);
  document.getElementById("pl-prime").textContent = fmtUSD(t.prime);
  document.getElementById("pl-opinc").textContent = fmtUSD(t.opinc);
  document.getElementById("pl-net").textContent = pct(t.netPct);
}

function renderBreakEven() {
  const t = totals();
  // Fixed: occupancy/operating + manager + benefits. Variable: COGS + hourly labor + tax + processing + 3p fees
  const fixed = state.pl.op_rent + state.pl.op_util + state.pl.op_net + state.pl.op_pos + state.pl.op_mkt + state.pl.op_ins + state.pl.op_rep + state.pl.op_clean + state.pl.op_lic + state.pl.op_acct + state.pl.op_small + state.pl.lab_mgr + state.pl.lab_bene;
  const variable = t.cogs + state.pl.lab_kitchen + state.pl.lab_foh + state.pl.lab_drivers + state.pl.lab_tax + state.pl.op_proc + state.pl.op_3p;
  const varRatio = t.revenue ? variable / t.revenue : 0.6;
  const cm = 1 - varRatio;
  const beRev = cm > 0 ? fixed / cm : 0;
  const ticket = state.beTicket || 22;
  document.getElementById("be-fixed").textContent = fmtUSD(fixed);
  document.getElementById("be-var").textContent = pct(varRatio * 100);
  document.getElementById("be-rev").textContent = fmtUSD(beRev);
  document.getElementById("be-day").textContent = fmtUSD(beRev / 30);
  document.getElementById("be-orders").textContent = Math.ceil((beRev / 30) / ticket);
  const ticketInput = document.getElementById("be-ticket");
  if (ticketInput && document.activeElement !== ticketInput) ticketInput.value = ticket;
}

function classifyItem(marginPct, units) {
  const highMargin = marginPct >= 70;
  const highVolume = units >= 200;
  if (highMargin && highVolume) return { cls: "Star", key: "star" };
  if (!highMargin && highVolume) return { cls: "Plowhorse", key: "plow" };
  if (highMargin && !highVolume) return { cls: "Puzzle", key: "puzl" };
  return { cls: "Dog", key: "dog" };
}

function renderMenu() {
  const tbody = document.getElementById("menu-body");
  tbody.innerHTML = "";
  state.menu.forEach((m, idx) => {
    const margin = m.price - m.cost;
    const marginPct = m.price ? (margin / m.price) * 100 : 0;
    const rev = m.price * m.units;
    const cls = classifyItem(marginPct, m.units);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(m.name)}</td>
      <td><input type="number" step="0.01" value="${m.price}" data-menu="${idx}" data-field="price"/></td>
      <td><input type="number" step="0.01" value="${m.cost}" data-menu="${idx}" data-field="cost"/></td>
      <td>${fmtUSD2(margin)}</td>
      <td>${pct(marginPct)}</td>
      <td><input type="number" value="${m.units}" data-menu="${idx}" data-field="units"/></td>
      <td>${fmtUSD(rev)}</td>
      <td><span class="cls-${cls.key}">${cls.cls}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderInventory() {
  const tbody = document.getElementById("inv-body");
  tbody.innerHTML = "";
  state.inv.forEach((i, idx) => {
    const value = i.onHand * i.cost;
    const belowPar = i.onHand < i.par;
    const critical = i.onHand <= i.reorder;
    const status = critical ? `<span class="pill err">Reorder now</span>` : belowPar ? `<span class="pill warn">Below par</span>` : `<span class="pill ok">OK</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(i.item)}</td>
      <td>${escapeHtml(i.unit)}</td>
      <td><input type="number" step="0.1" value="${i.onHand}" data-inv="${idx}" data-field="onHand"/></td>
      <td>${i.par}</td>
      <td>${i.reorder}</td>
      <td>${fmtUSD2(i.cost)}</td>
      <td>${fmtUSD2(value)}</td>
      <td>${escapeHtml(i.vendor)}</td>
      <td>${status}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderWaste() {
  const tbody = document.getElementById("waste-body");
  tbody.innerHTML = "";
  let total = 0;
  state.waste.forEach(w => {
    total += w.loss;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(w.date)}</td><td>${escapeHtml(w.item)}</td><td>${w.qty}</td><td>${escapeHtml(w.reason)}</td><td>${fmtUSD2(w.loss)}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("waste-total").textContent = fmtUSD2(total);
}

function renderStaff() {
  const tbody = document.getElementById("staff-body");
  tbody.innerHTML = "";
  let weekTotal = 0;
  state.staff.forEach((s, idx) => {
    const weekly = s.hourly * s.hrs;
    const monthly = weekly * 4.33;
    weekTotal += weekly;
    const days = daysBetween(todayISO(), s.exp);
    const certStatus = days < 0 ? `<span class="pill err">Expired</span>` : days < 30 ? `<span class="pill warn">${days}d</span>` : `<span class="pill ok">${days}d</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.role)}</td>
      <td><input type="number" step="0.25" value="${s.hourly}" data-staff="${idx}" data-field="hourly"/></td>
      <td><input type="number" step="1" value="${s.hrs}" data-staff="${idx}" data-field="hrs"/></td>
      <td>${fmtUSD2(weekly)}</td>
      <td>${fmtUSD(monthly)}</td>
      <td>${escapeHtml(s.cert)}</td>
      <td>${escapeHtml(s.exp)} ${certStatus}</td>
    `;
    tbody.appendChild(tr);
  });
  const monthTotal = weekTotal * 4.33;
  const t = totals();
  document.getElementById("staff-week").textContent = fmtUSD(weekTotal);
  document.getElementById("staff-month").textContent = fmtUSD(monthTotal);
  document.getElementById("staff-pct").textContent = t.revenue ? pct((monthTotal / t.revenue) * 100) : "0%";
}

function renderTemps() {
  const coldGrid = document.getElementById("temp-grid-cold");
  const hotGrid  = document.getElementById("temp-grid-hot");
  // Legacy single-grid fallback (shouldn't trigger after the tabs rebuild)
  const legacy   = document.getElementById("temp-grid");
  if (coldGrid) coldGrid.innerHTML = "";
  if (hotGrid)  hotGrid.innerHTML  = "";
  if (legacy)   legacy.innerHTML   = "";

  const now = Date.now();
  const HOT_OVERDUE_MS = 2 * 60 * 60 * 1000; // 2h in service

  state.temps.forEach((t, idx) => {
    const kind = t.kind || (t.min >= 100 ? 'hot' : 'cold');
    const ok = t.last >= t.min && t.last <= t.max;
    const lastAt = t.lastLoggedAt ? new Date(t.lastLoggedAt).getTime() : null;
    const overdue = kind === 'hot' && lastAt && (now - lastAt) > HOT_OVERDUE_MS;
    const ageLabel = lastAt ? (() => {
      const mins = Math.floor((now - lastAt) / 60000);
      if (mins < 60) return `Logged ${mins}m ago`;
      const h = Math.floor(mins / 60); const m = mins % 60;
      return `Logged ${h}h${m ? ' ' + m + 'm' : ''} ago`;
    })() : 'No log yet';

    let statusPill;
    if (!ok) statusPill = `<span class="pill err">Alert</span>`;
    else if (overdue) statusPill = `<span class="pill warn">Overdue</span>`;
    else statusPill = `<span class="pill ok">In range</span>`;

    const div = document.createElement("div");
    div.className = `temp-cell ${ok ? (overdue ? 'warn' : 'ok') : 'err'}`;
    div.innerHTML = `
      <div class="temp-label">${escapeHtml(t.label || t.equipment)}</div>
      <div class="temp-range">${kind === 'hot' ? `Hot-hold: ≥ ${t.min} ${t.unit}` : `Safe: ${t.min}–${t.max} ${t.unit}`} · <span class="muted">${ageLabel}</span></div>
      <div class="temp-input">
        <input type="number" step="0.5" value="${t.last}" data-temp="${idx}"/>
        <span class="unit">${t.unit}</span>
        ${statusPill}
      </div>
    `;
    const target = (kind === 'hot' ? hotGrid : coldGrid) || legacy;
    if (target) target.appendChild(div);
  });

  // Last-logged summary under the button
  const lastEl = document.getElementById('temp-last-logged');
  if (lastEl) {
    const anyAt = state.temps.map(t => t.lastLoggedAt).filter(Boolean).sort().pop();
    lastEl.textContent = anyAt ? `Most recent log: ${new Date(anyAt).toLocaleString()}` : '';
  }
}

function renderChecklist() {
  const ul = document.getElementById("checklist");
  ul.innerHTML = "";
  state.checklist.forEach((c, idx) => {
    const li = document.createElement("li");
    if (c.done) li.classList.add("done");
    li.innerHTML = `<div class="check-box"></div><div class="check-label">${c.task}</div><div class="check-time">${c.time}</div>`;
    li.addEventListener("click", () => { state.checklist[idx].done = !state.checklist[idx].done; renderChecklist(); saveState(); });
    ul.appendChild(li);
  });
  const done = state.checklist.filter(c => c.done).length;
  document.getElementById("check-done").textContent = `${done}/${state.checklist.length}`;
}

function renderCleaning() {
  const tbody = document.getElementById("clean-body");
  tbody.innerHTML = "";
  const freqDays = { "Daily": 1, "Weekly": 7, "Monthly": 30, "Quarterly": 90, "Semi-annual": 180 };
  state.cleaning.forEach((c, idx) => {
    const limit = freqDays[c.freq] || 30;
    const next = addDays(c.last, limit);
    const diff = daysBetween(todayISO(), next);
    const status = diff < 0 ? `<span class="pill err">${Math.abs(diff)}d overdue</span>` : diff < 2 ? `<span class="pill warn">Due ${diff}d</span>` : `<span class="pill ok">In ${diff}d</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.task}</td>
      <td>${c.freq}</td>
      <td>${c.last}</td>
      <td>${next}</td>
      <td>${c.assigned}</td>
      <td>${status}</td>
      <td><button class="ghost-btn" data-clean-done="${idx}">Mark done</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// Prep labels (day-dot / use-by labels)
// ---------------------------------------------------------------------------

function hoursDiff(laterISO, earlierMs = Date.now()) {
  return (new Date(laterISO).getTime() - earlierMs) / 3600000;
}
function fmtWhen(iso) {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}
function relTime(iso) {
  const hrs = hoursDiff(iso);
  if (hrs < 0) {
    const h = Math.abs(Math.round(hrs));
    return h >= 24 ? `${Math.round(h/24)}d overdue` : `${h}h overdue`;
  }
  if (hrs < 1) return `in ${Math.round(hrs * 60)}m`;
  if (hrs < 24) return `in ${Math.round(hrs)}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

function renderPrepLabels() {
  if (!Array.isArray(state.prepLabels)) return;
  const now = Date.now();
  const active  = state.prepLabels.filter(l => !l.voided_at);
  const voided  = state.prepLabels.filter(l => l.voided_at);
  const expired = active.filter(l => new Date(l.use_by).getTime() < now);
  const soon    = active.filter(l => {
    const t = new Date(l.use_by).getTime();
    return t >= now && t - now <= 12 * 3600 * 1000;
  });
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const today = state.prepLabels.filter(l => new Date(l.prepped_at) >= todayStart).length;

  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('pl-active', active.length);
  setText('pl-soon', soon.length);
  setText('pl-expired', expired.length);
  setText('pl-today', today);
  setText('pl-count', `${active.length} active`);

  // Active labels list
  const list = document.getElementById('label-list');
  if (list) {
    if (active.length === 0) {
      list.innerHTML = `<div class="empty-state">No active labels. Create one to get started.</div>`;
    } else {
      // Sort by use-by ascending (most urgent first)
      const sorted = [...active].sort((a, b) => new Date(a.use_by) - new Date(b.use_by));
      list.innerHTML = sorted.map(l => {
        const useByMs = new Date(l.use_by).getTime();
        const state_ = useByMs < now ? 'expired'
          : useByMs - now <= 12 * 3600 * 1000 ? 'soon'
          : 'fresh';
        const statePill = state_ === 'expired' ? `<span class="pill err">Past use-by</span>`
          : state_ === 'soon' ? `<span class="pill warn">Use first</span>`
          : `<span class="pill ok">Fresh</span>`;
        const allergens = (l.allergens || []).map(a => `<span class="tag tag-allergen">${escapeHtml(a)}</span>`).join(' ');
        const typeLabel = l.prep_type === 'thaw' ? 'Thawing' : l.prep_type === 'open' ? 'Opened' : 'Prepped';
        return `<div class="label-row label-${state_}" data-label-id="${l.id}">
          <div class="label-row-main">
            <div class="label-row-head">
              <strong>${escapeHtml(l.item)}</strong>
              ${statePill}
              <span class="muted small">${typeLabel}${l.station ? ' · ' + escapeHtml(l.station) : ''}</span>
            </div>
            <div class="label-row-meta small muted">
              Prep: ${fmtWhen(l.prepped_at)}${l.prepped_by ? ' · ' + escapeHtml(l.prepped_by) : ''}
              &nbsp;·&nbsp; Use by: ${fmtWhen(l.use_by)} (${relTime(l.use_by)})
            </div>
            ${allergens ? `<div class="label-row-allergens">${allergens}</div>` : ''}
          </div>
          <div class="label-row-actions">
            <button class="ghost-btn small" data-label-print="${l.id}">Print</button>
            <button class="ghost-btn small" data-label-use="${l.id}">Mark used</button>
            <button class="ghost-btn small danger" data-label-discard="${l.id}">Discard</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  // History (last 7 days of voided labels)
  const histBody = document.getElementById('label-history-body');
  if (histBody) {
    const sevenDays = now - 7 * 24 * 3600 * 1000;
    const recent = voided.filter(l => new Date(l.voided_at).getTime() >= sevenDays)
      .sort((a, b) => new Date(b.voided_at) - new Date(a.voided_at));
    if (recent.length === 0) {
      histBody.innerHTML = `<tr><td colspan="6" class="muted center">No history yet.</td></tr>`;
    } else {
      histBody.innerHTML = recent.map(l => {
        const outcomeClass = /discard/i.test(l.voided_reason || '') ? 'err' : 'ok';
        return `<tr>
          <td>${escapeHtml(l.item)}</td>
          <td class="muted small">${l.prep_type}</td>
          <td class="muted small">${fmtWhen(l.prepped_at)}</td>
          <td class="muted small">${fmtWhen(l.use_by)}</td>
          <td class="muted small">${escapeHtml(l.prepped_by || '—')}</td>
          <td><span class="pill ${outcomeClass}">${escapeHtml(l.voided_reason || 'Voided')}</span></td>
        </tr>`;
      }).join('');
    }
  }
}

function buildLabelPrintHTML(label, tenantName) {
  const allergens = (label.allergens || []).join(' · ').toUpperCase() || 'NONE';
  const typeUpper = label.prep_type === 'thaw' ? 'THAWING' : label.prep_type === 'open' ? 'OPENED' : 'PREPPED';
  const preppedAt = new Date(label.prepped_at);
  const useBy = new Date(label.use_by);
  const fmt = (d) => d.toLocaleString([], { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' });
  return `<div class="plabel">
    <div class="plabel-head">
      <span class="plabel-type">${typeUpper}</span>
      <span class="plabel-tenant">${escapeHtml(tenantName || 'Stationly')}</span>
    </div>
    <div class="plabel-item">${escapeHtml(label.item)}</div>
    <div class="plabel-grid">
      <div><span class="plabel-k">Prep</span><span class="plabel-v">${fmt(preppedAt)}</span></div>
      <div class="plabel-useby"><span class="plabel-k">USE BY</span><span class="plabel-v">${fmt(useBy)}</span></div>
    </div>
    <div class="plabel-foot">
      <div><span class="plabel-k">By</span> ${escapeHtml(label.prepped_by || '—')}${label.station ? ' · ' + escapeHtml(label.station) : ''}</div>
      <div class="plabel-alg"><span class="plabel-k">Allergens</span> ${escapeHtml(allergens)}</div>
      ${label.notes ? `<div class="plabel-notes">${escapeHtml(label.notes)}</div>` : ''}
    </div>
  </div>`;
}

function printPrepLabel(label) {
  const tenantName = (window.__RESTOPS_CTX__ && window.__RESTOPS_CTX__.tenant && window.__RESTOPS_CTX__.tenant.name) || 'Stationly';
  const root = document.getElementById('label-print-root');
  if (!root) { window.print(); return; }
  root.innerHTML = buildLabelPrintHTML(label, tenantName);
  document.body.classList.add('printing-label');
  // Let the browser paint before opening the dialog
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-label');
      root.innerHTML = '';
    }, 300);
  }, 80);
}

function renderLicenses() {
  const tbody = document.getElementById("lic-body");
  tbody.innerHTML = "";
  state.licenses.forEach(l => {
    let statusPill = `<span class="pill ok">Active</span>`;
    if (l.exp !== "N/A") {
      const d = daysBetween(todayISO(), l.exp);
      if (d < 0) statusPill = `<span class="pill err">Expired ${Math.abs(d)}d</span>`;
      else if (d < 60) statusPill = `<span class="pill warn">${d}d</span>`;
      else statusPill = `<span class="pill ok">${d}d</span>`;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.doc}</td><td>${l.issuer}</td><td>${l.num}</td><td>${l.issued}</td><td>${l.exp}</td><td>${statusPill}</td>`;
    tbody.appendChild(tr);
  });
}

function renderInspections() {
  const tbody = document.getElementById("insp-body");
  tbody.innerHTML = "";
  state.inspections.forEach(i => {
    const tr = document.createElement("tr");
    const resultPill = i.high > 0 ? `<span class="pill warn">${i.result}</span>` : `<span class="pill ok">${i.result}</span>`;
    tr.innerHTML = `<td>${i.date}</td><td>${i.type}</td><td>${i.violations}</td><td>${i.high}</td><td>${resultPill}</td>`;
    tbody.appendChild(tr);
  });
}

function renderTraining() {
  const tbody = document.getElementById("train-body");
  tbody.innerHTML = "";
  state.staff.forEach(s => {
    const days = daysBetween(todayISO(), s.exp);
    const fh = days < 0 ? `<span class="pill err">Expired</span>` : days < 30 ? `<span class="pill warn">${days}d</span>` : `<span class="pill ok">Current</span>`;
    const allergen = Math.random() > 0.3 ? `<span class="pill ok">Done</span>` : `<span class="pill warn">Due</span>`;
    const servsafe = s.role.includes("Manager") || s.role.includes("Owner") ? `<span class="pill ok">Certified</span>` : `<span class="pill neutral">N/A</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${s.name}</td><td>${fh}</td><td>${allergen}</td><td>${servsafe}</td>`;
    tbody.appendChild(tr);
  });
}

function renderAlerts() {
  const alerts = buildAlerts();
  const ul = document.getElementById("alerts-list");
  ul.innerHTML = "";
  alerts.forEach(a => {
    const li = document.createElement("li");
    const icon = a.level === "err" ? "!" : a.level === "warn" ? "⚠" : "✓";
    li.innerHTML = `<div class="alert-icon ${a.level}">${icon}</div><div class="alert-body"><div class="alert-title">${a.title}</div><div class="alert-sub">${a.sub}</div></div>`;
    ul.appendChild(li);
  });
  document.getElementById("alert-count").textContent = alerts.filter(a=>a.level!=="ok").length;
}

function renderCompliance() {
  const c = complianceScore();
  const host = document.getElementById("comp-bars");
  host.innerHTML = "";
  c.breakdown.forEach(b => {
    const color = b.score >= 85 ? "" : b.score >= 65 ? "warn" : "err";
    const row = document.createElement("div");
    row.className = "comp-row";
    row.innerHTML = `<div class="label">${b.label}</div><div class="comp-bar"><div class="fill ${color}" style="width:${b.score}%"></div></div><div class="score">${b.score}%</div>`;
    host.appendChild(row);
  });
}

function renderHealthPill() {
  const c = complianceScore();
  const t = totals();
  const pill = document.getElementById("health-pill");
  pill.classList.remove("warn", "err");
  const txt = pill.querySelector(".health-text");
  // Blended health: compliance + prime cost + labor % + food cost
  const primeScore = t.primePct <= 60 ? 100 : t.primePct <= 65 ? 75 : t.primePct <= 70 ? 50 : 25;
  const laborScore = t.laborPct <= 28 ? 100 : t.laborPct <= 32 ? 75 : t.laborPct <= 36 ? 50 : 25;
  const foodScore  = t.foodPct  <= 32 ? 100 : t.foodPct  <= 35 ? 75 : t.foodPct  <= 38 ? 50 : 25;
  const overall = Math.round(0.4*c.overall + 0.25*primeScore + 0.2*laborScore + 0.15*foodScore);
  if (overall >= 85) { txt.textContent = `Healthy · ${overall}%`; }
  else if (overall >= 65) { pill.classList.add("warn"); txt.textContent = `Watch · ${overall}%`; }
  else { pill.classList.add("err"); txt.textContent = `Critical · ${overall}%`; }
}

// -----------------------------------------------------------------------------
// CHARTS
// -----------------------------------------------------------------------------
function renderCharts() {
  renderRevenueChart();
  renderBreakdownChart();
  renderTopChart();
  renderPrimeChart();
  renderDailyChart();
  renderMixChart();
  renderVendorChart();
  renderLaborChart();
  renderTempChart();
}

function filteredSales() { return state.sales30.slice(-state.range); }

function renderRevenueChart() {
  const ctx = document.getElementById("chart-revenue"); if (!ctx) return;
  destroyChart("revenue");
  const data = filteredSales();
  const t = totals();
  const primeDaily = (t.prime / 30);
  charts.revenue = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map(d => d.day.slice(5)),
      datasets: [
        { label: "Revenue", data: data.map(d => d.total), borderColor: "#E8A33D", backgroundColor: "rgba(232,163,61,0.12)", fill: true, tension: 0.3, pointRadius: 0 },
        { label: "Prime cost", data: data.map(() => primeDaily), borderColor: "#C9302C", borderDash: [4,4], pointRadius: 0, fill: false },
      ]
    },
    options: chartOpts({ legend: true, currency: true })
  });
}

function renderBreakdownChart() {
  const ctx = document.getElementById("chart-breakdown"); if (!ctx) return;
  destroyChart("breakdown");
  const t = totals();
  charts.breakdown = new Chart(ctx, {
    type: "doughnut",
    data: { labels: ["Food (COGS)", "Labor", "Occupancy/Ops", "Net Income"],
      datasets: [{ data: [t.cogs, t.labor, t.ops, Math.max(t.opinc,0)], backgroundColor: CHART_COLORS.slice(0,4), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { padding: 12 } } }, cutout: "65%" }
  });
}

function renderTopChart() {
  const ctx = document.getElementById("chart-top"); if (!ctx) return;
  destroyChart("top");
  const top = [...state.menu].map(m => ({ name: m.name, rev: m.price * m.units })).sort((a,b) => b.rev - a.rev).slice(0, 8);
  charts.top = new Chart(ctx, {
    type: "bar",
    data: { labels: top.map(t => t.name), datasets: [{ label: "Revenue", data: top.map(t => t.rev), backgroundColor: "#E8A33D", borderRadius: 4 }] },
    options: horizBarOpts()
  });
}

function renderPrimeChart() {
  const ctx = document.getElementById("chart-prime"); if (!ctx) return;
  destroyChart("prime");
  const t = totals();
  const weeks = ["W-5","W-4","W-3","W-2","W-1","Now"];
  const base = t.primePct;
  const series = [base + 4.2, base + 2.8, base + 3.5, base + 1.9, base + 0.6, base].map(v => +v.toFixed(1));
  charts.prime = new Chart(ctx, {
    type: "line",
    data: { labels: weeks, datasets: [
      { label: "Prime %", data: series, borderColor: "#E8A33D", backgroundColor: "rgba(232,163,61,0.15)", fill: true, tension: 0.35, pointRadius: 3 },
      { label: "Target 60%", data: weeks.map(() => 60), borderColor: "#6fbf73", borderDash: [4,4], pointRadius: 0 }
    ]},
    options: chartOpts({ legend: true })
  });
}

function renderDailyChart() {
  const ctx = document.getElementById("chart-daily"); if (!ctx) return;
  destroyChart("daily");
  const data = filteredSales();
  charts.daily = new Chart(ctx, {
    type: "bar",
    data: { labels: data.map(d => d.day.slice(5)), datasets: [
      { label: "Dine-in",  data: data.map(d => d.dinein),   backgroundColor: "#E8A33D", stack: "s" },
      { label: "Take-out", data: data.map(d => d.takeout),  backgroundColor: "#C9302C", stack: "s" },
      { label: "Delivery", data: data.map(d => d.delivery), backgroundColor: "#3B6E3B", stack: "s" },
      { label: "Catering", data: data.map(d => d.catering), backgroundColor: "#D7B26A", stack: "s" },
    ]},
    options: { ...chartOpts({ legend: true, currency: true }), scales: { ...chartOpts({}).scales, x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: "#2c2820" } } } }
  });
}

function renderMixChart() {
  const ctx = document.getElementById("chart-mix"); if (!ctx) return;
  destroyChart("mix");
  // Simple bucket
  const buckets = { Pizza: 0, Sides: 0, Beverages: 0, Other: 0 };
  state.menu.forEach(m => {
    const rev = m.price * m.units;
    const n = m.name.toLowerCase();
    if (n.includes("pizza") || n.includes("margherita") || n.includes("sicilian") || n.includes("supreme") || n.includes("white") || n.includes("bbq") || n.includes("meat")) buckets.Pizza += rev;
    else if (n.includes("soda") || n.includes("drink")) buckets.Beverages += rev;
    else if (n.includes("salad") || n.includes("knots") || n.includes("wings") || n.includes("calzone") || n.includes("stromboli")) buckets.Sides += rev;
    else buckets.Other += rev;
  });
  charts.mix = new Chart(ctx, {
    type: "doughnut",
    data: { labels: Object.keys(buckets), datasets: [{ data: Object.values(buckets), backgroundColor: CHART_COLORS.slice(0,4), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, cutout: "60%" }
  });
}

function renderVendorChart() {
  const ctx = document.getElementById("chart-vendor"); if (!ctx) return;
  destroyChart("vendor");
  const byVendor = {};
  state.inv.forEach(i => { byVendor[i.vendor] = (byVendor[i.vendor] || 0) + i.onHand * i.cost * 4; }); // approx monthly turnover x4
  const entries = Object.entries(byVendor).sort((a,b) => b[1] - a[1]);
  charts.vendor = new Chart(ctx, {
    type: "bar",
    data: { labels: entries.map(e => e[0]), datasets: [{ label: "Spend", data: entries.map(e => e[1]), backgroundColor: "#E8A33D", borderRadius: 4 }] },
    options: horizBarOpts()
  });
}

function horizBarOpts() {
  return {
    responsive: true, maintainAspectRatio: false, indexAxis: "y",
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: "#1c1a15", titleColor: "#f3ece0", bodyColor: "#b5a992", borderColor: "#3a3528", borderWidth: 1, padding: 10,
        callbacks: { label: (c) => `${fmtUSD(c.raw)}` } }
    },
    scales: {
      x: { grid: { color: "#2c2820" }, ticks: { callback: v => "$"+(v>=1000 ? (v/1000).toFixed(1)+"k" : v) } },
      y: { grid: { display: false }, ticks: { font: { size: 11 } } }
    }
  };
}

function renderLaborChart() {
  const ctx = document.getElementById("chart-labor"); if (!ctx) return;
  destroyChart("labor");
  const hours = ["11a","12p","1p","2p","3p","4p","5p","6p","7p","8p","9p","10p"];
  const sales = [420, 680, 510, 280, 210, 340, 620, 980, 1120, 980, 720, 440];
  const labor = [95,110,110,85,75,85,120,145,160,155,125,90];
  charts.labor = new Chart(ctx, {
    type: "line",
    data: { labels: hours, datasets: [
      { label: "Sales / hr", data: sales, borderColor: "#E8A33D", backgroundColor: "rgba(232,163,61,0.15)", yAxisID: "y", fill: true, tension: 0.3 },
      { label: "Labor $ / hr", data: labor, borderColor: "#C9302C", yAxisID: "y1", tension: 0.3 }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: {
        y: { position: "left", grid: { color: "#2c2820" }, ticks: { callback: v => "$"+v } },
        y1: { position: "right", grid: { display: false }, ticks: { callback: v => "$"+v } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderTempChart() {
  const ctx = document.getElementById("chart-temp"); if (!ctx) return;
  destroyChart("temp");
  const coolers = state.temps.filter(t => t.unit === "°F" && t.max <= 45);
  const labels = coolers[0]?.history.map(h => h.day.slice(5)) || [];
  charts.temp = new Chart(ctx, {
    type: "line",
    data: { labels,
      datasets: coolers.map((t, i) => ({
        label: t.label, data: t.history.map(h => h.value),
        borderColor: CHART_COLORS[i % CHART_COLORS.length], tension: 0.3, pointRadius: 2, fill: false
      })).concat([
        { label: "Max safe (41°F)", data: labels.map(() => 41), borderColor: "#e85a4f", borderDash: [4,4], pointRadius: 0, fill: false }
      ])
    },
    options: chartOpts({ legend: true })
  });
}

function chartOpts({ legend = false, currency = false } = {}) {
  return {
    responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: legend, position: "top", labels: { usePointStyle: true, padding: 12 } },
      tooltip: { backgroundColor: "#1c1a15", titleColor: "#f3ece0", bodyColor: "#b5a992", borderColor: "#3a3528", borderWidth: 1, padding: 10,
        callbacks: currency ? { label: (c) => `${c.dataset.label}: ${fmtUSD(c.raw)}` } : undefined
      } },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
      y: { grid: { color: "#2c2820" }, ticks: currency ? { callback: v => "$"+(v>=1000 ? (v/1000).toFixed(1)+"k" : v) } : {} }
    }
  };
}

// -----------------------------------------------------------------------------
// PHASE 2 — ROLE-BASED ACCESS
// -----------------------------------------------------------------------------
function applyRole() {
  document.body.classList.remove("role-owner", "role-manager", "role-staff");
  document.body.classList.add(`role-${state.role}`);
  const sel = document.getElementById("role-select");
  if (sel && sel.value !== state.role) sel.value = state.role;

  // Staff are locked to the Time Clock view. If the current view is anything
  // else (e.g. they bookmarked a deeper page or the persisted state had them
  // on overview), force-switch them.
  if (state.role === 'staff') {
    const visibleClock = document.querySelector('.nav-item[data-view="clock"]');
    if (visibleClock && !visibleClock.classList.contains('active')) {
      // Defer to next tick so DOM is ready when called early in boot.
      setTimeout(() => {
        try { showView('clock'); } catch (_) {}
      }, 0);
    }
  }
}

// -----------------------------------------------------------------------------
// PHASE 2 — WEEKLY BRIEFING (auto-generated narrative + anomalies)
// -----------------------------------------------------------------------------
function renderBriefing() {
  const t = totals();
  const comp = complianceScore();
  const period = document.getElementById("brief-period");
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (period) period.textContent = `Week of ${fmt(weekStart)} — ${fmt(weekEnd)} · auto-generated from your dashboard data`;

  // Headline — data-driven
  const head = document.getElementById("brief-headline");
  if (head) {
    if (t.primePct <= 55) head.textContent = "Strong week — prime cost in healthy range";
    else if (t.primePct <= 60) head.textContent = "Solid operations with room to tighten costs";
    else head.textContent = "Costs running hot — watch prime and food cost";
  }

  // KPIs
  const kpiEl = document.getElementById("brief-kpis");
  if (kpiEl) {
    const weekRev = state.sales30.slice(-7).reduce((a, d) => a + d.total, 0);
    const lastWeek = state.sales30.slice(-14, -7).reduce((a, d) => a + d.total, 0);
    const delta = lastWeek ? ((weekRev - lastWeek) / lastWeek) * 100 : 0;
    const alerts = buildAlerts().filter(a => a.level !== "ok");
    kpiEl.innerHTML = `
      <div class="brief-kpi"><div class="lbl">Revenue (7D)</div><div class="val">${fmtUSD(weekRev)}</div><div class="dlt ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs prior week</div></div>
      <div class="brief-kpi"><div class="lbl">Prime cost</div><div class="val">${pct(t.primePct)}</div><div class="dlt">Target ≤ 60%</div></div>
      <div class="brief-kpi"><div class="lbl">Net margin</div><div class="val">${pct(t.netPct)}</div><div class="dlt">Industry 7–10%</div></div>
      <div class="brief-kpi"><div class="lbl">Compliance</div><div class="val">${comp.overall}%</div><div class="dlt">${alerts.length} active alerts</div></div>
    `;
  }

  // Insights — synthesized from dashboard state
  const insights = [];
  // Top seller
  const topSeller = [...state.menu].sort((a,b) => b.units - a.units)[0];
  if (topSeller) insights.push({ icon: "📈", text: `<strong>${topSeller.name || topSeller.item}</strong> is your top mover this month with ${topSeller.units} units — margin ${pct(((topSeller.price - topSeller.cost)/topSeller.price)*100)}.` });
  // Prime vs target
  if (t.primePct > 60) insights.push({ icon: "⚠️", text: `Prime cost at ${pct(t.primePct)} is above the 60% target. Trim ~${fmtUSD(t.prime - t.revenue * 0.60)} to get back in range.` });
  else insights.push({ icon: "✅", text: `Prime cost held at ${pct(t.primePct)} — below the 60% industry benchmark. Keep doing what's working.` });
  // Food cost
  if (t.foodPct > 32) insights.push({ icon: "🧀", text: `Food cost drifted to ${pct(t.foodPct)} — check cheese and meat invoices; vendor prices may have moved.` });
  else if (t.foodPct < 28) insights.push({ icon: "🍝", text: `Food cost at ${pct(t.foodPct)} is lean — could indicate under-portioning or menu mix shift toward margin-heavy items.` });
  // Labor efficiency
  if (t.laborPct > 28) insights.push({ icon: "👥", text: `Labor % at ${pct(t.laborPct)} is high — review the scheduler for over-coverage on slow weekdays.` });
  // Waste
  const wasteTotal = state.waste.reduce((a,w) => a + (w.loss||0), 0);
  const wastePct = t.cogs ? (wasteTotal / t.cogs) * 100 : 0;
  if (wastePct > 2) insights.push({ icon: "🗑️", text: `Waste at ${wastePct.toFixed(1)}% of food cost — 2% is the target. Top reason: ${topWasteReason()}.` });

  const insList = document.getElementById("insights-list");
  if (insList) insList.innerHTML = insights.map(i => `<li><span class="ins-icon">${i.icon}</span><span>${i.text}</span></li>`).join("");

  // Anomalies (alerts)
  const anomalies = buildAlerts().filter(a => a.level !== "ok");
  const anomEl = document.getElementById("anomalies-list");
  const anomCount = document.getElementById("anomaly-count");
  if (anomEl) {
    if (anomalies.length === 0) anomEl.innerHTML = `<li><span class="ins-icon">✨</span><span>No anomalies detected this week.</span></li>`;
    else anomEl.innerHTML = anomalies.slice(0, 6).map(a => `<li><span class="ins-icon ${a.level}">${a.level === "err" ? "‼️" : "⚠️"}</span><span><strong>${a.title}</strong><br><span class="muted">${a.sub}</span></span></li>`).join("");
  }
  if (anomCount) anomCount.textContent = anomalies.length;

  // Focus list — prioritized action items
  const focus = [];
  // DBPR readiness
  const inspScore = computeInspScore();
  if (inspScore.pct < 90) focus.push(`Close out ${inspScore.failHigh} high-priority DBPR items this week (inspection readiness at ${inspScore.pct}%).`);
  // Reorder
  const lowInv = state.inv.filter(i => i.onHand <= i.reorder);
  if (lowInv.length > 0) focus.push(`Place reorder with ${[...new Set(lowInv.map(i => i.vendor))].join(", ")} — ${lowInv.length} items at or below par.`);
  // Food safety — expired prep labels
  const expiredLabels = (state.prepLabels || []).filter(l => !l.voided_at && l.use_by && new Date(l.use_by) < new Date());
  if (expiredLabels.length > 0) {
    const preview = expiredLabels.slice(0, 3).map(l => l.item).join(", ");
    focus.push(`Discard ${expiredLabels.length} prep-label item${expiredLabels.length === 1 ? "" : "s"} past use-by: ${preview}${expiredLabels.length > 3 ? ", …" : ""}.`);
  }
  // Food safety — hot-hold overdue checks (>2h since last log)
  const nowMs = now.getTime();
  const hotStations = (state.temps || []).filter(t => t.kind === "hot");
  const overdueHot = hotStations.filter(t => !t.lastLoggedAt || (nowMs - new Date(t.lastLoggedAt).getTime()) > 2 * 60 * 60 * 1000);
  if (overdueHot.length > 0) focus.push(`Log hot-hold temps on ${overdueHot.length} station${overdueHot.length === 1 ? "" : "s"} overdue past 2 hours: ${overdueHot.map(s => s.label || s.equipment).join(", ")}.`);
  // Menu engineering
  const dogs = state.menu.filter(m => {
    const margin = ((m.price - m.cost)/m.price) * 100;
    return margin < 65 && m.units < 150;
  });
  if (dogs.length > 0) focus.push(`Review ${dogs.length} slow-moving low-margin items: ${dogs.map(d => d.name || d.item).join(", ")}.`);
  // Invoice price hikes that still need review / posting
  const bigHikes = [];
  for (const inv of state.invoices || []) {
    if (inv.status === 'posted') continue;
    for (const l of inv.lines || []) {
      if (!l.variance) continue;
      if (l.variance.delta > 0.15) bigHikes.push({ item: l.matchedName || l.desc, vendor: inv.vendor, delta: l.variance.delta });
    }
  }
  if (bigHikes.length > 0) {
    const first = bigHikes[0];
    focus.push(`Push back on ${first.vendor} — ${first.item} up ${(first.delta * 100).toFixed(0)}% on the latest invoice${bigHikes.length > 1 ? ` (+${bigHikes.length - 1} more price jump${bigHikes.length - 1 === 1 ? '' : 's'})` : ''}.`);
  }
  const unreviewedInv = (state.invoices || []).filter((i) => i.status === 'draft').length;
  if (unreviewedInv > 0) focus.push(`Review ${unreviewedInv} draft invoice${unreviewedInv === 1 ? '' : 's'} in Invoices & AP — match line items to inventory before posting.`);
  focus.push(`Cross-train 1–2 staff on dough prep to reduce single-point-of-failure risk on Fridays.`);

  const focusEl = document.getElementById("focus-list");
  if (focusEl) focusEl.innerHTML = focus.map(f => `<li>${f}</li>`).join("");
}

function topWasteReason() {
  const counts = {};
  state.waste.forEach(w => counts[w.reason] = (counts[w.reason]||0) + (w.loss||0));
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  return sorted.length ? sorted[0][0] : "spoilage";
}

// -----------------------------------------------------------------------------
// PHASE 2 — RECIPE COSTING
// -----------------------------------------------------------------------------
function recipeCost(r) { return r.ingredients.reduce((a, i) => a + (i.qty * i.cost), 0); }
function recipeMarginPct(r) {
  const cost = recipeCost(r);
  return r.menuPrice ? ((r.menuPrice - cost) / r.menuPrice) * 100 : 0;
}
function recipeFoodPct(r) {
  const cost = recipeCost(r);
  return r.menuPrice ? (cost / r.menuPrice) * 100 : 0;
}

function renderRecipes() {
  const listEl = document.getElementById("recipe-list");
  if (!listEl) return;
  listEl.innerHTML = state.recipes.map(r => {
    const cost = recipeCost(r);
    const fp = recipeFoodPct(r);
    const tone = fp <= 30 ? "good" : fp <= 35 ? "mid" : "bad";
    return `<li class="${r.id === state.selectedRecipe ? 'selected' : ''}" data-recipe="${r.id}">
      <div>
        <div class="r-name">${r.name}</div>
        <div class="r-margin ${tone}">${fp.toFixed(1)}% food cost</div>
      </div>
      <div class="r-cost">${fmtUSD2(recipeCost(r))}</div>
    </li>`;
  }).join("");
  renderRecipeDetail();
  renderVariance();
}

function renderRecipeDetail() {
  const r = state.recipes.find(x => x.id === state.selectedRecipe) || state.recipes[0];
  if (!r) return;
  document.getElementById("recipe-title").textContent = r.name;
  document.getElementById("recipe-yield").textContent = `${fmtUSD2(r.menuPrice)} menu · yield ${r.yield}`;
  const cost = recipeCost(r);
  const margin = recipeMarginPct(r);
  const fp = recipeFoodPct(r);
  const body = document.getElementById("recipe-body");
  body.innerHTML = `
    <div class="rec-stats">
      <div><span class="muted">Plate cost</span><strong>${fmtUSD2(cost/r.yield)}</strong></div>
      <div><span class="muted">Menu price</span><strong>${fmtUSD2(r.menuPrice)}</strong></div>
      <div><span class="muted">Food cost %</span><strong class="${fp <= 32 ? 'good' : fp <= 38 ? 'mid' : 'bad'}">${fp.toFixed(1)}%</strong></div>
      <div><span class="muted">Gross margin</span><strong>${margin.toFixed(1)}%</strong></div>
    </div>
    <table class="tbl compact rec-ing">
      <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Unit cost</th><th>Ext. cost</th></tr></thead>
      <tbody>${r.ingredients.map((i, idx) => `
        <tr>
          <td>${i.item}</td>
          <td><input type="number" step="0.01" data-rec="${r.id}" data-rec-idx="${idx}" data-rec-field="qty" value="${i.qty}" /></td>
          <td>${i.unit}</td>
          <td><input type="number" step="0.01" data-rec="${r.id}" data-rec-idx="${idx}" data-rec-field="cost" value="${i.cost}" /></td>
          <td class="mono">${fmtUSD2(i.qty * i.cost)}</td>
        </tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right"><strong>Total batch cost</strong></td><td class="mono"><strong>${fmtUSD2(cost)}</strong></td></tr></tfoot>
    </table>
    <label class="rec-price">Menu price <input type="number" step="0.01" data-rec="${r.id}" data-rec-field="menuPrice" value="${r.menuPrice}" /></label>
  `;
}

function renderVariance() {
  // Theoretical food cost: from recipes weighted by menu units sold in SAMPLE.menu
  // Actual food cost: from P&L cogs
  let theoretical = 0;
  state.menu.forEach(m => {
    // Exact-ish match on item name; fall back to the menu item's declared cost
    const label = (m.name || m.item || "").toString().toLowerCase();
    let match = state.recipes.find(r => r.name.toLowerCase() === label);
    if (!match) match = state.recipes.find(r => {
      const rn = r.name.toLowerCase();
      return label.includes(rn) || rn.includes(label);
    });
    const unitCost = (match && match.ingredients.length) ? recipeCost(match) : (m.cost || 0);
    theoretical += unitCost * (m.units || 0);
  });
  const actual = totals().cogs;
  const revenue = totals().revenue;
  const shrink = actual - theoretical;
  document.getElementById("var-theo").textContent = fmtUSD(theoretical);
  document.getElementById("var-act").textContent = fmtUSD(actual);
  document.getElementById("var-shrink").textContent = (shrink >= 0 ? "+" : "") + fmtUSD(shrink);
  document.getElementById("var-theo-pct").textContent = revenue ? `${((theoretical/revenue)*100).toFixed(1)}% of revenue` : "—";
  document.getElementById("var-act-pct").textContent = revenue ? `${((actual/revenue)*100).toFixed(1)}% of revenue` : "—";
  const shrinkPct = theoretical ? (shrink / theoretical) * 100 : 0;
  const shrinkEl = document.getElementById("var-shrink-pct");
  shrinkEl.textContent = `${shrinkPct >= 0 ? '+' : ''}${shrinkPct.toFixed(1)}% variance · ${shrinkPct > 4 ? 'investigate' : shrinkPct > 0 ? 'acceptable' : 'favorable'}`;
  shrinkEl.className = `var-foot ${shrinkPct > 4 ? 'bad' : shrinkPct > 0 ? 'mid' : 'good'}`;
}

// -----------------------------------------------------------------------------
// PHASE 2 — SHIFT SCHEDULER
// -----------------------------------------------------------------------------
function renderScheduler() {
  const grid = document.getElementById("sched-grid");
  if (!grid) return;
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const staff = state.staff;

  // Week label
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const lbl = document.getElementById("sched-week");
  if (lbl) lbl.textContent = `Week of ${fmt(weekStart)} — ${fmt(weekEnd)}`;

  let html = `<thead><tr><th class="sched-staff">Staff</th>${days.map(d => `<th>${d}</th>`).join("")}<th>Hrs</th><th>$</th></tr></thead><tbody>`;
  let totalCost = 0;
  let totalHours = 0;
  const dailyHours = [0,0,0,0,0,0,0];
  const dailyCost = [0,0,0,0,0,0,0];

  staff.forEach((s, sIdx) => {
    let rowHours = 0;
    let rowCost = 0;
    const cells = days.map((d, dIdx) => {
      const key = `${sIdx}_${dIdx}`;
      const sh = state.schedule[key];
      if (sh) {
        rowHours += sh.hours;
        const cost = sh.hours * (s.hourly || s.rate || 15);
        rowCost += cost;
        dailyHours[dIdx] += sh.hours;
        dailyCost[dIdx] += cost;
        return `<td class="sched-cell shift" data-s="${sIdx}" data-d="${dIdx}" title="${sh.start}–${sh.end} · ${sh.hours}h">${sh.hours}h</td>`;
      }
      return `<td class="sched-cell off" data-s="${sIdx}" data-d="${dIdx}"><span class="muted">—</span></td>`;
    }).join("");
    totalCost += rowCost;
    totalHours += rowHours;
    html += `<tr><td class="name-cell">${s.name}<span class="role">${s.role} · ${fmtUSD2(s.hourly || s.rate || 0)}/hr</span></td>${cells}<td class="sched-sum">${rowHours}</td><td class="sched-sum">${fmtUSD(rowCost)}</td></tr>`;
  });
  html += `<tr class="sched-totals"><td class="name-cell">Daily hrs</td>${dailyHours.map(h => `<td class="sched-sum">${h}</td>`).join("")}<td class="sched-sum"><strong>${totalHours}</strong></td><td class="sched-sum"><strong>${fmtUSD(totalCost)}</strong></td></tr>`;
  html += `</tbody>`;
  grid.innerHTML = html;

  // Pills
  document.getElementById("sched-cost").textContent = `${fmtUSD(totalCost)} / wk`;
  const laborPct = state.forecastSales ? (totalCost / state.forecastSales) * 100 : 0;
  const pctEl = document.getElementById("sched-pct");
  pctEl.textContent = `${laborPct.toFixed(1)}% labor`;
  pctEl.className = `sched-pill ${laborPct <= 28 ? 'good' : laborPct <= 32 ? 'mid' : 'bad'}`;

  // Chart: labor cost vs forecasted revenue per day
  renderSchedChart(dailyCost);

  // Warnings
  const warnings = [];
  const forecastDaily = [0.09,0.10,0.11,0.12,0.14,0.22,0.22]; // share of weekly sales by DOW
  days.forEach((d, i) => {
    const dayFc = state.forecastSales * forecastDaily[i];
    const dayLaborPct = dayFc ? (dailyCost[i] / dayFc) * 100 : 0;
    if (dayLaborPct > 32) warnings.push({ icon: "⚠️", text: `${d}: labor ${dayLaborPct.toFixed(0)}% of forecast — over-staffed. Consider cutting one shift.` });
    if (dailyHours[i] < 8 && (i >= 5 || i === 0)) warnings.push({ icon: "🚨", text: `${d}: only ${dailyHours[i]}h scheduled on a peak day — under-staffed.` });
  });
  // Check for back-to-back long shifts
  staff.forEach((s, sIdx) => {
    const weekH = days.reduce((a, _, dIdx) => a + (state.schedule[`${sIdx}_${dIdx}`]?.hours || 0), 0);
    if (weekH > 40) warnings.push({ icon: "⏰", text: `${s.name} scheduled ${weekH}h — overtime applies above 40h in FL.` });
  });
  if (warnings.length === 0) warnings.push({ icon: "✅", text: `Schedule looks balanced against forecast.` });
  const wEl = document.getElementById("sched-warnings");
  if (wEl) wEl.innerHTML = warnings.slice(0, 6).map(w => `<li><span class="ins-icon">${w.icon}</span><span>${w.text}</span></li>`).join("");
}

function renderSchedChart(dailyCost) {
  const el = document.getElementById("chart-sched");
  if (!el) return;
  destroyChart("sched");
  const forecastDaily = [0.09,0.10,0.11,0.12,0.14,0.22,0.22];
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const forecast = forecastDaily.map(p => state.forecastSales * p);
  charts.sched = new Chart(el, {
    type: "bar",
    data: {
      labels: days,
      datasets: [
        { label: "Labor cost", data: dailyCost.map(v => Math.round(v)), backgroundColor: "#C9302C", borderRadius: 4 },
        { label: "Forecast sales", data: forecast.map(v => Math.round(v)), backgroundColor: "#3B6E3B", borderRadius: 4 },
      ],
    },
    options: chartOpts({ legend: true, currency: true }),
  });
}

// -----------------------------------------------------------------------------
// PHASE 2 — DBPR INSPECTION PREP
// -----------------------------------------------------------------------------
function computeInspScore() {
  let earned = 0, total = 0;
  let hpPass = 0, hpTotal = 0, intPass = 0, intTotal = 0, basicPass = 0, basicTotal = 0;
  let failHigh = 0;
  DBPR_CHECKLIST.forEach(it => {
    const w = it.sev === "high" ? 3 : it.sev === "intermediate" ? 2 : 1;
    total += w;
    const pass = state.inspChecks[it.code];
    if (pass) earned += w;
    else if (it.sev === "high") failHigh += 1;
    if (it.sev === "high") { hpTotal++; if (pass) hpPass++; }
    else if (it.sev === "intermediate") { intTotal++; if (pass) intPass++; }
    else { basicTotal++; if (pass) basicPass++; }
  });
  const pct = total ? Math.round((earned / total) * 100) : 0;
  return { pct, hpPass, hpTotal, intPass, intTotal, basicPass, basicTotal, failHigh };
}

function renderInspection() {
  const s = computeInspScore();
  const ringFg = document.getElementById("insp-ring-fg");
  const ringVal = document.getElementById("insp-score-value");
  if (ringFg) {
    const C = 327; // 2*pi*52 rounded
    ringFg.setAttribute("stroke-dashoffset", C - (C * s.pct / 100));
    ringFg.setAttribute("stroke", s.pct >= 90 ? "#6fbf73" : s.pct >= 75 ? "#E8A33D" : "#C9302C");
  }
  if (ringVal) ringVal.textContent = `${s.pct}%`;
  document.getElementById("insp-hp").textContent = `${s.hpPass}/${s.hpTotal}`;
  document.getElementById("insp-int").textContent = `${s.intPass}/${s.intTotal}`;
  document.getElementById("insp-bas").textContent = `${s.basicPass}/${s.basicTotal}`;

  // Groups
  const groupEl = document.getElementById("insp-groups");
  if (groupEl) {
    const groups = {};
    DBPR_CHECKLIST.forEach(it => {
      if (state.inspFilter === "high" && it.sev !== "high") return;
      if (state.inspFilter === "intermediate" && it.sev !== "intermediate") return;
      if (state.inspFilter === "basic" && it.sev !== "basic") return;
      if (state.inspFilter === "fail" && state.inspChecks[it.code]) return;
      (groups[it.group] ||= []).push(it);
    });
    groupEl.innerHTML = Object.entries(groups).map(([g, items]) => `
      <div class="insp-group">
        <h4>${g}</h4>
        <ul class="insp-list">${items.map(it => {
          const done = state.inspChecks[it.code];
          return `<li class="insp-item ${done ? 'done' : ''}" data-insp="${it.code}">
            <div class="check-box"></div>
            <span class="insp-code">${it.code}</span>
            <div class="insp-task">${it.task}<small>${it.detail}</small></div>
            <span class="insp-sev ${it.sev}">${it.sev === 'high' ? 'HP' : it.sev === 'intermediate' ? 'Int' : 'Basic'}</span>
          </li>`;
        }).join("")}</ul>
      </div>
    `).join("") || `<p class="muted">No items match this filter.</p>`;
  }

  // Top violations
  const topEl = document.getElementById("top-viol");
  if (topEl) topEl.innerHTML = TOP_VIOLATIONS.map(v => {
    const status = state.inspChecks[v.code];
    return `<li><strong>${v.code} · ${v.title}</strong><small>${v.desc} · ${status ? '✓ ready' : '○ check'}</small></li>`;
  }).join("");

  // Filter chip active state
  document.querySelectorAll("[data-insp-filter]").forEach(ch => {
    ch.classList.toggle("active", ch.dataset.inspFilter === state.inspFilter);
  });
}

function startMockInspection() {
  // Pick 6 random questions
  const pool = [...MOCK_INSPECTION_QUESTIONS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  state.mockSession = { questions: pool.slice(0, 6), answers: {}, idx: 0 };
  renderMockInspection();
}

function renderMockInspection() {
  const body = document.getElementById("mock-results");
  if (!body || !state.mockSession) return;
  const ms = state.mockSession;
  const done = ms.idx >= ms.questions.length;
  if (done) {
    const correct = Object.values(ms.answers).filter(a => a === "pass").length;
    const score = Math.round((correct / ms.questions.length) * 100);
    body.innerHTML = `
      <div class="mock-summary">
        <h4>Mock inspection complete — ${score}%</h4>
        <p class="muted">${correct} of ${ms.questions.length} scenarios handled correctly.</p>
        <ul class="insights" style="margin-top:10px">${ms.questions.map(q => {
          const answered = ms.answers[q.code];
          const res = MOCK_ANSWERS[q.code][answered] || "";
          return `<li><span class="ins-icon">${answered === 'pass' ? '✅' : '⚠️'}</span><span><strong>${q.code}</strong> — ${q.q}<br><span class="muted">${res}</span></span></li>`;
        }).join("")}</ul>
        <button class="btn" id="restart-mock" style="margin-top:12px">Run another</button>
      </div>
    `;
    return;
  }
  const q = ms.questions[ms.idx];
  body.innerHTML = `
    <div class="mock-q">
      <div class="q-head"><span>Question ${ms.idx + 1} of ${ms.questions.length}</span><span>Code ${q.code}</span></div>
      <div class="q-text">${q.q}</div>
      <div class="q-actions">
        <button class="q-btn" data-mock-ans="pass">Pass</button>
        <button class="q-btn" data-mock-ans="fail">Fail / violation</button>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// EVENTS
// -----------------------------------------------------------------------------
function bindEvents() {
  // Nav
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      document.querySelector(`.view[data-view="${view}"]`).classList.add("active");
      const titles = {
        overview: ["Overview", "Real-time snapshot of the business"],
        briefing: ["Weekly Briefing", "Auto-generated insights, anomalies, and focus areas"],
        costs: ["Costs & P&L", "Edit any line — totals and break-even recalculate live"],
        recipes: ["Recipe Costing", "Plate costs, food cost %, and theoretical-vs-actual variance"],
        sales: ["Sales & Menu", "Daily revenue, product mix, and menu engineering"],
        inventory: ["Inventory", "Par levels, vendor spend, and waste tracking"],
        invoices: ["Invoices & AP", "Upload invoices, OCR line items, and catch vendor price hikes"],
        labor: ["Labor", "Staff roster, wages, and shift-level efficiency"],
        scheduler: ["Shift Scheduler", "Weekly coverage with live labor-% projection"],
        clock: ["Time Clock", "Employees punch in and out with their 4-digit PIN"],
        safety: ["Food Safety", "Prep labels, temperature logs, checklists, and cleaning"],
        inspection: ["DBPR Inspection Prep", "37-point FL DBPR readiness walkthrough + mock inspection"],
        tasks: ["Task Assignments", "Daily, weekly, and monthly duties — fire, grease trap, hood vents, and more"],
        compliance: ["Licenses", "Licenses, inspections, and training status"],
        team: ["Team & Invites", "Invite teammates and manage access to this restaurant"],
      };
      const [t, s] = titles[view] || titles.overview;
      document.getElementById("view-title").textContent = t;
      document.getElementById("view-sub").textContent = s;
      // Lazy-load team data when the team view opens (avoid extra fetches during boot).
      if (view === 'team') refreshTeamView().catch(err => console.error('Team view load failed:', err));
      if (view === 'clock') resetClockToPinPad();
      // redraw charts on visibility change
      setTimeout(renderCharts, 50);
    });
  });

  // Range
  document.querySelectorAll(".seg-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.range = +b.dataset.range;
      if (state.sales30.length < state.range) state.sales30 = genSales(state.range);
      document.getElementById("rev-range-label").textContent = `Last ${state.range} days`;
      renderCharts(); saveState();
    });
  });

  // P&L inputs — delegated
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.pl) {
      state.pl[el.dataset.pl] = +el.value || 0;
      renderKPIs(); renderPL(); renderBreakEven();
      renderCharts(); saveState();
    } else if (el.dataset.menu !== undefined) {
      const idx = +el.dataset.menu, field = el.dataset.field;
      const value = +el.value || 0;
      const item = state.menu[idx];
      if (!item) return;
      state.menu[idx][field] = value;
      renderMenu(); renderCharts();
      // Persist price/cost to menu_items. `units` is UI-only (derived from POS sales later).
      if ((field === 'price' || field === 'cost') && item.id) {
        dataRepo.updateMenuItem(item.id, { [field]: value }).catch(err => {
          console.error('Menu update failed:', err);
          alert('Could not save menu change: ' + err.message);
        });
      }
    } else if (el.dataset.inv !== undefined) {
      const idx = +el.dataset.inv, field = el.dataset.field;
      const value = +el.value || 0;
      const item = state.inv[idx];
      if (!item) return;
      state.inv[idx][field] = value;
      renderInventory(); renderAlerts(); renderCompliance(); renderCharts();
      if (item.id) {
        dataRepo.updateInventoryItem(item.id, { [field]: value }).catch(err => {
          console.error('Inventory update failed:', err);
          alert('Could not save inventory change: ' + err.message);
        });
      }
    } else if (el.dataset.staff !== undefined) {
      const idx = +el.dataset.staff, field = el.dataset.field;
      const value = +el.value || 0;
      const member = state.staff[idx];
      if (!member) return;
      state.staff[idx][field] = value;
      // Keep hourly/wage aliases in sync in case other code reads either.
      if (field === 'hourly') state.staff[idx].wage = value;
      if (field === 'wage') state.staff[idx].hourly = value;
      renderStaff(); renderKPIs();
      // Only hourly wage persists to DB right now (cert/hrs fields are UI-only for now).
      if ((field === 'hourly' || field === 'wage') && member.id) {
        dataRepo.updateStaffWage(member.id, value).catch(err => {
          console.error('Staff wage update failed:', err);
          alert('Could not save wage: ' + err.message);
        });
      }
    } else if (el.dataset.temp !== undefined) {
      const idx = +el.dataset.temp;
      state.temps[idx].last = +el.value || 0;
      renderTemps(); renderAlerts(); renderCompliance(); renderHealthPill(); renderKPIs();
    } else if (el.id === "be-ticket") {
      state.beTicket = +el.value || 22;
      renderBreakEven(); saveState();
    }
  });

  document.addEventListener("click", (e) => {
    const el = e.target;
    if (el.dataset.cleanDone !== undefined) {
      const idx = +el.dataset.cleanDone;
      state.cleaning[idx].last = todayISO();
      renderCleaning(); renderAlerts(); renderCompliance(); renderHealthPill(); renderKPIs(); saveState();
    }
  });

  document.getElementById("log-temp").addEventListener("click", async () => {
    const btn = document.getElementById("log-temp");
    const orig = btn.textContent;
    btn.textContent = "Logging…";
    btn.disabled = true;
    try {
      // Persist each equipment reading to Supabase.
      await Promise.all(
        state.temps.map(t => dataRepo.logTemperature(t.equipment, t.last))
      );
      // Refresh history from DB so charts reflect real log timestamps.
      state.temps = await dataRepo.fetchTempLogs();
      renderTempChart();
      renderTemps();
      renderHealthPill();
      btn.textContent = "✓ Logged";
    } catch (err) {
      console.error('Temperature log failed:', err);
      alert('Could not log temperatures: ' + err.message);
      btn.textContent = orig;
    } finally {
      btn.disabled = false;
      setTimeout(() => { if (btn.textContent === "✓ Logged") btn.textContent = orig; }, 1500);
    }
  });

  // Waste modal
  const modal = document.getElementById("waste-modal");
  document.getElementById("add-waste").addEventListener("click", () => modal.hidden = false);
  document.getElementById("w-cancel").addEventListener("click", () => modal.hidden = true);
  document.getElementById("w-save").addEventListener("click", async () => {
    const saveBtn = document.getElementById("w-save");
    const payload = {
      item: document.getElementById("w-item").value || "Item",
      qty: +document.getElementById("w-qty").value || 0,
      reason: document.getElementById("w-reason").value,
      loss: +document.getElementById("w-loss").value || 0,
    };
    saveBtn.disabled = true;
    const origText = saveBtn.textContent;
    saveBtn.textContent = "Saving…";
    try {
      await dataRepo.logWaste(payload);
      state.waste = await dataRepo.fetchWasteLogs();
      renderWaste();
      modal.hidden = true;
      ["w-item","w-qty","w-loss"].forEach(id => document.getElementById(id).value = "");
    } catch (err) {
      console.error('Waste save failed:', err);
      alert('Could not save waste entry: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = origText;
    }
  });

  document.getElementById("reset-data").addEventListener("click", () => {
    if (confirm("Reset all dashboard data to sample values? This will clear your edits.")) {
      state = seed(); renderAll();
    }
  });

  // -------------------------------------------------------------------------
  // Phase 2 event wiring
  // -------------------------------------------------------------------------
  // Role switcher
  const roleSel = document.getElementById("role-select");
  if (roleSel) {
    roleSel.addEventListener("change", () => {
      state.role = roleSel.value;
      applyRole();
      saveState();
    });
  }

  // Inspection item toggle (delegated) — write-through to Supabase.
  document.addEventListener("click", (e) => {
    const item = e.target.closest("[data-insp]");
    if (item) {
      const code = item.dataset.insp;
      const next = !state.inspChecks[code];
      state.inspChecks[code] = next;
      renderInspection();
      renderBriefing();
      dataRepo.setInspectionCheck(code, next).catch(err => {
        console.error('Inspection toggle failed:', err);
        // Roll back UI on failure to keep state consistent with DB.
        state.inspChecks[code] = !next;
        renderInspection();
        renderBriefing();
        alert('Could not save inspection check: ' + err.message);
      });
    }
    // Filter chips
    const chip = e.target.closest("[data-insp-filter]");
    if (chip) {
      state.inspFilter = chip.dataset.inspFilter;
      renderInspection();
    }
    // Recipe selection
    const rec = e.target.closest("[data-recipe]");
    if (rec) {
      state.selectedRecipe = rec.dataset.recipe;
      renderRecipes();
    }
  });

  // Recipe input changes (delegated) — write-through to Supabase.
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.rec) {
      const r = state.recipes.find(x => x.id === el.dataset.rec);
      if (!r) return;
      const value = +el.value || 0;
      if (el.dataset.recField === "menuPrice") {
        r.menuPrice = value;
        renderRecipes();
        if (r.id) {
          dataRepo.updateRecipeMenuPrice(r.id, value).catch(err => {
            console.error('Recipe menu price update failed:', err);
            alert('Could not save menu price: ' + err.message);
          });
        }
      } else if (el.dataset.recIdx !== undefined) {
        const ing = r.ingredients[+el.dataset.recIdx];
        if (!ing) return;
        const field = el.dataset.recField; // 'qty' or 'cost'
        ing[field] = value;
        renderRecipes();
        if (ing.id) {
          dataRepo.updateRecipeIngredient(ing.id, { [field]: value }).catch(err => {
            console.error('Recipe ingredient update failed:', err);
            alert('Could not save ingredient change: ' + err.message);
          });
        }
      }
    }
  });

  // Mock inspection
  const startMock = document.getElementById("start-mock");
  if (startMock) startMock.addEventListener("click", startMockInspection);
  document.addEventListener("click", (e) => {
    const ans = e.target.closest("[data-mock-ans]");
    if (ans && state.mockSession) {
      const q = state.mockSession.questions[state.mockSession.idx];
      state.mockSession.answers[q.code] = ans.dataset.mockAns;
      state.mockSession.idx += 1;
      renderMockInspection();
    }
    if (e.target.id === "restart-mock") startMockInspection();

    // Task toggles — writes to Supabase task_completions
    const toggle = e.target.closest("[data-task-toggle]");
    if (toggle) {
      const id = toggle.dataset.taskToggle;
      toggle.disabled = true;
      tasksRepo.toggleTaskCompletion(id)
        .then(() => renderTasks())
        .catch((err) => {
          console.error('Toggle failed:', err);
          alert('Could not update task: ' + err.message);
          toggle.disabled = false;
        });
    }

    // Task assignee re-assign (click cycles through staff) — writes to Supabase
    const aBtn = e.target.closest("[data-task-assignee]");
    if (aBtn) {
      const id = aBtn.dataset.taskAssignee;
      aBtn.style.opacity = '0.5';
      tasksRepo.cycleTaskAssignee(id, state.staff || [])
        .then(() => renderTasks())
        .catch((err) => {
          console.error('Reassign failed:', err);
          alert('Could not reassign: ' + err.message);
          aBtn.style.opacity = '';
        });
    }

    // Task frequency filter
    const tf = e.target.closest("[data-tf]");
    if (tf) {
      state.taskFreq = tf.dataset.tf;
      document.querySelectorAll("[data-tf]").forEach(b => b.classList.toggle("active", b.dataset.tf === state.taskFreq));
      renderTasks();
    }

    // Task category filter
    const tc = e.target.closest("[data-tc]");
    if (tc) {
      state.taskCat = tc.dataset.tc;
      document.querySelectorAll("[data-tc]").forEach(b => b.classList.toggle("active", b.dataset.tc === state.taskCat));
      renderTasks();
    }
  });

  // Task assignee select
  const tAssignee = document.getElementById("task-assignee");
  if (tAssignee) tAssignee.addEventListener("change", (e) => {
    state.taskAssignee = e.target.value;
    renderTasks();
  });

  // Refresh briefing
  const rb = document.getElementById("refresh-brief");
  if (rb) rb.addEventListener("click", () => {
    rb.textContent = "✨ Refreshing…";
    setTimeout(() => { renderBriefing(); rb.textContent = "Refresh briefing"; }, 400);
  });

  // Scheduler cell click — quick toggle: off <-> default shift
  document.addEventListener("click", (e) => {
    const cell = e.target.closest(".sched-cell");
    if (cell && !e.target.closest("input")) {
      const sIdx = +cell.dataset.s;
      const dIdx = +cell.dataset.d;
      const key = `${sIdx}_${dIdx}`;
      if (state.schedule[key]) {
        state.schedule[key] = null;
      } else {
        // Default shift based on day (weekend = evening, weekday = lunch)
        const def = (dIdx === 5 || dIdx === 6) ? ["16:00","23:00"] : ["11:00","19:00"];
        state.schedule[key] = { start: def[0], end: def[1], hours: parseShiftHours(def[0], def[1]) };
      }
      renderScheduler();
      saveState();
    }
  });

  // --- Food Safety tabs ---
  document.querySelectorAll('#safety-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('#safety-tabs .tab-btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('.view[data-view="safety"] .tab-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.tab === tab);
      });
      if (tab === 'temps') { renderTempChart(); renderTemps(); }
      if (tab === 'labels') renderPrepLabels();
    });
  });

  // --- Prep label form submit ---
  const labelForm = document.getElementById('label-form');
  if (labelForm) {
    labelForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('lf-submit');
      const origText = submitBtn.textContent;
      const item = document.getElementById('lf-item').value.trim();
      if (!item) return;
      const prepType = document.getElementById('lf-type').value;
      const hoursRaw = document.getElementById('lf-hours').value.trim();
      const shelfHours = hoursRaw === '' ? null : Number(hoursRaw);
      const preppedBy = document.getElementById('lf-by').value.trim() || null;
      const station = document.getElementById('lf-station').value.trim() || null;
      const notes = document.getElementById('lf-notes').value.trim() || null;
      const allergens = Array.from(document.querySelectorAll('#lf-allergens input:checked')).map(i => i.value);

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      try {
        const newLabel = await dataRepo.createPrepLabel({ item, prepType, preppedBy, shelfHours, allergens, station, notes });
        state.prepLabels = [newLabel, ...state.prepLabels];
        renderPrepLabels();
        // Reset form but preserve "Prepped by" + "Station" (same person often labels many items in a row)
        document.getElementById('lf-item').value = '';
        document.getElementById('lf-hours').value = '';
        document.getElementById('lf-notes').value = '';
        document.querySelectorAll('#lf-allergens input').forEach(i => { i.checked = false; });
        submitBtn.textContent = '✓ Created';
        // Open print dialog
        printPrepLabel(newLabel);
        setTimeout(() => { submitBtn.textContent = origText; submitBtn.disabled = false; document.getElementById('lf-item').focus(); }, 800);
      } catch (err) {
        console.error('Create label failed:', err);
        alert('Could not create label: ' + err.message);
        submitBtn.textContent = origText;
        submitBtn.disabled = false;
      }
    });
  }
  const resetBtn = document.getElementById('lf-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    ['lf-item','lf-hours','lf-by','lf-station','lf-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.querySelectorAll('#lf-allergens input').forEach(i => { i.checked = false; });
    document.getElementById('lf-type').value = 'prep';
  });

  // --- Label row actions (print / used / discard) ---
  document.addEventListener('click', async (e) => {
    const printBtn = e.target.closest('[data-label-print]');
    if (printBtn) {
      const id = printBtn.dataset.labelPrint;
      const label = state.prepLabels.find(l => l.id === id);
      if (label) printPrepLabel(label);
      return;
    }
    const useBtn = e.target.closest('[data-label-use]');
    const discardBtn = e.target.closest('[data-label-discard]');
    const target = useBtn || discardBtn;
    if (!target) return;
    const id = target.dataset.labelUse || target.dataset.labelDiscard;
    const reason = useBtn ? 'Used' : 'Discarded';
    if (!confirm(`${reason === 'Used' ? 'Mark this label as used' : 'Discard this label'}?`)) return;
    try {
      const updated = await dataRepo.voidPrepLabel(id, reason);
      const idx = state.prepLabels.findIndex(l => l.id === id);
      if (idx >= 0) state.prepLabels[idx] = { ...state.prepLabels[idx], ...updated };
      renderPrepLabels();
    } catch (err) {
      console.error('Void label failed:', err);
      alert('Could not update label: ' + err.message);
    }
  });

  // --- Auto-populate shelf-life when label type changes ---
  const typeSel = document.getElementById('lf-type');
  if (typeSel) typeSel.addEventListener('change', () => {
    const hours = { prep: '', open: '', thaw: '' }[typeSel.value] ?? '';
    const hoursInput = document.getElementById('lf-hours');
    if (hoursInput) hoursInput.placeholder = typeSel.value === 'thaw' ? 'Auto (24h)' : 'Auto (72h)';
  });
}

// -----------------------------------------------------------------------------
// INVOICES & AP — render, upload, review, line matching, variance
// -----------------------------------------------------------------------------
function fmtInvDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const mo = Math.round(days / 30);
  return `${mo}mo ago`;
}

function varianceLevel(delta) {
  const abs = Math.abs(delta);
  if (abs > 0.15) return 'err';
  if (abs > 0.05) return 'warn';
  return 'ok';
}

function variancePill(v) {
  if (!v) return '<span class="muted tiny">first</span>';
  const pctStr = (v.delta * 100).toFixed(1);
  const level = varianceLevel(v.delta);
  const sign = v.delta >= 0 ? '+' : '';
  const label = level === 'ok' ? 'stable' : (v.delta > 0 ? 'up' : 'down');
  return `<span class="variance-pill ${level}" title="Prior ${fmtUSD2(v.prevPrice)} · ${fmtInvDate(v.prevAt)}">${sign}${pctStr}% ${label}</span>`;
}

function confidenceClass(c) {
  if (c >= 0.65) return 'match-confidence-high';
  if (c >= 0.35) return 'match-confidence-med';
  return 'match-confidence-low';
}

function statusPill(status) {
  const map = { draft: ['warn', 'Needs review'], reviewed: ['ok', 'Reviewed'], posted: ['neutral', 'Posted'] };
  const [cls, label] = map[status] || ['neutral', status || '—'];
  return `<span class="pill ${cls}">${label}</span>`;
}

function invoiceVarianceSummary(inv) {
  // count warn+err variance lines
  let warn = 0, err = 0;
  for (const l of inv.lines || []) {
    if (!l.variance) continue;
    const lv = varianceLevel(l.variance.delta);
    if (lv === 'warn') warn++;
    if (lv === 'err') err++;
  }
  return { warn, err };
}

function renderInvoices() {
  const invoices = state.invoices || [];

  // ---------- KPIs ----------
  const kpiEl = document.getElementById('invoices-kpis');
  if (kpiEl) {
    const unreviewed = invoices.filter((i) => i.status === 'draft').length;
    const now = Date.now();
    const thirtyAgo = now - 30 * 86400000;
    const spend30 = invoices
      .filter((i) => i.date && new Date(i.date).getTime() >= thirtyAgo)
      .reduce((a, i) => a + (Number(i.total) || 0), 0);
    let priceAlerts = 0;
    for (const i of invoices) {
      if (i.status === 'posted') continue;
      const s = invoiceVarianceSummary(i);
      priceAlerts += s.warn + s.err;
    }
    const lastUpload = invoices
      .map((i) => i.uploadedAt)
      .filter(Boolean)
      .sort()
      .pop();
    kpiEl.innerHTML = `
      <div class="kpi"><div class="kpi-label">Needs review</div><div class="kpi-value">${unreviewed}</div><div class="kpi-sub">${unreviewed === 0 ? 'All caught up' : 'draft invoices'}</div></div>
      <div class="kpi"><div class="kpi-label">Spend · last 30d</div><div class="kpi-value">${fmtUSD(spend30)}</div><div class="kpi-sub">${invoices.filter((i) => i.date && new Date(i.date).getTime() >= thirtyAgo).length} invoices</div></div>
      <div class="kpi"><div class="kpi-label">Price alerts</div><div class="kpi-value">${priceAlerts}</div><div class="kpi-sub">lines drifting &gt;5%</div></div>
      <div class="kpi"><div class="kpi-label">Last upload</div><div class="kpi-value">${lastUpload ? fmtRelAgo(lastUpload) : '—'}</div><div class="kpi-sub">${lastUpload ? fmtInvDate(lastUpload) : 'No uploads yet'}</div></div>
    `;
  }

  // ---------- nav badge ----------
  const badge = document.getElementById('invoices-badge');
  if (badge) {
    const needs = invoices.filter((i) => i.status === 'draft').length;
    if (needs > 0) { badge.textContent = needs; badge.classList.add('hot'); }
    else { badge.textContent = ''; badge.classList.remove('hot'); }
  }

  // ---------- count + list ----------
  const countEl = document.getElementById('invoices-count');
  if (countEl) countEl.textContent = `${invoices.length} on file`;

  const listEl = document.getElementById('invoice-list');
  if (listEl) {
    if (invoices.length === 0) {
      listEl.innerHTML = `<div class="empty-state muted">No invoices yet. Drop a photo or scan of a vendor invoice above — Claude will extract the line items.</div>`;
    } else {
      listEl.innerHTML = invoices.map((inv) => {
        const v = invoiceVarianceSummary(inv);
        const alertChip = v.err > 0
          ? `<span class="variance-pill err">${v.err} price jump${v.err === 1 ? '' : 's'}</span>`
          : v.warn > 0
            ? `<span class="variance-pill warn">${v.warn} drift</span>`
            : '';
        return `
          <div class="invoice-card" data-invoice-id="${inv.id}">
            <div class="invoice-card-head">
              <div>
                <div class="invoice-vendor">${escapeHtml(inv.vendor || 'Unknown vendor')}</div>
                <div class="invoice-meta muted">${escapeHtml(inv.number || 'no #')} · ${fmtInvDate(inv.date)}</div>
              </div>
              <div class="invoice-right">
                <div class="invoice-total">${fmtUSD2(inv.total)}</div>
                <div class="invoice-status-row">${statusPill(inv.status)}${alertChip ? ' ' + alertChip : ''}</div>
              </div>
            </div>
            <div class="invoice-card-foot">
              <span class="muted tiny">${(inv.lines || []).length} line${(inv.lines || []).length === 1 ? '' : 's'} · uploaded ${fmtRelAgo(inv.uploadedAt)}</span>
              <button class="btn-link" data-review-invoice="${inv.id}">Review →</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // ---------- review panel ----------
  renderInvoiceReview();
}

function renderInvoiceReview() {
  const wrap = document.getElementById('invoice-review-wrap');
  const body = document.getElementById('invoice-review-body');
  const title = document.getElementById('invoice-review-title');
  const saveBtn = document.getElementById('invoice-save');
  if (!wrap || !body) return;

  const inv = state.reviewInvoice;
  if (!inv) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  if (title) title.textContent = `Review · ${inv.vendor || 'invoice'}${inv.number ? ' · ' + inv.number : ''}`;
  if (saveBtn) saveBtn.textContent = inv.id ? 'Save as reviewed' : 'Save invoice';

  const inventory = state.inv || [];
  const invOpts = inventory.map((it) => {
    const unit = it.unit ? ` / ${it.unit}` : '';
    return `<option value="${it.id}">${escapeHtml(it.item)}${unit}</option>`;
  }).join('');

  const headerGrid = `
    <div class="form-grid review-header">
      <label><span class="lbl">Vendor</span><input type="text" data-review-field="vendor" value="${escapeHtml(inv.vendor || '')}" /></label>
      <label><span class="lbl">Invoice #</span><input type="text" data-review-field="number" value="${escapeHtml(inv.number || '')}" /></label>
      <label><span class="lbl">Date</span><input type="date" data-review-field="date" value="${inv.date || ''}" /></label>
      <label><span class="lbl">Subtotal</span><input type="number" step="0.01" data-review-field="subtotal" value="${inv.subtotal || 0}" /></label>
      <label><span class="lbl">Tax</span><input type="number" step="0.01" data-review-field="tax" value="${inv.tax || 0}" /></label>
      <label><span class="lbl">Total</span><input type="number" step="0.01" data-review-field="total" value="${inv.total || 0}" /></label>
    </div>
  `;

  const rows = (inv.lines || []).map((l, idx) => {
    const matched = l.matchedId
      ? `<option value="${l.matchedId}" selected>${escapeHtml(l.matchedName || 'matched')}</option>`
      : '';
    const confClass = confidenceClass(l.confidence);
    const confLabel = l.matchedId
      ? `<span class="${confClass}" title="Match confidence">${Math.round(l.confidence * 100)}%</span>`
      : `<span class="match-confidence-low">no match</span>`;
    const priceCell = variancePill(l.variance);
    return `
      <tr data-line-idx="${idx}">
        <td class="tight">${idx + 1}</td>
        <td>
          <div class="desc">${escapeHtml(l.desc || '')}</div>
          <div class="muted tiny">${l.qty} ${escapeHtml(l.unit || '')}</div>
        </td>
        <td class="num">${fmtUSD2(l.unitPrice)}</td>
        <td class="num">${fmtUSD2(l.extPrice)}</td>
        <td>${priceCell}</td>
        <td class="match-cell">
          <select data-match-line="${idx}" class="match-select">
            <option value="">— no match —</option>
            ${matched}
            ${invOpts}
            <option value="__new__">+ Create new SKU</option>
          </select>
          <div class="muted tiny">${confLabel}</div>
        </td>
      </tr>
    `;
  }).join('');

  body.innerHTML = `
    ${headerGrid}
    <div class="invoice-review-table-wrap">
      <table class="tbl compact invoice-review-table">
        <thead><tr><th>#</th><th>Line</th><th class="num">Unit</th><th class="num">Ext.</th><th>Variance</th><th>Match to inventory</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">No line items.</td></tr>'}</tbody>
      </table>
    </div>
  `;

  // Pre-select currently matched item in each dropdown without duplicate options.
  body.querySelectorAll('select[data-match-line]').forEach((sel) => {
    // Remove duplicate matched option that precedes invOpts if present
    const idx = +sel.dataset.matchLine;
    const line = (inv.lines || [])[idx];
    if (line && line.matchedId) {
      // Remove preceding duplicate by keeping only last occurrence
      const seen = new Set();
      [...sel.options].reverse().forEach((opt) => {
        if (seen.has(opt.value)) opt.remove();
        else seen.add(opt.value);
      });
      sel.value = line.matchedId;
    }
  });
}

// ---------- upload flow ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const idx = String(result).indexOf('base64,');
      resolve(idx >= 0 ? String(result).slice(idx + 7) : String(result));
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function setInvoiceStatus(msg, level) {
  const el = document.getElementById('invoice-status');
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ''; el.className = 'dropzone-status'; return; }
  el.hidden = false;
  el.textContent = msg;
  el.className = 'dropzone-status' + (level ? ' ' + level : '');
}

async function handleInvoiceUpload(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    setInvoiceStatus('Only image files (JPG, PNG, WEBP) are supported right now.', 'err');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setInvoiceStatus('File too large — keep under 10 MB.', 'err');
    return;
  }
  setInvoiceStatus('Reading image…');
  try {
    const b64 = await fileToBase64(file);
    setInvoiceStatus('Running Claude vision OCR…');
    const res = await dataRepo.ocrInvoice(b64, file.type);
    if (!res || !res.ok || !res.invoice) {
      const detail = res && (res.detail || res.hint || res.error) || 'OCR failed';
      throw new Error(detail);
    }
    const extracted = res.invoice;
    setInvoiceStatus('Matching line items to inventory…');
    const inventory = state.inv || [];
    const lines = (extracted.lines || []).map((l, i) => {
      const desc = l.description || l.desc || '';
      const matches = dataRepo.matchLine(desc, inventory);
      const top = Array.isArray(matches) ? matches[0] : matches;
      const accept = top && top.score >= 0.35; // below 0.35 feels like a guess
      return {
        lineIndex: i,
        desc,
        qty: Number(l.qty) || 0,
        unit: l.unit || '',
        unitPrice: Number(l.unit_price ?? l.unitPrice) || 0,
        extPrice: Number(l.extended_price ?? l.extPrice) || ((Number(l.qty) || 0) * (Number(l.unit_price) || 0)),
        matchedId: accept ? top.id : null,
        matchedName: accept ? top.name : null,
        confidence: accept ? top.score : 0,
        createdNewSku: false,
        variance: null,
      };
    });
    state.reviewInvoice = {
      id: null,
      vendor: extracted.vendor || '',
      number: extracted.invoice_number || '',
      date: extracted.invoice_date || new Date().toISOString().slice(0, 10),
      subtotal: Number(extracted.subtotal) || 0,
      tax: Number(extracted.tax) || 0,
      total: Number(extracted.total) || lines.reduce((a, l) => a + l.extPrice, 0),
      status: 'draft',
      uploadedAt: new Date().toISOString(),
      lines,
      ocrRaw: extracted,
      notes: '',
    };
    setInvoiceStatus('Done — review the extracted lines below.', 'ok');
    renderInvoiceReview();
    // Scroll review into view
    const wrap = document.getElementById('invoice-review-wrap');
    wrap?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error('[invoice upload]', err);
    setInvoiceStatus('OCR failed: ' + (err?.message || err), 'err');
  }
}

async function openInvoiceForReview(invoiceId) {
  const inv = (state.invoices || []).find((i) => i.id === invoiceId);
  if (!inv) return;
  // Clone so edits don't mutate state until saved
  state.reviewInvoice = JSON.parse(JSON.stringify(inv));
  renderInvoiceReview();
  document.getElementById('invoice-review-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveReviewInvoice() {
  const inv = state.reviewInvoice;
  if (!inv) return;
  const saveBtn = document.getElementById('invoice-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  try {
    const payload = { ...inv, status: 'reviewed' };
    const saved = await dataRepo.saveInvoice(payload);
    // Refresh full list to pull in variance + history rows
    state.invoices = await dataRepo.fetchInvoices({ limit: 100 });
    state.reviewInvoice = null;
    const flaggedCount = saved?.variance?.flagged_count || 0;
    if (flaggedCount > 0) {
      const top = saved.variance.flagged?.[0];
      const pct = top ? `${(top.variance_pct * 100).toFixed(0)}%` : '';
      setInvoiceStatus(
        `Saved. ⚠️ ${flaggedCount} line${flaggedCount === 1 ? '' : 's'} priced >15% above 4-week avg${top ? ` (top: "${top.description?.slice(0, 40) || ''}" +${pct})` : ''} — alert sent.`,
        'warn',
      );
    } else {
      setInvoiceStatus('Saved.', 'ok');
    }
    renderAll();
  } catch (err) {
    console.error('[save invoice]', err);
    alert('Save failed: ' + (err?.message || err));
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save as reviewed'; }
  }
}

function cancelReviewInvoice() {
  state.reviewInvoice = null;
  setInvoiceStatus('');
  renderInvoiceReview();
}

function bindInvoiceEvents() {
  const dz = document.getElementById('invoice-dropzone');
  const file = document.getElementById('invoice-file');
  const browse = document.getElementById('invoice-browse');

  if (dz && file) {
    dz.addEventListener('click', (e) => {
      if (e.target.id === 'invoice-browse') return; // handled below
      file.click();
    });
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); }
    });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); dz.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag');
    }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) handleInvoiceUpload(f);
    });
  }
  if (file) {
    file.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) handleInvoiceUpload(f);
      e.target.value = '';
    });
  }
  if (browse) {
    browse.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); file?.click(); });
  }

  // Review list delegation (invoice list "Review →" buttons)
  document.addEventListener('click', (e) => {
    const rv = e.target.closest('[data-review-invoice]');
    if (rv) {
      e.preventDefault();
      openInvoiceForReview(rv.dataset.reviewInvoice);
    }
  });

  // Cancel / save
  document.getElementById('invoice-cancel')?.addEventListener('click', cancelReviewInvoice);
  document.getElementById('invoice-save')?.addEventListener('click', saveReviewInvoice);

  // Review panel inputs (delegated)
  document.addEventListener('input', (e) => {
    if (!state.reviewInvoice) return;
    const f = e.target.closest('[data-review-field]');
    if (f) {
      const key = f.dataset.reviewField;
      const val = f.type === 'number' ? Number(f.value) : f.value;
      state.reviewInvoice[key] = val;
    }
  });
  document.addEventListener('change', (e) => {
    if (!state.reviewInvoice) return;
    const sel = e.target.closest('select[data-match-line]');
    if (!sel) return;
    const idx = +sel.dataset.matchLine;
    const line = state.reviewInvoice.lines[idx];
    if (!line) return;
    if (sel.value === '__new__') {
      const name = prompt('Create new inventory SKU from:', line.desc);
      if (!name) { sel.value = line.matchedId || ''; return; }
      line.matchedName = name;
      line.matchedId = null; // saved as null + createdNewSku true; dataRepo can create on save
      line.createdNewSku = true;
      line.confidence = 1;
    } else if (sel.value === '') {
      line.matchedId = null;
      line.matchedName = null;
      line.confidence = 0;
      line.createdNewSku = false;
    } else {
      const it = (state.inv || []).find((i) => i.id === sel.value);
      line.matchedId = sel.value;
      line.matchedName = it ? it.item : null;
      line.confidence = 1; // manual confirm
      line.createdNewSku = false;
    }
    renderInvoiceReview();
  });
}

// -----------------------------------------------------------------------------
// TASK ASSIGNMENTS
// -----------------------------------------------------------------------------
// Tasks module is fully Supabase-backed. Data is fetched once on first render
// and cached in tasksRepo; subsequent calls use the cache. Mutations refresh.
let _tasksLoaded = false;
async function renderTasks() {
  const section = document.querySelector('.view[data-view="tasks"]');
  if (!section) return;

  // First render: fetch from Supabase. Show a subtle loading state.
  if (!_tasksLoaded) {
    const container = document.getElementById("task-groups");
    if (container) container.innerHTML = `<div class="card empty-card"><p class="muted">Loading tasks…</p></div>`;
    try {
      await tasksRepo.refreshTasks();
      _tasksLoaded = true;
    } catch (err) {
      console.error('Failed to load tasks:', err);
      if (container) container.innerHTML = `<div class="card empty-card"><p class="muted" style="color:#e8a39a">Could not load tasks: ${err.message}</p></div>`;
      return;
    }
  }

  const TASKS = tasksRepo.getTasks();
  const RECS = tasksRepo.getRecs();

  // Build assignee list from schedule staff + Vendor
  const assigneeSelect = document.getElementById("task-assignee");
  if (assigneeSelect && assigneeSelect.options.length <= 1) {
    const names = Array.from(new Set(state.staff.map(s => s.name).concat(["Vendor"])));
    names.forEach(n => {
      const o = document.createElement("option");
      o.value = n; o.textContent = n;
      assigneeSelect.appendChild(o);
    });
  }

  // KPI counts
  const counts = { daily: { total: 0, done: 0 }, weekly: { total: 0, done: 0 }, monthly: { total: 0, done: 0 }, overdue: 0 };
  TASKS.forEach(t => {
    const rec = RECS[t.id];
    const st = taskStatus(t, rec);
    if (st === "overdue") counts.overdue += 1;
    if (t.freq === "daily") { counts.daily.total += 1; if (st === "done-today") counts.daily.done += 1; }
    if (t.freq === "weekly") { counts.weekly.total += 1; if (st !== "overdue") counts.weekly.done += 1; }
    if (t.freq === "monthly") { counts.monthly.total += 1; if (st !== "overdue") counts.monthly.done += 1; }
  });
  document.getElementById("tk-today").textContent = `${counts.daily.done}/${counts.daily.total}`;
  document.getElementById("tk-today-sub").textContent = counts.daily.done === counts.daily.total ? "All done" : `${counts.daily.total - counts.daily.done} remaining`;
  document.getElementById("tk-week").textContent = `${counts.weekly.done}/${counts.weekly.total}`;
  document.getElementById("tk-week-sub").textContent = `${counts.weekly.total - counts.weekly.done} due this week`;
  document.getElementById("tk-month").textContent = `${counts.monthly.done}/${counts.monthly.total}`;
  document.getElementById("tk-month-sub").textContent = `${counts.monthly.total - counts.monthly.done} due this month`;
  document.getElementById("tk-overdue").textContent = counts.overdue;

  // Sidebar badge
  const badge = document.getElementById("tasks-badge");
  if (badge) {
    if (counts.overdue > 0) { badge.textContent = counts.overdue; badge.classList.add("hot"); }
    else { badge.textContent = ""; badge.classList.remove("hot"); }
  }

  // Filter tasks
  let list = TASKS.filter(t => {
    if (state.taskFreq !== "all" && t.freq !== state.taskFreq) return false;
    if (state.taskCat !== "all" && t.category !== state.taskCat) return false;
    if (state.taskAssignee !== "all") {
      const rec = RECS[t.id];
      if (!rec || rec.assignee !== state.taskAssignee) return false;
    }
    return true;
  });

  // Sort: overdue first, then critical, then by freq
  const freqOrder = { daily: 0, weekly: 1, monthly: 2, quarterly: 3, annual: 4 };
  const sevOrder = { critical: 0, important: 1, routine: 2 };
  list.sort((a, b) => {
    const sa = taskStatus(a, RECS[a.id]);
    const sb = taskStatus(b, RECS[b.id]);
    const overdueA = sa === "overdue" ? 0 : 1;
    const overdueB = sb === "overdue" ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    if (sevOrder[a.sev] !== sevOrder[b.sev]) return sevOrder[a.sev] - sevOrder[b.sev];
    return freqOrder[a.freq] - freqOrder[b.freq];
  });

  // Group by frequency
  const container = document.getElementById("task-groups");
  if (!container) return;
  const groups = {};
  list.forEach(t => { (groups[t.freq] ||= []).push(t); });

  const freqLabels = {
    daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual"
  };
  const freqSubtitles = {
    daily: "Open → service → close cadence",
    weekly: "Run these on the calm day of the week",
    monthly: "Book vendors, sign tags, refresh logs",
    quarterly: "Seasonal audits & semi-annual services",
    annual: "License renewals & big-ticket contracts"
  };

  let html = "";
  if (list.length === 0) {
    html = `<div class="card empty-card"><p class="muted">No tasks match the current filters.</p></div>`;
  } else {
    ["daily", "weekly", "monthly", "quarterly", "annual"].forEach(f => {
      if (!groups[f]) return;
      html += `<div class="task-group">
        <div class="task-group-head">
          <div><h3>${freqLabels[f]} <span class="muted" style="font-weight:400;font-size:14px">· ${groups[f].length}</span></h3><p class="muted small">${freqSubtitles[f]}</p></div>
        </div>
        <div class="task-list">`;
      groups[f].forEach(t => {
        const rec = RECS[t.id] || {};
        const st = taskStatus(t, rec);
        const statusLabel = st === "done-today" ? "✓ Done today" : st === "overdue" ? "Overdue" : "Due";
        const statusClass = st === "done-today" ? "done" : st === "overdue" ? "overdue" : "due";
        const lastDoneTxt = rec.lastDone ? `Last: ${new Date(rec.lastDone).toLocaleDateString("en-US", {month: "short", day: "numeric"})}` : "Never logged";
        const vendorBadge = t.vendor ? `<span class="vendor-pill">VENDOR</span>` : "";
        const estTxt = t.est > 0 ? `${t.est}m` : "—";
        html += `<div class="task-row ${statusClass}" data-task-id="${t.id}">
          <button class="task-check ${st === "done-today" ? "checked" : ""}" data-task-toggle="${t.id}" aria-label="Mark done">${st === "done-today" ? "✓" : ""}</button>
          <div class="task-body">
            <div class="task-title-row">
              <span class="task-title">${t.title}</span>
              <span class="sev-pill sev-${t.sev}">${t.sev}</span>
              <span class="cat-pill">${t.category}</span>
              ${vendorBadge}
            </div>
            <p class="task-detail muted">${t.detail}</p>
            <div class="task-meta">
              <span class="task-assignee" data-task-assignee="${t.id}">👤 ${rec.assignee || "Unassigned"}</span>
              <span class="task-est">⏱ ${estTxt}</span>
              <span class="task-last">${lastDoneTxt}</span>
              <span class="task-status ${statusClass}">${statusLabel}</span>
            </div>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    });
  }
  container.innerHTML = html;
}

// Today label
function setToday() {
  const d = new Date();
  document.getElementById("today-label").textContent = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// -----------------------------------------------------------------------------
// INIT — waits for the auth guard in index.html to fire 'restops:ready'
// -----------------------------------------------------------------------------
async function bootApp() {
  setToday();

  // Load tenant context (session, tenant, role) BEFORE applying any
  // role-gated UI. Role drives sidebar visibility, the View-as widget,
  // staff-only Time Clock locking, etc.
  let ctx = null;
  try {
    const tc = await import('./tenantContext.js');
    ctx = await tc.loadTenantContext();
    // Sync the in-memory state.role with the user's actual membership role.
    // 'owner' | 'manager' | 'staff'. Owner-only tooling reads state.role too,
    // so this is the single source of truth for the app's permission checks.
    if (ctx?.role) {
      state.role = ctx.role;
      applyRole();
    }
  } catch (e) {
    console.warn('Tenant context load failed:', e);
  }

  // Show demo banner if the current session was created via the demo auto-signin.
  try {
    const isDemo = ctx?.user?.email === 'demo@bellavita.app';
    if (isDemo) {
      const banner = document.getElementById('demo-banner');
      if (banner) banner.hidden = false;
    }
    if (ctx?.profile?.is_platform_owner) {
      const plink = document.getElementById('platform-link');
      if (plink) plink.hidden = false;
    }

    // Hide the "Reset sample data" footer button for any non-demo tenant
    // (it only makes sense on the demo tenant; for real tenants it's a
    // dangerous footgun that would wipe their actual data).
    const isDemoTenantBoot = ctx?.tenant?.id === 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72'
      || ctx?.user?.email === 'demo@bellavita.app';
    const resetBtn = document.getElementById('reset-data');
    if (resetBtn && !isDemoTenantBoot) resetBtn.style.display = 'none';

    // Billing: status banner + read-only enforcement + Billing tab UI.
    // Runs in the background — must not block boot.
    if (ctx?.tenant?.id) {
      import('./billingView.js')
        .then(mod => mod.initBilling(ctx))
        .catch(e => console.warn('billing init failed', e));
    }

    // Alerts inbox + bell — initialize for all real tenants and demo.
    if (ctx?.tenant?.id && ctx?.user?.id) {
      import('./alertsView.js')
        .then(mod => mod.initAlerts({ tenantId: ctx.tenant.id, user: ctx.user }))
        .catch(e => console.warn('alerts init failed', e));
    }

    // POS integrations (Toast + Square) — owners/managers only.
    if (ctx?.tenant?.id && (ctx?.role === 'owner' || ctx?.role === 'manager')) {
      import('./posIntegrationsView.js')
        .then(mod => mod.initPosIntegrations({ tenantId: ctx.tenant.id }))
        .catch(e => console.warn('pos integrations init failed', e));
    }

    // Smart Scheduler — sales-by-hour forecast + coverage suggestion.
    if (ctx?.tenant?.id) {
      import('./smartScheduler.js')
        .then(mod => mod.initSmartScheduler({ tenantId: ctx.tenant.id }))
        .catch(e => console.warn('smart scheduler init failed', e));
    }

    // Granular role permissions — apply hidden views for non-owners,
    // and render the settings UI inside Team view for owners.
    if (ctx?.tenant?.id) {
      import('./rolePermissions.js')
        .then(async (mod) => {
          if (ctx.role !== 'owner') {
            const hidden = await mod.loadMyHiddenViews(ctx.tenant.id);
            mod.applyHiddenViews(hidden);
          } else {
            await mod.initRolePermissionsUI({ tenantId: ctx.tenant.id, role: ctx.role });
          }
        })
        .catch(e => console.warn('role permissions init failed', e));
    }

    // Trial countdown banner — shown to real (non-demo) trialing tenants.
    if (!isDemo && ctx?.tenant?.subscription_status === 'trialing' && ctx?.tenant?.trial_ends_at) {
      const banner = document.getElementById('trial-banner');
      const textEl = document.getElementById('trial-banner-text');
      if (banner && textEl) {
        const msLeft = new Date(ctx.tenant.trial_ends_at) - Date.now();
        const daysLeft = Math.ceil(msLeft / 86400000);
        const tenantName = ctx.tenant?.name || 'your restaurant';
        if (daysLeft > 1) {
          textEl.innerHTML = `<strong>${daysLeft} days left</strong> in your free trial of Stationly for <strong>${tenantName}</strong>. No card required until you're ready.`;
        } else if (daysLeft === 1) {
          textEl.innerHTML = `<strong>1 day left</strong> in your free trial. Add billing to keep your data flowing.`;
          banner.classList.add('trial-banner-warn');
        } else if (daysLeft === 0) {
          textEl.innerHTML = `Your free trial ends <strong>today</strong>. Add billing to avoid interruption.`;
          banner.classList.add('trial-banner-warn');
        } else {
          textEl.innerHTML = `Your free trial has ended. Add billing to restore full access.`;
          banner.classList.add('trial-banner-warn');
        }
        banner.hidden = false;
      }
    }
  } catch (_) { /* non-fatal */ }

  // Hydrate state from Supabase (replaces the mock SAMPLE.* where possible).
  // For modules that have no rows yet, auto-seed from SAMPLE so a brand-new
  // tenant sees a working dashboard on first load.
  try {
    const [
      staff, temps, waste, inspChecks, licenses, inspHistory,
      menu, inv, recipes, sales, prepLabels, invoices,
    ] = await Promise.all([
      dataRepo.fetchStaff(),
      dataRepo.fetchTempLogs(),
      dataRepo.fetchWasteLogs(),
      dataRepo.fetchInspectionChecks(),
      dataRepo.fetchLicenses(),
      dataRepo.fetchInspectionHistory(),
      dataRepo.fetchMenu(),
      dataRepo.fetchInventory(),
      dataRepo.fetchRecipes(),
      dataRepo.fetchDailySales(30),
      dataRepo.fetchPrepLabels({ includeVoided: true }),
      dataRepo.fetchInvoices({ limit: 100 }),
    ]);
    state.staff = staff;
    state.temps = temps;
    state.waste = waste;
    state.inspChecks = inspChecks;
    state.licenses = licenses;
    state.prepLabels = prepLabels;
    state.invoices = invoices || [];
    if (inspHistory.length > 0) {
      state.inspections = inspHistory.map(h => ({
        date: h.date, type: 'Routine', violations: h.violations, high: 0, result: 'Met',
      }));
    } else {
      // No history logged yet — don't show fake inspections from SAMPLE.
      state.inspections = [];
    }

    // Determine whether this is the public demo tenant. ONLY the demo tenant
    // gets sample-data auto-seeding; real tenants start empty so owners only
    // see what they (or their staff) have actually entered or imported.
    const DEMO_TENANT_ID = 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72';
    const isDemoTenant = ctx?.tenant?.id === DEMO_TENANT_ID
      || ctx?.user?.email === 'demo@bellavita.app';

    if (isDemoTenant) {
      // Demo tenant: seed any missing modules from SAMPLE so visitors see a
      // working dashboard. Idempotent — each helper no-ops if rows exist.
      state.menu    = menu.length    > 0 ? menu    : await dataRepo.seedMenuFromSample(SAMPLE.menu);
      state.inv     = inv.length     > 0 ? inv     : await dataRepo.seedInventoryFromSample(SAMPLE.inv);
      state.recipes = recipes.length > 0 ? recipes : await dataRepo.seedRecipesFromSample(SAMPLE_RECIPES);
      state.sales30 = sales.length   > 0 ? sales   : await dataRepo.seedDailySalesFromSample(state.sales30);
    } else {
      // Real tenant: zero data unless they've created/imported it themselves.
      state.menu    = menu;
      state.inv     = inv;
      state.recipes = recipes;
      state.sales30 = sales;
      // P&L is hardcoded from SAMPLE.pl in seed() — zero it out for real tenants
      // until P&L import or manual entry replaces it. Keeps the schema shape
      // intact so renderers don't crash, but every value reads $0 / 0%.
      state.pl = Object.fromEntries(Object.keys(state.pl || {}).map(k => [k, 0]));
      // Same for hardcoded staff/temps/checklist/cleaning/licenses that came
      // from seed(). Real data comes from Supabase fetches above; if those
      // returned empty arrays (already assigned), good. The remaining fields
      // were set from SAMPLE during initial seed() and need clearing.
      state.checklist = (state.checklist || []).map(c => ({ ...c, done: false }));
      // staff/temps/waste/licenses are already overwritten above with real fetches.
      // checklist/cleaning are local-state operational checklists, kept as templates.
      state.forecastSales = 0;
      state.beTicket = 0;
    }
    // selectedRecipe was initialised to 'r1' (sample id). Switch to the first real recipe
    // so recipe detail renders without needing the user to click.
    if (state.recipes.length > 0) state.selectedRecipe = state.recipes[0].id;
  } catch (err) {
    console.error('Failed to hydrate state from Supabase:', err);
    alert('Could not load your data: ' + err.message);
  }

  bindEvents();
  bindInvoiceEvents();
  bindTeamView();
  bindClockEvents();
  bindPublishEvents();
  renderAll();
  window.__restopsBooted = true;
  // Dev-only debug hook so Playwright QA can inspect state.
  window.__restopsState = state;
  window.__restopsRepos = { dataRepo, tasksRepo, invitesRepo };
}

// -----------------------------------------------------------------------------
// TEAM & INVITES VIEW
// -----------------------------------------------------------------------------
function bindTeamView() {
  const role = window.__RESTOPS_CTX__?.role;
  const canInvite = role === 'owner' || role === 'manager';
  const gate = document.getElementById('team-invite-gate');
  const locked = document.getElementById('team-invite-locked');
  if (!canInvite) {
    if (gate) gate.hidden = true;
    if (locked) locked.hidden = false;
  }

  // Owner-only notification health check
  const notifCard = document.getElementById('notif-health-card');
  const notifBtn = document.getElementById('notif-test-btn');
  const notifMsg = document.getElementById('notif-test-msg');
  if (notifCard && role === 'owner') {
    notifCard.hidden = false;
    if (notifBtn && !notifBtn.dataset.bound) {
      notifBtn.dataset.bound = '1';
      notifBtn.addEventListener('click', async () => {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session) {
          notifMsg.textContent = 'Sign in first.';
          return;
        }
        notifBtn.disabled = true;
        notifBtn.textContent = 'Sending…';
        notifMsg.textContent = '';
        try {
          const url = 'https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/notify';
          const r = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + session.access_token,
            },
            body: JSON.stringify({
              type: 'test',
              note: 'Test from ' + (window.__RESTOPS_CTX__?.user?.email || 'unknown'),
            }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.ok) {
            notifMsg.textContent = '✓ Test email sent. Check your inbox in ~30 seconds.';
            notifMsg.style.color = 'var(--ok, #2e7d32)';
          } else {
            notifMsg.textContent = 'Failed: ' + (j.message || j.error || ('HTTP ' + r.status));
            notifMsg.style.color = 'var(--danger, #c9302c)';
          }
        } catch (err) {
          notifMsg.textContent = 'Failed: ' + (err.message || err);
          notifMsg.style.color = 'var(--danger, #c9302c)';
        } finally {
          notifBtn.disabled = false;
          notifBtn.textContent = 'Send test email';
        }
      });
    }
  }

  const form = document.getElementById('invite-form');
  if (form && canInvite) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('invite-submit');
      const msg = document.getElementById('invite-form-msg');
      const email = document.getElementById('invite-email').value.trim();
      const roleSel = document.getElementById('invite-role').value;
      msg.hidden = true;
      msg.classList.remove('ok', 'err');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const inv = await invitesRepo.createInvite({ email, role: roleSel });
        msg.classList.add('ok');
        msg.innerHTML = `Invite created. Share this link with <strong>${escapeHtml(email)}</strong>: <code>${escapeHtml(inv.link)}</code>`;
        msg.hidden = false;
        document.getElementById('invite-email').value = '';
        await refreshTeamView();
      } catch (err) {
        msg.classList.add('err');
        msg.textContent = err.message || 'Could not send invite.';
        msg.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send invite';
      }
    });
  }

  // Delegated click handlers for invite rows (revoke / copy).
  document.getElementById('team-invites-table')?.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.matches('.invite-revoke')) {
      const id = t.dataset.id;
      if (!id || !confirm('Revoke this invite?')) return;
      try {
        await invitesRepo.revokeInvite(id);
        await refreshTeamView();
      } catch (err) {
        alert('Could not revoke: ' + err.message);
      }
    } else if (t.matches('.invite-copy')) {
      const link = t.dataset.link;
      try {
        await navigator.clipboard.writeText(link);
        const orig = t.textContent;
        t.textContent = 'Copied';
        setTimeout(() => { t.textContent = orig; }, 1200);
      } catch (err) {
        // Fallback: just select the text so the user can copy manually
        const row = t.closest('tr');
        const code = row?.querySelector('code');
        if (code) {
          const r = document.createRange();
          r.selectNodeContents(code);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    }
  });
}

async function refreshTeamView() {
  const ctx = window.__RESTOPS_CTX__;
  // Members
  const { data: members, error: memErr } = await (await import('./supabaseClient.js')).supabase
    .from('memberships')
    .select('id, role, created_at, user_id')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: true });
  const tbody = document.querySelector('#team-members-table tbody');
  tbody.innerHTML = '';
  if (memErr) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Error loading members: ${escapeHtml(memErr.message)}</td></tr>`;
  } else {
    for (const m of (members || [])) {
      // We can't query auth.users directly from the client, so show a short user id
      // unless this member is the current user.
      const isMe = m.user_id === ctx.user.id;
      const displayEmail = isMe ? ctx.user.email : shortId(m.user_id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(displayEmail)}${isMe ? ' <span class="invite-chip-inline">you</span>' : ''}</td>
        <td><span class="invite-chip-inline">${escapeHtml(m.role)}</span></td>
        <td class="muted">${new Date(m.created_at).toLocaleDateString()}</td>`;
      tbody.appendChild(tr);
    }
    document.getElementById('team-member-count').textContent =
      `${members?.length || 0} member${members?.length === 1 ? '' : 's'}`;
  }

  // Pending invites
  const role = ctx.role;
  const canSeeInvites = role === 'owner' || role === 'manager';
  const invTable = document.getElementById('team-invites-table');
  const invEmpty = document.getElementById('team-invites-empty');
  if (!canSeeInvites) {
    invTable.hidden = true;
    invEmpty.textContent = 'Only managers and owners can see pending invites.';
    invEmpty.hidden = false;
    return;
  }
  invTable.hidden = false;
  let invites = [];
  try {
    invites = await invitesRepo.listInvites({ includeAccepted: false });
  } catch (err) {
    console.error('listInvites failed:', err);
  }
  const ib = invTable.querySelector('tbody');
  ib.innerHTML = '';
  if (!invites.length) {
    invEmpty.hidden = false;
    invEmpty.textContent = 'No pending invites.';
    document.getElementById('team-invite-count').textContent = '0 pending';
    return;
  }
  invEmpty.hidden = true;
  document.getElementById('team-invite-count').textContent =
    `${invites.length} pending`;
  for (const inv of invites) {
    const tr = document.createElement('tr');
    const exp = new Date(inv.expires_at);
    const expLabel = inv.expired ? 'Expired' : exp.toLocaleDateString();
    tr.innerHTML = `
      <td>${escapeHtml(inv.email)}</td>
      <td><span class="invite-chip-inline">${escapeHtml(inv.role)}</span></td>
      <td class="${inv.expired ? 'warn' : 'muted'}">${expLabel}</td>
      <td><code class="invite-link-code">${escapeHtml(inv.link)}</code>
          <button class="chip invite-copy" data-link="${escapeHtml(inv.link)}">Copy</button></td>
      <td><button class="chip invite-revoke" data-id="${inv.id}">Revoke</button></td>`;
    ib.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function shortId(id) { return id ? `user ${id.slice(0, 8)}…` : '—'; }

// -----------------------------------------------------------------------------
// TIME CLOCK (tablet mode) — PIN pad + clock in/out
// -----------------------------------------------------------------------------
const clockState = {
  entry: '',
  employee: null,
  activeShift: null,
  timerId: null,
  wallClockId: null,
  autoResetId: null,
};

function resetClockToPinPad() {
  clockState.entry = '';
  clockState.employee = null;
  clockState.activeShift = null;
  if (clockState.timerId) { clearInterval(clockState.timerId); clockState.timerId = null; }
  if (clockState.autoResetId) { clearTimeout(clockState.autoResetId); clockState.autoResetId = null; }
  const pinWrap = document.getElementById('clock-pin-wrap');
  const cardWrap = document.getElementById('clock-card-wrap');
  if (pinWrap) pinWrap.hidden = false;
  if (cardWrap) cardWrap.hidden = true;
  updatePinDots();
  const label = document.getElementById('pin-label');
  if (label) { label.textContent = 'Enter your 4-digit PIN'; label.classList.remove('pin-err'); }
  // Brand name
  const brandName = window.__RESTOPS_CTX__?.tenant?.name;
  const bn = document.getElementById('clock-brand-name');
  if (bn && brandName) bn.textContent = brandName;
  startWallClock();
}

function startWallClock() {
  if (clockState.wallClockId) return;
  const tick = () => {
    const el = document.getElementById('clock-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  tick();
  clockState.wallClockId = setInterval(tick, 30000);
}

function updatePinDots() {
  const dots = document.querySelectorAll('#pin-dots .pin-dot');
  dots.forEach((d, i) => d.classList.toggle('filled', i < clockState.entry.length));
}

async function handlePinDigit(digit) {
  if (clockState.entry.length >= 4) return;
  clockState.entry += digit;
  updatePinDots();
  if (clockState.entry.length === 4) {
    const pin = clockState.entry;
    const label = document.getElementById('pin-label');
    if (label) label.textContent = 'Checking…';
    try {
      const emp = await clockRepo.verifyPin(pin);
      if (!emp) {
        if (label) { label.textContent = 'Incorrect PIN'; label.classList.add('pin-err'); }
        clockState.entry = '';
        setTimeout(() => {
          updatePinDots();
          if (label) { label.textContent = 'Enter your 4-digit PIN'; label.classList.remove('pin-err'); }
        }, 1200);
        return;
      }
      await showEmployeeCard(emp);
    } catch (err) {
      console.error('PIN verify failed:', err);
      if (label) { label.textContent = 'Could not verify — try again'; label.classList.add('pin-err'); }
      clockState.entry = '';
      setTimeout(() => {
        updatePinDots();
        if (label) { label.textContent = 'Enter your 4-digit PIN'; label.classList.remove('pin-err'); }
      }, 1800);
    }
  }
}

async function showEmployeeCard(emp) {
  clockState.employee = emp;
  const pinWrap = document.getElementById('clock-pin-wrap');
  const cardWrap = document.getElementById('clock-card-wrap');
  if (pinWrap) pinWrap.hidden = true;
  if (cardWrap) cardWrap.hidden = false;
  document.getElementById('emp-avatar').textContent = (emp.name || '?').charAt(0).toUpperCase();
  document.getElementById('emp-name').textContent = emp.name || 'Employee';
  document.getElementById('emp-role').textContent = (emp.role || '').replace(/_/g, ' ');

  // Check active shift
  try {
    const active = await clockRepo.getActiveShift(emp.id);
    clockState.activeShift = active;
    renderClockCardState();
  } catch (err) {
    console.error('getActiveShift failed:', err);
    document.getElementById('emp-status').textContent = 'Ready to clock in';
    renderClockCardState();
  }
}

function renderClockCardState() {
  const status = document.getElementById('emp-status');
  const timerEl = document.getElementById('emp-timer');
  const btn = document.getElementById('clock-action-btn');
  if (!btn || !status || !timerEl) return;
  if (clockState.activeShift) {
    status.textContent = `On the clock since ${new Date(clockState.activeShift.clock_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    timerEl.hidden = false;
    btn.textContent = 'Clock Out';
    btn.classList.remove('clock-in');
    btn.classList.add('clock-out');
    startShiftTimer();
  } else {
    status.textContent = 'Ready to clock in';
    timerEl.hidden = true;
    btn.textContent = 'Clock In';
    btn.classList.remove('clock-out');
    btn.classList.add('clock-in');
    if (clockState.timerId) { clearInterval(clockState.timerId); clockState.timerId = null; }
  }
}

function startShiftTimer() {
  if (clockState.timerId) clearInterval(clockState.timerId);
  const tick = () => {
    const el = document.getElementById('emp-timer');
    if (!el || !clockState.activeShift) return;
    const ms = Date.now() - new Date(clockState.activeShift.clock_in_at).getTime();
    const secs = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  tick();
  clockState.timerId = setInterval(tick, 1000);
}

async function handleClockAction() {
  const btn = document.getElementById('clock-action-btn');
  if (!btn || !clockState.employee) return;
  btn.disabled = true;
  const status = document.getElementById('emp-status');
  try {
    if (clockState.activeShift) {
      // Clock out
      await clockRepo.clockOut(clockState.activeShift.id, 0);
      const startAt = new Date(clockState.activeShift.clock_in_at);
      const hrs = ((Date.now() - startAt.getTime()) / 3600000).toFixed(2);
      if (status) status.textContent = `Clocked out — ${hrs} hours. Good work!`;
      clockState.activeShift = null;
    } else {
      // Clock in
      const entry = await clockRepo.clockIn(clockState.employee.id, clockState.employee.hourly_rate || 0);
      clockState.activeShift = entry;
      if (status) status.textContent = `Clocked in at ${new Date(entry.clock_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Have a great shift!`;
    }
    renderClockCardState();
    // Auto return to PIN pad after 5s
    if (clockState.autoResetId) clearTimeout(clockState.autoResetId);
    clockState.autoResetId = setTimeout(resetClockToPinPad, 5000);
  } catch (err) {
    console.error('Clock action failed:', err);
    if (status) status.textContent = `Error: ${err.message || 'try again'}`;
  } finally {
    btn.disabled = false;
  }
}

function bindClockEvents() {
  const pad = document.getElementById('pin-pad');
  if (pad) {
    pad.addEventListener('click', (e) => {
      const btn = e.target.closest('.pin-key');
      if (!btn) return;
      const digit = btn.dataset.digit;
      const action = btn.dataset.action;
      if (digit !== undefined) handlePinDigit(digit);
      else if (action === 'back') { clockState.entry = clockState.entry.slice(0, -1); updatePinDots(); }
      else if (action === 'clear') { clockState.entry = ''; updatePinDots(); }
    });
  }
  const actionBtn = document.getElementById('clock-action-btn');
  if (actionBtn) actionBtn.addEventListener('click', handleClockAction);
  const backBtn = document.getElementById('clock-back-btn');
  if (backBtn) backBtn.addEventListener('click', resetClockToPinPad);
  // Keyboard PIN entry when on the clock view
  document.addEventListener('keydown', (e) => {
    const clockViewActive = document.querySelector('.view[data-view="clock"].active');
    if (!clockViewActive) return;
    const pinWrap = document.getElementById('clock-pin-wrap');
    if (!pinWrap || pinWrap.hidden) return;
    if (/^\d$/.test(e.key)) { handlePinDigit(e.key); }
    else if (e.key === 'Backspace') { clockState.entry = clockState.entry.slice(0, -1); updatePinDots(); }
  });
}

// -----------------------------------------------------------------------------
// PUBLISH SCHEDULE (SMS) — build preview messages, invoke send-schedule-sms
// -----------------------------------------------------------------------------
function formatShiftDay(weekStartISO, dayIdx) {
  const d = new Date(weekStartISO);
  d.setDate(d.getDate() + dayIdx);
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayIdx];
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${dayName} ${md}`;
}

function buildScheduleMessages() {
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const weekStartISO = weekStart.toISOString().slice(0, 10);
  const tenantName = window.__RESTOPS_CTX__?.tenant?.name || 'Your team';

  const messages = [];
  const allShifts = [];
  state.staff.forEach((s, sIdx) => {
    const lines = [];
    for (let d = 0; d < 7; d++) {
      const sh = state.schedule[`${sIdx}_${d}`];
      const dayLabel = formatShiftDay(weekStartISO, d);
      if (sh) {
        lines.push(`${dayLabel}: ${sh.start}–${sh.end} (${sh.hours}h)`);
        allShifts.push({ staff_id: s.id, staff_name: s.name, day: d, start: sh.start, end: sh.end, hours: sh.hours });
      } else {
        lines.push(`${dayLabel}: off`);
      }
    }
    const hasAny = lines.some((l) => !l.endsWith(': off'));
    const body = `Hey ${s.name.split(' ')[0]} — your shifts for the week of ${formatShiftDay(weekStartISO, 0)}:\n` +
      lines.join('\n') +
      `\n\nQuestions? Just reply.\n— ${tenantName}`;
    messages.push({
      staff_id: s.id,
      name: s.name,
      phone: s.phone || '',
      body,
      hasShifts: hasAny,
    });
  });
  return { weekStartISO, messages, allShifts };
}

function openPublishModal() {
  const modal = document.getElementById('publish-modal');
  const list = document.getElementById('publish-preview-list');
  const label = document.getElementById('publish-week-label');
  if (!modal || !list) return;
  const { weekStartISO, messages } = buildScheduleMessages();
  if (label) {
    const ws = new Date(weekStartISO);
    const we = new Date(weekStartISO); we.setDate(we.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    label.textContent = `Week of ${fmt(ws)} — ${fmt(we)}`;
  }
  list.innerHTML = messages.map((m) => {
    const hasPhone = !!m.phone;
    const chip = hasPhone
      ? `<span class="pill ok">${escapeHtml(m.phone)}</span>`
      : `<span class="pill warn">No phone on file</span>`;
    const dim = !hasPhone || !m.hasShifts;
    return `
      <div class="publish-row ${dim ? 'dim' : ''}">
        <div class="publish-row-head">
          <div><strong>${escapeHtml(m.name)}</strong></div>
          ${chip}
        </div>
        <pre class="publish-body">${escapeHtml(m.body)}</pre>
      </div>`;
  }).join('');
  const sendable = messages.filter((m) => m.phone && m.hasShifts).length;
  const skipped = messages.length - sendable;
  const statusEl = document.getElementById('publish-status');
  if (statusEl) statusEl.textContent = `${sendable} to send · ${skipped} skipped`;
  modal.hidden = false;
  // Stash on modal for the send handler
  modal.dataset.weekStart = weekStartISO;
  modal._payload = { weekStartISO, messages };
}

function closePublishModal() {
  const modal = document.getElementById('publish-modal');
  if (modal) modal.hidden = true;
}

async function sendScheduleNow() {
  const modal = document.getElementById('publish-modal');
  const sendBtn = document.getElementById('publish-send');
  const statusEl = document.getElementById('publish-status');
  if (!modal || !sendBtn) return;
  const payload = modal._payload;
  if (!payload) return;
  const toSend = payload.messages.filter((m) => m.phone && m.hasShifts);
  if (toSend.length === 0) {
    statusEl.textContent = 'Nothing to send — no staff have phone numbers and shifts.';
    return;
  }
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  statusEl.textContent = '';
  try {
    const { weekStartISO, messages } = payload;
    const { allShifts } = buildScheduleMessages();
    const result = await clockRepo.publishSchedule({
      weekStart: weekStartISO,
      shifts: allShifts,
      messages: toSend,
    });
    const sent = (result.deliveryResults || []).filter((r) => r.status === 'sent' || r.status === 'preview').length;
    const failed = (result.deliveryResults || []).filter((r) => r.status === 'failed').length;
    if (result.deliveryStatus === 'preview') {
      statusEl.innerHTML = `<span class="pill warn">Preview only</span> Twilio not configured yet — ${sent} messages generated.`;
      sendBtn.textContent = 'Close';
      sendBtn.disabled = false;
      sendBtn.onclick = () => { closePublishModal(); sendBtn.onclick = null; sendBtn.textContent = 'Send texts'; };
    } else if (failed > 0) {
      statusEl.textContent = `⚠️ Sent ${sent}, ${failed} failed. Check Edge Function logs.`;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send texts';
    } else {
      statusEl.textContent = `✓ Sent ${sent} text${sent === 1 ? '' : 's'}.`;
      setTimeout(closePublishModal, 1500);
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send texts';
    }
  } catch (err) {
    console.error('Publish schedule failed:', err);
    statusEl.textContent = `Error: ${err.message || 'could not publish'}`;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send texts';
  }
}

function bindPublishEvents() {
  const btn = document.getElementById('publish-schedule-btn');
  if (btn) btn.addEventListener('click', openPublishModal);
  const closeBtn = document.getElementById('publish-close');
  const cancelBtn = document.getElementById('publish-cancel');
  const sendBtn = document.getElementById('publish-send');
  if (closeBtn) closeBtn.addEventListener('click', closePublishModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closePublishModal);
  if (sendBtn) sendBtn.addEventListener('click', sendScheduleNow);
  // Click outside modal body closes
  const backdrop = document.getElementById('publish-modal');
  if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePublishModal(); });
}

if (window.__RESTOPS_CTX__) {
  // Guard already finished before app.js loaded
  bootApp();
} else {
  window.addEventListener('restops:ready', bootApp, { once: true });
}
