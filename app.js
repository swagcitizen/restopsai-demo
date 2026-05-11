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
import * as locationsRepo from './locationsRepo.js';
import * as transfersRepo from './transfersRepo.js';
import * as countsRepo from './countsRepo.js';
import * as varianceRepo from './varianceRepo.js';
import * as payrollRepo from './payrollRepo.js';
import * as tipPoolRepo from './tipPoolRepo.js';
import * as vendorsRepo from './vendorsRepo.js';
import * as billsRepo from './billsRepo.js';
import * as barPoursRepo from './barPoursRepo.js';
import * as activationRepo from './activationRepo.js';
import { getCurrentLocationId, setCurrentLocationId } from './tenantContext.js';
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
    locations: [],
    transfers: [],
    transferTab: 'outgoing',
    transferDraft: null, // { fromLocationId, toLocationId, lines: [...] }
    // Triple Release state
    invCat: 'all',
    invSub: 'items',
    barPours: [],
    barStatus: [],
    bills: [],
    billsAging: [],
    vendors: [],
    billsFilter: '',
    billsSub: 'bills',
    payPeriods: [],
    selectedPayPeriod: null,
    payRunLines: [],
    tipEntries: [],
    payrollSub: 'periods',
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
// Chart.js is loaded with `defer` for faster FCP, so it may not be ready at module-parse time.
// Apply defaults lazily inside ensureChartDefaults(), called from renderCharts() before any new Chart().
let __chartDefaultsApplied = false;
function ensureChartDefaults() {
  if (__chartDefaultsApplied || typeof Chart === "undefined") return;
  Chart.defaults.color = CHART_DEFAULTS.color;
  Chart.defaults.borderColor = CHART_DEFAULTS.borderColor;
  Chart.defaults.font.family = CHART_DEFAULTS.font.family;
  Chart.defaults.font.size = CHART_DEFAULTS.font.size;
  __chartDefaultsApplied = true;
}

const CHART_COLORS = ["#E8A33D", "#C9302C", "#3B6E3B", "#D7B26A", "#8D6E4B", "#6B8EAE", "#A87CA0", "#C08D3F"];

