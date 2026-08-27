const FLOOR_KEYS = {
  warehousePrefix: 'nexvault-warehouse-',   
  active:          'nexvault-active-warehouse',
  unlocked:        'nexvault-unlocked',
  session:         'nexvault-session',
  requests:        'nexvault-warehouse-requests',
  extraSites:      'nexvault-approved-warehouses',
  removedSites:    'nexvault-removed-warehouses'
};

let WAREHOUSE_DIRECTORY = [
  {
    id:'WH-MOH',
    name:'Mohali — Phase 8 Yard',
    city:'Mohali',
    address:'Industrial Area Phase 8, Mohali',
    passcode:'4021',
    note:'Main hub · fast-moving retail stock'
  },
  {
    id:'WH-CHD',
    name:'Chandigarh — Industrial Area',
    city:'Chandigarh',
    address:'Industrial Area Phase 1, Chandigarh',
    passcode:'5530',
    note:'City depot · mixed inventory'
  },
  {
    id:'WH-PAT',
    name:'Patiala — Rajpura Road',
    city:'Patiala',
    address:'Rajpura Road, Patiala',
    passcode:'6174',
    note:'Overflow store · bulk and slow movers'
  }
];

function warehouseInfo(id){
  return WAREHOUSE_DIRECTORY.find(entry => entry.id === id) || null;
}

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
  loadApprovedSites().forEach(site => {
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
      RACK_PLANS[site.id] = site.rackPlan;
    }
  });
}

mergeApprovedSites();

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

const BAYS_PER_RACK = 4;
const LEVELS_PER_BAY = 2;

