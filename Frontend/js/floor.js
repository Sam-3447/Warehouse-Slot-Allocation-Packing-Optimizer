/* =====================================================================
   NEXVAULT — WAREHOUSE FLOOR
   Core allocation engine + floor page

   READING ORDER
     1. STORAGE / SEED      where the warehouse map lives
     2. MEASUREMENTS        volume, weight, fill percentages
     3. THE ALGORITHM       first-fit-decreasing + ranking + constraints
     4. ACTIONS             add stock, remove stock, reallocate
     5. SUGGESTIONS         what the optimizer is flagging
     6. REQUESTS            company admin asks for a new warehouse
     7. RENDER              draw everything from the data
     8. EVENTS              form handling, filters, tabs
   ===================================================================== */

/* =====================================================================
   1. STORAGE / SEED
   ===================================================================== */

const FLOOR_KEYS = {
  warehousePrefix: 'nexvault-warehouse-',   // one map per warehouse
  active:          'nexvault-active-warehouse',
  unlocked:        'nexvault-unlocked',
  session:         'nexvault-session',
  requests:        'nexvault-warehouse-requests',
  extraSites:      'nexvault-approved-warehouses',
  removedSites:    'nexvault-removed-warehouses'
};

/* =====================================================================
// Seamless migration from legacy storage keys (optivault-* -> nexvault-*)
try {
  ['active-warehouse', 'unlocked', 'session', 'warehouse-requests', 'approved-warehouses', 'removed-warehouses', 'role', 'jwt'].forEach(function(k) {
    if (localStorage.getItem('optivault-' + k) !== null && localStorage.getItem('nexvault-' + k) === null) {
      localStorage.setItem('nexvault-' + k, localStorage.getItem('optivault-' + k));
    }
  });
  for (var _sk = 0; _sk < localStorage.length; _sk++) {
    var _k = localStorage.key(_sk);
    if (_k && _k.indexOf('optivault-warehouse-') === 0) {
      var _nk = _k.replace('optivault-warehouse-', 'nexvault-warehouse-');
      if (localStorage.getItem(_nk) === null) {
        localStorage.setItem(_nk, localStorage.getItem(_k));
      }
    }
  }
} catch(e) {}

   THE THREE WAREHOUSES THIS COMPANY RUNS
   Each one has its own passcode and its own slot map, so stock in
   Mohali is genuinely separate from stock in Patiala.
   ===================================================================== */

let WAREHOUSE_DIRECTORY = [
  {
    id:'WH-MOH',
    name:'Mohali — Phase 8 Yard',
    city:'Mohali',
    address:'Industrial Area Phase 8, Mohali',
    passcode:'4021',
    note:'Main hub · fast-moving retail stock',
    company:'Harbor & Bell Logistics'
  },
  {
    id:'WH-CHD',
    name:'Chandigarh — Industrial Area',
    city:'Chandigarh',
    address:'Industrial Area Phase 1, Chandigarh',
    passcode:'5530',
    note:'City depot · mixed inventory',
    company:'Harbor & Bell Logistics'
  },
  {
    id:'WH-PAT',
    name:'Patiala — Rajpura Road',
    city:'Patiala',
    address:'Rajpura Road, Patiala',
    passcode:'6174',
    note:'Overflow store · bulk and slow movers',
    company:'Harbor & Bell Logistics'
  }
];

function warehouseInfo(id){
  let found = WAREHOUSE_DIRECTORY.find(entry => entry.id === id);
  if(!found && typeof loadApprovedSites === 'function'){
    const approved = loadApprovedSites();
    found = approved.find(entry => entry.id === id) || null;
    if(found && !WAREHOUSE_DIRECTORY.some(e => e.id === id)){
      WAREHOUSE_DIRECTORY.push(found);
    }
  }
  return found || null;
}

function warehousesForCompany(companyName){
  if(!companyName || companyName === 'Demo company' || companyName === 'Harbor & Bell Logistics'){
    return WAREHOUSE_DIRECTORY.filter(entry => !entry.company || entry.company === 'Harbor & Bell Logistics');
  }
  return WAREHOUSE_DIRECTORY.filter(entry => entry.company === companyName);
}

// Fetch all approved/generated warehouses for this company live from MongoDB Atlas
async function syncWarehousesForCompany(companyName){
  if(!companyName || companyName === 'Demo company') return;
  try{
    const url = typeof getApiUrl === 'function' 
      ? getApiUrl('/api/warehouse/company/' + encodeURIComponent(companyName))
      : '/api/warehouse/company/' + encodeURIComponent(companyName);
    const res = await fetch(url);
    if(res.ok){
      const data = await res.json();
      if(data && data.success && Array.isArray(data.warehouses)){
        const approved = typeof loadApprovedSites === 'function' ? loadApprovedSites() : [];
        data.warehouses.forEach(w => {
          const existing = WAREHOUSE_DIRECTORY.find(entry => entry.id === w.id);
          if(existing){
            existing.name = w.name;
            if(w.city) existing.city = w.city;
            if(w.passcode) existing.passcode = w.passcode;
          } else {
            WAREHOUSE_DIRECTORY.push({
              id: w.id,
              name: w.name,
              city: w.city || 'Central Hub',
              address: w.city || 'Industrial Area',
              passcode: w.passcode || '1101',
              note: `${companyName} site`,
              company: companyName
            });
          }

          const appIdx = approved.findIndex(entry => entry.id === w.id);
          if(appIdx >= 0){
            approved[appIdx].name = w.name;
            if(w.city) approved[appIdx].city = w.city;
            if(w.passcode) approved[appIdx].passcode = w.passcode;
          } else {
            approved.push({
              id: w.id,
              name: w.name,
              city: w.city || 'Central Hub',
              address: w.city || 'Industrial Area',
              passcode: w.passcode || '1101',
              note: `${companyName} site`,
              company: companyName
            });
          }
        });
        if(typeof saveApprovedSites === 'function'){
          saveApprovedSites(approved);
        }
      }
    }
  }catch(e){}
}

/* Rack layouts differ per site, which is why the three warehouses
   report different capacity. distanceFromDock is what makes the
   velocity ranking possible: 1 = at the loading dock. */
const RACK_PLANS = {
  'WH-MOH': [
    { id:'A', name:'Rack A', zone:'Fast-pick',       distanceFromDock:1, maxVolume:900,  maxWeight:450 },
    { id:'F', name:'Rack F', zone:'Outbound stage',  distanceFromDock:1, maxVolume:600,  maxWeight:300 },
    { id:'C', name:'Rack C', zone:'Cold zone',       distanceFromDock:2, maxVolume:800,  maxWeight:400 },
    { id:'B', name:'Rack B', zone:'Bulk overrun',    distanceFromDock:3, maxVolume:1400, maxWeight:900 },
    { id:'E', name:'Rack E', zone:'Returns staging', distanceFromDock:4, maxVolume:700,  maxWeight:350 },
    { id:'D', name:'Rack D', zone:'Reserve cage',    distanceFromDock:5, maxVolume:1200, maxWeight:700 }
  ],
  'WH-CHD': [
    { id:'A', name:'Rack A', zone:'Fast-pick',      distanceFromDock:1, maxVolume:800,  maxWeight:400 },
    { id:'B', name:'Rack B', zone:'Outbound stage', distanceFromDock:2, maxVolume:700,  maxWeight:350 },
    { id:'C', name:'Rack C', zone:'General store',  distanceFromDock:3, maxVolume:1100, maxWeight:650 },
    { id:'D', name:'Rack D', zone:'Reserve cage',   distanceFromDock:4, maxVolume:1000, maxWeight:600 },
    { id:'E', name:'Rack E', zone:'Deep store',     distanceFromDock:5, maxVolume:1300, maxWeight:800 }
  ],
  'WH-PAT': [
    { id:'A', name:'Rack A', zone:'Fast-pick',    distanceFromDock:1, maxVolume:700,  maxWeight:350 },
    { id:'B', name:'Rack B', zone:'Bulk overrun', distanceFromDock:2, maxVolume:1500, maxWeight:950 },
    { id:'C', name:'Rack C', zone:'Deep store',   distanceFromDock:4, maxVolume:1400, maxWeight:900 },
    { id:'D', name:'Rack D', zone:'Reserve cage', distanceFromDock:5, maxVolume:1200, maxWeight:700 }
  ]
};

/* Warehouses the platform admin has approved get stored separately
   and merged in here, so every page that loads this file sees them
   alongside the three the company started with. */
function loadApprovedSites(){
  try{
    const raw = localStorage.getItem(FLOOR_KEYS.extraSites);
    return raw ? JSON.parse(raw) : [];
  }catch(err){
    console.warn('Could not read approved warehouses:', err);
    return [];
  }
}

function saveApprovedSites(list){
  try{
    localStorage.setItem(FLOOR_KEYS.extraSites, JSON.stringify(list));
  }catch(err){
    console.warn('Could not save approved warehouses:', err);
  }
}

function mergeApprovedSites(){
  const companies = typeof loadCompanyAccounts === 'function' ? loadCompanyAccounts() : [];
  const validCompanies = new Set(companies.map(c => c.name));
  validCompanies.add('Harbor & Bell Logistics');
  validCompanies.add('Demo company');

  const approved = loadApprovedSites().filter(site => validCompanies.has(site.company));
  saveApprovedSites(approved);

  approved.forEach(site => {
    const known = WAREHOUSE_DIRECTORY.some(entry => entry.id === site.id);
    if(!known){
      WAREHOUSE_DIRECTORY.push({
        id: site.id,
        name: site.name,
        city: site.city,
        address: site.address,
        passcode: site.passcode,
        note: site.note,
        company: site.company,
        openedAt: site.openedAt
      });
    }
    if(site.rackPlan && site.rackPlan.length){
      RACK_PLANS[site.id] = site.rackPlan;
    }
  });
}

// runs as soon as this file loads, before any page code
mergeApprovedSites();

/* Deleted warehouses (approved removal requests) drop out here,
   so a removed site does not reappear on the next page load. */
function loadRemovedSites(){
  try{
    const raw = localStorage.getItem(FLOOR_KEYS.removedSites);
    return raw ? JSON.parse(raw) : [];
  }catch(err){
    console.warn('Could not read removed warehouses:', err);
    return [];
  }
}

function saveRemovedSites(list){
  try{
    localStorage.setItem(FLOOR_KEYS.removedSites, JSON.stringify(list));
  }catch(err){
    console.warn('Could not save removed warehouses:', err);
  }
}

function applyRemovedSites(){
  const removed = loadRemovedSites();
  if(!removed.length) return;
  WAREHOUSE_DIRECTORY = WAREHOUSE_DIRECTORY.filter(entry => !removed.includes(entry.id));
}

applyRemovedSites();

const ZONE_NAMES = [
  'Fast-pick', 'Outbound stage', 'General store',
  'Bulk overrun', 'Deep store', 'Reserve cage',
  'Returns staging', 'Overflow'
];

/* Racks are sized to the slots the company asked for: eight slots
   per rack, and each rack sits a little further from the dock. */
function buildRackPlan(slotsWanted){
  const num = Number(slotsWanted) || 32;
  const rackCount = Math.max(2, Math.min(8, Math.round(num / 8)));
  const plan = [];
  for(let i = 0; i < rackCount; i++){
    const letter = String.fromCharCode(65 + i);
    const deep = i >= rackCount / 2;
    plan.push({
      id: letter,
      name: 'Rack ' + letter,
      zone: ZONE_NAMES[i % ZONE_NAMES.length],
      distanceFromDock: i + 1,
      maxVolume: deep ? 1300 : 800,
      maxWeight: deep ? 800 : 400
    });
  }
  return plan;
}

/* Four bays per rack, two levels per bay = 8 slots per rack. */
const BAYS_PER_RACK = 4;
const LEVELS_PER_BAY = 2;

function buildEmptyWarehouse(id){
  const info = warehouseInfo(id);
  let plan = RACK_PLANS[id];
  if(!plan || !plan.length){
    if(info && info.rackPlan && info.rackPlan.length){
      plan = info.rackPlan;
      RACK_PLANS[id] = plan;
    }else{
      plan = buildRackPlan(32);
      RACK_PLANS[id] = plan;
    }
  }

  const racks = plan.map(entry => {
    const slots = [];
    for(let bay = 1; bay <= BAYS_PER_RACK; bay++){
      for(let level = 1; level <= LEVELS_PER_BAY; level++){
        slots.push({
          id: `${entry.id}-${String(bay).padStart(2,'0')}-${level}`,
          rackId: entry.id,
          rackName: entry.name,
          zone: entry.zone,
          distanceFromDock: entry.distanceFromDock,
          bay: bay,
          level: level,
          maxVolume: entry.maxVolume || (entry.id >= 'E' ? 1300 : 800),
          maxWeight: entry.maxWeight || (entry.id >= 'E' ? 800 : 400),
          units: []
        });
      }
    }
    return {
      id: entry.id,
      name: entry.name,
      zone: entry.zone,
      distanceFromDock: entry.distanceFromDock,
      slots: slots
    };
  });

  return {
    id: id,
    name: info ? info.name : id,
    sector: info ? info.city : '',
    racks: racks,
    pending: [],
    log: []
  };
}

/* Opening stock per site, so the three warehouses do not look alike.
   These go through the real algorithm, not straight into slots. */