const charts = {};
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function renderAll() {
  ensureChartDefaults();
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
    const menuSample = m.isSample ? `<span class="sample-pill" title="Sample data">SAMPLE</span>` : '';
    tr.innerHTML = `
      <td>${escapeHtml(m.name)}${menuSample}</td>
      <td><input type="number" step="0.01" value="${m.price}" data-menu="${idx}" data-field="price"/></td>
      <td><input type="number" step="0.01" value="${m.cost}" data-menu="${idx}" data-field="cost"/></td>
      <td>${fmtUSD2(margin)}</td>
      <td>${pct(marginPct)}</td>
      <td><input type="number" value="${m.units}" data-menu="${idx}" data-field="units"/></td>
      <td>${fmtUSD(rev)}</td>
      <td><span class="cls-${cls.key}">${cls.cls}</span></td>
      <td>${m.id ? `<button class="row-del" data-menu-del="${m.id}" title="Delete">×</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderInventory() {
  const tbody = document.getElementById("inv-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  const cat = state.invCat || 'all';
  const filtered = state.inv.filter((i) => {
    if (cat === 'all') return true;
    return (i.category || 'food') === cat;
  });
  filtered.forEach((i, idx) => {
    const value = i.onHand * i.cost;
    const belowPar = i.onHand < i.par;
    const critical = i.onHand <= i.reorder;
    const status = critical ? `<span class="pill err">Reorder now</span>` : belowPar ? `<span class="pill warn">Below par</span>` : `<span class="pill ok">OK</span>`;
    const catSlug = (i.category || 'food');
    const catBadge = `<span class="cat-badge cat-${catSlug.replace('/','-')}">${escapeHtml(catLabel(catSlug))}</span>`;
    // Use the index in state.inv (not the filtered list) so data-inv stays stable.
    const realIdx = state.inv.indexOf(i);
    const tr = document.createElement("tr");
    const sampleTag = i.isSample ? `<span class="sample-pill" title="Sample data">SAMPLE</span>` : '';
    tr.innerHTML = `
      <td data-label="Item">${escapeHtml(i.item)}${sampleTag}</td>
      <td data-label="Cat">${catBadge}</td>
      <td data-label="Unit">${escapeHtml(i.unit)}</td>
      <td data-label="On hand"><input type="number" inputmode="decimal" step="0.1" value="${i.onHand}" data-inv="${realIdx}" data-field="onHand"/></td>
      <td data-label="Par">${i.par}</td>
      <td data-label="Reorder">${i.reorder}</td>
      <td data-label="Cost/unit">${fmtUSD2(i.cost)}</td>
      <td data-label="Value">${fmtUSD2(value)}</td>
      <td data-label="Vendor">${escapeHtml(i.vendor)}</td>
      <td data-label="Status">${status}</td>
      <td data-label="">${i.id ? `<button class="row-del" data-inv-del="${i.id}" title="Delete">×</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function catLabel(c) {
  const map = { food: 'Food', beer: 'Beer', wine: 'Wine', spirits: 'Spirits', 'n/a_beverage': 'N/A', dry_goods: 'Dry', smallwares: 'Wares', other: 'Other' };
  return map[c] || c;
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
    const staffSample = s.isSample ? `<span class="sample-pill" title="Sample data">SAMPLE</span>` : '';
    tr.innerHTML = `
      <td>${escapeHtml(s.name)}${staffSample}</td>
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
        <input type="number" inputmode="decimal" pattern="[0-9.\\-]*" step="0.5" value="${t.last}" data-temp="${idx}"/>
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
        <div class="r-name">${r.name}${r.isSample ? ' <span class="sample-pill" title="Sample data">SAMPLE</span>' : ''}</div>
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
  if (!r) {
    const body = document.getElementById("recipe-body");
    if (body) body.innerHTML = `<p class="muted">No recipes yet — click <strong>+ Add recipe</strong> to create your first plate cost.</p>`;
    return;
  }
  document.getElementById("recipe-title").textContent = r.name;
  document.getElementById("recipe-yield").textContent = `${fmtUSD2(r.menuPrice)} menu · yield ${r.yield}`;
  const cost = recipeCost(r);
  const margin = recipeMarginPct(r);
  const fp = recipeFoodPct(r);
  // Color code per brief: <30% green, 30-35% yellow, >35% red.
  const fpClass = fp < 30 ? 'good' : fp <= 35 ? 'mid' : 'bad';
  const body = document.getElementById("recipe-body");
  body.innerHTML = `
    <div class="rec-stats">
      <div><span class="muted">Plate cost</span><strong>${fmtUSD2(cost/r.yield)}</strong></div>
      <div><span class="muted">Menu price</span><strong>${fmtUSD2(r.menuPrice)}</strong></div>
      <div><span class="muted">Food cost %</span><strong class="${fpClass}">${fp.toFixed(1)}%</strong></div>
      <div><span class="muted">Gross margin</span><strong>${margin.toFixed(1)}%</strong></div>
    </div>
    <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
      <button class="btn" id="add-ingredient" data-recipe-id="${r.id}" data-write-action>+ Add ingredient</button>
      <button class="ghost-btn" id="delete-recipe" data-recipe-id="${r.id}" data-write-action style="color:#c9302c;border-color:#c9302c">Delete recipe</button>
    </div>
    <table class="tbl compact rec-ing">
      <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Unit cost</th><th>Ext. cost</th><th></th></tr></thead>
      <tbody>${r.ingredients.map((i, idx) => `
        <tr>
          <td>${escapeHtml(i.item)}</td>
          <td><input type="number" step="0.01" data-rec="${r.id}" data-rec-idx="${idx}" data-rec-field="qty" value="${i.qty}" /></td>
          <td>${escapeHtml(i.unit)}</td>
          <td><input type="number" step="0.01" data-rec="${r.id}" data-rec-idx="${idx}" data-rec-field="cost" value="${i.cost}" /></td>
          <td class="mono">${fmtUSD2(i.qty * i.cost)}</td>
          <td>${i.id ? `<button class="row-del" data-ing-del="${i.id}" data-recipe-id="${r.id}" title="Remove">×</button>` : ''}</td>
        </tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right"><strong>Total batch cost</strong></td><td class="mono"><strong>${fmtUSD2(cost)}</strong></td><td></td></tr></tfoot>
    </table>
    <label class="rec-price">Menu price <input type="number" step="0.01" data-rec="${r.id}" data-rec-field="menuPrice" value="${r.menuPrice}" /></label>
  `;
}

function renderVarianceLegacy() {
  // Theoretical food cost: from recipes weighted by menu units sold in SAMPLE.menu
  // Actual food cost: from P&L cogs
  // (Superseded by async renderVariance below; kept for reference, no longer wired.)
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
  ensureChartDefaults();
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
// ACTIVATION CHECKLIST + SAMPLE-DATA BANNER
//
// Both UI elements live in app.html above the topbar so they appear on every
// tab (not just Overview). The activation panel reads from v_activation_status
// and per-user dismissals; it auto-hides at 100% complete or when the user
// clicks "Don't show again". The sample-data banner is shown whenever any
// is_sample=true row exists for the tenant; clearing it calls the
// clear_sample_data RPC.
// -----------------------------------------------------------------------------
const HIDE_FOR_NOW_KEY = 'stationly:activation:hideForNow';

async function detectSampleData() {
  const c = window.__RESTOPS_CTX__;
  if (!c?.tenantId) return false;
  // Three quick HEAD-style queries so we don't pull rows. Any one match wins.
  const tables = ['inventory_items', 'menu_items', 'invoices'];
  for (const t of tables) {
    try {
      const { count, error } = await supabase
        .from(t)
        .select('id', { count: 'exact', head: true })
        .eq('is_sample', true)
        .limit(1);
      if (error) { console.warn('sample probe', t, error); continue; }
      if ((count || 0) > 0) return true;
    } catch (e) { console.warn('sample probe failed', t, e); }
  }
  return false;
}

async function refreshSampleBanner() {
  const banner = document.getElementById('sample-data-banner');
  if (!banner) return;
  const has = await detectSampleData();
  banner.hidden = !has;
}

async function clearSampleData() {
  const c = window.__RESTOPS_CTX__;
  if (!c?.tenantId) return;
  const btn = document.getElementById('sample-banner-clear');
  if (btn) { btn.disabled = true; btn.textContent = 'Clearing…'; }
  try {
    const { error } = await supabase.rpc('clear_sample_data', { p_tenant_id: c.tenantId });
    if (error) throw error;
    // Re-fetch the affected datasets so the UI drops the SAMPLE rows immediately.
    const [staff, menu, inv, recipes, invoices, temps] = await Promise.all([
      dataRepo.fetchStaff(),
      dataRepo.fetchMenu(),
      dataRepo.fetchInventory(),
      dataRepo.fetchRecipes(),
      dataRepo.fetchInvoices({ limit: 100 }),
      dataRepo.fetchTempLogs(),
    ]);
    state.staff = staff; state.menu = menu; state.inv = inv; state.recipes = recipes;
    state.invoices = invoices; state.temps = temps;
    renderAll();
    await refreshSampleBanner();
    await renderActivationChecklist();
  } catch (e) {
    console.error('clear_sample_data failed:', e);
    alert('Could not clear sample data: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Clear and start fresh'; }
  }
}

async function renderActivationChecklist() {
  const panel = document.getElementById('activation-checklist');
  if (!panel) return;
  const c = window.__RESTOPS_CTX__;
  if (!c?.tenantId) { panel.hidden = true; return; }

  // "Hide for now" is a session/local preference — not a DB write.
  let hideForNow = false;
  try { hideForNow = sessionStorage.getItem(HIDE_FOR_NOW_KEY) === '1'; } catch (_) {}

  let tasks = [];
  try { tasks = await activationRepo.getStatus(); }
  catch (e) { console.warn('activation getStatus failed', e); panel.hidden = true; return; }

  const visible = tasks.filter(t => !t.dismissed);
  const completed = visible.filter(t => t.complete).length;
  const total = visible.length;

  // Hide entirely when nothing left to show, when 100% complete, or for the session.
  if (hideForNow || total === 0 || completed === total) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  document.getElementById('activation-progress-text').textContent =
    `${completed} of ${total} complete · keep going to get full value out of Stationly`;
  document.getElementById('activation-progress-fill').style.width =
    `${Math.round((completed / total) * 100)}%`;

  const list = document.getElementById('activation-list');
  list.innerHTML = visible.map(t => `
    <li class="activation-item ${t.complete ? 'is-complete' : ''}" data-task-key="${t.key}">
      <span class="activation-item-icon" aria-hidden="true">${t.icon}</span>
      <span class="activation-item-label">${escapeHtml(t.label)}</span>
      ${t.complete
        ? `<span class="activation-item-check" aria-label="Complete">✓</span>`
        : `<button type="button" class="activation-item-action" data-task-open="${t.key}" data-task-view="${t.view}" data-task-modal="${t.modalId || ''}">Open</button>`}
    </li>`).join('');
}

function wireActivationEvents() {
  // "Open" buttons jump to the relevant tab and (when defined) open the add-modal.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-task-open]');
    if (btn) {
      const view = btn.dataset.taskView;
      const modal = btn.dataset.taskModal;
      const navBtn = document.querySelector(`.nav-item[data-view="${view}"]`);
      if (navBtn) navBtn.click();
      if (modal) setTimeout(() => {
        const el = document.getElementById(modal);
        if (el) el.hidden = false;
      }, 80);
      return;
    }
  });

  const toggle = document.getElementById('activation-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const panel = document.getElementById('activation-checklist');
      if (!panel) return;
      const collapsed = panel.classList.toggle('is-collapsed');
      toggle.textContent = collapsed ? 'Show' : 'Hide';
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  }

  const dismissBtn = document.getElementById('activation-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', async () => {
      try { sessionStorage.setItem(HIDE_FOR_NOW_KEY, '1'); } catch (_) {}
      try { await activationRepo.dismissAll(); } catch (e) { console.warn(e); }
      const panel = document.getElementById('activation-checklist');
      if (panel) panel.hidden = true;
    });
  }

  const clearBtn = document.getElementById('sample-banner-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearSampleData);
}

// -----------------------------------------------------------------------------
// MOBILE NAV DRAWER
// -----------------------------------------------------------------------------
function setupMobileNav() {
  const drawerList = document.getElementById('mobile-nav-list');
  if (!drawerList || drawerList.dataset.populated === '1') return;
  // Clone every .nav-section / .nav-item from the desktop sidebar into the drawer.
  // Cloned .nav-item buttons keep their data-view, so the existing click
  // handler bound below will pick them up alongside the originals.
  const sourceNav = document.querySelector('.sidebar .nav');
  if (!sourceNav) return;
  Array.from(sourceNav.children).forEach(child => {
    const clone = child.cloneNode(true);
    drawerList.appendChild(clone);
  });
  drawerList.dataset.populated = '1';

  // Open / close wiring
  const drawer = document.getElementById('mobile-nav-drawer');
  const backdrop = document.getElementById('mobile-nav-backdrop');
  const openBtn = document.getElementById('mobile-menu-btn');
  const closeBtn = document.getElementById('mobile-nav-close');
  if (openBtn) openBtn.addEventListener('click', openMobileDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeMobileDrawer);
  if (backdrop) backdrop.addEventListener('click', closeMobileDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer?.dataset.open === 'true') closeMobileDrawer();
  });
  // Mobile alerts bell button: route to alerts view (existing nav-item handler
  // listens via .nav-item; this <button> has data-view but isn't .nav-item, so
  // wire it directly).
  const alertsBtn = document.getElementById('mobile-alerts-btn');
  if (alertsBtn) {
    alertsBtn.addEventListener('click', () => {
      const target = document.querySelector('.sidebar .nav-item[data-view="alerts"]');
      if (target) target.click();
    });
  }
}
function openMobileDrawer() {
  const drawer = document.getElementById('mobile-nav-drawer');
  const backdrop = document.getElementById('mobile-nav-backdrop');
  const btn = document.getElementById('mobile-menu-btn');
  if (!drawer) return;
  drawer.dataset.open = 'true';
  drawer.setAttribute('aria-hidden', 'false');
  if (backdrop) { backdrop.hidden = false; backdrop.dataset.open = 'true'; }
  if (btn) btn.setAttribute('aria-expanded', 'true');
  try { sessionStorage.setItem('mobile-drawer-open', '1'); } catch (_) {}
}
function closeMobileDrawer() {
  const drawer = document.getElementById('mobile-nav-drawer');
  const backdrop = document.getElementById('mobile-nav-backdrop');
  const btn = document.getElementById('mobile-menu-btn');
  if (!drawer || drawer.dataset.open !== 'true') return;
  drawer.dataset.open = 'false';
  drawer.setAttribute('aria-hidden', 'true');
  if (backdrop) { backdrop.dataset.open = 'false'; setTimeout(() => { backdrop.hidden = true; }, 220); }
  if (btn) btn.setAttribute('aria-expanded', 'false');
  try { sessionStorage.removeItem('mobile-drawer-open'); } catch (_) {}
}

// -----------------------------------------------------------------------------
// EVENTS
// -----------------------------------------------------------------------------
function bindEvents() {
  // Mobile drawer: clone the desktop nav into the drawer once on first run.
  setupMobileNav();

  // Nav
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      // Update active state across BOTH desktop sidebar and mobile drawer
      // copies (matched by data-view) so they stay in sync.
      document.querySelectorAll(".nav-item").forEach(b => {
        b.classList.toggle("active", b.dataset.view === view);
      });
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      document.querySelector(`.view[data-view="${view}"]`).classList.add("active");
      // Close drawer (if open) when any nav item is tapped.
      closeMobileDrawer();
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
        locations: ["Locations", "Manage your physical locations and the commissary kitchen"],
        commissary: ["Commissary", "Move prepped batches and inventory between locations"],
        variance: ["Variance", "Theoretical-vs-actual usage from counts, recipes, and POS — drill into every item"],
        bills: ["Bill Pay", "Approve, schedule, and record vendor payments — workflow + audit trail"],
        receipts: ["Receipts", "Upload, scan, and track vendor receipts — OCR-ready when Document AI is configured"],
        payroll: ["Payroll", "Pay periods, OT, and CSV export to Gusto / ADP / Paychex"],
      };
      const [t, s] = titles[view] || titles.overview;
      document.getElementById("view-title").textContent = t;
      document.getElementById("view-sub").textContent = s;
      // Mirror the active tab title into the mobile topbar.
      const _mobTitle = document.getElementById('mobile-topbar-title');
      if (_mobTitle) _mobTitle.textContent = t;
      // Lazy-load team data when the team view opens (avoid extra fetches during boot).
      if (view === 'team') refreshTeamView().catch(err => console.error('Team view load failed:', err));
      if (view === 'clock') resetClockToPinPad();
      if (view === 'variance') renderVariance().catch(err => console.error('Variance load failed:', err));
      if (view === 'bills') renderBills().catch(err => console.error('Bills load failed:', err));
      if (view === 'receipts' && window.__receiptsInited) window.__receiptsRefresh && window.__receiptsRefresh();
      if (view === 'reports') window.__inspectionsInit && window.__inspectionsInit();
      if (view === 'payroll') renderPayroll().catch(err => console.error('Payroll load failed:', err));
      if (view === 'inventory') {
        const isBarPane = document.querySelector('.inv-pane[data-inv-pane="bar"]:not([hidden])');
        if (isBarPane) renderBarDashboard().catch(err => console.error('Bar dashboard load failed:', err));
      }
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

  // ---------------------------------------------------------------------------
  // Tenant CRUD modals (menu / inventory / recipes / custom tasks)
  // ---------------------------------------------------------------------------
  function _show(id) { const el = document.getElementById(id); if (el) el.hidden = false; }
  function _hide(id) { const el = document.getElementById(id); if (el) el.hidden = true; }
  function _val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function _num(id) { const v = _val(id); return v === '' ? null : (+v || 0); }
  function _clear(ids) { ids.forEach(id => { const el = document.getElementById(id); if (el) { if (el.tagName === 'SELECT') el.selectedIndex = 0; else el.value = ''; } }); }

  // Menu item add
  const addMenuBtn = document.getElementById("add-menu-item");
  if (addMenuBtn) addMenuBtn.addEventListener("click", () => _show("menu-modal"));
  const miCancel = document.getElementById("mi-cancel");
  if (miCancel) miCancel.addEventListener("click", () => _hide("menu-modal"));
  const miSave = document.getElementById("mi-save");
  if (miSave) miSave.addEventListener("click", async () => {
    const name = _val("mi-name").trim();
    if (!name) { alert("Name required"); return; }
    const payload = {
      name,
      category: _val("mi-cat").trim() || "Other",
      menuPrice: _num("mi-price") || 0,
      foodCost: _num("mi-cost") || 0,
    };
    miSave.disabled = true; const o = miSave.textContent; miSave.textContent = "Saving…";
    try {
      await dataRepo.addMenuItem(payload);
      state.menu = await dataRepo.fetchMenu();
      renderMenu();
      _hide("menu-modal");
      _clear(["mi-name","mi-cat","mi-price","mi-cost"]);
    } catch (err) { console.error(err); alert("Could not save menu item: " + err.message); }
    finally { miSave.disabled = false; miSave.textContent = o; }
  });

  // Inventory item add
  const addInvBtn = document.getElementById("add-inv-item");
  if (addInvBtn) addInvBtn.addEventListener("click", () => _show("inv-modal"));
  const iiCancel = document.getElementById("ii-cancel");
  if (iiCancel) iiCancel.addEventListener("click", () => _hide("inv-modal"));
  // Toggle bar fields visibility based on category select
  const iiCat = document.getElementById("ii-category");
  if (iiCat) {
    const updateBarFields = () => {
      const cat = iiCat.value;
      const isBar = ['beer','wine','spirits','n/a_beverage'].includes(cat);
      const wrap = document.getElementById('ii-bar-fields');
      if (wrap) wrap.hidden = !isBar;
    };
    iiCat.addEventListener('change', updateBarFields);
    // Initialize on first open
    if (addInvBtn) addInvBtn.addEventListener('click', updateBarFields);
  }
  const iiSave = document.getElementById("ii-save");
  if (iiSave) iiSave.addEventListener("click", async () => {
    const name = _val("ii-name").trim();
    if (!name) { alert("Name required"); return; }
    const category = _val("ii-category") || 'food';
    const isBar = ['beer','wine','spirits','n/a_beverage'].includes(category);
    const payload = {
      name,
      unit: _val("ii-unit").trim() || "unit",
      onHand: _num("ii-onhand") || 0,
      par: _num("ii-par") || 0,
      cost: _num("ii-cost") || 0,
      vendor: _val("ii-vendor").trim() || null,
      category,
    };
    if (isBar) {
      const ml = _num("ii-bottle-ml");
      const yieldOz = _num("ii-yield-oz");
      const abv = _num("ii-abv");
      payload.bottleSizeMl = ml || null;
      payload.unitYieldOz = yieldOz || null;
      payload.abv = abv || null;
      payload.vendorSku = _val("ii-vendor-sku").trim() || null;
      payload.upc = _val("ii-upc").trim() || null;
      payload.binLocation = _val("ii-bin").trim() || null;
    }
    iiSave.disabled = true; const o = iiSave.textContent; iiSave.textContent = "Saving…";
    try {
      await dataRepo.addInventoryItem(payload);
      state.inv = await dataRepo.fetchInventory();
      renderInventory();
      // If bar pane is active, refresh bar dashboard too
      const isBarPane = document.querySelector('.inv-pane[data-inv-pane="bar"]:not([hidden])');
      if (isBarPane) renderBarDashboard().catch(() => {});
      _hide("inv-modal");
      _clear(["ii-name","ii-unit","ii-onhand","ii-par","ii-cost","ii-vendor","ii-bottle-ml","ii-yield-oz","ii-abv","ii-vendor-sku","ii-upc","ii-bin"]);
    } catch (err) { console.error(err); alert("Could not save inventory item: " + err.message); }
    finally { iiSave.disabled = false; iiSave.textContent = o; }
  });

  // Recipe add
  const addRecBtn = document.getElementById("add-recipe");
  if (addRecBtn) addRecBtn.addEventListener("click", () => {
    // Populate menu link select
    const sel = document.getElementById("rc-menu-link");
    if (sel) {
      sel.innerHTML = '<option value="">— None —</option>' +
        (state.menu || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    }
    _show("recipe-modal");
  });
  const rcCancel = document.getElementById("rc-cancel");
  if (rcCancel) rcCancel.addEventListener("click", () => _hide("recipe-modal"));
  const rcSave = document.getElementById("rc-save");
  if (rcSave) rcSave.addEventListener("click", async () => {
    const name = _val("rc-name").trim();
    if (!name) { alert("Recipe name required"); return; }
    const payload = {
      name,
      yield: _num("rc-yield") || 1,
      menuPrice: _num("rc-price") || 0,
      linkedMenuItemId: _val("rc-menu-link") || null,
    };
    rcSave.disabled = true; const o = rcSave.textContent; rcSave.textContent = "Saving…";
    try {
      const createdId = await dataRepo.addRecipe(payload);
      state.recipes = await dataRepo.fetchRecipes();
      if (typeof createdId === 'string' && createdId) state.selectedRecipe = createdId;
      else if (createdId && createdId.id) state.selectedRecipe = createdId.id;
      else if (state.recipes.length) state.selectedRecipe = state.recipes[state.recipes.length - 1].id;
      renderRecipes();
      _hide("recipe-modal");
      _clear(["rc-name","rc-price"]);
      const yEl = document.getElementById("rc-yield"); if (yEl) yEl.value = "1";
    } catch (err) { console.error(err); alert("Could not save recipe: " + err.message); }
    finally { rcSave.disabled = false; rcSave.textContent = o; }
  });

  // Recipe ingredient add — handler delegated since #add-ingredient is rendered dynamically
  document.addEventListener("click", (e) => {
    const addIngBtn = e.target.closest("#add-ingredient");
    if (addIngBtn) {
      const sel = document.getElementById("ig-pick");
      if (sel) {
        sel.innerHTML = '<option value="">— Free text below —</option>' +
          (state.inv || []).map(i => `<option value="${i.id}" data-name="${(i.name||'').replace(/"/g,'&quot;')}" data-unit="${i.unit||''}" data-cost="${i.cost||0}">${i.name}</option>`).join('');
      }
      _clear(["ig-name","ig-qty","ig-unit","ig-cost"]);
      _show("ing-modal");
    }
    const delRecBtn = e.target.closest("#delete-recipe");
    if (delRecBtn) {
      const rid = delRecBtn.dataset.recipeId || state.selectedRecipe;
      if (rid && confirm("Delete this recipe?")) {
        delRecBtn.disabled = true;
        dataRepo.deleteRecipe(rid)
          .then(async () => {
            state.recipes = await dataRepo.fetchRecipes();
            state.selectedRecipe = state.recipes[0]?.id || null;
            renderRecipes();
          })
          .catch(err => { console.error(err); alert("Could not delete recipe: " + err.message); delRecBtn.disabled = false; });
      }
    }
  });
  // Auto-populate ingredient fields when picking from inventory
  const igPick = document.getElementById("ig-pick");
  if (igPick) igPick.addEventListener("change", () => {
    const opt = igPick.selectedOptions[0];
    if (opt && opt.value) {
      document.getElementById("ig-name").value = opt.dataset.name || "";
      document.getElementById("ig-unit").value = opt.dataset.unit || "";
      document.getElementById("ig-cost").value = opt.dataset.cost || "";
    }
  });
  const igCancel = document.getElementById("ig-cancel");
  if (igCancel) igCancel.addEventListener("click", () => _hide("ing-modal"));
  const igSave = document.getElementById("ig-save");
  if (igSave) igSave.addEventListener("click", async () => {
    const recipeId = state.selectedRecipe;
    if (!recipeId) { alert("Select a recipe first"); return; }
    const name = _val("ig-name").trim();
    if (!name) { alert("Ingredient name required"); return; }
    const pourOzVal = _num("ig-pour-oz");
    const payload = {
      name,
      qty: _num("ig-qty") || 0,
      unit: _val("ig-unit").trim() || "unit",
      cost: _num("ig-cost") || 0,
      pourOz: pourOzVal > 0 ? pourOzVal : null,
    };
    igSave.disabled = true; const o = igSave.textContent; igSave.textContent = "Saving…";
    try {
      await dataRepo.addRecipeIngredient(recipeId, payload);
      state.recipes = await dataRepo.fetchRecipes();
      renderRecipes();
      _hide("ing-modal");
      _clear(["ig-pick","ig-name","ig-qty","ig-unit","ig-cost","ig-pour-oz"]);
    } catch (err) { console.error(err); alert("Could not add ingredient: " + err.message); }
    finally { igSave.disabled = false; igSave.textContent = o; }
  });

  // Custom task add
  const addTaskBtn = document.getElementById("add-custom-task");
  if (addTaskBtn) addTaskBtn.addEventListener("click", () => {
    const sel = document.getElementById("ct-assignee");
    if (sel) {
      sel.innerHTML = '<option value="">— Unassigned —</option>' +
        (state.staff || []).filter(s => s.active !== false).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }
    _show("task-modal");
  });
  const ctCancel = document.getElementById("ct-cancel");
  if (ctCancel) ctCancel.addEventListener("click", () => _hide("task-modal"));
  const ctSave = document.getElementById("ct-save");
  if (ctSave) ctSave.addEventListener("click", async () => {
    const title = _val("ct-title").trim();
    if (!title) { alert("Title required"); return; }
    const payload = {
      title,
      detail: _val("ct-detail").trim() || null,
      frequency: _val("ct-freq") || "daily",
      category: _val("ct-cat") || "Operations",
      severity: _val("ct-sev") || "routine",
      estimatedMinutes: _num("ct-est") || 5,
      assignedStaffId: _val("ct-assignee") || null,
    };
    ctSave.disabled = true; const o = ctSave.textContent; ctSave.textContent = "Saving…";
    try {
      await tasksRepo.addCustomTask(payload);
      // Refresh tasks render — renderTasks fetches via tasksRepo internally if so designed,
      // otherwise just re-render from state. Trigger renderAll to be safe.
      if (typeof renderTasks === 'function') renderTasks();
      _hide("task-modal");
      _clear(["ct-title","ct-detail"]);
    } catch (err) { console.error(err); alert("Could not save task: " + err.message); }
    finally { ctSave.disabled = false; ctSave.textContent = o; }
  });

  // Delete-row delegation: menu / inventory / ingredient / task
  document.addEventListener("click", (e) => {
    const mDel = e.target.closest("[data-menu-del]");
    if (mDel) {
      const id = mDel.dataset.menuDel;
      if (!id) return;
      if (!confirm("Delete this menu item?")) return;
      mDel.disabled = true;
      dataRepo.deleteMenuItem(id)
        .then(async () => { state.menu = await dataRepo.fetchMenu(); renderMenu(); })
        .catch(err => { console.error(err); alert("Could not delete: " + err.message); mDel.disabled = false; });
      return;
    }
    const iDel = e.target.closest("[data-inv-del]");
    if (iDel) {
      const id = iDel.dataset.invDel;
      if (!id) return;
      if (!confirm("Delete this inventory item?")) return;
      iDel.disabled = true;
      dataRepo.deleteInventoryItem(id)
        .then(async () => { state.inv = await dataRepo.fetchInventory(); renderInventory(); })
        .catch(err => { console.error(err); alert("Could not delete: " + err.message); iDel.disabled = false; });
      return;
    }
    const gDel = e.target.closest("[data-ing-del]");
    if (gDel) {
      const id = gDel.dataset.ingDel;
      if (!id) return;
      if (!confirm("Remove this ingredient?")) return;
      gDel.disabled = true;
      dataRepo.deleteRecipeIngredient(id)
        .then(async () => { state.recipes = await dataRepo.fetchRecipes(); renderRecipes(); })
        .catch(err => { console.error(err); alert("Could not delete: " + err.message); gDel.disabled = false; });
      return;
    }
    const tDel = e.target.closest("[data-task-del]");
    if (tDel) {
      const id = tDel.dataset.taskDel;
      if (!id) return;
      if (!confirm("Delete this custom task?")) return;
      tDel.disabled = true;
      tasksRepo.deleteCustomTask(id)
        .then(() => { if (typeof renderTasks === 'function') renderTasks(); })
        .catch(err => { console.error(err); alert("Could not delete: " + err.message); tDel.disabled = false; });
      return;
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
                <div class="invoice-vendor">${escapeHtml(inv.vendor || 'Unknown vendor')}${inv.isSample ? ' <span class="sample-pill" title="Sample data">SAMPLE</span>' : ''}</div>
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
      <label><span class="lbl">Subtotal</span><input type="number" inputmode="decimal" step="0.01" data-review-field="subtotal" value="${inv.subtotal || 0}" /></label>
      <label><span class="lbl">Tax</span><input type="number" inputmode="decimal" step="0.01" data-review-field="tax" value="${inv.tax || 0}" /></label>
      <label><span class="lbl">Total</span><input type="number" inputmode="decimal" step="0.01" data-review-field="total" value="${inv.total || 0}" /></label>
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
        const isCustom = t.id === t._uuid; // library_id IS NULL means uiId equals db uuid
        const customBadge = isCustom ? `<span class="vendor-pill" style="background:rgba(232,163,61,0.18);color:#e8a33d">CUSTOM</span>` : "";
        const estTxt = t.est > 0 ? `${t.est}m` : "—";
        const customActions = isCustom ? `<button class="row-del" data-task-del="${t._uuid}" title="Delete" data-write-action style="margin-left:auto">×</button>` : "";
        html += `<div class="task-row ${statusClass}" data-task-id="${t.id}">
          <button class="task-check ${st === "done-today" ? "checked" : ""}" data-task-toggle="${t.id}" aria-label="Mark done">${st === "done-today" ? "✓" : ""}</button>
          <div class="task-body">
            <div class="task-title-row">
              <span class="task-title">${t.title}</span>
              <span class="sev-pill sev-${t.sev}">${t.sev}</span>
              <span class="cat-pill">${t.category}</span>
              ${vendorBadge}
              ${customBadge}
              ${customActions}
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
// LOCATIONS + COMMISSARY (multi-location)
// -----------------------------------------------------------------------------
function initLocationSwitcher() {
  const wrap = document.getElementById('location-switcher');
  const sel = document.getElementById('location-select');
  if (!wrap || !sel) return;
  // Hide entirely if 0 or 1 locations — single-site operators see no UX change.
  if ((state.locations || []).length < 2) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  // Populate options.
  const cur = getCurrentLocationId();
  sel.innerHTML = '<option value="">All locations</option>' +
    state.locations.map(l => {
      const tag = l.is_commissary ? ' · commissary' : (l.is_primary ? ' · primary' : '');
      return `<option value="${l.id}">${escapeHtml(l.name)}${tag}</option>`;
    }).join('');
  if (cur) sel.value = cur;
  sel.onchange = () => {
    setCurrentLocationId(sel.value || null);
    refreshAfterLocationChange().catch(err => console.error(err));
  };
}

async function refreshAfterLocationChange() {
  const locId = getCurrentLocationId();
  try {
    state.inv = await dataRepo.fetchInventory({ locationId: locId });
    state.temps = await dataRepo.fetchTempLogs({ locationId: locId });
    state.prepLabels = await dataRepo.fetchPrepLabels({ includeVoided: true, locationId: locId });
  } catch (e) { console.warn('Location-scoped refresh failed', e); }
  if (typeof renderInventory === 'function') renderInventory();
  if (typeof renderTemps === 'function') renderTemps();
  if (typeof renderPrepLabels === 'function') renderPrepLabels();
  renderLocations();
  renderCommissary();
}

function renderCommissaryNavVisibility() {
  const navItem = document.getElementById('nav-commissary');
  if (!navItem) return;
  const hasCommissary = (state.locations || []).some(l => l.is_commissary);
  navItem.hidden = !hasCommissary;
}

function renderLocations() {
  const tbody = document.getElementById('locations-body');
  if (!tbody) return;
  const locs = state.locations || [];
  if (locs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#7a715f">Loading locations…</td></tr>';
    return;
  }
  tbody.innerHTML = locs.map(l => {
    const addr = [l.address_line1, l.city, l.state, l.postal_code].filter(Boolean).join(', ') || '—';
    const badges = [];
    if (l.is_primary) badges.push('<span class="pill primary">Primary</span>');
    if (l.is_commissary) badges.push('<span class="pill commissary">Commissary</span>');
    if (badges.length === 0) badges.push('<span class="pill ok">Active</span>');
    const actions = [
      `<button class="ghost-btn" data-loc-edit="${l.id}">Edit</button>`,
      l.is_commissary
        ? `<button class="ghost-btn" data-loc-uncommissary="${l.id}">Unset commissary</button>`
        : `<button class="ghost-btn" data-loc-commissary="${l.id}">Mark as commissary</button>`,
      l.is_primary ? '' : `<button class="row-del" data-loc-del="${l.id}" title="Remove">×</button>`,
    ].filter(Boolean).join(' ');
    return `<tr>
      <td><strong>${escapeHtml(l.name)}</strong></td>
      <td>${escapeHtml(addr)}</td>
      <td>${badges.join(' ')}</td>
      <td style="text-align:right">${actions}</td>
    </tr>`;
  }).join('');
}

function openLocationModal(locId = null) {
  const m = document.getElementById('location-modal');
  if (!m) return;
  const loc = locId ? (state.locations || []).find(l => l.id === locId) : null;
  document.getElementById('location-modal-title').textContent = loc ? 'Edit location' : 'Add location';
  document.getElementById('loc-id').value = loc?.id || '';
  document.getElementById('loc-name').value = loc?.name || '';
  document.getElementById('loc-addr').value = loc?.address_line1 || '';
  document.getElementById('loc-city').value = loc?.city || '';
  document.getElementById('loc-state').value = loc?.state || '';
  document.getElementById('loc-zip').value = loc?.postal_code || '';
  document.getElementById('loc-commissary').checked = !!loc?.is_commissary;
  m.hidden = false;
}
function closeLocationModal() {
  const m = document.getElementById('location-modal'); if (m) m.hidden = true;
}

async function saveLocationFromModal() {
  const id = document.getElementById('loc-id').value || null;
  const patch = {
    name: document.getElementById('loc-name').value.trim(),
    address_line1: document.getElementById('loc-addr').value.trim() || null,
    city: document.getElementById('loc-city').value.trim() || null,
    state: document.getElementById('loc-state').value.trim() || null,
    postal_code: document.getElementById('loc-zip').value.trim() || null,
  };
  const isCommissary = document.getElementById('loc-commissary').checked;
  if (!patch.name) { alert('Location name is required'); return; }
  try {
    let savedId = id;
    if (id) {
      await locationsRepo.updateLocation(id, patch);
    } else {
      const created = await locationsRepo.addLocation({ ...patch, isCommissary });
      savedId = created?.id;
    }
    if (id && savedId) {
      // For edits, also reconcile commissary toggle.
      const cur = (state.locations || []).find(l => l.id === id);
      if (cur && cur.is_commissary !== isCommissary) {
        await locationsRepo.setCommissary(savedId, isCommissary);
      }
    }
    state.locations = await locationsRepo.fetchLocations();
    initLocationSwitcher();
    renderLocations();
    renderCommissaryNavVisibility();
    closeLocationModal();
  } catch (err) {
    console.error(err); alert('Save failed: ' + err.message);
  }
}

function renderCommissary() {
  const tbody = document.getElementById('transfers-body');
  if (!tbody) return;
  const sub = document.getElementById('commissary-sub');
  const hasCommissary = (state.locations || []).some(l => l.is_commissary);
  if (!hasCommissary) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:24px;text-align:center;color:#7a715f">Designate one of your locations as a commissary to start using transfers.</td></tr>';
    if (sub) sub.textContent = 'Mark a location as commissary in the Locations tab to start moving inventory.';
    return;
  }
  if (sub) sub.textContent = 'Move prepped batches and inventory between locations.';
  const locId = getCurrentLocationId();
  const tab = state.transferTab || 'outgoing';
  let rows = state.transfers || [];
  if (tab === 'outgoing' && locId) rows = rows.filter(r => r.from_location_id === locId);
  else if (tab === 'incoming' && locId) rows = rows.filter(r => r.to_location_id === locId);
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:#7a715f">No ${tab === 'all' ? '' : tab + ' '}transfers yet.</td></tr>`;
    return;
  }
  const locName = (id) => (state.locations.find(l => l.id === id) || {}).name || '—';
  tbody.innerHTML = rows.map(t => {
    const lineCount = (t.lines || []).length;
    const total = (t.lines || []).reduce((s, l) => s + (Number(l.line_total) || 0), 0);
    const created = t.created_at ? new Date(t.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '—';
    const status = `<span class="pill ${t.status}">${t.status}</span>`;
    let actions = '';
    if (t.status === 'draft') actions = `<button class="ghost-btn" data-tr-send="${t.id}">Mark sent</button>`;
    else if (t.status === 'sent') actions = `<button class="ghost-btn" data-tr-recv="${t.id}">Mark received</button>`;
    return `<tr>
      <td>${escapeHtml(locName(t.from_location_id))}</td>
      <td>${escapeHtml(locName(t.to_location_id))}</td>
      <td>${status}</td>
      <td>${lineCount}</td>
      <td>${fmtUSD2(total)}</td>
      <td>${created}</td>
      <td style="text-align:right">${actions}</td>
    </tr>`;
  }).join('');
}

function openTransferModal() {
  const m = document.getElementById('transfer-modal'); if (!m) return;
  const fromSel = document.getElementById('tr-from');
  const toSel = document.getElementById('tr-to');
  const itemSel = document.getElementById('tr-line-item');
  const opts = (state.locations || []).map(l => `<option value="${l.id}">${escapeHtml(l.name)}${l.is_commissary ? ' · commissary' : ''}</option>`).join('');
  fromSel.innerHTML = opts;
  toSel.innerHTML = opts;
  // Default "from" to the commissary if there is one
  const commissary = (state.locations || []).find(l => l.is_commissary);
  if (commissary) fromSel.value = commissary.id;
  // Default "to" to first non-commissary
  const dest = (state.locations || []).find(l => l.id !== fromSel.value);
  if (dest) toSel.value = dest.id;
  itemSel.innerHTML = '<option value="">— Pick item —</option>' +
    (state.inv || []).filter(i => i.id).map(i => `<option value="${i.id}" data-unit="${escapeHtml(i.unit||'')}" data-cost="${i.cost||0}">${escapeHtml(i.item)}</option>`).join('');
  document.getElementById('tr-id').value = '';
  document.getElementById('tr-when').value = '';
  document.getElementById('tr-notes').value = '';
  document.getElementById('tr-line-qty').value = '';
  state.transferDraft = { lines: [] };
  renderTransferDraftLines();
  m.hidden = false;
}
function closeTransferModal() {
  const m = document.getElementById('transfer-modal'); if (m) m.hidden = true;
  state.transferDraft = null;
}
function renderTransferDraftLines() {
  const tbody = document.getElementById('tr-lines-body'); if (!tbody) return;
  const lines = state.transferDraft?.lines || [];
  if (lines.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:10px;text-align:center;color:#7a715f">No lines yet</td></tr>';
    return;
  }
  tbody.innerHTML = lines.map((l, idx) => `<tr>
    <td>${escapeHtml(l.description)}</td>
    <td>${l.quantity}</td>
    <td>${escapeHtml(l.unit||'')}</td>
    <td>${fmtUSD2(l.unit_cost)}</td>
    <td><button class="row-del" data-tr-rmline="${idx}">×</button></td>
  </tr>`).join('');
}

async function saveTransferDraft() {
  const fromId = document.getElementById('tr-from').value;
  const toId   = document.getElementById('tr-to').value;
  if (!fromId || !toId || fromId === toId) { alert('Pick distinct from/to locations'); return; }
  const when   = document.getElementById('tr-when').value || null;
  const notes  = document.getElementById('tr-notes').value || null;
  const lines  = state.transferDraft?.lines || [];
  if (lines.length === 0) { alert('Add at least one line'); return; }
  try {
    const transfer = await transfersRepo.createTransfer({ fromLocationId: fromId, toLocationId: toId, scheduledFor: when, notes });
    for (const ln of lines) {
      await transfersRepo.addTransferLine(transfer.id, ln);
    }
    state.transfers = await transfersRepo.listTransfers();
    closeTransferModal();
    renderCommissary();
  } catch (err) {
    console.error(err); alert('Could not save transfer: ' + err.message);
  }
}

async function handleTransferAction(action, transferId) {
  try {
    if (action === 'send') await transfersRepo.markSent(transferId);
    else if (action === 'recv') await transfersRepo.markReceived(transferId);
    state.transfers = await transfersRepo.listTransfers();
    // Refresh inventory — receive can change on_hand at destination.
    state.inv = await dataRepo.fetchInventory({ locationId: getCurrentLocationId() });
    renderCommissary();
    if (typeof renderInventory === 'function') renderInventory();
  } catch (err) {
    console.error(err); alert('Action failed: ' + err.message);
  }
}

// Bind events for locations + commissary tabs (delegated)
function bindCommissaryEvents() {
  const addBtn = document.getElementById('add-location');
  if (addBtn) addBtn.addEventListener('click', () => openLocationModal());
  const locCancel = document.getElementById('loc-cancel');
  if (locCancel) locCancel.addEventListener('click', closeLocationModal);
  const locSave = document.getElementById('loc-save');
  if (locSave) locSave.addEventListener('click', saveLocationFromModal);

  const newTransfer = document.getElementById('new-transfer');
  if (newTransfer) newTransfer.addEventListener('click', openTransferModal);
  const trCancel = document.getElementById('tr-cancel');
  if (trCancel) trCancel.addEventListener('click', closeTransferModal);
  const trSave = document.getElementById('tr-save');
  if (trSave) trSave.addEventListener('click', saveTransferDraft);
  const trAddLine = document.getElementById('tr-add-line');
  if (trAddLine) trAddLine.addEventListener('click', () => {
    const sel = document.getElementById('tr-line-item');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) { alert('Pick an inventory item'); return; }
    const qty = Number(document.getElementById('tr-line-qty').value);
    if (!(qty > 0)) { alert('Enter quantity'); return; }
    state.transferDraft = state.transferDraft || { lines: [] };
    state.transferDraft.lines.push({
      inventoryItemId: opt.value,
      description: opt.textContent,
      quantity: qty,
      unit: opt.dataset.unit || null,
      unitCost: Number(opt.dataset.cost) || 0,
    });
    document.getElementById('tr-line-qty').value = '';
    renderTransferDraftLines();
  });

  // Tabs in commissary view
  document.querySelectorAll('[data-transfer-tab]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-transfer-tab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.transferTab = b.dataset.transferTab;
      renderCommissary();
    });
  });

  // Delegated row actions on locations + transfers tables
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.locEdit) { openLocationModal(t.dataset.locEdit); return; }
    if (t.dataset.locCommissary) {
      try { await locationsRepo.setCommissary(t.dataset.locCommissary, true); state.locations = await locationsRepo.fetchLocations(); initLocationSwitcher(); renderLocations(); renderCommissaryNavVisibility(); renderCommissary(); }
      catch (err) { alert('Could not set commissary: ' + err.message); }
      return;
    }
    if (t.dataset.locUncommissary) {
      try { await locationsRepo.setCommissary(t.dataset.locUncommissary, false); state.locations = await locationsRepo.fetchLocations(); initLocationSwitcher(); renderLocations(); renderCommissaryNavVisibility(); renderCommissary(); }
      catch (err) { alert('Could not unset commissary: ' + err.message); }
      return;
    }
    if (t.dataset.locDel) {
      if (!confirm('Remove this location?')) return;
      try { await locationsRepo.deleteLocation(t.dataset.locDel); state.locations = await locationsRepo.fetchLocations(); initLocationSwitcher(); renderLocations(); }
      catch (err) { alert('Could not delete: ' + err.message); }
      return;
    }
    if (t.dataset.trSend) { await handleTransferAction('send', t.dataset.trSend); return; }
    if (t.dataset.trRecv) { await handleTransferAction('recv', t.dataset.trRecv); return; }
    if (t.dataset.trRmline !== undefined && t.dataset.trRmline !== '') {
      const idx = Number(t.dataset.trRmline);
      if (state.transferDraft?.lines) {
        state.transferDraft.lines.splice(idx, 1);
        renderTransferDraftLines();
      }
      return;
    }
  });
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

  // Wire Sentry user/tenant context once auth resolves. No-op if Sentry not loaded.
  try {
    if (typeof window.__setSentryUser === 'function' && ctx?.user) {
      window.__setSentryUser(ctx.user, ctx?.tenant?.id || null);
      if (ctx?.role && window.Sentry?.setTag) window.Sentry.setTag('role', ctx.role);
    }
  } catch (e) { /* noop */ }

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

    // Prep Labels (Food Safety tab) — runs for all tenant members.
    if (ctx?.tenant?.id && ctx?.user?.id) {
      import('./prepLabelsView.js')
        .then(mod => mod.initPrepLabels({
          tenantId: ctx.tenant.id,
          userId: ctx.user.id,
          userEmail: ctx.user.email,
        }))
        .catch(e => console.warn('prep labels init failed', e));
    }

    // Receipts — runs for all tenant members.
    if (ctx?.tenant?.id && ctx?.user?.id) {
      import('./receiptsView.js')
        .then(mod => {
          mod.initReceipts({ tenantId: ctx.tenant.id, userId: ctx.user.id });
          window.__receiptsInited = true;
          // Nav handler calls this when the user clicks Receipts. Re-running initReceipts
          // is a no-op for setup (the _initialized guard short-circuits) and just refreshes
          // the list — the in-flight dedupe in loadReceipts() prevents double fetches.
          window.__receiptsRefresh = () => mod.initReceipts({ tenantId: ctx.tenant.id, userId: ctx.user.id });
        })
        .catch(e => console.warn('receipts init failed', e));
    }

    // Inspection reports — health/safety report repository (loads lazily on first view).
    if (ctx?.tenant?.id && ctx?.user?.id) {
      window.__inspectionsInit = () => {
        if (window.__inspectionsInited) {
          window.__inspectionsRefresh && window.__inspectionsRefresh();
          return;
        }
        import('./inspectionsView.js')
          .then(mod => {
            mod.initInspections({ tenantId: ctx.tenant.id, userId: ctx.user.id });
            window.__inspectionsInited = true;
            window.__inspectionsRefresh = () => mod.initInspections({ tenantId: ctx.tenant.id, userId: ctx.user.id });
          })
          .catch(e => console.warn('inspections init failed', e));
      };
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
    // Locations + transfers (multi-location commissary). Failures are non-fatal
    // — a single-location tenant works without these.
    try {
      state.locations = await locationsRepo.fetchLocations();
    } catch (e) { console.warn('locations fetch failed', e); state.locations = []; }
    try {
      state.transfers = await transfersRepo.listTransfers();
    } catch (e) { console.warn('transfers fetch failed', e); state.transfers = []; }
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
  bindCommissaryEvents();
  bindVarianceEvents();
  wireTripleReleaseEvents();
  wireActivationEvents();
  renderAll();

  // Honor explicit view from URL hash or ?view= param. Strip any query string
  // that Stripe (or any other redirector) tacks onto the hash:
  //   #billing?status=success&session_id=cs_...   ->  billing
  //   #billing                                     ->  billing
  //   ?view=billing                                ->  billing
  // If the hash names a real nav-item, click it. This fixes the Stripe-return
  // bug where the user landed on Overview instead of Billing.
  function _viewFromUrl() {
    try {
      const search = new URLSearchParams(window.location.search);
      const fromQuery = search.get('view');
      if (fromQuery) return fromQuery.trim();
      const hash = (window.location.hash || '').replace(/^#/, '');
      if (!hash) return null;
      // Strip any ?... or &... that follows the view name.
      return hash.split(/[?&]/)[0].trim() || null;
    } catch (_) { return null; }
  }
  const explicitView = _viewFromUrl();
  if (explicitView) {
    const explicitBtn = document.querySelector(`.sidebar .nav-item[data-view="${explicitView}"]`)
      || document.querySelector(`.nav-item[data-view="${explicitView}"]`);
    if (explicitBtn) {
      try { explicitBtn.click(); } catch (_) {}
    }
  }

  // Tablet kitchen mode: if device is touch + roughly tablet-sized, default to
  // Time Clock (skip if user already navigated via URL hash or ?view= param,
  // and skip when role is owner/manager who explicitly want overview).
  try {
    const hasExplicitView = !!explicitView;
    const isTabletTouch = window.matchMedia('(max-width: 1024px) and (pointer: coarse)').matches;
    const role = state.role || 'owner';
    if (!hasExplicitView && (role === 'staff' || isTabletTouch)) {
      const clockBtn = document.querySelector('.sidebar .nav-item[data-view="clock"]')
        || document.querySelector('.nav-item[data-view="clock"]');
      if (clockBtn) clockBtn.click();
    }
  } catch (_) { /* best-effort default-view; never block boot */ }

  // Activation panel + sample-data banner — fire and forget; both are async.
  // Each handles its own "empty/incomplete state" gracefully so a slow query
  // can't block first paint.
  refreshSampleBanner().catch((e) => console.warn('sample banner check failed', e));
  renderActivationChecklist().catch((e) => console.warn('activation render failed', e));
  window.__restopsBooted = true;
  // Dev-only debug hook so Playwright QA can inspect state.
  window.__restopsState = state;
  window.__restopsRepos = { dataRepo, tasksRepo, invitesRepo, locationsRepo, transfersRepo, countsRepo, varianceRepo, payrollRepo, tipPoolRepo, vendorsRepo, billsRepo, barPoursRepo, activationRepo };
  initLocationSwitcher();
  renderLocations();
  renderCommissaryNavVisibility();
  renderCommissary();

  // Connection status pill + offline sync queue indicator.
  // Mounts a pill in the topbar and shows toasts when offline writes are queued / flushed.
  import('./connectionStatus.js')
    .then(m => m.initConnectionStatus && m.initConnectionStatus())
    .catch(e => console.warn('connection status init failed', e));
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

// =============================================================================
// VARIANCE (Theoretical-vs-Actual)
// =============================================================================
const variance = {
  counts: [],          // recent count headers for current location
  countTotals: {},     // count_id -> { lineCount, totalDollars }
  draftCount: null,    // { id?, locationId, periodLabel, lines: [{inventoryItemId, name, unit, on_hand, unit_cost, counted_qty}] }
  rows: [],            // last variance run rows
  fromCountId: null,
  toCountId: null,
  sortKey: 'variance_dollars',
  sortDir: 'desc',
};

function varianceFmtUSD(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(n) || 0);
}
function varianceFmtQty(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function varianceFmtPct(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

async function renderVariance() {
  const locId = getCurrentLocationId();
  // 1) Load counts for this location
  try {
    variance.counts = await countsRepo.listCounts({ locationId: locId, limit: 50 });
  } catch (err) {
    console.error('listCounts failed', err);
    variance.counts = [];
  }
  await renderCountsTable();
  populateVarianceCountSelectors();
  renderVarianceTable();
  renderVarianceKpis();
}

async function renderCountsTable() {
  const tbody = document.getElementById('counts-body');
  if (!tbody) return;
  const role = window.__RESTOPS_CTX__?.role;
  const canWrite = role === 'owner' || role === 'manager';
  if (!variance.counts.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:#7a715f">No counts yet. ${canWrite ? 'Click <strong>+ New count</strong> to start.' : 'Ask a manager to run the first count.'}</td></tr>`;
    return;
  }
  // Fetch totals for visible counts (lazy)
  const ids = variance.counts.map(c => c.id);
  const need = ids.filter(id => !variance.countTotals[id]);
  await Promise.all(need.map(async (id) => {
    try { variance.countTotals[id] = await countsRepo.countTotals(id); }
    catch { variance.countTotals[id] = { lineCount: 0, totalDollars: 0 }; }
  }));
  tbody.innerHTML = variance.counts.map(c => {
    const tot = variance.countTotals[c.id] || { lineCount: 0, totalDollars: 0 };
    const date = c.counted_at ? new Date(c.counted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const status = `<span class="pill ${c.status}">${c.status}</span>`;
    let actions = '';
    if (canWrite) {
      if (c.status === 'draft') actions += `<button class="ghost-btn" data-cnt-open="${c.id}">Edit</button> <button class="ghost-btn" data-cnt-finalize="${c.id}">Finalize</button> `;
      actions += `<button class="row-del" data-cnt-del="${c.id}" title="Delete">×</button>`;
    }
    return `<tr>
      <td>${date}</td>
      <td>${escapeHtml(c.period_label || '—')}</td>
      <td>${status}</td>
      <td>${tot.lineCount}</td>
      <td>${varianceFmtUSD(tot.totalDollars)}</td>
      <td style="text-align:right">${actions}</td>
    </tr>`;
  }).join('');
}

function populateVarianceCountSelectors() {
  const fromSel = document.getElementById('var-from-count');
  const toSel = document.getElementById('var-to-count');
  if (!fromSel || !toSel) return;
  const finalized = variance.counts.filter(c => c.status === 'finalized');
  const opt = (c) => {
    const date = c.counted_at ? new Date(c.counted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const label = c.period_label ? `${date} — ${c.period_label}` : date;
    return `<option value="${c.id}">${escapeHtml(label)}</option>`;
  };
  if (finalized.length < 2) {
    fromSel.innerHTML = '<option value="">Need 2 finalized counts</option>';
    toSel.innerHTML = '<option value="">Need 2 finalized counts</option>';
    return;
  }
  fromSel.innerHTML = finalized.slice().reverse().map(opt).join(''); // ascending date
  toSel.innerHTML = finalized.map(opt).join(''); // descending date
  // Defaults: oldest finalized -> newest finalized
  fromSel.value = finalized[finalized.length - 1].id;
  toSel.value = finalized[0].id;
}

function renderVarianceKpis() {
  const summary = varianceRepo.summarize(variance.rows || []);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('vk-theo', varianceFmtUSD(summary.totalTheoretical));
  set('vk-actual', varianceFmtUSD(summary.totalActual));
  set('vk-var', varianceFmtUSD(summary.varianceDollars));
  set('vk-pct', `${(summary.variancePct || 0).toFixed(1)}%`);
}

function renderVarianceTable() {
  const tbody = document.getElementById('variance-body');
  if (!tbody) return;
  const rows = (variance.rows || []).slice();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:#7a715f">Run a report from two finalized counts to see variance for every item.</td></tr>`;
    document.getElementById('export-variance')?.setAttribute('disabled', '');
    return;
  }
  document.getElementById('export-variance')?.removeAttribute('disabled');
  // Sort
  const dir = variance.sortDir === 'asc' ? 1 : -1;
  const k = variance.sortKey;
  rows.sort((a, b) => {
    const av = a[k]; const bv = b[k];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  tbody.innerHTML = rows.map(r => {
    const sev = r.severity || 'unknown';
    const badge = `<span class="sev-badge var-${sev}">${sev === 'unknown' ? 'POS data needed' : sev}</span>`;
    return `<tr data-var-row="${r.inventory_item_id}" style="cursor:pointer">
      <td data-label="Item">${escapeHtml(r.item_name || '')}</td>
      <td data-label="Unit">${escapeHtml(r.unit || '')}</td>
      <td data-label="Theoretical" style="text-align:right">${varianceFmtQty(r.theoretical_used_qty)}</td>
      <td data-label="Actual" style="text-align:right">${varianceFmtQty(r.actual_used_qty)}</td>
      <td data-label="Δ qty" style="text-align:right">${varianceFmtQty(r.variance_qty)}</td>
      <td data-label="Δ $" style="text-align:right">${r.variance_dollars == null ? '—' : varianceFmtUSD(r.variance_dollars)}</td>
      <td data-label="Δ %" style="text-align:right">${varianceFmtPct(r.variance_pct)}</td>
      <td data-label="Severity">${badge}</td>
    </tr>`;
  }).join('');
}

async function runVarianceReport() {
  const fromId = document.getElementById('var-from-count')?.value;
  const toId = document.getElementById('var-to-count')?.value;
  if (!fromId || !toId) { alert('Pick two finalized counts'); return; }
  if (fromId === toId) { alert('From and To must differ'); return; }
  variance.fromCountId = fromId;
  variance.toCountId = toId;
  try {
    variance.rows = await varianceRepo.runReport({ fromCountId: fromId, toCountId: toId, locationId: getCurrentLocationId() });
  } catch (err) {
    console.error('Variance report failed', err);
    alert('Could not run report: ' + (err.message || 'unknown error'));
    return;
  }
  renderVarianceTable();
  renderVarianceKpis();
}

// ---- Drill-down drawer ----
async function openVarianceDrawer(itemId) {
  const row = (variance.rows || []).find(r => r.inventory_item_id === itemId);
  if (!row) return;
  const drawer = document.getElementById('variance-drawer');
  const title = document.getElementById('vd-title');
  const body = document.getElementById('vd-body');
  if (!drawer || !body) return;
  title.textContent = `${row.item_name} — ${row.unit || ''}`;
  body.innerHTML = `
    <div class="vd-summary">
      <div><span class="muted">Beginning</span><strong>${varianceFmtQty(row.beginning_qty)}</strong></div>
      <div><span class="muted">+ Purchases</span><strong>${varianceFmtQty(row.purchases_qty)}</strong></div>
      <div><span class="muted">− Ending</span><strong>${varianceFmtQty(row.ending_qty)}</strong></div>
      <div><span class="muted">= Actual</span><strong>${varianceFmtQty(row.actual_used_qty)}</strong></div>
      <div><span class="muted">Theoretical</span><strong>${varianceFmtQty(row.theoretical_used_qty)}</strong></div>
      <div><span class="muted">Waste</span><strong>${varianceFmtQty(row.waste_qty)}</strong></div>
      <div class="vd-headline"><span class="muted">Variance</span>
        <strong class="var-${row.severity || 'unknown'}">${varianceFmtQty(row.variance_qty)} · ${row.variance_dollars == null ? '—' : varianceFmtUSD(row.variance_dollars)} · ${varianceFmtPct(row.variance_pct)}</strong>
      </div>
    </div>
    ${row.reason ? `<p class="sub" style="margin-top:10px">${escapeHtml(row.reason)}</p>` : ''}
    <div id="vd-detail-sections" style="margin-top:14px"><span class="muted">Loading recipes, purchases, and waste details…</span></div>
  `;
  drawer.hidden = false;
  // Lazy-load deeper detail. Best-effort — if any of these fail we still show the summary above.
  try {
    const [{ data: ri }, { data: il }, { data: wl }] = await Promise.all([
      supabase.from('recipe_ingredients').select('id, recipe_id, name, qty, unit').ilike('name', row.item_name),
      supabase.from('invoice_lines').select('id, raw_description, qty, unit, extended_price, invoice_id').or(`matched_inventory_id.eq.${row.inventory_item_id},raw_description.ilike.${row.item_name}`).limit(50),
      supabase.from('waste_logs').select('id, item, qty, reason, dollar_loss, logged_at').ilike('item', row.item_name).order('logged_at', { ascending: false }).limit(20),
    ]);
    const sec = document.getElementById('vd-detail-sections');
    if (sec) {
      const recipesHtml = (ri || []).length
        ? `<h4>Recipes using this item</h4><ul>${ri.map(r => `<li>${escapeHtml(r.qty)} ${escapeHtml(r.unit||'')} — recipe ${escapeHtml(r.recipe_id?.slice(0,8) || '')}</li>`).join('')}</ul>`
        : '<h4>Recipes using this item</h4><p class="muted">None linked.</p>';
      const invHtml = (il || []).length
        ? `<h4>Recent invoice lines</h4><ul>${il.slice(0, 10).map(l => `<li>${escapeHtml(l.raw_description||'—')}: ${varianceFmtQty(l.qty)} ${escapeHtml(l.unit||'')}${l.extended_price != null ? ' · ' + varianceFmtUSD(l.extended_price) : ''}</li>`).join('')}</ul>`
        : '<h4>Recent invoice lines</h4><p class="muted">No matching invoices.</p>';
      const wasteHtml = (wl || []).length
        ? `<h4>Recent waste</h4><ul>${wl.map(w => `<li>${new Date(w.logged_at).toLocaleDateString()}: ${varianceFmtQty(w.qty)} — ${escapeHtml(w.reason||'')}${w.dollar_loss != null ? ' · ' + varianceFmtUSD(w.dollar_loss) : ''}</li>`).join('')}</ul>`
        : '<h4>Recent waste</h4><p class="muted">No waste logged for this item.</p>';
      sec.innerHTML = recipesHtml + invHtml + wasteHtml;
    }
  } catch (err) {
    console.warn('Drawer detail load failed', err);
  }
}
function closeVarianceDrawer() {
  const drawer = document.getElementById('variance-drawer');
  if (drawer) drawer.hidden = true;
}

// ---- CSV export ----
function exportVarianceCsv() {
  const rows = variance.rows || [];
  if (!rows.length) return;
  const header = ['Item','Unit','Theoretical','Actual','Variance Qty','Variance $','Variance %','Severity'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      JSON.stringify(r.item_name || ''),
      JSON.stringify(r.unit || ''),
      r.theoretical_used_qty == null ? '' : Number(r.theoretical_used_qty).toFixed(3),
      Number(r.actual_used_qty || 0).toFixed(3),
      r.variance_qty == null ? '' : Number(r.variance_qty).toFixed(3),
      r.variance_dollars == null ? '' : Number(r.variance_dollars).toFixed(2),
      r.variance_pct == null ? '' : Number(r.variance_pct).toFixed(2),
      r.severity || '',
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `variance-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- Count modal ----
function openCountModal(existingCountId = null) {
  const m = document.getElementById('count-modal'); if (!m) return;
  const locSel = document.getElementById('cnt-loc');
  const opts = (state.locations || []).map(l => `<option value="${l.id}">${escapeHtml(l.name)}${l.is_commissary ? ' · commissary' : ''}</option>`).join('');
  locSel.innerHTML = opts || '<option value="">(no locations)</option>';
  const curLoc = getCurrentLocationId();
  if (curLoc) locSel.value = curLoc;
  document.getElementById('cnt-id').value = existingCountId || '';
  document.getElementById('cnt-label').value = '';
  document.getElementById('cnt-notes').value = '';
  // Pre-fill lines from current inventory
  const locId = locSel.value || null;
  const inv = (state.inv || []).filter(i => i.id && (!locId || !i.location_id || i.location_id === locId));
  variance.draftCount = {
    locationId: locId,
    lines: inv.map(i => ({
      inventoryItemId: i.id,
      name: i.item || i.name || 'Item',
      unit: i.unit || '',
      on_hand: Number(i.qty != null ? i.qty : i.on_hand) || 0,
      unit_cost: Number(i.cost != null ? i.cost : i.unit_cost) || 0,
      counted_qty: '',
    })),
  };
  renderCountModalLines();
  m.hidden = false;
}

function renderCountModalLines() {
  const tbody = document.getElementById('cnt-lines-body');
  if (!tbody || !variance.draftCount) return;
  const lines = variance.draftCount.lines || [];
  if (!lines.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;color:#7a715f">No inventory items at this location.</td></tr>';
    return;
  }
  tbody.innerHTML = lines.map((l, idx) => {
    const counted = l.counted_qty === '' ? '' : Number(l.counted_qty);
    const ext = (counted === '' ? 0 : counted * (l.unit_cost || 0));
    return `<tr>
      <td>${escapeHtml(l.name)}</td>
      <td style="text-align:right">${varianceFmtQty(l.on_hand)}</td>
      <td><input type="number" inputmode="decimal" step="0.01" min="0" data-cnt-line-idx="${idx}" value="${l.counted_qty === '' ? '' : l.counted_qty}" style="width:100%" /></td>
      <td>${escapeHtml(l.unit || '')}</td>
      <td style="text-align:right">${counted === '' ? '—' : varianceFmtUSD(ext)}</td>
    </tr>`;
  }).join('');
}

function closeCountModal() {
  const m = document.getElementById('count-modal'); if (m) m.hidden = true;
  variance.draftCount = null;
}

async function saveCount({ finalize = false } = {}) {
  if (!variance.draftCount) return;
  const locId = document.getElementById('cnt-loc')?.value || null;
  const label = document.getElementById('cnt-label')?.value || null;
  const notes = document.getElementById('cnt-notes')?.value || null;
  const linesIn = (variance.draftCount.lines || []).filter(l => l.counted_qty !== '' && l.counted_qty != null);
  if (!linesIn.length) { alert('Enter at least one counted quantity.'); return; }
  try {
    const cnt = await countsRepo.createCount({ locationId: locId, periodLabel: label, notes });
    for (const ln of linesIn) {
      await countsRepo.addLine(cnt.id, {
        inventoryItemId: ln.inventoryItemId,
        countedQty: Number(ln.counted_qty) || 0,
        unit: ln.unit,
        unitCost: ln.unit_cost,
      });
    }
    if (finalize) {
      await countsRepo.finalizeCount(cnt.id);
    }
    closeCountModal();
    await renderVariance();
  } catch (err) {
    console.error('saveCount failed', err);
    alert('Could not save count: ' + (err.message || 'unknown error'));
  }
}

function bindVarianceEvents() {
  // Open new count
  document.getElementById('new-count')?.addEventListener('click', () => openCountModal());
  document.getElementById('cnt-cancel')?.addEventListener('click', closeCountModal);
  document.getElementById('cnt-save-draft')?.addEventListener('click', () => saveCount({ finalize: false }));
  document.getElementById('cnt-finalize')?.addEventListener('click', () => saveCount({ finalize: true }));
  document.getElementById('cnt-prefill')?.addEventListener('click', () => {
    if (!variance.draftCount) return;
    variance.draftCount.lines.forEach(l => { l.counted_qty = l.on_hand; });
    renderCountModalLines();
  });
  // Edit on count line input
  document.addEventListener('input', (e) => {
    const idx = e.target?.dataset?.cntLineIdx;
    if (idx == null || !variance.draftCount) return;
    const i = Number(idx);
    const v = e.target.value;
    variance.draftCount.lines[i].counted_qty = v === '' ? '' : v;
    // Update extended on the right cell only (cheap full re-render is fine for <500 lines)
    renderCountModalLines();
  });
  // Re-prefill if location changes
  document.getElementById('cnt-loc')?.addEventListener('change', (e) => {
    if (!variance.draftCount) return;
    const locId = e.target.value || null;
    const inv = (state.inv || []).filter(i => i.id && (!locId || !i.location_id || i.location_id === locId));
    variance.draftCount = {
      locationId: locId,
      lines: inv.map(i => ({
        inventoryItemId: i.id,
        name: i.item || i.name || 'Item',
        unit: i.unit || '',
        on_hand: Number(i.qty != null ? i.qty : i.on_hand) || 0,
        unit_cost: Number(i.cost != null ? i.cost : i.unit_cost) || 0,
        counted_qty: '',
      })),
    };
    renderCountModalLines();
  });

  // Counts table actions
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.cntFinalize) {
      const id = t.dataset.cntFinalize;
      try { await countsRepo.finalizeCount(id); await renderVariance(); }
      catch (err) { alert('Finalize failed: ' + (err.message || err)); }
    }
    if (t.dataset.cntDel) {
      const id = t.dataset.cntDel;
      if (!confirm('Delete this count?')) return;
      try { await countsRepo.deleteCount(id); delete variance.countTotals[id]; await renderVariance(); }
      catch (err) { alert('Delete failed: ' + (err.message || err)); }
    }
    if (t.dataset.varRow) {
      openVarianceDrawer(t.dataset.varRow).catch(err => console.error(err));
    }
    // Close drawer when clicking outside the card
    if (t.id === 'variance-drawer') {
      closeVarianceDrawer();
    }
  });

  // Run report
  document.getElementById('run-variance')?.addEventListener('click', () => runVarianceReport().catch(err => console.error(err)));
  document.getElementById('export-variance')?.addEventListener('click', exportVarianceCsv);
  document.getElementById('vd-close')?.addEventListener('click', closeVarianceDrawer);

  // Sortable header
  document.querySelectorAll('#variance-table thead th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (variance.sortKey === k) variance.sortDir = variance.sortDir === 'desc' ? 'asc' : 'desc';
      else { variance.sortKey = k; variance.sortDir = 'desc'; }
      renderVarianceTable();
    });
  });

  // Re-render when location switches
  document.addEventListener('stationly:location-changed', () => {
    const active = document.querySelector('.view[data-view="variance"].active');
    if (active) renderVariance().catch(err => console.error(err));
  });
}

if (window.__RESTOPS_CTX__) {
  // Guard already finished before app.js loaded
  bootApp();
} else {
  window.addEventListener('restops:ready', bootApp, { once: true });
}

// =====================================================================
// TRIPLE RELEASE: Payroll, Bill Pay, Bar Inventory
// =====================================================================

// ---------- Bar Inventory ----------
async function renderBarDashboard() {
  try {
    const [pours, status] = await Promise.all([
      barPoursRepo.listPours({ limit: 100 }),
      barPoursRepo.listBarStatus(),
    ]);
    state.barPours = pours || [];
    state.barStatus = status || [];
  } catch (e) {
    console.error('Bar dashboard load failed:', e);
    state.barPours = state.barPours || [];
    state.barStatus = state.barStatus || [];
  }
  // KPIs
  const barItems = state.inv.filter(i => ['beer','wine','spirits','n/a_beverage'].includes(i.category || ''));
  const totalBottles = barItems.reduce((s, i) => s + (Number(i.onHand) || 0), 0);
  const totalValue = barItems.reduce((s, i) => s + (Number(i.onHand) || 0) * (Number(i.cost) || 0), 0);
  const belowPar = barItems.filter(i => (Number(i.onHand) || 0) < (Number(i.par) || 0)).length;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const pours7 = (state.barPours || []).filter(p => new Date(p.poured_at || p.pouredAt) >= sevenDaysAgo).length;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('bar-kpi-bottles', totalBottles.toFixed(1));
  setText('bar-kpi-value', fmtUSD(totalValue));
  setText('bar-kpi-reorder', String(belowPar));
  setText('bar-kpi-pours', String(pours7));

  // Status table
  const sb = document.getElementById('bar-status-body');
  if (sb) {
    if (!state.barStatus.length) {
      sb.innerHTML = '<tr><td colspan="8" style="padding:14px;text-align:center;color:#7a715f">No bar items yet. Add a beer/wine/spirits item from "All inventory" to get started.</td></tr>';
    } else {
      sb.innerHTML = state.barStatus.map(r => {
        const days = r.days_of_supply == null ? '—' : Number(r.days_of_supply).toFixed(1);
        const flag = r.reorder_flag
          ? '<span class="pill err">Reorder</span>'
          : '<span class="pill ok">OK</span>';
        const cat = (r.category || '').replace('/','-');
        return `<tr>
          <td>${escapeHtml(r.name)}</td>
          <td><span class="cat-badge cat-${cat}">${escapeHtml(catLabel(r.category))}</span></td>
          <td>${r.bottle_size_ml ? r.bottle_size_ml + ' mL' : '—'}</td>
          <td style="text-align:right">${Number(r.on_hand_bottles || 0).toFixed(1)}</td>
          <td style="text-align:right">${Number(r.on_hand_oz || 0).toFixed(1)}</td>
          <td style="text-align:right">${Number(r.par_bottles || 0).toFixed(1)}</td>
          <td style="text-align:right">${days}</td>
          <td>${flag}</td>
        </tr>`;
      }).join('');
    }
  }

  renderPourLog();
}

function renderPourLog() {
  const tbody = document.getElementById('bar-pours-body');
  if (!tbody) return;
  if (!state.barPours || !state.barPours.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;color:#7a715f">No pours logged yet. Tap “+ Log pour” when you spill, comp, or train.</td></tr>';
    return;
  }
  // Build name lookup for bar items
  const nameById = Object.fromEntries((state.inv || []).map(i => [i.id, i.item]));
  tbody.innerHTML = state.barPours.map(p => {
    const when = p.poured_at ? new Date(p.poured_at).toLocaleString() : '';
    const item = nameById[p.inventory_item_id] || p.inventory_item_id || '';
    return `<tr>
      <td>${escapeHtml(when)}</td>
      <td>${escapeHtml(item)}</td>
      <td>${Number(p.poured_oz || 0).toFixed(2)}</td>
      <td>${escapeHtml(p.reason || '')}</td>
      <td>${escapeHtml(p.notes || '')}</td>
    </tr>`;
  }).join('');
}

// ---------- Bill Pay ----------
async function renderBills() {
  await Promise.all([
    refreshVendors(),
    refreshBills(),
  ]);
  renderBillsTable();
  renderVendorsTable();
  renderBillsAging();
}

async function refreshVendors() {
  try { state.vendors = await vendorsRepo.listVendors({ activeOnly: true }) || []; }
  catch (e) { console.error('Load vendors failed:', e); state.vendors = state.vendors || []; }
}

async function refreshBills() {
  try {
    const status = state.billsFilter || null;
    state.bills = await billsRepo.listBills({ status, limit: 200 }) || [];
    state.billsAging = await billsRepo.listBillsAging() || [];
  } catch (e) {
    console.error('Load bills failed:', e);
    state.bills = state.bills || [];
    state.billsAging = state.billsAging || [];
  }
}

function renderBillsTable() {
  const tbody = document.getElementById('bills-body');
  if (!tbody) return;
  const vendorById = Object.fromEntries((state.vendors || []).map(v => [v.id, v]));
  if (!state.bills || !state.bills.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:14px;text-align:center;color:#7a715f">No bills yet. Click <strong>+ New bill</strong> to add one, or generate from a received invoice.</td></tr>';
    return;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  tbody.innerHTML = state.bills.map(b => {
    const vendor = vendorById[b.vendor_id]?.name || b.vendor_name || '—';
    const balance = (Number(b.amount) || 0) - (Number(b.amount_paid) || 0);
    let statusPill;
    const due = b.due_date ? new Date(b.due_date) : null;
    const overdue = due && due < today && b.status !== 'paid' && b.status !== 'void';
    const stat = overdue ? 'overdue' : b.status;
    const cls = stat === 'paid' ? 'ok' : stat === 'overdue' ? 'err' : stat === 'partial' || stat === 'scheduled' ? 'warn' : '';
    statusPill = `<span class="pill ${cls}">${stat}</span>`;
    let approvalPill = '';
    if (b.approval_status === 'approved') approvalPill = '<span class="pill ok">approved</span>';
    else if (b.approval_status === 'rejected') approvalPill = '<span class="pill err">rejected</span>';
    else approvalPill = '<span class="pill warn">pending</span>';
    const actions = [];
    if (b.approval_status === 'pending') actions.push(`<button class="btn small" data-bill-approve="${b.id}">Approve</button>`);
    if (b.approval_status !== 'rejected' && stat !== 'paid' && stat !== 'void') actions.push(`<button class="btn small" data-bill-pay="${b.id}">Pay</button>`);
    return `<tr>
      <td data-label="Vendor">${escapeHtml(vendor)}</td>
      <td data-label="Bill #">${escapeHtml(b.bill_number || '—')}</td>
      <td data-label="Bill date">${escapeHtml(b.bill_date || '')}</td>
      <td data-label="Due">${escapeHtml(b.due_date || '')}</td>
      <td data-label="Amount" style="text-align:right">${fmtUSD2(b.amount)}</td>
      <td data-label="Balance" style="text-align:right">${fmtUSD2(balance)}</td>
      <td data-label="Status">${statusPill}</td>
      <td data-label="Approval">${approvalPill}</td>
      <td data-label="">${actions.join(' ')}</td>
    </tr>`;
  }).join('');

  // Wire approve / pay buttons
  tbody.querySelectorAll('[data-bill-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-bill-approve');
      btn.disabled = true;
      try {
        await billsRepo.approveBill(id);
        await refreshBills();
        renderBillsTable();
        renderBillsAging();
      } catch (e) { console.error(e); alert('Approve failed: ' + e.message); }
      finally { btn.disabled = false; }
    });
  });
  tbody.querySelectorAll('[data-bill-pay]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-bill-pay');
      const bill = (state.bills || []).find(b => b.id === id);
      if (!bill) return;
      document.getElementById('pay-bill-id').value = id;
      const balance = (Number(bill.amount) || 0) - (Number(bill.amount_paid) || 0);
      document.getElementById('pay-amount').value = balance.toFixed(2);
      document.getElementById('pay-date').value = todayISO();
      const vendor = (state.vendors || []).find(v => v.id === bill.vendor_id);
      document.getElementById('pay-bill-summary').textContent =
        `${vendor?.name || 'Vendor'} · ${bill.bill_number || ''} · Balance ${fmtUSD2(balance)}`;
      _show('payment-modal');
    });
  });
}

function renderVendorsTable() {
  const tbody = document.getElementById('vendors-body');
  if (!tbody) return;
  if (!state.vendors || !state.vendors.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:14px;text-align:center;color:#7a715f">No vendors yet. Click <strong>+ New vendor</strong> to add one.</td></tr>';
    return;
  }
  tbody.innerHTML = state.vendors.map(v => `
    <tr>
      <td>${escapeHtml(v.name)}</td>
      <td>${escapeHtml(v.email || '')}</td>
      <td>${escapeHtml(v.phone || '')}</td>
      <td>${escapeHtml(v.default_payment_method || 'check')}</td>
      <td>${v.default_terms_days || 30} days</td>
      <td></td>
    </tr>`).join('');
}

function renderBillsAging() {
  const today = new Date(); today.setHours(0,0,0,0);
  const aging = state.billsAging || [];
  const buckets = {
    current: { label: 'Not yet due', total: 0, count: 0, cls: 'aging-current' },
    d1_30:   { label: '1–30 days',   total: 0, count: 0, cls: 'aging-1-30' },
    d31_60:  { label: '31–60 days',  total: 0, count: 0, cls: 'aging-31-60' },
    d61_90:  { label: '61–90 days',  total: 0, count: 0, cls: 'aging-61-90' },
    d90_plus:{ label: '90+ days',    total: 0, count: 0, cls: 'aging-90' },
  };
  let openAp = 0, overdue = 0, dueWeek = 0, paidThisMonth = 0;
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);

  aging.forEach(r => {
    const bal = Number(r.balance) || 0;
    const bucket = r.aging_bucket || 'current';
    if (buckets[bucket]) { buckets[bucket].total += bal; buckets[bucket].count += 1; }
    if (r.status !== 'paid' && r.status !== 'void') openAp += bal;
    const due = r.due_date ? new Date(r.due_date) : null;
    if (due && due < today && r.status !== 'paid' && r.status !== 'void') overdue += bal;
    if (due && due >= today && due <= weekEnd && r.status !== 'paid' && r.status !== 'void') dueWeek += bal;
  });
  // MTD payments — sum amount_paid on bills where last update is in this month is tricky; approx
  (state.bills || []).forEach(b => {
    paidThisMonth += Number(b.amount_paid) || 0;
  });

  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('ap-kpi-open', fmtUSD(openAp));
  setText('ap-kpi-overdue', fmtUSD(overdue));
  setText('ap-kpi-week', fmtUSD(dueWeek));
  setText('ap-kpi-paid', fmtUSD(paidThisMonth));

  const wrap = document.getElementById('ap-aging-bars');
  if (wrap) {
    const max = Math.max(1, ...Object.values(buckets).map(b => b.total));
    wrap.innerHTML = Object.entries(buckets).map(([k, b]) => {
      const w = Math.round((b.total / max) * 100);
      return `
        <div class="aging-row">
          <div class="aging-label">${b.label}<span class="muted"> · ${b.count}</span></div>
          <div class="aging-track"><div class="aging-fill ${b.cls}" style="width:${w}%"></div></div>
          <div class="aging-amount">${fmtUSD(b.total)}</div>
        </div>`;
    }).join('');
  }
}

// ---------- Payroll ----------
async function renderPayroll() {
  try {
    state.payPeriods = await payrollRepo.listPayPeriods({ limit: 60 }) || [];
  } catch (e) {
    console.error('Load pay periods failed:', e);
    state.payPeriods = state.payPeriods || [];
  }
  renderPayrollPeriods();
  populatePayrollPeriodSelects();
  // Render run detail / tips for selected period
  if (state.selectedPayPeriod) {
    await loadPayRunDetail(state.selectedPayPeriod);
    await loadTipEntries(state.selectedPayPeriod);
  }
}

function renderPayrollPeriods() {
  const tbody = document.getElementById('payroll-periods-body');
  if (!tbody) return;
  if (!state.payPeriods.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;color:#7a715f">No pay periods yet. Click <strong>+ New pay period</strong> to start.</td></tr>';
    return;
  }
  tbody.innerHTML = state.payPeriods.map(p => {
    const cls = p.status === 'paid' ? 'ok' : p.status === 'locked' ? 'warn' : '';
    return `<tr>
      <td data-label="Start">${escapeHtml(p.period_start)}</td>
      <td data-label="End">${escapeHtml(p.period_end)}</td>
      <td data-label="Pay date">${escapeHtml(p.pay_date || '—')}</td>
      <td data-label="Status"><span class="pill ${cls}">${p.status}</span></td>
      <td data-label="Provider">${escapeHtml(p.provider || '—')}</td>
      <td data-label="Total gross" style="text-align:right">${fmtUSD(p.total_gross || 0)}</td>
      <td data-label="" style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn small" data-pp-generate="${p.id}">Generate run</button>
        <button class="btn small ghost" data-pp-detail="${p.id}">View</button>
        ${p.status === 'locked' ? `<button class="btn small ghost" data-pp-unlock="${p.id}">Unlock</button>` : ''}
        ${p.status === 'locked' || p.status === 'paid' ? '' : `<button class="btn small ghost" data-pp-paid="${p.id}">Mark paid</button>`}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-pp-generate]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-pp-generate');
    btn.disabled = true;
    try {
      await payrollRepo.generatePayRun(id);
      state.selectedPayPeriod = id;
      await renderPayroll();
      // Switch to run detail pane
      switchPayrollSub('run');
    } catch (e) { console.error(e); alert('Generate failed: ' + e.message); }
    finally { btn.disabled = false; }
  }));
  tbody.querySelectorAll('[data-pp-detail]').forEach(btn => btn.addEventListener('click', async () => {
    state.selectedPayPeriod = btn.getAttribute('data-pp-detail');
    await loadPayRunDetail(state.selectedPayPeriod);
    switchPayrollSub('run');
  }));
  tbody.querySelectorAll('[data-pp-unlock]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-pp-unlock');
    try { await payrollRepo.unlockPayPeriod(id); await renderPayroll(); }
    catch (e) { alert('Unlock failed: ' + e.message); }
  }));
  tbody.querySelectorAll('[data-pp-paid]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-pp-paid');
    try { await payrollRepo.markPayPeriodPaid(id); await renderPayroll(); }
    catch (e) { alert('Mark paid failed: ' + e.message); }
  }));
}

