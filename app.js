// RestOps AI — Operations Dashboard
// Vanilla JS + Chart.js. Supabase-backed (module by module).

import {
  DBPR_CHECKLIST,
  TOP_VIOLATIONS,
  MOCK_INSPECTION_QUESTIONS,
  MOCK_ANSWERS,
  SAMPLE_RECIPES,
  SAMPLE_CUSTOMERS,
  TASK_LIBRARY,
} from './phase2.js';
import * as tasksRepo from './tasksRepo.js';
import * as dataRepo from './dataRepo.js';

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
    customers: SAMPLE_CUSTOMERS.map(c => ({ ...c, tags: [...c.tags] })),
    schedule: seedSchedule(),
    forecastSales: 21000, // weekly forecast
    mockSession: null,
    tasks: seedTasks(),
    taskFreq: "all",
    taskCat: "all",
    taskAssignee: "all",
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
    if (t.last < t.min || t.last > t.max) {
      alerts.push({ level: "err", title: `Temperature out of range: ${t.label}`, sub: `Last ${t.last}${t.unit} · safe ${t.min}–${t.max}${t.unit}` });
    }
  });
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
  renderCRM();
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
      <td>${m.name}</td>
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
      <td>${i.item}</td>
      <td>${i.unit}</td>
      <td><input type="number" step="0.1" value="${i.onHand}" data-inv="${idx}" data-field="onHand"/></td>
      <td>${i.par}</td>
      <td>${i.reorder}</td>
      <td>${fmtUSD2(i.cost)}</td>
      <td>${fmtUSD2(value)}</td>
      <td>${i.vendor}</td>
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
    tr.innerHTML = `<td>${w.date}</td><td>${w.item}</td><td>${w.qty}</td><td>${w.reason}</td><td>${fmtUSD2(w.loss)}</td>`;
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
      <td>${s.name}</td>
      <td>${s.role}</td>
      <td><input type="number" step="0.25" value="${s.hourly}" data-staff="${idx}" data-field="hourly"/></td>
      <td><input type="number" step="1" value="${s.hrs}" data-staff="${idx}" data-field="hrs"/></td>
      <td>${fmtUSD2(weekly)}</td>
      <td>${fmtUSD(monthly)}</td>
      <td>${s.cert}</td>
      <td>${s.exp} ${certStatus}</td>
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
  const grid = document.getElementById("temp-grid");
  grid.innerHTML = "";
  state.temps.forEach((t, idx) => {
    const ok = t.last >= t.min && t.last <= t.max;
    const div = document.createElement("div");
    div.className = `temp-cell ${ok ? "ok" : "err"}`;
    div.innerHTML = `
      <div class="temp-label">${t.label}</div>
      <div class="temp-range">Safe: ${t.min}–${t.max} ${t.unit}</div>
      <div class="temp-input">
        <input type="number" step="0.5" value="${t.last}" data-temp="${idx}"/>
        <span class="unit">${t.unit}</span>
        <span class="pill ${ok ? "ok" : "err"}" style="margin-left:auto">${ok ? "In range" : "Alert"}</span>
      </div>
    `;
    grid.appendChild(div);
  });
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
  // Win-back
  const winback = state.customers.filter(c => daysBetween(c.last, todayISO()) > 60).length;
  if (winback > 0) focus.push(`Run a win-back text blast to ${winback} lapsed customers — offer 20% off to return.`);
  // Menu engineering
  const dogs = state.menu.filter(m => {
    const margin = ((m.price - m.cost)/m.price) * 100;
    return margin < 65 && m.units < 150;
  });
  if (dogs.length > 0) focus.push(`Review ${dogs.length} slow-moving low-margin items: ${dogs.map(d => d.name || d.item).join(", ")}.`);
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
// PHASE 2 — CRM
// -----------------------------------------------------------------------------
function renderCRM() {
  const cs = state.customers;
  const active90 = cs.filter(c => daysBetween(c.last, todayISO()) <= 90).length;
  const repeat = cs.filter(c => c.orders >= 2).length;
  const repeatRate = cs.length ? (repeat / cs.length) * 100 : 0;
  const avg = cs.length ? cs.reduce((a,c) => a + c.spent, 0) / cs.length : 0;
  const winback = cs.filter(c => daysBetween(c.last, todayISO()) > 60).length;

  document.getElementById("crm-active").textContent = active90;
  document.getElementById("crm-repeat").textContent = pct(repeatRate);
  document.getElementById("crm-avg").textContent = fmtUSD(avg);
  document.getElementById("crm-winback").textContent = winback;

  const body = document.getElementById("crm-body");
  if (body) {
    body.innerHTML = cs.map(c => {
      const daysSince = daysBetween(c.last, todayISO());
      return `<tr>
        <td><strong>${c.name}</strong><br><span class="muted small">${c.phone}</span></td>
        <td class="mono">${c.orders}</td>
        <td class="mono">${fmtUSD(c.spent)}</td>
        <td>${daysSince}d ago</td>
        <td>${c.tags.map(t => `<span class="tag tag-${t.toLowerCase().replace(/\s|-/g,'')}">${t}</span>`).join(" ")}</td>
      </tr>`;
    }).join("");
  }

  // Campaigns
  const campaigns = [];
  const vips = cs.filter(c => c.tags.includes("VIP"));
  if (vips.length) campaigns.push({ title: "Reward your VIPs", desc: `${vips.length} customers with 20+ orders — send a free garlic knot coupon for their next visit.`, tag: "Loyalty" });
  const wb = cs.filter(c => daysBetween(c.last, todayISO()) > 60);
  if (wb.length) campaigns.push({ title: "Win-back text blast", desc: `${wb.length} customers haven't ordered in 60+ days. Suggested offer: 20% off next order.`, tag: "Win-back" });
  const atRisk = cs.filter(c => c.tags.includes("at-risk"));
  if (atRisk.length) campaigns.push({ title: "At-risk nudge", desc: `${atRisk.length} regulars drifting. Personal text from owner — "We miss you!"`, tag: "Retention" });
  campaigns.push({ title: "Referral program", desc: `Invite top customers to refer a friend for $5 off each. Projected new sign-ups: ~${Math.round(vips.length * 1.5)}.`, tag: "Growth" });
  campaigns.push({ title: "Birthday club", desc: `Collect birthdays at POS and auto-send a free personal pizza email. Industry avg 12% redemption.`, tag: "Loyalty" });

  const cEl = document.getElementById("campaigns-list");
  if (cEl) cEl.innerHTML = campaigns.map(c => `<li>
    <div>
      <div class="cname">${c.title} <span class="tag tag-${c.tag.toLowerCase().replace(/\s|-/g,'')}">${c.tag}</span></div>
      <div class="cdesc">${c.desc}</div>
    </div>
    <button class="ghost-btn">Launch</button>
  </li>`).join("");
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
        overview: ["Overview", "Real-time snapshot of the pizzeria"],
        briefing: ["Weekly Briefing", "Auto-generated insights, anomalies, and focus areas"],
        costs: ["Costs & P&L", "Edit any line — totals and break-even recalculate live"],
        recipes: ["Recipe Costing", "Plate costs, food cost %, and theoretical-vs-actual variance"],
        sales: ["Sales & Menu", "Daily revenue, product mix, and menu engineering"],
        inventory: ["Inventory", "Par levels, vendor spend, and waste tracking"],
        customers: ["Customers / CRM", "Repeat rate, VIPs, win-back, and campaign ideas"],
        labor: ["Labor", "Staff roster, wages, and shift-level efficiency"],
        scheduler: ["Shift Scheduler", "Weekly coverage with live labor-% projection"],
        safety: ["Food Safety", "HACCP temperature logs, checklists, and cleaning"],
        inspection: ["DBPR Inspection Prep", "37-point FL DBPR readiness walkthrough + mock inspection"],
        tasks: ["Task Assignments", "Daily, weekly, and monthly duties — fire, grease trap, hood vents, and more"],
        compliance: ["Licenses", "Licenses, inspections, and training status"],
      };
      const [t, s] = titles[view] || titles.overview;
      document.getElementById("view-title").textContent = t;
      document.getElementById("view-sub").textContent = s;
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
      state.menu[idx][field] = +el.value || 0;
      renderMenu(); renderCharts(); saveState();
    } else if (el.dataset.inv !== undefined) {
      const idx = +el.dataset.inv, field = el.dataset.field;
      state.inv[idx][field] = +el.value || 0;
      renderInventory(); renderAlerts(); renderCompliance(); renderCharts(); saveState();
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

  // Recipe input changes (delegated)
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.rec) {
      const r = state.recipes.find(x => x.id === el.dataset.rec);
      if (!r) return;
      if (el.dataset.recField === "menuPrice") {
        r.menuPrice = +el.value || 0;
      } else if (el.dataset.recIdx !== undefined) {
        const ing = r.ingredients[+el.dataset.recIdx];
        if (ing) ing[el.dataset.recField] = +el.value || 0;
      }
      renderRecipes();
      saveState();
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

  // Hydrate state from Supabase (replaces the mock SAMPLE.* where possible).
  // Each module has its own repo; modules still reading memStore get kept
  // for now and migrate in later passes (Menu/Recipes/CRM/Sales).
  try {
    const [staff, temps, waste, inspChecks, licenses, inspHistory] = await Promise.all([
      dataRepo.fetchStaff(),
      dataRepo.fetchTempLogs(),
      dataRepo.fetchWasteLogs(),
      dataRepo.fetchInspectionChecks(),
      dataRepo.fetchLicenses(),
      dataRepo.fetchInspectionHistory(),
    ]);
    state.staff = staff;
    state.temps = temps;
    state.waste = waste;
    state.inspChecks = inspChecks;
    state.licenses = licenses;
    if (inspHistory.length > 0) {
      state.inspections = inspHistory.map(h => ({
        date: h.date, type: 'Routine', violations: h.violations, high: 0, result: 'Met',
      }));
    }
    // else keep the SAMPLE.inspections so charts/briefing still have data; user hasn't logged any yet.
  } catch (err) {
    console.error('Failed to hydrate state from Supabase:', err);
    alert('Could not load your data: ' + err.message);
  }

  bindEvents();
  renderAll();
  window.__restopsBooted = true;
  // Dev-only debug hook so Playwright QA can inspect state.
  window.__restopsState = state;
  window.__restopsRepos = { dataRepo, tasksRepo };
}

if (window.__RESTOPS_CTX__) {
  // Guard already finished before app.js loaded
  bootApp();
} else {
  window.addEventListener('restops:ready', bootApp, { once: true });
}