const SEED_STOCK = {
  'WH-MOH': [
    { sku:'SKU-88213', name:'Pallet wrap',     l:100, w:80, h:70, weight:22, velocity:'fast',   fragile:false, qty:16 },
    { sku:'SKU-40410', name:'Carton stock',    l:80,  w:60, h:60, weight:14, velocity:'fast',   fragile:false, qty:14 },
    { sku:'SKU-21877', name:'Label rolls',     l:40,  w:40, h:30, weight:4,  velocity:'fast',   fragile:false, qty:18 },
    { sku:'SKU-12190', name:'Bin flats',       l:120, w:80, h:40, weight:11, velocity:'medium', fragile:false, qty:12 },
    { sku:'SKU-63155', name:'Cold packs',      l:90,  w:70, h:50, weight:16, velocity:'medium', fragile:false, qty:9 },
    { sku:'SKU-47720', name:'Returns cartons', l:70,  w:50, h:50, weight:8,  velocity:'medium', fragile:false, qty:10 },
    { sku:'SKU-73004', name:'Spare motors',    l:60,  w:60, h:60, weight:28, velocity:'slow',   fragile:false, qty:9 },
    { sku:'SKU-55021', name:'Glass panels',    l:100, w:70, h:40, weight:20, velocity:'slow',   fragile:true,  qty:3 }
  ],
  'WH-CHD': [
    { sku:'SKU-30112', name:'Retail cartons',  l:80,  w:60, h:50, weight:12, velocity:'fast',   fragile:false, qty:12 },
    { sku:'SKU-21877', name:'Label rolls',     l:40,  w:40, h:30, weight:4,  velocity:'fast',   fragile:false, qty:14 },
    { sku:'SKU-66840', name:'Shelf brackets',  l:90,  w:50, h:40, weight:19, velocity:'medium', fragile:false, qty:10 },
    { sku:'SKU-47720', name:'Returns cartons', l:70,  w:50, h:50, weight:8,  velocity:'medium', fragile:false, qty:8 },
    { sku:'SKU-55021', name:'Glass panels',    l:100, w:70, h:40, weight:20, velocity:'slow',   fragile:true,  qty:2 },
    { sku:'SKU-73004', name:'Spare motors',    l:60,  w:60, h:60, weight:28, velocity:'slow',   fragile:false, qty:6 }
  ],
  'WH-PAT': [
    { sku:'SKU-90355', name:'Bulk sacks',      l:110, w:90, h:60, weight:34, velocity:'slow',   fragile:false, qty:9 },
    { sku:'SKU-73004', name:'Spare motors',    l:60,  w:60, h:60, weight:28, velocity:'slow',   fragile:false, qty:8 },
    { sku:'SKU-12190', name:'Bin flats',       l:120, w:80, h:40, weight:11, velocity:'medium', fragile:false, qty:7 },
    { sku:'SKU-30112', name:'Retail cartons',  l:80,  w:60, h:50, weight:12, velocity:'fast',   fragile:false, qty:6 }
  ]
};

/* Which warehouse is the supervisor working in right now? */
function activeWarehouseId(){
  return localStorage.getItem(FLOOR_KEYS.active);
}

function storageKeyFor(id){
  return FLOOR_KEYS.warehousePrefix + id;
}

// Synchronize warehouse live with MongoDB Atlas Cloud
async function syncFromCloud(id){
  try{
    const endpoint = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/' + id) : '/api/warehouse/' + id;
    const res = await fetch(endpoint);
    if(res.ok){
      const data = await res.json();
      if(data && data.success && data.warehouse && data.warehouse.racks && data.warehouse.racks.length){
        WAREHOUSE = data.warehouse;
        try{ localStorage.setItem(storageKeyFor(id), JSON.stringify(WAREHOUSE)); }catch(e){}
        if(typeof renderAll === 'function') renderAll();
        if(typeof updateHeaderStats === 'function') updateHeaderStats();
        if(typeof render3D === 'function') render3D();
        console.log(`[MongoDB Atlas] Live warehouse ${id} loaded from cloud`);
      }
    }
  }catch(err){
    // Graceful offline fallback
  }
}

function loadWarehouse(id){
  // Trigger background cloud sync from MongoDB Atlas
  syncFromCloud(id);

  try{
    const raw = localStorage.getItem(storageKeyFor(id));
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && parsed.racks && Array.isArray(parsed.racks) && parsed.racks.length > 0){
        return parsed;
      }
    }
  }catch(err){
    console.warn('Could not read the warehouse map:', err);
  }

  const fresh = buildEmptyWarehouse(id);
  (SEED_STOCK[id] || []).forEach(entry => {
    allocateBatch(fresh, expandToUnits(fresh, entry), { silent:true });
  });
  addLog(fresh, 'Warehouse map created with opening stock.');
  saveWarehouse(fresh);
  return fresh;
}

function saveWarehouse(warehouse){
  try{
    localStorage.setItem(storageKeyFor(warehouse.id), JSON.stringify(warehouse));
  }catch(err){
    console.warn('Could not save the warehouse map:', err);
  }

  // Persist floor state directly to MongoDB Atlas
  try{
    const syncUrl = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/sync') : '/api/warehouse/sync';
    const session = (function(){ try { return JSON.parse(localStorage.getItem(FLOOR_KEYS.session)); } catch(e){ return null; } })();
    const whMeta = typeof warehouseInfo === 'function' ? warehouseInfo(warehouse.id) : null;
    const currentCompany = (session && session.company) || (whMeta && whMeta.company) || '';

    fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouseId: warehouse.id,
        companyName: currentCompany,
        racks: warehouse.racks
      })
    }).catch(err => console.warn('[MongoDB Sync Note]', err.message));
  }catch(e){}
}

function addLog(warehouse, text){
  warehouse.log.unshift({ text: text, at: Date.now() });
  warehouse.log = warehouse.log.slice(0, 20);
}

/* =====================================================================
   2. MEASUREMENTS
   Dimensions are centimetres, volume is litres, weight is kilograms.
   ===================================================================== */

function volumeOf(l, w, h){
  return (l * w * h) / 1000;          // cm³ -> litres
}

function usedVolume(slot){
  return slot.units.reduce((total, unit) => total + unit.volume, 0);
}

function usedWeight(slot){
  return slot.units.reduce((total, unit) => total + unit.weight, 0);
}

function freeVolume(slot){
  return (slot.maxVolume || 900) - usedVolume(slot);
}

function slotFill(slot){
  const max = slot.maxVolume || 900;
  return max ? Math.round((usedVolume(slot) / max) * 100) : 0;
}

function rackFill(rack){
  if(!rack || !rack.slots) return 0;
  const capacity = rack.slots.reduce((total, slot) => total + (slot.maxVolume || 900), 0);
  const filled = rack.slots.reduce((total, slot) => total + usedVolume(slot), 0);
  return capacity ? Math.round((filled / capacity) * 100) : 0;
}

function allSlots(warehouse){
  return warehouse.racks.flatMap(rack =>
    rack.slots.map(slot => ({ slot: slot, rack: rack }))
  );
}

function findSlotById(warehouse, slotId){
  const wanted = String(slotId).trim().toUpperCase();
  return allSlots(warehouse).find(entry => entry.slot.id === wanted) || null;
}

function hasFragile(slot){
  return slot.units.some(unit => unit.fragile);
}

function warehouseStats(warehouse){
  const slots = allSlots(warehouse);
  const capacity = slots.reduce((t, e) => t + e.slot.maxVolume, 0);
  const filled = slots.reduce((t, e) => t + usedVolume(e.slot), 0);
  const empty = slots.filter(e => e.slot.units.length === 0).length;
  return {
    capacityUsed: capacity ? Math.round((filled / capacity) * 100) : 0,
    usedLitres: Math.round(filled),
    totalLitres: Math.round(capacity),
    emptySlots: empty,
    totalSlots: slots.length,
    rackCount: warehouse.racks.length,
    pending: warehouse.pending.length
  };
}

/* =====================================================================
   3. THE ALGORITHM
   First-fit-decreasing, with two additions on top of the base heuristic:
     - slots are ranked by travel distance against item velocity
     - a slot is only a candidate if it passes the safety checks
   ===================================================================== */

/* Turn one stock entry into individual units. Bin packing works on
   units, not on a quantity field. */
function expandToUnits(warehouse, entry){
  const units = [];
  const volume = volumeOf(entry.l, entry.w, entry.h);
  for(let i = 0; i < entry.qty; i++){
    units.push({
      ref: makeRef(),
      sku: entry.sku,
      name: entry.name,
      l: entry.l, w: entry.w, h: entry.h,
      volume: Number(volume.toFixed(2)),
      weight: entry.weight,
      velocity: entry.velocity,
      fragile: entry.fragile,
      addedAt: Date.now()
    });
  }
  return units;
}