async function loadPayRunDetail(periodId) {
  const empty = document.getElementById('payroll-run-empty');
  const detail = document.getElementById('payroll-run-detail');
  try {
    const run = await payrollRepo.getRunForPeriod(periodId);
    if (!run) {
      if (empty) empty.hidden = false;
      if (detail) detail.hidden = true;
      return;
    }
    const lines = await payrollRepo.listRunLines(run.id) || [];
    state.payRunLines = lines;
    renderPayRunDetail(run, lines);
    if (empty) empty.hidden = true;
    if (detail) detail.hidden = false;
  } catch (e) {
    console.error('Run detail failed:', e);
    if (empty) empty.hidden = false;
    if (detail) detail.hidden = true;
  }
}

function renderPayRunDetail(run, lines) {
  const period = (state.payPeriods || []).find(p => p.id === run.pay_period_id);
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  let totalHours = 0, regPay = 0, otPay = 0, gross = 0;
  lines.forEach(l => {
    totalHours += (Number(l.regular_hours) || 0) + (Number(l.overtime_hours) || 0);
    regPay += Number(l.regular_pay) || 0;
    otPay += Number(l.overtime_pay) || 0;
    gross += Number(l.gross_pay) || 0;
  });
  setText('pr-kpi-hours', totalHours.toFixed(2));
  setText('pr-kpi-reg', fmtUSD(regPay));
  setText('pr-kpi-ot', fmtUSD(otPay));
  setText('pr-kpi-gross', fmtUSD(gross));
  setText('pr-title', `Pay run · ${period?.period_start || ''} → ${period?.period_end || ''}`);
  setText('pr-sub', `${lines.length} staff · ${run.status || ''}`);

  const staffById = Object.fromEntries((state.staff || []).map(s => [s.id, s]));
  const tbody = document.getElementById('payroll-run-body');
  if (!tbody) return;
  if (!lines.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:14px;text-align:center;color:#7a715f">No staff in this run.</td></tr>';
    return;
  }
  tbody.innerHTML = lines.map(l => {
    const sName = staffById[l.staff_id]?.name || l.staff_name || l.staff_id || '';
    const otCls = (Number(l.overtime_hours) || 0) > 0 ? 'ot-row' : '';
    return `<tr class="${otCls}">
      <td>${escapeHtml(sName)}</td>
      <td style="text-align:right">${Number(l.regular_hours || 0).toFixed(2)}</td>
      <td style="text-align:right">${Number(l.overtime_hours || 0).toFixed(2)}</td>
      <td style="text-align:right">${fmtUSD2(l.hourly_rate)}</td>
      <td style="text-align:right">${fmtUSD2(l.regular_pay)}</td>
      <td style="text-align:right">${fmtUSD2(l.overtime_pay)}</td>
      <td style="text-align:right">${fmtUSD2(l.tips)}</td>
      <td style="text-align:right"><strong>${fmtUSD2(l.gross_pay)}</strong></td>
    </tr>`;
  }).join('');
}