function buildEmptyWarehouse(id){
  const info = warehouseInfo(id);
  const plan = RACK_PLANS[id] || [];

  const racks = plan.map(entry => {
    const slots = [];
    for(let bay = 1; bay <= BAYS_PER_RACK; bay++){
      for(let level = 1; level <= LEVELS_PER_BAY; level++){
        slots.push({
          id: `${entry.id}-${String(bay).padStart(2,'0')}-${level}`,
          bay: bay,
          level: level,
          maxVolume: entry.maxVolume,
          maxWeight: entry.maxWeight,
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

function activeWarehouseId(){
  return localStorage.getItem(FLOOR_KEYS.active);
}

function storageKeyFor(id){
  return FLOOR_KEYS.warehousePrefix + id;
}

function loadWarehouse(id){
  try{
    const raw = localStorage.getItem(storageKeyFor(id));
    if(raw) return JSON.parse(raw);
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
}

function addLog(warehouse, text){
  warehouse.log.unshift({ text: text, at: Date.now() });
  warehouse.log = warehouse.log.slice(0, 20);
}

function volumeOf(l, w, h){
  return (l * w * h) / 1000;          
}

function usedVolume(slot){
  return slot.units.reduce((total, unit) => total + unit.volume, 0);
}

function usedWeight(slot){
  return slot.units.reduce((total, unit) => total + unit.weight, 0);
}

function freeVolume(slot){
  return slot.maxVolume - usedVolume(slot);
}

function slotFill(slot){
  return Math.round((usedVolume(slot) / slot.maxVolume) * 100);
}

function rackFill(rack){
  const capacity = rack.slots.reduce((total, slot) => total + slot.maxVolume, 0);
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
  
  if(hasFragile(slot)){
    return { ok:false, reason:'Slot holds a fragile unit' };
  }
  
  if(unit.fragile && slot.units.length > 0){
    return { ok:false, reason:'Fragile unit needs an empty slot' };
  }
  return { ok:true };
}

function rankSlots(candidates, unit){
  const distances = candidates.map(entry => entry.rack.distanceFromDock);
  const middle = (Math.min(...distances) + Math.max(...distances)) / 2;

  return candidates.slice().sort((a, b) => {
    const da = a.rack.distanceFromDock;
    const db = b.rack.distanceFromDock;

    if(unit.velocity === 'fast' && da !== db){
      return da - db;                       
    }
    if(unit.velocity === 'slow' && da !== db){
      return db - da;                       
    }
    if(unit.velocity === 'medium'){
      const offsetA = Math.abs(da - middle);
      const offsetB = Math.abs(db - middle);
      if(offsetA !== offsetB) return offsetA - offsetB;
    }
    
    return (freeVolume(a.slot) - unit.volume) - (freeVolume(b.slot) - unit.volume);
  });
}

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

function allocateBatch(warehouse, units, options){
  const settings = options || {};
  const queue = units.slice().sort((a, b) => b.volume - a.volume);
  const placed = [];
  const rejected = [];

  queue.forEach((unit, index) => {
    const search = findSlotDetailed(warehouse, unit);
    const target = search.target;

    if(target){
      
      
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

function whyNothingFits(warehouse, unit){
  const reasons = allSlots(warehouse)
    .map(entry => slotAccepts(entry.slot, unit).reason)
    .filter(Boolean);

  if(reasons.length === 0) return 'No slot available';

  const tally = {};
  reasons.forEach(reason => { tally[reason] = (tally[reason] || 0) + 1; });
  return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
}

function addStock(warehouse, entry){
  const units = expandToUnits(warehouse, entry);
  const result = allocateBatch(warehouse, units);

  if(result.rejected.length){
    addLog(warehouse, `${result.rejected.length} unit${result.rejected.length > 1 ? 's' : ''} of ${entry.sku} could not be placed.`);
  }
  saveWarehouse(warehouse);
  return result;
}

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
    reallocated: moved.length,          
    reallocatedDetail: moved
  };
}

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

function buildSuggestions(warehouse){
  const list = [];

  
  
  
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

function loadRequests(){
  try{
    const raw = localStorage.getItem(FLOOR_KEYS.requests);
    if(raw) return JSON.parse(raw);
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

function decideRequest(ref, decision){
  const list = loadRequests();
  const found = list.find(entry => entry.ref === ref);
  if(!found) return null;
  found.status = decision;             
  found.decidedAt = Date.now();
  saveRequests(list);
  return found;
}

const ZONE_NAMES = [
  'Fast-pick', 'Outbound stage', 'General store',
  'Bulk overrun', 'Deep store', 'Reserve cage',
  'Returns staging', 'Overflow'
];

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

function buildRackPlan(slotsWanted){
  const rackCount = Math.max(2, Math.min(8, Math.round(slotsWanted / 8)));
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

  
  const approved = loadApprovedSites();
  approved.push(site);
  saveApprovedSites(approved);
  mergeApprovedSites();

  
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

function loadCompanyAccounts(){
  try{
    const raw = localStorage.getItem('nexvault-companies') || localStorage.getItem('optivault-companies');
    return raw ? JSON.parse(raw) : [];
  }catch(err){
    console.warn('Could not read company accounts:', err);
    return [];
  }
}

function saveCompanyAccounts(list){
  try{
    localStorage.setItem('nexvault-companies', JSON.stringify(list));
    localStorage.setItem('optivault-companies', JSON.stringify(list));
  }catch(err){
    console.warn('Could not save company accounts:', err);
  }
}

function decideCompany(email, decision){
  const list = loadCompanyAccounts();
  const found = list.find(entry => entry.email === email);
  if(!found) return null;
  found.status = decision;             
  found.decidedAt = Date.now();
  saveCompanyAccounts(list);
  return found;
}

let WAREHOUSE = null;
let activeFilter = 'all';
let searchTerm = '';
let activePane = 'floor';
let LAST_REPORT = null;     

function renderAll(){
  renderHeader();
  renderStats();
  renderRacks();
  renderZones();
  
  renderSuggestions();
  renderPending();
  renderActivity();
  renderAllocationReport();
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
    racks = racks.filter(rack => rackFill(rack) >= 85);
  }else if(activeFilter === 'has-space'){
    racks = racks.filter(rack => rackFill(rack) < 40);
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
    const fill = rackFill(rack);
    const open = rack.slots.filter(slot => slot.units.length === 0).length;
    return `
      <div class="rack">
        <div class="rack-head">
          <span class="tagpill">${rack.id}</span>
          <div>
            <h3>${rack.name}</h3>
            <div class="desc">${rack.zone} · ${rack.slots.length} slots · ${open} empty · ${dockLabel(rack.distanceFromDock)}</div>
          </div>
          <div class="bar-wrap">
            <div class="bar"><i class="${fillClass(fill)}" style="width:${fill}%"></i></div>
            <span class="pct">${fill}%</span>
          </div>
        </div>
        <div class="slots">
          ${rack.slots.map(slot => renderSlotRow(slot)).join('')}
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
  const fill = slotFill(slot);
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
        return `${sku} × ${group.count}${group.fragile ? ' <b class="flag">FRAGILE</b>' : ''}`;
      }).join(' · ')
    : '<span class="muted-text">Empty · ready for putaway</span>';

  return `
    <div class="slot">
      <span class="id">${slot.id}</span>
      <span class="desc">${contents}</span>
      <span class="kg">${Math.round(usedWeight(slot))}/${slot.maxWeight} kg</span>
      <div class="sbar"><i class="${fillClass(fill)}" style="width:${fill}%"></i></div>
      <span class="pct-sm">${fill}%</span>
    </div>`;
}

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

  
  
  const reasons = [];
  placed.forEach(row => {
    if(!reasons.includes(row.why.text)) reasons.push(row.why.text);
  });

  const why = reasons.length ? `
    <div class="rep-sub">Why the engine picked those slots</div>
    <ul class="rep-why">
      ${reasons.slice(0, 6).map(text => `<li>${text}</li>`).join('')}
    </ul>` : '';

  return `
    <div class="rep-head">
      <div>
        <h4>Allocation run — ${report.sku}</h4>
        <div class="rep-meta">${report.qty} unit${report.qty > 1 ? 's' : ''} sorted largest first, then each one took the best-ranked slot that would accept it.</div>
      </div>
      <button class="btn" type="button" data-goto-pane="floor">See it on the floor</button>
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

function render3D(){
  const stage = document.getElementById('stage3d');
  if(!stage) return;

  const dock = '<div class="dock-strip"><span>DOCK DOORS</span></div>';

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
            
            
            const height = fill === 0 ? 0 : Math.round(4 + (fill / 100) * 34);
            return `
              <div class="box3 ${fill === 0 ? 'vacant' : fillClass(fill)}"
                   style="--h:${height}px"
                   title="${slot.id} — ${fill}% full">
                <div class="floorpad"></div>
                <div class="wall-s"></div>
                <div class="wall-e"></div>
                <div class="top"></div>
              </div>`;
          }).join('');
        return `<div class="bay">${levels}</div>`;
      }).join('');

      return `
        <div class="rack3d">
          <div class="bays">${bayHtml}</div>
        </div>`;
    }).join('');

  renderRackKey();
}

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

document.addEventListener('DOMContentLoaded', function(){
  
  
  
  if(!document.getElementById('racks')) return;

  if(!guardWarehouseAccess()) return;
  guardSession();

  WAREHOUSE = loadWarehouse(activeWarehouseId());
  renderAll();

  initTabs();
  initAddForm();
  initRemoveForm();
  initFilters();
  initSearch();
  initModals();
  initReset();
  initChangeWarehouse();
});

function initTabs(){
  document.querySelectorAll('[data-pane]').forEach(link => {
    link.addEventListener('click', function(){
      showPane(link.dataset.pane);
    });
  });

  
  
  document.addEventListener('click', function(event){
    const jump = event.target.closest('[data-goto-pane]');
    if(jump) showPane(jump.dataset.gotoPane);
  });

  showPane(activePane);
}

function showPane(name){
  activePane = name;

  document.querySelectorAll('[data-pane]').forEach(link => {
    link.classList.toggle('on', link.dataset.pane === name);
  });
  document.querySelectorAll('[data-pane-body]').forEach(pane => {
    pane.classList.toggle('on', pane.dataset.paneBody === name);
  });

  
  
  const search = document.getElementById('floorSearch');
  if(search) search.style.visibility = (name === 'floor') ? 'visible' : 'hidden';

  window.scrollTo(0, 0);
}

function guardWarehouseAccess(){
  const id = activeWarehouseId();
  const unlocked = localStorage.getItem(FLOOR_KEYS.unlocked);
  if(id && unlocked === id && warehouseInfo(id)){
    return true;
  }
  window.location.href = 'warehouse-select.html';
  return false;
}

function initChangeWarehouse(){
  const button = document.getElementById('changeWarehouse');
  if(!button) return;
  button.addEventListener('click', function(){
    localStorage.removeItem(FLOOR_KEYS.unlocked);
    localStorage.removeItem(FLOOR_KEYS.active);
    window.location.href = 'warehouse-select.html';
  });
}

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
    if(who) who.textContent = initialsOf(session.company);
    if(who) who.title = `${session.company} — sign out`;
    if(banner) banner.hidden = true;
  }else{
    if(banner) banner.hidden = false;
    if(who) who.textContent = '—';
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

    const entry = {
      sku: value('inSku').toUpperCase(),
      name: value('inName') || 'Unnamed stock',
      l: Number(value('inL')),
      w: Number(value('inW')),
      h: Number(value('inH')),
      weight: Number(value('inWeight')),
      velocity: value('inVelocity'),
      fragile: document.getElementById('inFragile').checked,
      qty: Number(value('inQty'))
    };

    const problem = validateEntry(entry);
    if(problem){
      showResult('bad', problem, '');
      return;
    }

    const result = addStock(WAREHOUSE, entry);

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

    if(result.rejected.length === 0){
      showResult('good',
        `Placed ${result.placed.length} × ${entry.sku}`,
        placedText);
    }else if(result.placed.length === 0){
      showResult('bad',
        `Could not place ${entry.sku}`,
        result.rejected[0].reason + '. Units are waiting in the queue.');
    }else{
      showResult('warn',
        `Placed ${result.placed.length}, ${result.rejected.length} waiting`,
        placedText + ' · ' + result.rejected[0].reason);
    }

    form.reset();
    document.getElementById('inQty').value = 1;
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

    showResult('good',
      `Removed ${result.removed} × ${result.sku} from ${result.slotId}`,
      result.reallocated
        ? `Reallocation placed ${result.reallocated} waiting unit${result.reallocated > 1 ? 's' : ''}.`
        : 'No units were waiting for that space.');

    form.reset();
    document.getElementById('outQty').value = 1;
  });
}

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

  
  
  
  
  
  
  
  
  
  

  document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', function(){
      document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('on'));
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(event){
      if(event.target === modal) modal.classList.remove('on');
    });
  });

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape'){
      document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('on'));
    }
  });

  const signOut = document.getElementById('whoAmI');
  if(signOut){
    signOut.addEventListener('click', function(){
      localStorage.removeItem(FLOOR_KEYS.session);
      window.location.href = 'signin.html';
    });
  }
}

function initReset(){
  const button = document.getElementById('resetFloor');
  if(!button) return;
  button.addEventListener('click', function(){
    localStorage.removeItem(storageKeyFor(WAREHOUSE.id));
    WAREHOUSE = loadWarehouse(activeWarehouseId());
    LAST_REPORT = null;
    renderAll();
    showResult('good', 'Floor reset to seed stock', 'The warehouse map was rebuilt and re-allocated.');
  });
}