function makeRef(){
  return 'U' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/* ---------------------------------------------------------------
   SAFETY CHECKS
   Every reason a slot can refuse a unit lives here, so the UI can
   explain a refusal instead of just failing.
   --------------------------------------------------------------- */
function slotAccepts(slot, unit){
  if(unit.volume > slot.maxVolume){
    return { ok:false, reason:'Unit is larger than the slot' };
  }
  if(usedVolume(slot) + unit.volume > slot.maxVolume){
    return { ok:false, reason:'Not enough space left' };
  }
  if(usedWeight(slot) + unit.weight > slot.maxWeight){
    return { ok:false, reason:'Would exceed the slot weight limit' };
  }
  // Nothing is ever stacked on top of something fragile.
  if(hasFragile(slot)){
    return { ok:false, reason:'Slot holds a fragile unit' };
  }
  // A fragile unit gets a slot to itself.
  if(unit.fragile && slot.units.length > 0){
    return { ok:false, reason:'Fragile unit needs an empty slot' };
  }
  return { ok:true };
}

/* ---------------------------------------------------------------
   SLOT RANKING
   Fast movers are pulled many times a day, so they belong near the
   dock. Slow movers are pulled rarely, so they go deep and leave the
   short walk free. Where two slots rank equally, the tighter fit wins,
   which is what keeps wasted space down.
   --------------------------------------------------------------- */
function rankSlots(candidates, unit){
  const distances = candidates.map(entry => entry.rack.distanceFromDock);
  const middle = (Math.min(...distances) + Math.max(...distances)) / 2;

  return candidates.slice().sort((a, b) => {
    const da = a.rack.distanceFromDock;
    const db = b.rack.distanceFromDock;

    if(unit.velocity === 'fast' && da !== db){
      return da - db;                       // nearest dock first
    }
    if(unit.velocity === 'slow' && da !== db){
      return db - da;                       // deepest first
    }
    if(unit.velocity === 'medium'){
      const offsetA = Math.abs(da - middle);
      const offsetB = Math.abs(db - middle);
      if(offsetA !== offsetB) return offsetA - offsetB;
    }
    // Tie-break: least space left over after the unit goes in.
    return (freeVolume(a.slot) - unit.volume) - (freeVolume(b.slot) - unit.volume);
  });
}

/* ---------------------------------------------------------------
   FIND A SLOT
   Filter to slots that will accept the unit, rank them, take the
   first. That "take the first" is the first-fit part.

   findSlotDetailed also hands back the full ranked shortlist, which
   is what lets the allocation report explain the choice instead of
   just announcing it. The decision itself is unchanged: ranked[0].
   --------------------------------------------------------------- */
function findSlotDetailed(warehouse, unit){
  const everySlot = allSlots(warehouse);
  const candidates = everySlot.filter(entry => slotAccepts(entry.slot, unit).ok);

  if(candidates.length === 0){
    return { target:null, ranked:[], totalSlots: everySlot.length };
  }
  const ranked = rankSlots(candidates, unit);
  return { target: ranked[0], ranked: ranked, totalSlots: everySlot.length };
}

function findSlotFor(warehouse, unit){
  return findSlotDetailed(warehouse, unit).target;
}

/* ---------------------------------------------------------------
   WHY THIS SLOT
   Reads the shortlist the ranking produced and reports which rule
   actually decided the winner. Pure reporting — it never changes
   where a unit goes.
   --------------------------------------------------------------- */
function explainChoice(ranked, unit){
  const chosen = ranked[0];
  const distances = ranked.map(entry => entry.rack.distanceFromDock);
  const spread = Array.from(new Set(distances)).sort((a, b) => a - b);
  const leftover = Math.round(freeVolume(chosen.slot) - unit.volume);

  let rule = 'Tightest fit';
  let text = '';

  if(spread.length > 1 && unit.velocity === 'fast'){
    rule = 'Velocity';
    text = `Fast mover, so the nearest rack with room wins. ${chosen.rack.name} sits ${chosen.rack.distanceFromDock} from the dock — the racks that had space ranged ${spread[0]} to ${spread[spread.length - 1]}.`;
  }else if(spread.length > 1 && unit.velocity === 'slow'){
    rule = 'Velocity';
    text = `Slow mover, so it is stored deep and leaves the short walk free. ${chosen.rack.name} sits ${chosen.rack.distanceFromDock} from the dock — the furthest that had room.`;
  }else if(spread.length > 1 && unit.velocity === 'medium'){
    rule = 'Velocity';
    const middle = (Math.min(...distances) + Math.max(...distances)) / 2;
    text = `Medium mover, so it aims for the middle of the floor (${middle} from the dock). ${chosen.rack.name} at ${chosen.rack.distanceFromDock} was the closest rack to that.`;
  }else{
    text = `Every slot that could take this unit sat the same distance from the dock, so the tie-break decided it — the slot left with the least spare room.`;
  }

  const tied = ranked.filter(entry => entry.rack.distanceFromDock === chosen.rack.distanceFromDock).length;
  if(rule === 'Velocity' && tied > 1){
    text += ` ${tied} slots tied at that distance, so the tightest fit chose between them.`;
  }

  return {
    rule: rule,
    text: text,
    leftover: leftover,
    considered: ranked.length
  };
}

/* ---------------------------------------------------------------
   ALLOCATE A BATCH
   Sorting largest-first is the "decreasing" part of
   first-fit-decreasing. Big awkward units get the pick of the
   shelves while space is still open; small units fill the gaps.
   --------------------------------------------------------------- */
function allocateBatch(warehouse, units, options){
  const settings = options || {};
  const queue = units.slice().sort((a, b) => b.volume - a.volume);
  const placed = [];
  const rejected = [];

  queue.forEach((unit, index) => {
    const search = findSlotDetailed(warehouse, unit);
    const target = search.target;

    if(target){
      // Worked out before the unit goes in, while the slot still
      // shows the free space the decision was made against.
      const why = explainChoice(search.ranked, unit);

      unit.slotId = target.slot.id;
      target.slot.units.push(unit);

      placed.push({
        unit: unit,
        slotId: target.slot.id,
        rack: target.rack.name,
        rackId: target.rack.id,
        zone: target.rack.zone,
        distance: target.rack.distanceFromDock,
        queuePosition: index + 1,
        queueSize: queue.length,
        totalSlots: search.totalSlots,
        why: why
      });
    }else{
      rejected.push({
        unit: unit,
        reason: whyNothingFits(warehouse, unit),
        queuePosition: index + 1,
        queueSize: queue.length
      });
      warehouse.pending.push(unit);
    }
  });

  if(!settings.silent && placed.length){
    addLog(warehouse, `Placed ${placed.length} unit${placed.length > 1 ? 's' : ''} of ${queue[0].sku}.`);
  }

  return { placed: placed, rejected: rejected };
}

/* The most common refusal across the whole floor, so the message
   the supervisor sees is the actual blocker. */
function whyNothingFits(warehouse, unit){
  const reasons = allSlots(warehouse)
    .map(entry => slotAccepts(entry.slot, unit).reason)
    .filter(Boolean);

  if(reasons.length === 0) return 'No slot available';

  const tally = {};
  reasons.forEach(reason => { tally[reason] = (tally[reason] || 0) + 1; });
  return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
}

/* =====================================================================
   4. ACTIONS
   ===================================================================== */

function addStock(warehouse, entry){
  const units = expandToUnits(warehouse, entry);
  const result = allocateBatch(warehouse, units);

  if(result.rejected.length){
    addLog(warehouse, `${result.rejected.length} unit${result.rejected.length > 1 ? 's' : ''} of ${entry.sku} could not be placed.`);
  }
  saveWarehouse(warehouse);
  return result;
}

/* Removing stock frees capacity, which is exactly when the pending
   queue is worth retrying. That retry is the reallocation step. */
function removeStock(warehouse, slotId, sku, quantity){
  const target = findSlotById(warehouse, slotId);
  if(!target){
    return { ok:false, message:`No slot called ${slotId} on this floor.` };
  }

  const wanted = String(sku).trim().toUpperCase();
  const matching = target.slot.units.filter(unit => unit.sku.toUpperCase() === wanted);
  if(matching.length === 0){
    return { ok:false, message:`${slotId} is not holding ${sku}.` };
  }

  const count = Math.min(quantity, matching.length);
  const removing = matching.slice(0, count);
  const removingRefs = removing.map(unit => unit.ref);
  const freedVolume = removing.reduce((total, unit) => total + unit.volume, 0);
  const freedWeight = removing.reduce((total, unit) => total + unit.weight, 0);

  target.slot.units = target.slot.units.filter(unit => !removingRefs.includes(unit.ref));
  addLog(warehouse, `Removed ${count} × ${wanted} from ${target.slot.id}.`);

  // Persist stock removal to MongoDB Atlas
  try{
    const removeUrl = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/remove') : '/api/warehouse/remove';
    fetch(removeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouseId: warehouse.id,
        slotId: target.slot.id,
        sku: wanted,
        quantity: count
      })
    }).catch(() => {});
  }catch(e){}

  const moved = runReallocation(warehouse);
  saveWarehouse(warehouse);

  return {
    ok: true,
    removed: count,
    sku: wanted,
    slotId: target.slot.id,
    rack: target.rack.name,
    freedVolume: Math.round(freedVolume),
    freedWeight: Math.round(freedWeight),
    slotFillNow: slotFill(target.slot),
    reallocated: moved.length,          // still a number for older callers
    reallocatedDetail: moved
  };
}

/* Retry everything waiting in the pending queue now that space
   has opened up. Returns the units it managed to place, so the
   reallocation can be shown rather than just counted. */
function runReallocation(warehouse){
  if(warehouse.pending.length === 0) return [];

  const waiting = warehouse.pending.slice();
  warehouse.pending = [];
  const result = allocateBatch(warehouse, waiting, { silent:true });

  if(result.placed.length){
    addLog(warehouse, `Reallocation placed ${result.placed.length} waiting unit${result.placed.length > 1 ? 's' : ''}.`);
  }
  return result.placed;
}

/* =====================================================================
   5. SUGGESTIONS
   Everything the optimizer flags is derived from the current map.
   ===================================================================== */

function buildSuggestions(warehouse){
  const list = [];

  // Racks running out of room. The replacement rack is the closest one
  // with real space, not simply the emptiest — a suggestion that sends
  // fast-pick overflow to the far end of the building is a bad one.
  warehouse.racks.forEach(rack => {
    const fill = rackFill(rack);
    if(fill >= 90){
      const roomier = warehouse.racks
        .filter(other => other.id !== rack.id && rackFill(other) < 60)
        .sort((a, b) =>
          (a.distanceFromDock - b.distanceFromDock) || (rackFill(a) - rackFill(b))
        )[0];

      list.push({
        severity: 'high',
        type: 'Rack pressure',
        title: roomier
          ? `${rack.name} at ${fill}% — send new putaway to ${roomier.name}`
          : `${rack.name} at ${fill}% — no rack has spare room`
      });
    }
  });

  // Slots nearly full, grouped per rack so one tight rack is one flag
  // rather than eight identical ones.
  warehouse.racks.forEach(rack => {
    const tight = rack.slots.filter(slot => slotFill(slot) >= 92);
    if(tight.length && rackFill(rack) < 90){
      list.push({
        severity: 'medium',
        type: 'Overfill',
        title: tight.length === 1
          ? `${tight[0].id} at ${slotFill(tight[0])}% — ${Math.round(freeVolume(tight[0]))} L left`
          : `${tight.length} slots in ${rack.name} are over 92% full`
      });
    }
  });

  // Units that never found a home
  if(warehouse.pending.length){
    const grouped = {};
    warehouse.pending.forEach(unit => {
      grouped[unit.sku] = (grouped[unit.sku] || 0) + 1;
    });
    Object.keys(grouped).forEach(sku => {
      list.push({
        severity: 'high',
        type: 'Waiting',
        title: `${grouped[sku]} × ${sku} waiting — free a slot to place them`
      });
    });
  }

  // Fast movers sitting deep in the building while a near slot is open
  const nearOpen = allSlots(warehouse)
    .filter(entry => entry.rack.distanceFromDock <= 2 && freeVolume(entry.slot) > 0);

  warehouse.racks
    .filter(rack => rack.distanceFromDock >= 4)
    .forEach(rack => {
      rack.slots.forEach(slot => {
        slot.units
          .filter(unit => unit.velocity === 'fast')
          .slice(0, 1)
          .forEach(unit => {
            const better = nearOpen.find(entry => slotAccepts(entry.slot, unit).ok);
            if(better){
              list.push({
                severity: 'medium',
                type: 'Travel time',
                title: `${unit.sku} is a fast mover in ${rack.name} — ${better.slot.id} is closer to the dock`
              });
            }
          });
      });
    });

  return list;
}

/* =====================================================================
   6. WAREHOUSE REQUESTS
   A company admin cannot open a warehouse on their own. They file a
   request, the platform admin approves or rejects it. Both sides read
   this one list, which is why it lives in the shared engine file.
   ===================================================================== */

function loadRequests(){
  try{
    const raw = localStorage.getItem(FLOOR_KEYS.requests);
    if(raw) {
      const list = JSON.parse(raw);
      if(Array.isArray(list)){
        const companies = typeof loadCompanyAccounts === 'function' ? loadCompanyAccounts() : [];
        if(companies.length){
          const validCompanies = new Set(companies.map(c => c.name));
          validCompanies.add('Harbor & Bell Logistics');
          validCompanies.add('Demo company');
          return list.filter(r => validCompanies.has(r.company));
        }
        return list;
      }
    }
  }catch(err){
    console.warn('Could not read warehouse requests:', err);
  }
  return [];
}

function saveRequests(list){
  try{
    localStorage.setItem(FLOOR_KEYS.requests, JSON.stringify(list));
  }catch(err){
    console.warn('Could not save warehouse requests:', err);
  }
}