async function loadTipEntries(periodId) {
  try {
    state.tipEntries = await tipPoolRepo.listForPeriod(periodId) || [];
  } catch (e) {
    state.tipEntries = state.tipEntries || [];
  }
  renderTipEntries();
}

function renderTipEntries() {
  const tbody = document.getElementById('tip-entries-body');
  if (!tbody) return;
  const staffById = Object.fromEntries((state.staff || []).map(s => [s.id, s]));
  if (!state.tipEntries.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;color:#7a715f">No tip entries yet for this period.</td></tr>';
    return;
  }
  tbody.innerHTML = state.tipEntries.map(t => `
    <tr>
      <td>${escapeHtml(t.created_at ? new Date(t.created_at).toLocaleDateString() : '')}</td>
      <td>${escapeHtml(staffById[t.staff_id]?.name || t.staff_id || '')}</td>
      <td>${escapeHtml(t.tip_type || 'declared')}</td>
      <td style="text-align:right">${fmtUSD2(t.tip_amount)}</td>
      <td><button class="row-del" data-tip-del="${t.id}">×</button></td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-tip-del]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-tip-del');
    try { await tipPoolRepo.removeEntry(id); await loadTipEntries(state.selectedPayPeriod); }
    catch (e) { alert('Remove failed: ' + e.message); }
  }));
}

function populatePayrollPeriodSelects() {
  const fillSel = (id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Pick period —</option>' +
      (state.payPeriods || []).map(p => `<option value="${p.id}">${p.period_start} → ${p.period_end}</option>`).join('');
    if (cur) sel.value = cur;
    else if (state.selectedPayPeriod) sel.value = state.selectedPayPeriod;
  };
  fillSel('tip-period');
  fillSel('export-period');
  // Staff select for tips
  const tipStaff = document.getElementById('tip-staff');
  if (tipStaff) {
    tipStaff.innerHTML = '<option value="">— Staff —</option>' +
      (state.staff || []).filter(s => s.active !== false).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  }
}

function switchPayrollSub(sub) {
  state.payrollSub = sub;
  document.querySelectorAll('#payroll-sub-seg .sub-seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.payrollSub === sub);
  });
  document.querySelectorAll('.payroll-pane').forEach(p => {
    p.hidden = p.dataset.payrollPane !== sub;
  });
}

// CSV export — client-side
function escapeCsv(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function buildPayrollCsv(provider, lines) {
  const staffById = Object.fromEntries((state.staff || []).map(s => [s.id, s]));
  const splitName = (full) => {
    const [first, ...rest] = (full || '').split(' ');
    return { first: first || '', last: rest.join(' ') || '' };
  };
  let headers = [];
  let rows = [];
  if (provider === 'gusto') {
    headers = ['Employee Name', 'Hours', 'Overtime Hours', 'Tips', 'Other Earnings', 'Pay Type'];
    rows = lines.map(l => {
      const name = staffById[l.staff_id]?.name || l.staff_name || '';
      return [name, Number(l.regular_hours || 0).toFixed(2), Number(l.overtime_hours || 0).toFixed(2), Number(l.tips || 0).toFixed(2), '0.00', 'Hourly'];
    });
  } else if (provider === 'adp') {
    headers = ['Employee ID', 'First Name', 'Last Name', 'Reg Hours', 'O/T Hours', 'Tips'];
    rows = lines.map(l => {
      const fullName = staffById[l.staff_id]?.name || l.staff_name || '';
      const { first, last } = splitName(fullName);
      return [l.staff_id || '', first, last, Number(l.regular_hours || 0).toFixed(2), Number(l.overtime_hours || 0).toFixed(2), Number(l.tips || 0).toFixed(2)];
    });
  } else if (provider === 'paychex') {
    headers = ['Employee Number', 'Name', 'Regular Hours', 'Overtime Hours', 'Tip Income'];
    rows = lines.map(l => {
      const fullName = staffById[l.staff_id]?.name || l.staff_name || '';
      return [l.staff_id || '', fullName, Number(l.regular_hours || 0).toFixed(2), Number(l.overtime_hours || 0).toFixed(2), Number(l.tips || 0).toFixed(2)];
    });
  } else {
    // generic_csv — all internal columns
    headers = ['staff_id', 'staff_name', 'regular_hours', 'overtime_hours', 'hourly_rate', 'regular_pay', 'overtime_pay', 'tips', 'gross_pay'];
    rows = lines.map(l => {
      const name = staffById[l.staff_id]?.name || l.staff_name || '';
      return [l.staff_id || '', name,
        Number(l.regular_hours || 0).toFixed(2),
        Number(l.overtime_hours || 0).toFixed(2),
        Number(l.hourly_rate || 0).toFixed(2),
        Number(l.regular_pay || 0).toFixed(2),
        Number(l.overtime_pay || 0).toFixed(2),
        Number(l.tips || 0).toFixed(2),
        Number(l.gross_pay || 0).toFixed(2)];
    });
  }
  const csv = [headers.map(escapeCsv).join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
  return csv;
}

// =========== Wire all triple-release events ===========
function wireTripleReleaseEvents() {
  // ----- Inventory sub-seg + category filter -----
  document.querySelectorAll('#inv-sub-seg .sub-seg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sub = btn.dataset.invSub;
      state.invSub = sub;
      document.querySelectorAll('#inv-sub-seg .sub-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.inv-pane').forEach(p => p.hidden = p.dataset.invPane !== sub);
      if (sub === 'bar') {
        await renderBarDashboard();
      }
    });
  });
  document.querySelectorAll('#inv-cat-filter .cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.invCat = btn.dataset.cat;
      document.querySelectorAll('#inv-cat-filter .cat-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderInventory();
    });
  });

  // ----- Bar pour modal -----
  document.getElementById('add-bar-pour')?.addEventListener('click', () => {
    const sel = document.getElementById('bp-item');
    if (sel) {
      const barItems = (state.inv || []).filter(i => ['beer','wine','spirits','n/a_beverage'].includes(i.category || ''));
      sel.innerHTML = barItems.length
        ? barItems.map(i => `<option value="${i.id}">${escapeHtml(i.item)}</option>`).join('')
        : '<option value="">No bar items yet</option>';
    }
    _show('bar-pour-modal');
  });
  document.getElementById('bp-cancel')?.addEventListener('click', () => _hide('bar-pour-modal'));
  document.getElementById('bp-save')?.addEventListener('click', async () => {
    const itemId = _val('bp-item');
    const oz = _num('bp-oz');
    if (!itemId || !oz || oz <= 0) { alert('Pick a bottle and enter ounces.'); return; }
    const btn = document.getElementById('bp-save');
    btn.disabled = true;
    try {
      await barPoursRepo.logPour({
        inventoryItemId: itemId,
        pouredOz: oz,
        reason: _val('bp-reason') || 'spill',
        notes: _val('bp-notes').trim() || null,
      });
      await renderBarDashboard();
      _hide('bar-pour-modal');
      _clear(['bp-oz', 'bp-notes']);
    } catch (e) { console.error(e); alert('Log pour failed: ' + e.message); }
    finally { btn.disabled = false; }
  });

  // ----- Bills sub-seg -----
  document.querySelectorAll('#bills-sub-seg .sub-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.billsSub;
      state.billsSub = sub;
      document.querySelectorAll('#bills-sub-seg .sub-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.bills-pane').forEach(p => p.hidden = p.dataset.billsPane !== sub);
    });
  });
  // Bills filter status
  document.getElementById('bills-filter-status')?.addEventListener('change', async (e) => {
    state.billsFilter = e.target.value || '';
    await refreshBills();
    renderBillsTable();
  });

  // ----- Vendor modal -----
  document.getElementById('add-vendor')?.addEventListener('click', () => _show('vendor-modal'));
  document.getElementById('v-cancel')?.addEventListener('click', () => _hide('vendor-modal'));
  document.getElementById('v-save')?.addEventListener('click', async () => {
    const name = _val('v-name').trim();
    if (!name) { alert('Vendor name required'); return; }
    const btn = document.getElementById('v-save'); btn.disabled = true;
    try {
      await vendorsRepo.createVendor({
        name,
        email: _val('v-email').trim() || null,
        phone: _val('v-phone').trim() || null,
        address: _val('v-address').trim() || null,
        defaultPaymentMethod: _val('v-method') || 'check',
        defaultTermsDays: _num('v-terms') || 30,
        accountNumber: _val('v-account').trim() || null,
        notes: _val('v-notes').trim() || null,
      });
      await refreshVendors();
      renderVendorsTable();
      _hide('vendor-modal');
      _clear(['v-name','v-email','v-phone','v-address','v-account','v-notes']);
    } catch (e) { console.error(e); alert('Save vendor failed: ' + e.message); }
    finally { btn.disabled = false; }
  });

  // ----- Bill modal -----
  document.getElementById('add-bill')?.addEventListener('click', async () => {
    // Populate vendor select + invoice select
    const vSel = document.getElementById('b-vendor');
    if (vSel) {
      vSel.innerHTML = (state.vendors || []).length
        ? state.vendors.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')
        : '<option value="">No vendors yet — add one first</option>';
    }
    const iSel = document.getElementById('b-invoice');
    if (iSel) {
      iSel.innerHTML = '<option value="">— None —</option>' +
        ((state.invoices || []).map(inv => `<option value="${inv.id}">${escapeHtml(inv.vendor || '')} · ${escapeHtml(inv.bill_number || '')}</option>`).join(''));
    }
    document.getElementById('b-date').value = todayISO();
    document.getElementById('b-due').value = addDays(todayISO(), 30);
    _show('bill-modal');
  });
  document.getElementById('b-cancel')?.addEventListener('click', () => _hide('bill-modal'));
  document.getElementById('b-save')?.addEventListener('click', async () => {
    const vendorId = _val('b-vendor');
    if (!vendorId) { alert('Pick a vendor.'); return; }
    const amount = _num('b-amount');
    if (!amount || amount <= 0) { alert('Enter an amount.'); return; }
    const btn = document.getElementById('b-save'); btn.disabled = true;
    try {
      await billsRepo.createBill({
        vendorId,
        invoiceId: _val('b-invoice') || null,
        billNumber: _val('b-number').trim() || null,
        billDate: _val('b-date') || todayISO(),
        dueDate: _val('b-due') || addDays(todayISO(), 30),
        amount,
        notes: _val('b-notes').trim() || null,
      });
      await refreshBills();
      renderBillsTable();
      renderBillsAging();
      _hide('bill-modal');
      _clear(['b-number','b-amount','b-notes']);
    } catch (e) { console.error(e); alert('Save bill failed: ' + e.message); }
    finally { btn.disabled = false; }
  });

  // ----- Payment modal -----
  document.getElementById('pay-cancel')?.addEventListener('click', () => _hide('payment-modal'));
  document.getElementById('pay-save')?.addEventListener('click', async () => {
    const billId = document.getElementById('pay-bill-id').value;
    const amount = _num('pay-amount');
    const method = _val('pay-method');
    const date = _val('pay-date') || todayISO();
    const ref = _val('pay-ref').trim() || null;
    if (!billId || !amount || amount <= 0) { alert('Enter an amount.'); return; }
    const btn = document.getElementById('pay-save'); btn.disabled = true;
    try {
      await billsRepo.recordPayment(billId, { amount, method, paymentDate: date, reference: ref });
      await refreshBills();
      renderBillsTable();
      renderBillsAging();
      _hide('payment-modal');
      _clear(['pay-amount','pay-ref']);
    } catch (e) { console.error(e); alert('Record payment failed: ' + e.message); }
    finally { btn.disabled = false; }
  });

  // ----- Payroll sub-seg -----
  document.querySelectorAll('#payroll-sub-seg .sub-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPayrollSub(btn.dataset.payrollSub));
  });

  // ----- Pay period modal -----
  document.getElementById('add-pay-period')?.addEventListener('click', () => {
    const today = todayISO();
    document.getElementById('pp-start').value = addDays(today, -14);
    document.getElementById('pp-end').value = addDays(today, -1);
    document.getElementById('pp-paydate').value = addDays(today, 5);
    _show('pay-period-modal');
  });
  document.getElementById('pp-cancel')?.addEventListener('click', () => _hide('pay-period-modal'));
  document.getElementById('pp-save')?.addEventListener('click', async () => {
    const start = _val('pp-start');
    const end = _val('pp-end');
    if (!start || !end) { alert('Pick start and end dates.'); return; }
    const btn = document.getElementById('pp-save'); btn.disabled = true;
    try {
      await payrollRepo.createPayPeriod({
        periodStart: start,
        periodEnd: end,
        payDate: _val('pp-paydate') || null,
        notes: _val('pp-notes').trim() || null,
      });
      await renderPayroll();
      _hide('pay-period-modal');
      _clear(['pp-notes']);
    } catch (e) { console.error(e); alert('Create period failed: ' + e.message); }
    finally { btn.disabled = false; }
  });

  // ----- Tips entry add -----
  document.getElementById('tip-period')?.addEventListener('change', async (e) => {
    state.selectedPayPeriod = e.target.value || state.selectedPayPeriod;
    if (e.target.value) await loadTipEntries(e.target.value);
  });
  document.getElementById('add-tip-entry')?.addEventListener('click', async () => {
    const periodId = _val('tip-period') || state.selectedPayPeriod;
    const staffId = _val('tip-staff');
    const amount = _num('tip-amount');
    if (!periodId) { alert('Pick a pay period.'); return; }
    if (!staffId) { alert('Pick a staff member.'); return; }
    if (!amount || amount <= 0) { alert('Enter a tip amount.'); return; }
    const btn = document.getElementById('add-tip-entry'); btn.disabled = true;
    try {
      await tipPoolRepo.addEntry({
        payPeriodId: periodId,
        staffId,
        tipAmount: amount,
        tipType: _val('tip-type') || 'declared',
      });
      await loadTipEntries(periodId);
      _clear(['tip-amount']);
    } catch (e) { console.error(e); alert('Add tip failed: ' + e.message); }
    finally { btn.disabled = false; }
  });

  // ----- Export CSV -----
  document.getElementById('export-period')?.addEventListener('change', (e) => {
    state.selectedPayPeriod = e.target.value || state.selectedPayPeriod;
  });
  document.getElementById('export-payroll-csv')?.addEventListener('click', async () => {
    const periodId = _val('export-period') || state.selectedPayPeriod;
    const provider = _val('export-provider') || 'gusto';
    if (!periodId) { alert('Pick a pay period.'); return; }
    const btn = document.getElementById('export-payroll-csv'); btn.disabled = true;
    try {
      const run = await payrollRepo.getRunForPeriod(periodId);
      if (!run) { alert('Generate the run for this period first.'); return; }
      const lines = await payrollRepo.listRunLines(run.id);
      if (!lines || !lines.length) { alert('No lines on this run.'); return; }
      const csv = buildPayrollCsv(provider, lines);
      // Preview
      const pre = document.getElementById('export-preview');
      if (pre) { pre.hidden = false; pre.textContent = csv; }
      // Download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${provider}-${periodId.slice(0,8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      // Mark exported on the period
      try { await payrollRepo.markExported(periodId, provider); await renderPayroll(); } catch (e) { /* non-fatal */ }
    } catch (e) { console.error(e); alert('Export failed: ' + e.message); }
    finally { btn.disabled = false; }
  });
}