function makeRequestRef(){
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${year}-${random}`;
}

/* Filed by the company admin. Status starts as pending — nothing
   about the warehouse exists until the platform admin approves it. */
function submitWarehouseRequest(details){
  const list = loadRequests();
  const request = {
    ref: makeRequestRef(),
    type: 'open',
    company: details.company,
    city: details.city,
    address: details.address,
    proposedSlots: details.proposedSlots,
    contact: details.contact,
    note: details.note || '',
    status: 'pending',
    submittedAt: Date.now(),
    decidedAt: null
  };
  list.unshift(request);
  saveRequests(list);
  return request;
}

function requestsForCompany(company){
  return loadRequests().filter(entry => entry.company === company);
}

/* Used by the platform admin page. */
function decideRequest(ref, decision){
  const list = loadRequests();
  const found = list.find(entry => entry.ref === ref);
  if(!found) return null;
  found.status = decision;             // 'approved' or 'rejected'
  found.decidedAt = Date.now();
  saveRequests(list);
  return found;
}

/* ---------------------------------------------------------------
   APPROVING A REQUEST BUILDS A REAL WAREHOUSE
   Approval is not just a status change. It creates a slot map for
   the new site, gives it a passcode, and adds it to the directory —
   which is why the company sees a new warehouse card and the
   supervisors see a new site to unlock.
   --------------------------------------------------------------- */

function makeSiteId(city){
  const base = 'WH-' + city.replace(/[^a-z]/gi,'').slice(0,3).toUpperCase();
  let candidate = base;
  let counter = 2;
  while(WAREHOUSE_DIRECTORY.some(entry => entry.id === candidate)){
    candidate = base + counter;
    counter++;
  }
  return candidate;
}

function makePasscode(){
  return String(Math.floor(1000 + Math.random() * 9000));
}

function approveWarehouseRequest(ref){
  const list = loadRequests();
  const request = list.find(entry => entry.ref === ref);
  if(!request) return null;
  if(request.status !== 'pending') return null;

  const site = {
    id: makeSiteId(request.city),
    city: request.city,
    name: request.city + ' — ' + request.address.split(',')[0],
    address: request.address,
    passcode: makePasscode(),
    note: 'Opened from request ' + request.ref,
    company: request.company,
    openedAt: Date.now(),
    rackPlan: buildRackPlan(request.proposedSlots)
  };

  // store it, then make it visible to this page straight away
  const approved = loadApprovedSites();
  approved.push(site);
  saveApprovedSites(approved);
  mergeApprovedSites();

  // a brand new warehouse starts empty — no opening stock
  loadWarehouse(site.id);

  request.status = 'approved';
  request.decidedAt = Date.now();
  request.warehouseId = site.id;
  request.passcode = site.passcode;
  saveRequests(list);

  return { request: request, site: site };
}

function rejectWarehouseRequest(ref, reason){
  const list = loadRequests();
  const request = list.find(entry => entry.ref === ref);
  if(!request || request.status !== 'pending') return null;
  request.status = 'rejected';
  request.decidedAt = Date.now();
  request.reason = reason || '';
  saveRequests(list);
  return request;
}

/* ---------------------------------------------------------------
   DELETE REQUESTS
   A company admin cannot remove a warehouse on their own either —
   they file a removal request, the platform admin decides. Approval
   drops the site from the directory and its slot map for good.
   --------------------------------------------------------------- */

function submitDeleteRequest(details){
  const list = loadRequests();
  const request = {
    ref: makeRequestRef(),
    type: 'delete',
    company: details.company,
    warehouseId: details.warehouseId,
    city: details.city,
    note: details.note || '',
    status: 'pending',
    submittedAt: Date.now(),
    decidedAt: null
  };
  list.unshift(request);
  saveRequests(list);
  return request;
}

function approveDeleteRequest(ref){
  const list = loadRequests();
  const request = list.find(entry => entry.ref === ref && entry.type === 'delete');
  if(!request || request.status !== 'pending') return null;

  const removed = loadRemovedSites();
  if(!removed.includes(request.warehouseId)) removed.push(request.warehouseId);
  saveRemovedSites(removed);

  WAREHOUSE_DIRECTORY = WAREHOUSE_DIRECTORY.filter(entry => entry.id !== request.warehouseId);
  saveApprovedSites(loadApprovedSites().filter(site => site.id !== request.warehouseId));

  try{
    localStorage.removeItem(FLOOR_KEYS.warehousePrefix + request.warehouseId);
  }catch(err){
    console.warn('Could not clear removed warehouse slot map:', err);
  }

  request.status = 'approved';
  request.decidedAt = Date.now();
  saveRequests(list);
  return request;
}

function rejectDeleteRequest(ref){
  return decideRequest(ref, 'rejected');
}

function deleteWarehouseRequest(ref){
  try{
    const raw = localStorage.getItem(FLOOR_KEYS.requests);
    let fullList = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(fullList)) fullList = [];
    const prevLen = fullList.length;
    const next = fullList.filter(entry => entry.ref !== ref);
    if(next.length !== prevLen){
      saveRequests(next);
      return true;
    }
    return false;
  }catch(err){
    console.warn('Could not delete warehouse request:', err);
    return false;
  }
}

/* ---------------------------------------------------------------
   COMPANY ACCOUNTS
   Sign-up writes companies here as pending. The platform admin is
   the one who lets them in.
   --------------------------------------------------------------- */

window._NEXVAULT_COMPANIES_CACHE = [];
window._OPTIVAULT_COMPANIES_CACHE = window._NEXVAULT_COMPANIES_CACHE;

function loadCompanyAccounts(){
  return window._NEXVAULT_COMPANIES_CACHE || window._OPTIVAULT_COMPANIES_CACHE || [];
}

function saveCompanyAccounts(list){
  window._NEXVAULT_COMPANIES_CACHE = Array.isArray(list) ? list : [];
  window._OPTIVAULT_COMPANIES_CACHE = window._NEXVAULT_COMPANIES_CACHE;
  try {
    localStorage.removeItem('nexvault-companies');
    localStorage.removeItem('optivault-companies');
  } catch(e){}
}

function decideCompany(email, decision){
  const list = loadCompanyAccounts();
  const found = list.find(entry => (entry.email || '').toLowerCase() === (email || '').toLowerCase());
  if(!found) return null;
  found.status = decision;
  found.decidedAt = Date.now();
  return found;
}

function deleteCompanyAccount(identifier){
  const idStr = String(identifier || '').toLowerCase();
  const list = loadCompanyAccounts();
  const index = list.findIndex(entry =>
    (entry.id && String(entry.id).toLowerCase() === idStr) ||
    (entry.email && entry.email.toLowerCase() === idStr)
  );
  if(index === -1) return null;
  const removed = list.splice(index, 1)[0];
  saveCompanyAccounts(list);
  return removed;
}

/* =====================================================================
   7. RENDER
   ===================================================================== */

let WAREHOUSE = null;
let activeFilter = 'all';
let searchTerm = '';
let activePane = 'floor';
let LAST_REPORT = null;     // the last allocation or reallocation run
let LAST_PLACED_SLOTS = []; // slot IDs that received stock in the last allocation

function renderAll(){
  renderHeader();
  renderStats();
  renderRacks();
  renderZones();
  renderMiniViz();
  renderSuggestions();
  renderPending();
  renderActivity();
  renderAllocationReport();
  if(activePane === 'threed'){
    render3D();
  }
}

function renderHeader(){
  const info = warehouseInfo(WAREHOUSE.id);
  const slots = allSlots(WAREHOUSE).length;
  setText('whName', WAREHOUSE.name);
  setText('whMeta', `${WAREHOUSE.id} · ${WAREHOUSE.racks.length} RACKS · ${slots} SLOTS`);
  setText('floorTitleMeta',
    `Rack-by-rack occupancy for ${info ? info.city : WAREHOUSE.id}, recalculated on every change.`);
}

function renderStats(){
  const stats = warehouseStats(WAREHOUSE);
  const suggestions = buildSuggestions(WAREHOUSE);

  setText('statCapacity', stats.capacityUsed + '%');
  setText('statCapacitySub', `${stats.usedLitres} / ${stats.totalLitres} L`);
  setText('statFree', stats.emptySlots);
  setText('statFreeSub', `of ${stats.totalSlots} slots across ${stats.rackCount} racks`);
  setText('statPending', stats.pending);
  setText('statPendingSub', stats.pending ? 'waiting for space' : 'everything is placed');
  setText('statAlerts', suggestions.length);

  const high = suggestions.filter(s => s.severity === 'high').length;
  setText('statAlertsSub', suggestions.length
    ? `${high} need attention now`
    : 'nothing flagged');

  const alertCard = document.getElementById('statAlertsCard');
  if(alertCard) alertCard.classList.toggle('alert', suggestions.length > 0);

  // badge on the OPTIMIZER nav item
  const badge = document.getElementById('navFlagCount');
  if(badge){
    badge.textContent = suggestions.length;
    badge.hidden = suggestions.length === 0;
  }
  const waitBadge = document.getElementById('navPendingCount');
  if(waitBadge){
    waitBadge.textContent = stats.pending;
    waitBadge.hidden = stats.pending === 0;
  }
}

function fillClass(percent){
  if(percent >= 85) return 'high';
  if(percent >= 40) return 'mid';
  return 'low';
}

function renderRacks(){
  const host = document.getElementById('racks');
  if(!host) return;

  let racks = WAREHOUSE.racks.slice();

  if(activeFilter === 'near-full'){
    racks = racks.filter(rack => rackFill(rack) >= 85 || rack.slots.some(slot => slotFill(slot) >= 85));
  }else if(activeFilter === 'has-space'){
    racks = racks.filter(rack => rackFill(rack) < 40 || rack.slots.some(slot => slotFill(slot) < 40));
  }

  if(searchTerm){
    racks = racks.filter(rack =>
      rack.name.toLowerCase().includes(searchTerm) ||
      rack.zone.toLowerCase().includes(searchTerm) ||
      rack.slots.some(slot =>
        slot.id.toLowerCase().includes(searchTerm) ||
        slot.units.some(unit =>
          (unit.sku || '').toLowerCase().includes(searchTerm) ||
          (unit.name || '').toLowerCase().includes(searchTerm)
        )
      )
    );
  }

  if(racks.length === 0){
    host.innerHTML = `<div class="empty">No rack matches this view. Clear the filter or search to see the whole floor.</div>`;
    return;
  }

  host.innerHTML = racks.map(rack => {
    const rackId = rack.id || (rack.slots && rack.slots[0] ? rack.slots[0].id.split('-')[0] : 'A');
    const rackName = rack.name || ('Rack ' + rackId);
    const rackZone = rack.zone || 'General store';
    const fill = isNaN(rackFill(rack)) ? 0 : rackFill(rack);
    const open = rack.slots.filter(slot => slot.units.length === 0).length;

    let visibleSlots = rack.slots;
    if(activeFilter === 'near-full'){
      visibleSlots = rack.slots.filter(slot => slotFill(slot) >= 85);
    }else if(activeFilter === 'has-space'){
      visibleSlots = rack.slots.filter(slot => slotFill(slot) < 40);
    }

    if(searchTerm){
      visibleSlots = visibleSlots.filter(slot =>
        rack.name.toLowerCase().includes(searchTerm) ||
        rack.zone.toLowerCase().includes(searchTerm) ||
        slot.id.toLowerCase().includes(searchTerm) ||
        slot.units.some(unit =>
          (unit.sku || '').toLowerCase().includes(searchTerm) ||
          (unit.name || '').toLowerCase().includes(searchTerm)
        )
      );
    }

    return `
      <div class="rack">
        <div class="rack-head">
          <span class="tagpill">${rackId}</span>
          <div>
            <h3>${rackName}</h3>
            <div class="desc">${rackZone} · ${visibleSlots.length} of ${rack.slots.length} slots · ${open} empty · ${dockLabel(rack.distanceFromDock || 1)}</div>
          </div>
          <div class="bar-wrap">
            <div class="bar"><i class="${fillClass(fill)}" style="width:${fill}%"></i></div>
            <span class="pct">${fill}%</span>
          </div>
        </div>
        <div class="slots">
          ${visibleSlots.map(slot => renderSlotRow(slot)).join('')}
        </div>
      </div>`;
  }).join('');
}

function dockLabel(distance){
  if(distance <= 1) return 'at the dock';
  if(distance <= 2) return 'near the dock';
  if(distance <= 3) return 'mid floor';
  return 'deep floor';
}

function renderSlotRow(slot){
  const fill = isNaN(slotFill(slot)) ? 0 : slotFill(slot);
  const maxWeight = slot.maxWeight || 450;
  const isRecentlyPlaced = LAST_PLACED_SLOTS.includes(slot.id);
  const groups = {};

  slot.units.forEach(unit => {
    if(!groups[unit.sku]){
      groups[unit.sku] = { count:0, name:unit.name, fragile:unit.fragile, velocity:unit.velocity };
    }
    groups[unit.sku].count++;
  });

  const keys = Object.keys(groups);
  const contents = keys.length
    ? keys.map(sku => {
        const group = groups[sku];
        const isTargetSku = LAST_REPORT && LAST_REPORT.sku === sku;
        return `${sku} × ${group.count}${group.fragile ? ' <b class="flag">FRAGILE</b>' : ''}${isTargetSku && isRecentlyPlaced ? ' <b style="color:#10b981; font-weight:700; font-size:9px; background:#dcfce7; padding:1px 5px; border-radius:3px; margin-left:3px;">+ADDED</b>' : ''}`;
      }).join(' · ')
    : '<span class="muted-text">Empty · ready for putaway</span>';

  return `
    <div class="slot ${isRecentlyPlaced ? 'just-updated' : ''}" data-slot-id="${slot.id}">
      <span class="id">${slot.id}</span>
      <span class="desc">${contents}</span>
      <span class="kg">${Math.round(usedWeight(slot))}/${maxWeight} kg</span>
      <div class="sbar"><i class="${fillClass(fill)}" style="width:${fill}%"></i></div>
      <span class="pct-sm">${fill}%</span>
    </div>`;
}

/* Zone-level view — the macro read on top of the per-slot detail. */
function renderZones(){
  const host = document.getElementById('zones');
  if(!host) return;

  const rows = WAREHOUSE.racks
    .slice()
    .sort((a, b) => a.distanceFromDock - b.distanceFromDock)
    .map(rack => {
      const fill = rackFill(rack);
      const open = rack.slots.filter(slot => slot.units.length === 0).length;
      const capacity = rack.slots.reduce((total, slot) => total + slot.maxVolume, 0);
      const used = rack.slots.reduce((total, slot) => total + usedVolume(slot), 0);
      return `
        <div class="zone-row">
          <div>
            <span class="zone-name">${rack.zone}</span>
            <span class="zone-meta">${rack.name} · ${dockLabel(rack.distanceFromDock)} · ${open} of ${rack.slots.length} slots empty · ${Math.round(used)} / ${Math.round(capacity)} L</span>
          </div>
          <div class="zone-bar"><i class="${fillClass(fill)}" style="width:${fill}%"></i></div>
          <span class="zone-pct">${fill}%</span>
        </div>`;
    }).join('');

  host.innerHTML = rows;
}

/* The small preview inside the 3D panel — same rack fills as
   everywhere else, ordered by distance from the dock. */
function renderMiniViz(){
  const host = document.getElementById('miniViz');
  if(!host) return;

  host.innerHTML = WAREHOUSE.racks
    .slice()
    .sort((a, b) => a.distanceFromDock - b.distanceFromDock)
    .map(rack => {
      const fill = rackFill(rack);
      const colour = fill >= 85 ? 'var(--red)' : fill >= 40 ? 'var(--mid)' : 'var(--redlt)';
      return `<span title="${rack.name} — ${fill}%" style="height:100%">
                <i style="height:${fill}%;background:${colour}"></i>
              </span>`;
    }).join('');
}

/* The optimizer pane. Every flag buildSuggestions() produces is
   shown here, worst first — nothing is trimmed off. */
function renderSuggestions(){
  const host = document.getElementById('suggestions');
  const count = document.getElementById('suggestionCount');
  if(!host) return;

  const list = buildSuggestions(WAREHOUSE);
  if(count) count.textContent = list.length;

  const highCount = list.filter(item => item.severity === 'high').length;
  setText('suggestionBreakdown', list.length
    ? `${highCount} need attention now · ${list.length - highCount} worth watching`
    : 'Every unit is placed and no rack is under pressure.');

  if(list.length === 0){
    host.innerHTML = `
      <div class="opt-clear">
        <b>Nothing to flag</b>
        <span>All four checks came back clean. Every unit is in a slot, no rack is over 90%, no slot is over 92%, and no fast mover is sitting deep in the building.</span>
      </div>`;
    return;
  }

  const order = { high:0, medium:1, low:2 };
  host.innerHTML = list
    .slice()
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map(item => `
      <div class="opt-item ${item.severity}">
        <span class="sev">${item.severity === 'high' ? 'ACT NOW' : 'WATCH'}</span>
        <div class="opt-body">
          <div class="t">${item.title}</div>
          <div class="m">${item.type}</div>
        </div>
      </div>`).join('');
}

function renderPending(){
  const host = document.getElementById('pendingList');
  const wrap = document.getElementById('pendingPanel');
  if(!host || !wrap) return;

  if(WAREHOUSE.pending.length === 0){
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const grouped = {};
  WAREHOUSE.pending.forEach(unit => {
    if(!grouped[unit.sku]){
      grouped[unit.sku] = { count:0, name:unit.name, volume:unit.volume };
    }
    grouped[unit.sku].count++;
  });

  host.innerHTML = Object.keys(grouped).map(sku => {
    const group = grouped[sku];
    return `
      <div class="pending-row">
        <span class="id">${sku}</span>
        <span class="desc">${group.name} · ${group.volume} L each</span>
        <span class="count">${group.count} waiting</span>
      </div>`;
  }).join('');
}

function renderActivity(){
  const host = document.getElementById('activity');
  if(!host) return;

  if(WAREHOUSE.log.length === 0){
    host.innerHTML = `<div class="log-row"><span class="muted-text">No activity yet.</span></div>`;
    return;
  }

  host.innerHTML = WAREHOUSE.log.slice(0, 12).map(entry => `
    <div class="log-row">
      <span>${entry.text}</span>
      <span class="ago">${timeAgo(entry.at)}</span>
    </div>`).join('');
}

/* ---------------------------------------------------------------
   THE ALLOCATION REPORT
   This is the engine showing its working. Every unit the algorithm
   placed is listed with the slot it went to and the rule that chose
   that slot, and every refusal is listed with the reason.
   --------------------------------------------------------------- */
function renderAllocationReport(){
  const host = document.getElementById('allocReport');
  const idle = document.getElementById('allocIdle');
  if(!host) return;

  if(!LAST_REPORT){
    host.innerHTML = '';
    host.hidden = true;
    if(idle) idle.hidden = false;
    return;
  }
  host.hidden = false;
  if(idle) idle.hidden = true;

  host.innerHTML = LAST_REPORT.kind === 'add'
    ? addReportHtml(LAST_REPORT)
    : removeReportHtml(LAST_REPORT);
}

function addReportHtml(report){
  const placed = report.placed;
  const rejected = report.rejected;
  const volumes = placed.concat(rejected).map(row => row.unit.volume);
  const biggest = volumes.length ? Math.max(...volumes) : 0;
  const smallest = volumes.length ? Math.min(...volumes) : 0;

  const rows = placed.map(row => `
    <div class="rep-row">
      <span class="rep-n">#${row.queuePosition}</span>
      <span class="rep-sku">${row.unit.sku}<em>${row.unit.volume} L · ${row.unit.weight} kg</em></span>
      <span class="rep-arrow">→</span>
      <span class="rep-slot">${row.slotId}<em>${row.rack} · ${dockLabel(row.distance)}</em></span>
      <span class="rep-rule ${row.why.rule === 'Velocity' ? 'vel' : 'fit'}">${row.why.rule}</span>
      <span class="rep-left">${row.why.leftover} L spare</span>
    </div>`).join('');

  const refusals = rejected.length ? `
    <div class="rep-sub">Could not be placed</div>
    ${rejected.map(row => `
      <div class="rep-row bad">
        <span class="rep-n">#${row.queuePosition}</span>
        <span class="rep-sku">${row.unit.sku}<em>${row.unit.volume} L · ${row.unit.weight} kg</em></span>
        <span class="rep-arrow">✕</span>
        <span class="rep-slot">Waiting queue<em>retried automatically on the next removal</em></span>
        <span class="rep-rule stop">Refused</span>
        <span class="rep-left">${row.reason}</span>
      </div>`).join('')}` : '';

  // One line per distinct reason, so the panel explains itself
  // without repeating the same sentence twelve times.
  const reasons = [];
  placed.forEach(row => {
    if(!reasons.includes(row.why.text)) reasons.push(row.why.text);
  });

  const why = reasons.length ? `
    <div class="rep-sub">Why the engine picked those slots</div>
    <ul class="rep-why">
      ${reasons.slice(0, 6).map(text => `<li>${text}</li>`).join('')}
    </ul>` : '';

  const firstSlot = placed && placed[0] ? placed[0].slotId : '';
  return `
    <div class="rep-head">
      <div>
        <h4>Allocation run — ${report.sku}</h4>
        <div class="rep-meta">${report.qty} unit${report.qty > 1 ? 's' : ''} sorted largest first, then each one took the best-ranked slot that would accept it.</div>
      </div>
      <button class="btn" type="button" onclick="goToFloorAndHighlight('${firstSlot}')">See it on the floor</button>
    </div>

    <div class="rep-chips">
      <span class="chip good"><b>${placed.length}</b> placed</span>
      <span class="chip ${rejected.length ? 'bad' : ''}"><b>${rejected.length}</b> waiting</span>
      <span class="chip"><b>${biggest === smallest ? biggest + ' L' : smallest + '–' + biggest + ' L'}</b> unit volume</span>
      <span class="chip"><b>${report.velocity}</b> mover</span>
      ${report.fragile ? '<span class="chip warn"><b>Fragile</b> — needs its own slot</span>' : ''}
    </div>

    <div class="rep-step">
      <b>Step 1 — decreasing.</b> The batch is sorted largest volume first, so the awkward units get the pick of the shelves while space is still open.
      <b>Step 2 — first fit.</b> For each unit the engine filters to slots that pass the volume, weight and fragility checks, ranks what is left, and takes the first.
    </div>

    <div class="rep-rows">
      ${rows}
      ${refusals}
    </div>
    ${why}`;
}

function removeReportHtml(report){
  const moved = report.reallocatedDetail || [];

  const movedRows = moved.length ? `
    <div class="rep-sub">Reallocation — units that were waiting and now have a slot</div>
    ${moved.map(row => `
      <div class="rep-row">
        <span class="rep-n">#${row.queuePosition}</span>
        <span class="rep-sku">${row.unit.sku}<em>${row.unit.volume} L · ${row.unit.weight} kg</em></span>
        <span class="rep-arrow">→</span>
        <span class="rep-slot">${row.slotId}<em>${row.rack} · ${dockLabel(row.distance)}</em></span>
        <span class="rep-rule ${row.why.rule === 'Velocity' ? 'vel' : 'fit'}">${row.why.rule}</span>
        <span class="rep-left">${row.why.leftover} L spare</span>
      </div>`).join('')}`
    : `<div class="rep-none">Nothing was waiting for space, so there was nothing to reallocate. The freed room stays open for the next putaway.</div>`;

  return `
    <div class="rep-head">
      <div>
        <h4>Removal — ${report.removed} × ${report.sku} from ${report.slotId}</h4>
        <div class="rep-meta">Removing stock frees capacity, so the engine immediately retries everything sitting in the waiting queue.</div>
      </div>
      <button class="btn" type="button" data-goto-pane="floor">See it on the floor</button>
    </div>

    <div class="rep-chips">
      <span class="chip good"><b>${report.removed}</b> removed</span>
      <span class="chip"><b>${report.freedVolume} L</b> freed</span>
      <span class="chip"><b>${report.freedWeight} kg</b> off the shelf</span>
      <span class="chip"><b>${report.slotId}</b> now ${report.slotFillNow}% full</span>
      <span class="chip ${moved.length ? 'good' : ''}"><b>${moved.length}</b> reallocated</span>
    </div>

    <div class="rep-rows">
      ${movedRows}
    </div>`;
}

function timeAgo(timestamp){
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if(seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if(minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if(hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

function setText(id, value){
  const node = document.getElementById(id);
  if(node) node.textContent = value;
}

/* ---------------------------------------------------------------
   3D VIEW
   Each rack is drawn as a column of slots in an isometric frame.
   Height of the coloured part is the real fill of that slot.
   Currently switched off in the UI — the code is kept intact.
   --------------------------------------------------------------- */
function render3D(){
  const stage = document.getElementById('stage3d');
  if(!stage) return;

  if(!WAREHOUSE || !WAREHOUSE.racks){
    const id = activeWarehouseId() || 'WH-MOH';
    WAREHOUSE = loadWarehouse(id);
  }
  if(!WAREHOUSE || !WAREHOUSE.racks) return;

  const dock = '<div class="dock-strip" title="Dock Inbound Doors"><span>DOCK DOORS · INBOUND</span></div>';

  stage.innerHTML = dock + WAREHOUSE.racks
    .slice()
    .sort((a, b) => a.distanceFromDock - b.distanceFromDock)
    .map(rack => {
      const bays = {};
      rack.slots.forEach(slot => {
        if(!bays[slot.bay]) bays[slot.bay] = [];
        bays[slot.bay].push(slot);
      });

      const bayHtml = Object.keys(bays).map(bay => {
        const levels = bays[bay]
          .slice()
          .sort((a, b) => a.level - b.level)
          .map(slot => {
            const fill = slotFill(slot);
            // 5px of plinth so an almost-empty slot is visible,
            // then up to 34px more as the slot fills.
            const height = fill === 0 ? 0 : Math.round(5 + (fill / 100) * 32);
            return `
              <div class="box3 ${fill === 0 ? 'vacant' : fillClass(fill)}"
                   style="--h:${height}px"
                   data-slot="${slot.id}"
                   data-rack="${rack.id}"
                   data-fill="${fill}"
                   title="${slot.id} — ${fill}% full">
                <div class="floorpad"><span class="slot-mini-label">${slot.id}</span></div>
                <div class="wall-s"></div>
                <div class="wall-e"></div>
                <div class="wall-n"></div>
                <div class="wall-w"></div>
                <div class="top"></div>
              </div>`;
          }).join('');
        return `<div class="bay">${levels}</div>`;
      }).join('');

      return `
        <div class="rack3d" data-rack="${rack.id}">
          <div class="rack-header-3d">
            <span class="rack-title">${rack.id}</span>
            <span class="rack-zone-badge">${rack.zone}</span>
          </div>
          <div class="bays">${bayHtml}</div>
        </div>`;
    }).join('');

  renderRackKey();
  init3DTooltip();
}

/* Floating interactive telemetry tooltip on hovering 3D boxes */
function init3DTooltip(){
  let tooltip = document.getElementById('spatial3dTooltip');
  if(!tooltip){
    tooltip = document.createElement('div');
    tooltip.id = 'spatial3dTooltip';
    tooltip.className = 'spatial-3d-tooltip';
    document.body.appendChild(tooltip);
  }

  const stage = document.getElementById('stage3d');
  if(!stage || stage.dataset.tooltipBound) return;
  stage.dataset.tooltipBound = 'true';

  let currentSlot = null;

  stage.addEventListener('mousemove', function(e){
    const box = e.target.closest('.box3');
    if(!box){
      currentSlot = null;
      tooltip.classList.remove('visible');
      return;
    }

    const slotId = box.getAttribute('data-slot');
    if(!slotId || !WAREHOUSE){
      tooltip.classList.remove('visible');
      return;
    }

    // Also update telemetry card if on warehouse-3d.html
    if(typeof window.populateCard === 'function'){
      window.populateCard(slotId);
    }

    if(currentSlot !== slotId){
      currentSlot = slotId;
      const entry = findSlotById(WAREHOUSE, slotId);
      if(!entry){
        tooltip.classList.remove('visible');
        return;
      }

      const slot = entry.slot;
      const rack = entry.rack;
      const fill = isNaN(slotFill(slot)) ? 0 : slotFill(slot);
      const usedKg = Math.round(usedWeight(slot));
      const maxKg = slot.maxWeight || 400;
      const usedVol = Math.round(usedVolume(slot));
      const maxVol = slot.maxVolume || 800;
      const wtPercent = Math.min(100, Math.round((usedKg / maxKg) * 100));

      // Group units by SKU
      const groups = {};
      (slot.units || []).forEach(unit => {
        if(!groups[unit.sku]){
          groups[unit.sku] = { count: 0, name: unit.name || unit.sku, weight: unit.weight || 0, fragile: unit.fragile };
        }
        groups[unit.sku].count++;
      });

      const skuKeys = Object.keys(groups);
      let contentsHtml = '';
      if(skuKeys.length === 0){
        contentsHtml = '<div class="tip-empty">● Position is empty & ready for inbound stock.</div>';
      } else {
        contentsHtml = skuKeys.map(sku => {
          const item = groups[sku];
          return `<div class="tip-item">
            <b>${sku}</b>
            <span>${item.count} unit${item.count > 1 ? 's' : ''} (${Math.round(item.weight * item.count)} kg)${item.fragile ? ' <span class="tip-flag">FRAGILE</span>' : ''}</span>
          </div>`;
        }).join('');
      }

      const fillBadgeClass = fill >= 85 ? 'bad' : fill >= 40 ? 'mid' : 'good';
      const statusText = fill === 0 ? 'VACANT' : fill >= 85 ? `${fill}% CONGESTED` : `${fill}% OCCUPIED`;

      tooltip.innerHTML = `
        <div class="tip-head">
          <span class="tip-id">${slot.id}</span>
          <span class="tip-badge ${fillBadgeClass}">${statusText}</span>
        </div>
        <div class="tip-meta">
          ${rack.name || ('Rack ' + rack.id)} · Bay ${slot.bay} · Level ${slot.level}
          <span class="tip-zone">(${rack.zone || 'General'})</span>
        </div>
        <div class="tip-bars">
          <div class="tip-bar-row">
            <span>Vol: ${usedVol} / ${maxVol} L</span>
            <b>${fill}%</b>
          </div>
          <div class="tip-bar"><i class="${fillBadgeClass}" style="width:${fill}%"></i></div>
          <div class="tip-bar-row" style="margin-top:5px;">
            <span>Weight: ${usedKg} / ${maxKg} kg</span>
            <b>${wtPercent}%</b>
          </div>
          <div class="tip-bar"><i class="${wtPercent >= 85 ? 'bad' : wtPercent >= 40 ? 'mid' : 'good'}" style="width:${wtPercent}%"></i></div>
        </div>
        <div class="tip-contents">
          ${contentsHtml}
        </div>
      `;
    }

    // Position tooltip near cursor, clamping within screen
    const tipWidth = 270;
    const tipHeight = tooltip.offsetHeight || 160;
    let left = e.clientX + 16;
    let top = e.clientY + 16;

    if(left + tipWidth > window.innerWidth - 12){
      left = e.clientX - tipWidth - 16;
    }
    if(top + tipHeight > window.innerHeight - 12){
      top = e.clientY - tipHeight - 16;
    }

    tooltip.style.left = Math.max(10, left) + 'px';
    tooltip.style.top = Math.max(10, top) + 'px';
    tooltip.classList.add('visible');
  });

  stage.addEventListener('mouseleave', function(){
    currentSlot = null;
    tooltip.classList.remove('visible');
  });
}

/* The key under the 3D scene: readable text outside the rotation. */
function renderRackKey(){
  const host = document.getElementById('rackKey');
  if(!host) return;

  host.innerHTML = WAREHOUSE.racks
    .slice()
    .sort((a, b) => a.distanceFromDock - b.distanceFromDock)
    .map(rack => {
      const fill = rackFill(rack);
      const colour = fill >= 85 ? 'var(--red)' : fill >= 40 ? 'var(--mid)' : 'var(--redlt)';
      return `
        <div class="k">
          <span class="dot" style="background:${colour}"></span>
          <b>${rack.id}</b>
          <span>${rack.zone}</span>
          <span class="dist">· ${dockLabel(rack.distanceFromDock)}</span>
          <b>${fill}%</b>
        </div>`;
    }).join('');
}

/* =====================================================================
   8. EVENTS
   ===================================================================== */

function isCompanyAdminView(){
  const urlParams = new URLSearchParams(window.location.search);
  if(urlParams.get('view') === 'admin' || urlParams.get('role') === 'company-admin'){
    try {
      sessionStorage.setItem('nexvault-admin-view', 'true');
      sessionStorage.setItem('optivault-admin-view', 'true');
    } catch(e){}
    return true;
  }
  if(urlParams.get('view') === 'supervisor'){
    try {
      sessionStorage.removeItem('nexvault-admin-view');
      sessionStorage.removeItem('optivault-admin-view');
    } catch(e){}
    return false;
  }
  try {
    const session = JSON.parse(localStorage.getItem(FLOOR_KEYS.session));
    if(session && session.role === 'supervisor'){
      try {
      sessionStorage.removeItem('nexvault-admin-view');
      sessionStorage.removeItem('optivault-admin-view');
    } catch(e){}
      return false;
    }
    if(session && (session.role === 'company-admin' || session.role === 'admin')){
      return true;
    }
  } catch(e){}
  try {
    if(sessionStorage.getItem('nexvault-admin-view') === 'true' || sessionStorage.getItem('optivault-admin-view') === 'true') return true;
  } catch(e){}
  return false;
}

function applyAdminViewRestrictions(){
  if(!isCompanyAdminView()) return;

  // Add CSS restriction class to body
  document.body.classList.add('admin-view');

  // If activePane is restricted, force to 'floor'
  if(activePane !== 'floor' && activePane !== 'threed'){
    activePane = 'floor';
  }

  // Update header action: change warehouse -> Return to Admin Ledger
  const changeBtn = document.getElementById('changeWarehouse');
  if(changeBtn){
    changeBtn.innerHTML = '← Facility Ledger';
    changeBtn.title = 'Return to Enterprise Facility Ledger';
  }

  // Hide reset floor button
  const resetBtn = document.getElementById('resetFloor');
  if(resetBtn){
    resetBtn.style.display = 'none';
  }

  // Hide non-admin tabs
  ['stock', 'optimizer', 'reports'].forEach(pane => {
    const navBtn = document.querySelector(`[data-pane="${pane}"]`);
    if(navBtn) navBtn.style.display = 'none';
    const bodyPane = document.querySelector(`[data-pane-body="${pane}"]`);
    if(bodyPane) bodyPane.style.display = 'none';
  });

  // Hide optimizer stats card
  const alertsCard = document.getElementById('statAlertsCard');
  if(alertsCard){
    alertsCard.style.display = 'none';
  }

  // Add admin view indicator badge to header
  const hright = document.querySelector('.hright');
  if(hright && !document.getElementById('adminViewBadge')){
    const badge = document.createElement('span');
    badge.id = 'adminViewBadge';
    badge.className = 'admin-badge';
    badge.innerHTML = '🔒 ADMIN VIEW (READ ONLY)';
    hright.insertBefore(badge, hright.firstChild);
  }

  // Slot Inspector modal: hide transfer box and show read-only notice
  const transferBox = document.getElementById('inspTransferBox');
  if(transferBox){
    transferBox.style.display = 'none';
  }
  const adminNotice = document.getElementById('inspAdminNotice');
  if(adminNotice){
    adminNotice.style.display = 'flex';
  }

  // Update demo banner if visible
  const demoBanner = document.getElementById('demoBanner');
  if(demoBanner && !demoBanner.hidden){
    demoBanner.innerHTML = 'Viewing live floor in <b>Enterprise Admin mode</b> (View-only). Stock editing is restricted to on-site supervisors. <a href="company-dashboard.html" style="margin-left:8px; font-weight:600; color:inherit; text-decoration:underline;">← Return to Facility Ledger</a>';
  }
}

document.addEventListener('DOMContentLoaded', async function(){
  // floor.js is also loaded by the warehouse picker and the company
  // dashboard, neither of which has a rack list. Nothing below applies
  // on those pages.
  if(!document.getElementById('racks')) return;

  const session = (function(){ try { return JSON.parse(localStorage.getItem(FLOOR_KEYS.session)); } catch(e){ return null; } })();
  if(session && session.company && typeof syncWarehousesForCompany === 'function'){
    try {
      await syncWarehousesForCompany(session.company);
    } catch(e){}
  }

  if(!guardWarehouseAccess()) return;
  guardSession();
  applyAdminViewRestrictions();

  WAREHOUSE = loadWarehouse(activeWarehouseId());
  renderAll();

  initTabs();
  initAddForm();
  initRemoveForm();
  initFilters();
  initSearch();
  initModals();
  initSlotInspector();
  initReset();
  initChangeWarehouse();

  if(activePane === 'threed'){
    render3D();
  }
});

/* ---------------------------------------------------------------
   NAVBAR TABS
   One job per pane, so the supervisor is never looking at the whole
   application at once. Every pane stays in the DOM and is shown or
   hidden, which is why the renderers can keep writing to all of them.
   --------------------------------------------------------------- */
function initTabs(){
  document.querySelectorAll('[data-pane]').forEach(link => {
    link.addEventListener('click', function(){
      showPane(link.dataset.pane);
    });
  });

  // "See it on the floor" inside the allocation report, and any other
  // in-page jump. Delegated, because the report is redrawn constantly.
  document.addEventListener('click', function(event){
    const jump = event.target.closest('[data-goto-pane]');
    if(jump) showPane(jump.dataset.gotoPane);
  });

  showPane(activePane);
}

function showPane(name){
  if(isCompanyAdminView() && (name === 'stock' || name === 'optimizer' || name === 'reports')){
    name = 'floor';
  }

  activePane = name;

  document.querySelectorAll('[data-pane]').forEach(link => {
    link.classList.toggle('on', link.dataset.pane === name);
  });
  document.querySelectorAll('[data-pane-body]').forEach(pane => {
    pane.classList.toggle('on', pane.dataset.paneBody === name);
  });

  if(name === 'threed'){
    render3D();
  } else {
    if(typeof stopAutoRotate360 === 'function') stopAutoRotate360();
  }

  // The search box only filters the rack list, so it belongs to the
  // floor view and is hidden everywhere else.
  const search = document.getElementById('floorSearch');
  if(search) search.style.visibility = (name === 'floor') ? 'visible' : 'hidden';

  window.scrollTo(0, 0);
}

/* A supervisor reaches this page by picking a warehouse and entering
   its passcode. Landing here without doing that sends them back. */
function guardWarehouseAccess(){
  const id = activeWarehouseId();
  const unlocked = localStorage.getItem(FLOOR_KEYS.unlocked);
  if(id && (unlocked === id || isCompanyAdminView()) && warehouseInfo(id)){
    return true;
  }
  if(isCompanyAdminView()){
    window.location.href = 'company-dashboard.html';
    return false;
  }
  window.location.href = 'warehouse-select.html';
  return false;
}

function initChangeWarehouse(){
  const button = document.getElementById('changeWarehouse');
  if(!button) return;
  button.addEventListener('click', function(){
    if(isCompanyAdminView()){
      window.location.href = 'company-dashboard.html';
      return;
    }
    localStorage.removeItem(FLOOR_KEYS.unlocked);
    localStorage.removeItem(FLOOR_KEYS.active);
    window.location.href = 'warehouse-select.html';
  });
}

/* Only a signed-in supervisor should reach this page. Opening the
   file directly still works, but it says so. */
function guardSession(){
  let session = null;
  try{
    session = JSON.parse(localStorage.getItem(FLOOR_KEYS.session));
  }catch(err){
    session = null;
  }

  const banner = document.getElementById('demoBanner');
  const who = document.getElementById('whoAmI');

  if(session && session.company){
    if(who){
      who.textContent = initialsOf(session.company);
      who.title = isCompanyAdminView()
        ? `${session.company} (Company Admin — View Only) — Return to Ledger`
        : `${session.company} — sign out`;
    }
    if(banner) banner.hidden = true;
  }else{
    if(banner) banner.hidden = false;
    if(who) who.textContent = isCompanyAdminView() ? 'AD' : '—';
  }
}

function initialsOf(text){
  return text
    .split(/\s+/)
    .filter(word => /[a-z]/i.test(word))
    .slice(0, 2)
    .map(word => word[0].toUpperCase())
    .join('');
}

function initAddForm(){
  const form = document.getElementById('addForm');
  if(!form) return;

  form.addEventListener('submit', function(event){
    event.preventDefault();

    if(isCompanyAdminView()){
      showResult('bad', 'Action Restricted', 'Stock putaway and allocation are restricted to floor supervisors.');
      return;
    }

    const rawSku = value('inSku');
    const entry = {
      sku: (rawSku || ('SKU-' + Math.floor(10000 + Math.random() * 90000))).toUpperCase(),
      name: value('inName') || 'Unnamed stock',
      l: Number(value('inL') || 60),
      w: Number(value('inW') || 40),
      h: Number(value('inH') || 35),
      weight: Number(value('inWeight') || 14),
      velocity: value('inVelocity') || 'medium',
      fragile: document.getElementById('inFragile') ? document.getElementById('inFragile').checked : false,
      qty: Math.max(1, Math.min(40, Number(value('inQty') || 1)))
    };

    const problem = validateEntry(entry);
    if(problem){
      showResult('bad', problem, '');
      return;
    }

    const result = addStock(WAREHOUSE, entry);
    LAST_PLACED_SLOTS = result.placed.map(item => item.slotId);

    // Sync allocation with backend Express API: POST /api/warehouse/allocate
    try {
      const allocateUrl = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/allocate') : '/api/warehouse/allocate';
      const session = (function(){ try { return JSON.parse(localStorage.getItem(FLOOR_KEYS.session)); } catch(e){ return null; } })();
      const currentWh = (typeof activeWarehouseId === 'function' ? activeWarehouseId() : 'WH-MOH') || 'WH-MOH';
      const whMeta = typeof warehouseInfo === 'function' ? warehouseInfo(currentWh) : null;
      const currentCompany = (session && session.company) || (whMeta && whMeta.company) || '';

      fetch(allocateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: currentWh,
          companyName: currentCompany,
          item: entry
        })
      })
      .then(res => res.json())
      .then(data => {
        if(data && data.success){
          console.log(`[Backend Sync] Stored allocation ${data.allocationRef} in MongoDB Atlas`);
        }
      })
      .catch(err => console.warn('[Backend Note] Local offline fallback active:', err.message));
    } catch(fetchErr) {
      // Graceful offline fallback
    }

    LAST_REPORT = {
      kind: 'add',
      sku: entry.sku,
      qty: entry.qty,
      velocity: entry.velocity,
      fragile: entry.fragile,
      placed: result.placed,
      rejected: result.rejected
    };

    renderAll();

    const placedText = result.placed.length
      ? groupPlacements(result.placed)
      : '';

    const firstSlot = result.placed[0]?.slotId || '';
    const viewBtn = firstSlot
      ? `<button type="button" class="btn" style="padding:3px 10px; font-size:11px; margin-left:8px; cursor:pointer;" onclick="goToFloorAndHighlight('${firstSlot}')">View on Floor →</button>`
      : '';

    if(result.rejected.length === 0){
      showResult('good',
        `Placed ${result.placed.length} × ${entry.sku}`,
        placedText + (viewBtn ? ' &nbsp;·&nbsp; ' + viewBtn : ''));
    }else if(result.placed.length === 0){
      showResult('bad',
        `Could not place ${entry.sku}`,
        result.rejected[0].reason + '. Units are waiting in the queue.');
    }else{
      showResult('warn',
        `Placed ${result.placed.length}, ${result.rejected.length} waiting`,
        placedText + ' · ' + result.rejected[0].reason + (viewBtn ? ' &nbsp;·&nbsp; ' + viewBtn : ''));
    }

    form.reset();
    if(document.getElementById('inL')) document.getElementById('inL').value = 60;
    if(document.getElementById('inW')) document.getElementById('inW').value = 40;
    if(document.getElementById('inH')) document.getElementById('inH').value = 35;
    if(document.getElementById('inWeight')) document.getElementById('inWeight').value = 14;
    if(document.getElementById('inQty')) document.getElementById('inQty').value = 1;
  });
}

function groupPlacements(placed){
  const bySlot = {};
  placed.forEach(item => {
    bySlot[item.slotId] = (bySlot[item.slotId] || 0) + 1;
  });
  return Object.keys(bySlot)
    .map(slotId => `${slotId} (${bySlot[slotId]})`)
    .join(', ');
}

function validateEntry(entry){
  if(!entry.sku) return 'Enter a SKU.';
  if(!entry.l || !entry.w || !entry.h) return 'Enter all three dimensions in cm.';
  if(entry.l <= 0 || entry.w <= 0 || entry.h <= 0) return 'Dimensions must be greater than zero.';
  if(!entry.weight || entry.weight <= 0) return 'Enter a weight in kg.';
  if(!entry.qty || entry.qty < 1) return 'Enter a quantity of at least 1.';
  if(entry.qty > 40) return 'Add 40 units or fewer at a time.';
  return null;
}

function initRemoveForm(){
  const form = document.getElementById('removeForm');
  if(!form) return;

  form.addEventListener('submit', function(event){
    event.preventDefault();

    if(isCompanyAdminView()){
      showResult('bad', 'Action Restricted', 'Stock picking and deallocation are restricted to floor supervisors.');
      return;
    }

    const slotId = value('outSlot');
    const sku = value('outSku');
    const qty = Number(value('outQty'));

    if(!slotId || !sku || !qty){
      showResult('bad', 'Fill in the slot, SKU and quantity.', '');
      return;
    }

    const result = removeStock(WAREHOUSE, slotId, sku, qty);

    if(!result.ok){
      renderAll();
      showResult('bad', result.message, '');
      return;
    }

    LAST_PLACED_SLOTS = [];

    LAST_REPORT = {
      kind: 'remove',
      sku: result.sku,
      removed: result.removed,
      slotId: result.slotId,
      rack: result.rack,
      freedVolume: result.freedVolume,
      freedWeight: result.freedWeight,
      slotFillNow: result.slotFillNow,
      reallocatedDetail: result.reallocatedDetail
    };

    renderAll();

    const viewBtn = `<button type="button" class="btn" style="padding:3px 10px; font-size:11px; margin-left:8px; cursor:pointer;" onclick="goToFloorAndHighlight('${result.slotId}')">View on Floor →</button>`;

    showResult('good',
      `Removed ${result.removed} × ${result.sku} from ${result.slotId}`,
      (result.reallocated
        ? `Reallocation placed ${result.reallocated} waiting unit${result.reallocated > 1 ? 's' : ''}.`
        : 'No units were waiting for that space.') + ' &nbsp;·&nbsp; ' + viewBtn);

    form.reset();
    document.getElementById('outQty').value = 1;
  });
}

function goToFloorAndHighlight(slotId){
  searchTerm = '';
  activeFilter = 'all';
  const field = document.getElementById('floorSearch');
  if(field) field.value = '';
  document.querySelectorAll('[data-filter]').forEach(tab => {
    tab.classList.toggle('on', tab.dataset.filter === 'all');
  });

  showPane('floor');
  renderRacks();

  if(slotId){
    window.setTimeout(function(){
      const el = document.querySelector(`[data-slot-id="${slotId}"]`);
      if(el){
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('just-updated');
        void el.offsetWidth;
        el.classList.add('just-updated');
      }
    }, 120);
  }
}
window.goToFloorAndHighlight = goToFloorAndHighlight;

function value(id){
  const node = document.getElementById(id);
  return node ? node.value.trim() : '';
}

function showResult(kind, title, detail){
  const box = document.getElementById('resultBox');
  if(!box) return;
  box.className = 'result ' + kind;
  box.innerHTML = `<div class="r-title">${title}</div>${detail ? `<div class="r-detail">${detail}</div>` : ''}`;
  box.hidden = false;
}

function initFilters(){
  document.querySelectorAll('[data-filter]').forEach(tab => {
    tab.addEventListener('click', function(){
      document.querySelectorAll('[data-filter]').forEach(other => other.classList.remove('on'));
      tab.classList.add('on');
      activeFilter = tab.dataset.filter;
      renderRacks();
    });
  });
}

function initSearch(){
  const field = document.getElementById('floorSearch');
  if(!field) return;
  field.addEventListener('input', function(){
    searchTerm = field.value.trim().toLowerCase();
    if(activePane !== 'floor') showPane('floor');
    renderRacks();
  });
}

function initModals(){
  const modal3d = document.getElementById('modal3d');

  ['open3d', 'open3dHeader'].forEach(function(id){
    const button = document.getElementById(id);
    if(button){
      button.addEventListener('click', function(e){
        e.preventDefault();
        showPane('threed');
      });
    }
  });

  init3DRotation();

  function closeModal3D(){
    document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('on'));
    if(typeof stopAutoRotate360 === 'function') stopAutoRotate360();
  }

  document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', closeModal3D);
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(event){
      if(event.target === modal) closeModal3D();
    });
  });

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape'){
      closeModal3D();
    }
  });

  const signOut = document.getElementById('whoAmI');
  if(signOut){
    signOut.addEventListener('click', function(){
      if(isCompanyAdminView()){
        window.location.href = 'company-dashboard.html';
        return;
      }
      localStorage.removeItem(FLOOR_KEYS.session);
      window.location.href = 'signin.html';
    });
  }
}

let stopAutoRotate360 = null;

function init3DRotation(){
  const stage = document.getElementById('stage3d');
  const stageWrap = document.getElementById('stageWrap3D') || document.querySelector('.stage-wrap, .v-stage-wrap');
  const btnAuto = document.getElementById('btnAutoRotate360');
  const slider = document.getElementById('rot360Slider');
  const sliderVal = document.getElementById('rot360Val');

  if(!stageWrap || !stage) return;

  let isDragging = false;
  let startX = 0, startY = 0;
  let rotX = 56, rotZ = 328;
  let isAutoSpinning = false;
  let animId = null;

  let zoom = 1.0;
  const zoomInBtn = document.getElementById('btnZoomIn');
  const zoomOutBtn = document.getElementById('btnZoomOut');
  const zoomVal = document.getElementById('zoomLevel');

  function updateTransform(){
    stage.style.transform = `scale(${zoom}) rotateX(${rotX}deg) rotateZ(${rotZ}deg)`;
    const norm = Math.round(((rotZ % 360) + 360) % 360);
    if(slider) slider.value = norm;
    if(sliderVal) sliderVal.textContent = norm + '°';
    if(zoomVal) zoomVal.textContent = Math.round(zoom * 100) + '%';
  }

  function stopSpin(){
    if(isAutoSpinning){
      isAutoSpinning = false;
      if(animId) cancelAnimationFrame(animId);
      animId = null;
      stage.classList.remove('no-transition');
      if(btnAuto){
        btnAuto.classList.remove('active');
        btnAuto.innerHTML = '<span class="spin-ico">⟳</span> Auto 360°';
      }
    }
  }

  function startSpin(){
    if(isAutoSpinning) return;
    isAutoSpinning = true;
    stage.classList.add('no-transition');
    if(btnAuto){
      btnAuto.classList.add('active');
      btnAuto.innerHTML = '<span class="spin-ico">⟳</span> Spinning 360°';
    }
    function frame(){
      if(!isAutoSpinning) return;
      rotZ = (rotZ + 0.35) % 360;
      updateTransform();
      animId = requestAnimationFrame(frame);
    }
    animId = requestAnimationFrame(frame);
  }

  stopAutoRotate360 = stopSpin;

  if(btnAuto){
    btnAuto.addEventListener('click', function(){
      if(isAutoSpinning){
        stopSpin();
      }else{
        startSpin();
      }
    });
  }

  if(slider){
    slider.addEventListener('input', function(){
      stopSpin();
      stage.classList.add('no-transition');
      rotZ = Number(slider.value);
      Object.keys(presetBtns).forEach(other => {
        const otherBtn = document.getElementById(other);
        if(otherBtn) otherBtn.classList.remove('active');
      });
      updateTransform();
    });
    slider.addEventListener('change', function(){
      stage.classList.remove('no-transition');
    });
  }

  const presetBtns = {
    btnReset3D: { x: 56, z: 328 }, // Isometric 3D angled view
    btnTop3D:   { x: 0,  z: 0 },   // Top plan view looking straight down from ceiling
    btnSide3D:  { x: 70, z: 0 },   // Side profile view of the racks
    btnFront3D: { x: 70, z: 270 }  // Front view facing into the loading dock and aisles
  };

  Object.keys(presetBtns).forEach(id => {
    const btn = document.getElementById(id);
    if(btn){
      btn.addEventListener('click', function(){
        stopSpin();
        stage.classList.remove('no-transition');
        rotX = presetBtns[id].x;
        rotZ = presetBtns[id].z;
        Object.keys(presetBtns).forEach(other => {
          const otherBtn = document.getElementById(other);
          if(otherBtn) otherBtn.classList.toggle('active', other === id);
        });
        updateTransform();
      });
    }
  });

  if(zoomInBtn){
    zoomInBtn.addEventListener('click', function(){
      stage.classList.remove('no-transition');
      zoom = Math.min(2.4, Math.round((zoom + 0.15) * 100) / 100);
      updateTransform();
    });
  }
  if(zoomOutBtn){
    zoomOutBtn.addEventListener('click', function(){
      stage.classList.remove('no-transition');
      zoom = Math.max(0.45, Math.round((zoom - 0.15) * 100) / 100);
      updateTransform();
    });
  }

  const zoomResetBtn = document.getElementById('btnZoomReset');
  if(zoomResetBtn){
    zoomResetBtn.addEventListener('click', function(){
      stage.classList.remove('no-transition');
      zoom = 1.0;
      rotX = 56;
      rotZ = 328;
      updateTransform();
    });
  }

  stageWrap.addEventListener('wheel', function(e){
    e.preventDefault();
    stage.classList.add('no-transition');
    if(e.deltaY < 0){
      zoom = Math.min(2.4, Math.round((zoom + 0.08) * 100) / 100);
    }else{
      zoom = Math.max(0.45, Math.round((zoom - 0.08) * 100) / 100);
    }
    updateTransform();
  }, { passive: false });

  stageWrap.style.cursor = 'grab';

  // Mouse Dragging (360° yaw + pitch)
  stageWrap.addEventListener('mousedown', function(e){
    if(e.target.closest('.rack-key') || e.target.closest('button') || e.target.closest('input')) return;
    stopSpin();
    stage.classList.add('no-transition');
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    stageWrap.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', function(e){
    if(!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = e.clientX;
    startY = e.clientY;
    rotZ = (rotZ + dx * 0.45) % 360;
    rotX = Math.max(0, Math.min(88, rotX - dy * 0.45));
    updateTransform();
  });

  window.addEventListener('mouseup', function(){
    if(isDragging){
      isDragging = false;
      stageWrap.style.cursor = 'grab';
      stage.classList.remove('no-transition');
    }
  });

  // Touch Dragging for mobile / trackpad touch events
  stageWrap.addEventListener('touchstart', function(e){
    if(e.touches.length !== 1) return;
    if(e.target.closest('.rack-key') || e.target.closest('button') || e.target.closest('input')) return;
    stopSpin();
    stage.classList.add('no-transition');
    isDragging = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  stageWrap.addEventListener('touchmove', function(e){
    if(!isDragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    rotZ = (rotZ + dx * 0.45) % 360;
    rotX = Math.max(0, Math.min(88, rotX - dy * 0.45));
    updateTransform();
  }, { passive: true });

  stageWrap.addEventListener('touchend', function(){
    isDragging = false;
    stage.classList.remove('no-transition');
  }, { passive: true });

  // Keyboard navigation shortcuts
  window.addEventListener('keydown', function(e){
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if(e.code === 'Space'){
      e.preventDefault();
      if(isAutoSpinning) stopSpin(); else startSpin();
    }else if(e.key === '1'){
      const b = document.getElementById('btnReset3D');
      if(b) b.click();
    }else if(e.key === '2'){
      const b = document.getElementById('btnTop3D');
      if(b) b.click();
    }else if(e.key === '3'){
      const b = document.getElementById('btnSide3D');
      if(b) b.click();
    }else if(e.key === '4'){
      const b = document.getElementById('btnFront3D');
      if(b) b.click();
    }else if(e.key === '+' || e.key === '='){
      if(zoomInBtn) zoomInBtn.click();
    }else if(e.key === '-'){
      if(zoomOutBtn) zoomOutBtn.click();
    }else if(e.key.toLowerCase() === 'r'){
      if(zoomResetBtn) zoomResetBtn.click();
    }
  });

  updateTransform();
}

/* Rebuild the floor from scratch — useful before a demo. */
function initReset(){
  const button = document.getElementById('resetFloor');
  if(!button) return;
  button.addEventListener('click', async function(){
    if(isCompanyAdminView()){
      alert('Floor reset is restricted in Company Admin view-only mode.');
      return;
    }
    try{
      const resetUrl = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/reset') : '/api/warehouse/reset';
      await fetch(resetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId: WAREHOUSE.id })
      });
    }catch(err){
      console.warn('[MongoDB Atlas Reset Note]', err.message);
    }
    localStorage.removeItem(storageKeyFor(WAREHOUSE.id));
    await syncFromCloud(activeWarehouseId());
    LAST_REPORT = null;
    renderAll();
    showResult('good', 'Floor reset to seed stock', 'The warehouse map was rebuilt and synchronized with MongoDB Atlas.');
  });
}

/* =====================================================================
   INTERACTIVE SLOT INSPECTOR & STOCK RELOCATION
   ===================================================================== */
let currentInspectSlotId = null;

function findSlotWithRack(slotId){
  if(!WAREHOUSE || !WAREHOUSE.racks) return null;
  for(const rack of WAREHOUSE.racks){
    const s = rack.slots.find(slot => slot.id === slotId);
    if(s) return { slot: s, rack };
  }
  return null;
}

function openSlotInspector(slotId){
  const found = findSlotWithRack(slotId);
  if(!found) return;

  const { slot, rack } = found;
  currentInspectSlotId = slot.id;

  const modal = document.getElementById('modalSlotInspector');
  if(!modal) return;

  // Header Details
  const inspSlotId = document.getElementById('inspSlotId');
  const inspRackName = document.getElementById('inspRackName');
  const inspMeta = document.getElementById('inspMeta');

  if(inspSlotId) inspSlotId.textContent = slot.id;
  if(inspRackName) inspRackName.textContent = `${rack.name || 'Rack ' + rack.id} · ${rack.zone || 'General'}`;
  if(inspMeta) inspMeta.textContent = `Distance from dock: ${rack.distanceFromDock || 1} (${dockLabel(rack.distanceFromDock || 1)}) · Level ${slot.level || 1} · Bay ${slot.bay || 1}`;

  // Capacity calculations
  const volUsed = Math.round(usedVolume(slot));
  const volMax = slot.maxVolume || 800;
  const volPct = Math.min(100, Math.round((volUsed / volMax) * 100));

  const wtUsed = Math.round(usedWeight(slot));
  const wtMax = slot.maxWeight || 400;
  const wtPct = Math.min(100, Math.round((wtUsed / wtMax) * 100));

  // Meters
  const inspVolText = document.getElementById('inspVolText');
  const inspVolBar = document.getElementById('inspVolBar');
  const inspVolPct = document.getElementById('inspVolPct');

  if(inspVolText) inspVolText.textContent = `${volUsed} / ${volMax} L`;
  if(inspVolBar){
    inspVolBar.style.width = volPct + '%';
    inspVolBar.className = fillClass(volPct);
  }
  if(inspVolPct) inspVolPct.textContent = `${volPct}% capacity utilized (${volMax - volUsed} L remaining)`;

  const inspWtText = document.getElementById('inspWtText');
  const inspWtBar = document.getElementById('inspWtBar');
  const inspWtPct = document.getElementById('inspWtPct');

  if(inspWtText) inspWtText.textContent = `${wtUsed} / ${wtMax} kg`;
  if(inspWtBar){
    inspWtBar.style.width = wtPct + '%';
    inspWtBar.className = fillClass(wtPct);
  }
  if(inspWtPct) inspWtPct.textContent = `${wtPct}% weight load (${wtMax - wtUsed} kg available)`;

  // Status Badge
  const inspStatusBadge = document.getElementById('inspStatusBadge');
  const inspStatusDesc = document.getElementById('inspStatusDesc');

  if(inspStatusBadge && inspStatusDesc){
    if(slot.units.length === 0){
      inspStatusBadge.textContent = 'VACANT';
      inspStatusBadge.className = 'insp-badge vacant';
      inspStatusDesc.textContent = 'Empty slot ready for putaway allocation.';
    } else if(volPct >= 85 || wtPct >= 85){
      inspStatusBadge.textContent = 'CONGESTED';
      inspStatusBadge.className = 'insp-badge congested';
      inspStatusDesc.textContent = 'Operating near capacity threshold (≥85%).';
    } else {
      inspStatusBadge.textContent = 'OCCUPIED';
      inspStatusBadge.className = 'insp-badge occupied';
      inspStatusDesc.textContent = 'Nominal operating volume. Free space available.';
    }
  }

  // Items List
  const inspItemList = document.getElementById('inspItemList');
  const inspUnitCount = document.getElementById('inspUnitCount');
  if(inspUnitCount) inspUnitCount.textContent = `${slot.units.length} unit(s)`;

  const groups = {};
  slot.units.forEach(unit => {
    if(!groups[unit.sku]){
      groups[unit.sku] = {
        sku: unit.sku,
        name: unit.name || 'Stock item',
        count: 0,
        volume: unit.volume || 0,
        weight: unit.weight || 0,
        velocity: unit.velocity || 'medium',
        fragile: unit.fragile || false
      };
    }
    groups[unit.sku].count++;
  });

  const skuKeys = Object.keys(groups);
  if(inspItemList){
    if(skuKeys.length === 0){
      inspItemList.innerHTML = `<div style="padding:16px; text-align:center; color:#94a3b8; font-size:11px; background:#fff; border:1px dashed #cbd5e1; border-radius:6px;">Slot is vacant. No inventory items stored.</div>`;
    } else {
      inspItemList.innerHTML = skuKeys.map(sku => {
        const item = groups[sku];
        return `
          <div class="insp-item-card">
            <div class="insp-item-main">
              <b>${item.sku}</b> — ${item.name}
              <span>${item.volume} L · ${item.weight} kg per unit · Total: ${(item.volume * item.count).toFixed(1)} L</span>
            </div>
            <div class="insp-item-tags">
              <span class="insp-tag qty">${item.count} in slot</span>
              <span class="insp-tag vel">${item.velocity}</span>
              ${item.fragile ? '<span class="insp-tag fragile">🛡️ FRAGILE</span>' : ''}
            </div>
          </div>`;
      }).join('');
    }
  }

  // Populate Transfer Form Dropdowns
  const skuSelect = document.getElementById('transSkuSelect');
  const targetSelect = document.getElementById('transTargetSlot');
  const feedback = document.getElementById('transferFeedback');
  const transferBox = document.getElementById('inspTransferBox');

  if(feedback){
    feedback.hidden = true;
    feedback.textContent = '';
    feedback.className = 'transfer-alert';
  }

  if(skuSelect){
    if(skuKeys.length === 0){
      skuSelect.innerHTML = `<option value="">(No items in this slot)</option>`;
      skuSelect.disabled = true;
      if(transferBox) transferBox.style.opacity = '0.6';
    } else {
      skuSelect.disabled = false;
      if(transferBox) transferBox.style.opacity = '1';
      skuSelect.innerHTML = skuKeys.map(sku => {
        const item = groups[sku];
        return `<option value="${sku}">${sku} (${item.name}) — ${item.count} available</option>`;
      }).join('');
    }
  }

  if(targetSelect){
    const allSlots = [];
    WAREHOUSE.racks.forEach(r => {
      r.slots.forEach(s => {
        if(s.id !== slot.id){
          const freeL = Math.max(0, Math.round(s.maxVolume - usedVolume(s)));
          const freeKg = Math.max(0, Math.round((s.maxWeight || 400) - usedWeight(s)));
          allSlots.push({ id: s.id, rackName: r.name, freeL, freeKg, status: s.status });
        }
      });
    });

    // Sort target slots by free volume descending
    allSlots.sort((a, b) => b.freeL - a.freeL);

    targetSelect.innerHTML = `<option value="">Choose target slot...</option>` +
      allSlots.map(s => `<option value="${s.id}">${s.id} (${s.rackName}) · ${s.freeL} L free / ${s.freeKg} kg free</option>`).join('');
  }

  // Adjust display for admin view vs supervisor
  const adminNotice = document.getElementById('inspAdminNotice');
  if(isCompanyAdminView()){
    if(transferBox) transferBox.style.display = 'none';
    if(adminNotice) adminNotice.style.display = 'flex';
  } else {
    if(transferBox) transferBox.style.display = '';
    if(adminNotice) adminNotice.style.display = 'none';
  }

  // Show Modal
  modal.classList.add('on');
}

function initSlotInspector(){
  // Delegate click on slots
  document.addEventListener('click', function(e){
    const slotEl = e.target.closest('.slot');
    if(slotEl && slotEl.dataset.slotId){
      openSlotInspector(slotEl.dataset.slotId);
    }
  });

  // Close button
  const closeBtn = document.getElementById('btnCloseInspector');
  const modal = document.getElementById('modalSlotInspector');
  if(closeBtn && modal){
    closeBtn.addEventListener('click', function(){
      modal.classList.remove('on');
    });
  }

  // Transfer Form Submit
  const transferForm = document.getElementById('transferForm');
  const feedback = document.getElementById('transferFeedback');
  const btnConfirm = document.getElementById('btnConfirmTransfer');
  const btnQuickPick = document.getElementById('btnQuickPick');

  if(transferForm){
    transferForm.addEventListener('submit', async function(e){
      e.preventDefault();
      if(isCompanyAdminView()){
        showTransferAlert('bad', 'Stock operations are restricted to on-site supervisors.');
        return;
      }
      if(!currentInspectSlotId) return;

      const sku = (document.getElementById('transSkuSelect') || {}).value;
      const targetSlotId = (document.getElementById('transTargetSlot') || {}).value;
      const qty = Number((document.getElementById('transQty') || {}).value) || 1;

      if(!sku){
        showTransferAlert('bad', 'Please select an SKU to transfer.');
        return;
      }
      if(!targetSlotId){
        showTransferAlert('bad', 'Please choose a destination slot.');
        return;
      }

      if(btnConfirm){
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'Relocating stock...';
      }

      try{
        const url = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/transfer') : '/api/warehouse/transfer';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warehouseId: WAREHOUSE.id,
            fromSlotId: currentInspectSlotId,
            toSlotId: targetSlotId,
            sku,
            quantity: qty
          })
        });

        const data = await res.json();
        if(res.ok && data.success){
          showTransferAlert('good', `✔ ${data.message || 'Stock successfully relocated!'}`);
          // Sync live state from cloud
          await syncFromCloud(WAREHOUSE.id);
          renderAll();
          // Update the inspector with the new state
          setTimeout(() => {
            openSlotInspector(currentInspectSlotId);
            if(btnConfirm){
              btnConfirm.disabled = false;
              btnConfirm.textContent = '⇄ Execute Stock Relocation';
            }
          }, 700);
        } else {
          showTransferAlert('bad', `✕ ${data.message || 'Transfer failed.'}`);
          if(btnConfirm){
            btnConfirm.disabled = false;
            btnConfirm.textContent = '⇄ Execute Stock Relocation';
          }
        }
      }catch(err){
        showTransferAlert('bad', `✕ Network error: ${err.message}`);
        if(btnConfirm){
          btnConfirm.disabled = false;
          btnConfirm.textContent = '⇄ Execute Stock Relocation';
        }
      }
    });
  }

  // Quick Pick Button
  if(btnQuickPick){
    btnQuickPick.addEventListener('click', async function(){
      if(isCompanyAdminView()){
        showTransferAlert('bad', 'Stock picking is restricted to on-site supervisors.');
        return;
      }
      if(!currentInspectSlotId) return;
      const sku = (document.getElementById('transSkuSelect') || {}).value;
      const qty = Number((document.getElementById('transQty') || {}).value) || 1;

      if(!sku){
        showTransferAlert('bad', 'Please select an SKU to pick.');
        return;
      }

      if(!confirm(`Pick and remove ${qty} unit(s) of ${sku} from ${currentInspectSlotId}?`)) return;

      btnQuickPick.disabled = true;
      btnQuickPick.textContent = 'Picking...';

      try{
        const url = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/remove') : '/api/warehouse/remove';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warehouseId: WAREHOUSE.id,
            slotId: currentInspectSlotId,
            sku,
            quantity: qty
          })
        });

        const data = await res.json();
        if(res.ok && data.success){
          showTransferAlert('good', `✔ Picked ${data.removed || qty} unit(s) of ${sku} from ${currentInspectSlotId}`);
          await syncFromCloud(WAREHOUSE.id);
          renderAll();
          setTimeout(() => {
            openSlotInspector(currentInspectSlotId);
            btnQuickPick.disabled = false;
            btnQuickPick.textContent = '📤 Quick Pick SKU';
          }, 700);
        } else {
          showTransferAlert('bad', `✕ ${data.message || 'Pick failed.'}`);
          btnQuickPick.disabled = false;
          btnQuickPick.textContent = '📤 Quick Pick SKU';
        }
      }catch(err){
        showTransferAlert('bad', `✕ Error: ${err.message}`);
        btnQuickPick.disabled = false;
        btnQuickPick.textContent = '📤 Quick Pick SKU';
      }
    });
  }

  function showTransferAlert(type, msg){
    if(!feedback) return;
    feedback.hidden = false;
    feedback.className = `transfer-alert ${type}`;
    feedback.textContent = msg;
  }
}
