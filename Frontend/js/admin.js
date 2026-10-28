/* =====================================================================
   NEXVAULT LEDGER — company admin

   This page reads the SAME warehouse maps the supervisors write to.
   There is no separate copy of the data: when a supervisor places or
   removes stock on the floor page, the numbers here change with it.

   The company admin can look and can file a request for a new
   warehouse. They cannot touch stock — that is the supervisor's job.

   Warehouse definitions, slot maps, measurements and the request
   store all come from floor.js, which this page loads first.
   ===================================================================== */

let currentView = 'overview';
let siteFilter = 'all';
let reqFilter = 'open';
let siteSearchQuery = '';
let COMPANY = 'Demo company';


document.addEventListener('DOMContentLoaded', function(){

  // this file only runs on the ledger page
  if(!document.getElementById('siteGrid')) return;

  identifyCompany();
  renderEverything();
  syncAllCompanySitesFromCloud();

  initNav();
  initFilters();
  initReqFilters();
  initRequestModal();
  initDeleteModal();
  initRenameModal();
  initLiveRefresh();
});


/* ---------------------------------------------------------------
   Who is signed in
   --------------------------------------------------------------- */
function identifyCompany(){
  let session = null;

  try{
    session = JSON.parse(localStorage.getItem(FLOOR_KEYS.session));
  }catch(err){
    session = null;
  }

  const banner = document.getElementById('demoBanner');
  const who = document.getElementById('whoAmI');

  if(session && session.company){
    COMPANY = session.company;
    if(banner) banner.hidden = true;
  }else{
    COMPANY = 'Demo company';
    if(banner) banner.hidden = false;
  }

  setText('companyName', COMPANY);

  if(who){
    who.textContent = initialsOf(COMPANY) || '—';
    who.title = COMPANY + ' — Click to sign out';
    who.addEventListener('click', function(){
      localStorage.removeItem(FLOOR_KEYS.session);
      window.location.href = 'signin.html';
    });
  }

  const signOutBtn = document.getElementById('signOutBtn');
  if(signOutBtn){
    signOutBtn.addEventListener('click', function(){
      localStorage.removeItem(FLOOR_KEYS.session);
      window.location.href = 'signin.html';
    });
  }
}


/* ---------------------------------------------------------------
   Draw everything from current data
   --------------------------------------------------------------- */
function renderEverything(){
  renderCompanyStats();
  renderSites();
  renderRequests();
  renderNavCount();
}


/* Figures are summed only from the warehouses this company owns,
   so newly registered companies do not see other companies' hardcoded sites. */
function collectSites(){
  const mySites = typeof warehousesForCompany === 'function'
    ? warehousesForCompany(COMPANY)
    : WAREHOUSE_DIRECTORY.filter(entry => entry.company === COMPANY);

  return mySites.map(info => {
    const warehouse = loadWarehouse(info.id);
    const stats = warehouseStats(warehouse);

    return {
      info: info,
      warehouse: warehouse,
      stats: stats,
      occupied: stats.totalSlots - stats.emptySlots
    };
  });
}


function renderCompanyStats(){
  const sites = collectSites();
  const requests = requestsForCompany(COMPANY);
  const waitingRequests = requests.filter(entry => entry.status === 'pending');

  const totalSlots = sites.reduce((total, site) => total + site.stats.totalSlots, 0);
  const totalLitres = sites.reduce((total, site) => total + site.stats.totalLitres, 0);
  const usedLitres = sites.reduce((total, site) => total + site.stats.usedLitres, 0);
  const waitingUnits = sites.reduce((total, site) => total + site.stats.pending, 0);

  const average = totalLitres ? Math.round((usedLitres / totalLitres) * 100) : 0;

  setText('statSites', sites.length);
  setText('statRequests', waitingRequests.length);
  setText('statUtil', average + '%');
  setText('statSlots', totalSlots.toLocaleString());
  setText('statWaiting', waitingUnits);

  const waitingCard = document.getElementById('statWaitingCard');
  if(waitingCard) waitingCard.classList.toggle('warn', waitingUnits > 0);

  setText('ledgerSummary',
    `${sites.length} warehouses on record. Stock is placed and removed on site by supervisors; this ledger is view-only.`);
}


function barClass(percent){
  if(percent >= 85) return 'full';
  if(percent >= 65) return 'busy';
  return '';
}


function renderSites(){
  const host = document.getElementById('siteGrid');
  if(!host) return;

  let sites = collectSites();

  if(siteFilter === 'busy'){
    sites = sites.filter(site => site.stats.capacityUsed >= 65);
  }else if(siteFilter === 'roomy'){
    sites = sites.filter(site => site.stats.capacityUsed < 40);
  }

  if(siteSearchQuery){
    sites = sites.filter(site => {
      const name = (site.info.name || '').toLowerCase();
      const city = (site.info.city || '').toLowerCase();
      const id = (site.info.id || '').toLowerCase();
      const addr = (site.info.address || '').toLowerCase();
      return name.includes(siteSearchQuery) || city.includes(siteSearchQuery) || id.includes(siteSearchQuery) || addr.includes(siteSearchQuery);
    });
  }

  if(sites.length === 0){
    const isFiltered = siteFilter !== 'all' || Boolean(siteSearchQuery);
    host.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <b>${isFiltered ? 'No warehouse matches this search or filter' : 'No warehouses registered yet'}</b>
        ${isFiltered
          ? 'Clear your search query or reset the filter tab to see all facilities.'
          : 'Use the “Submit Warehouse Request” button above to provision a new site with the platform administration team.'}
      </div>`;
    return;
  }

  host.innerHTML = sites.map(site => {
    const stats = site.stats;

    return `
      <div class="card">
        <div>
          <div class="card-top">
            <div>
              <h3>${escapeHtml(site.info.name || site.info.city)}</h3>
              <div class="region">
                <span>📍 ${escapeHtml(site.info.city || site.info.address || '—')}</span>
                <span class="wh-code-badge">${escapeHtml(site.info.id)}</span>
              </div>
            </div>
            <div class="status active">ACTIVE</div>
          </div>

          <div class="util-section">
            <div class="util-row">
              <span>Volumetric Occupancy</span>
              <b>${stats.capacityUsed}%</b>
            </div>
            <div class="bar-track">
              <span class="bar-fill ${barClass(stats.capacityUsed)}" style="width:${stats.capacityUsed}%"></span>
            </div>
          </div>

          <table class="metrics-table">
            <tr>
              <td>Passcode</td>
              <td>
                <span class="passcode-pill">
                  <code>${site.info.passcode || '—'}</code>
                  <button type="button" class="copy-btn" data-copy-code="${site.info.passcode || ''}" title="Copy passcode to clipboard">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </span>
              </td>
            </tr>
            <tr><td>Total Slot Capacity</td><td>${stats.totalSlots} slots</td></tr>
            <tr><td>Occupied Slots</td><td>${site.occupied} occupied</td></tr>
            <tr><td>Available Slots</td><td>${stats.emptySlots} open</td></tr>
            <tr><td>Configured Racks</td><td>${stats.rackCount} racks</td></tr>
            <tr><td>Units Waiting</td><td class="${stats.pending ? 'flagged' : ''}">${stats.pending} pallets</td></tr>
          </table>

          <div class="note-box">
            ${escapeHtml(site.info.note || 'Active warehouse ledger')}. Last activity: <strong>${lastActivity(site.warehouse)}</strong>.
          </div>
        </div>

        <div class="card-action-row">
          <button class="btn-card btn-card-floor" data-open-floor="${site.info.id}" type="button" title="Open live floor allocation map">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span>Live Floor</span>
          </button>
          <button class="btn-card" data-rename-site="${site.info.id}" data-current-name="${escapeHtml(site.info.name || '')}" data-current-city="${escapeHtml(site.info.city || '')}" type="button">
            <span>✏️ Rename</span>
          </button>
          <button class="btn-card btn-card-danger" data-delete-site="${site.info.id}" data-city="${escapeHtml(site.info.city)}" type="button" title="File decommissioning request">
            <span>Decommission</span>
          </button>
        </div>
      </div>`;
  }).join('');

  // Wire up Open Floor map direct launcher
  host.querySelectorAll('[data-open-floor]').forEach(btn => {
    btn.addEventListener('click', function(){
      const id = btn.dataset.openFloor;
      if(typeof FLOOR_KEYS !== 'undefined' && FLOOR_KEYS.active){
        try {
          localStorage.setItem(FLOOR_KEYS.active, id);
          localStorage.setItem(FLOOR_KEYS.unlocked, id);
        } catch(e){}
      }
      try {
        sessionStorage.setItem('nexvault-admin-view', 'true');
        sessionStorage.setItem('optivault-admin-view', 'true');
      } catch(e){}
      window.location.href = 'warehouse-floor.html?view=admin';
    });
  });

  // Wire up Copy Passcode button
  host.querySelectorAll('[data-copy-code]').forEach(btn => {
    btn.addEventListener('click', async function(){
      const code = btn.dataset.copyCode;
      if(!code) return;
      try {
        await navigator.clipboard.writeText(code);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '✓';
        btn.style.color = '#10b981';
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.style.color = '';
        }, 1200);
      } catch(e){}
    });
  });

  host.querySelectorAll('[data-rename-site]').forEach(button => {
    button.addEventListener('click', function(){
      openRenameModal(button.dataset.renameSite, button.dataset.currentName, button.dataset.currentCity);
    });
  });

  host.querySelectorAll('[data-delete-site]').forEach(button => {
    button.addEventListener('click', function(){
      openDeleteModal(button.dataset.deleteSite, button.dataset.city);
    });
  });
}

function openRenameModal(id, currentName, currentCity){
  const modal = document.getElementById('renameModal');
  if(!modal) return;
  document.getElementById('renameWhId').value = id;
  document.getElementById('renameName').value = currentName || '';
  document.getElementById('renameCity').value = currentCity || '';
  const errBox = document.getElementById('renameError');
  if(errBox) errBox.hidden = true;
  modal.classList.add('on');
}

function initRenameModal(){
  const modal = document.getElementById('renameModal');
  const form = document.getElementById('renameForm');
  if(!modal || !form) return;

  modal.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', () => modal.classList.remove('on'));
  });
  modal.addEventListener('click', function(event){
    if(event.target === modal) modal.classList.remove('on');
  });

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    const whId = document.getElementById('renameWhId').value.trim();
    const newName = document.getElementById('renameName').value.trim();
    const newCity = document.getElementById('renameCity').value.trim();
    const submitBtn = document.getElementById('renameSubmit');
    const errBox = document.getElementById('renameError');

    if(!newName){
      if(errBox) { errBox.textContent = 'Please provide a facility name'; errBox.hidden = false; }
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const url = typeof getApiUrl === 'function' ? getApiUrl('/api/warehouse/rename') : '/api/warehouse/rename';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId: whId, newName, newCity })
      });
      const data = await res.json();
      if(!data.success){
        throw new Error(data.message || 'Could not rename warehouse');
      }

      // Update in memory directory
      const found = WAREHOUSE_DIRECTORY.find(w => w.id === whId);
      if(found){
        found.name = newName;
        if(newCity) found.city = newCity;
      }
      modal.classList.remove('on');
      renderEverything();
    } catch(err) {
      if(errBox) { errBox.textContent = err.message; errBox.hidden = false; }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Changes';
    }
  });
}


let pendingDeleteId = null;
let pendingDeleteCity = null;

function openDeleteModal(id, city){
  pendingDeleteId = id;
  pendingDeleteCity = city;
  setText('deleteCity', city);
  document.getElementById('deleteModal').classList.add('on');
}

function initDeleteModal(){
  const modal = document.getElementById('deleteModal');
  if(!modal) return;

  modal.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', () => modal.classList.remove('on'));
  });
  modal.addEventListener('click', function(event){
    if(event.target === modal) modal.classList.remove('on');
  });

  document.getElementById('deleteConfirm').addEventListener('click', function(){
    submitDeleteRequest({ company: COMPANY, warehouseId: pendingDeleteId, city: pendingDeleteCity });
    modal.classList.remove('on');
    renderEverything();
  });
}


function lastActivity(warehouse){
  if(!warehouse.log || warehouse.log.length === 0) return 'none recorded';
  return timeAgo(warehouse.log[0].at);
}


/* ---------------------------------------------------------------
   Requests filed by this company
   --------------------------------------------------------------- */
function renderRequests(){
  const host = document.getElementById('requestList');
  if(!host) return;

  const requests = requestsForCompany(COMPANY).filter(entry =>
    reqFilter === 'delete' ? entry.type === 'delete' : entry.type !== 'delete');

  if(requests.length === 0){
    host.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <b>No ${reqFilter === 'delete' ? 'Decommissioning' : 'Facility Addition'} Requisitions in Queue</b>
        <p>${reqFilter === 'delete'
          ? 'Use “Decommission” on any registered facility card in Facility Oversight to propose decommissioning a site.'
          : 'Submit a new warehouse requisition to provision storage capacity with the platform engineering team.'}</p>
        ${reqFilter !== 'delete' ? `
          <button class="b2b-btn b2b-btn-primary" data-open-request type="button" style="margin-top:16px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Submit Warehouse Requisition</span>
          </button>
        ` : ''}
      </div>`;

    host.querySelectorAll('[data-open-request]').forEach(btn => {
      btn.addEventListener('click', function(){
        const modal = document.getElementById('reqModal');
        if(modal){
          resetRequestForm();
          modal.classList.add('on');
          setTimeout(() => {
            const first = document.getElementById('reqCity');
            if(first) first.focus();
          }, 80);
        }
      });
    });
    return;
  }

  const isDelete = reqFilter === 'delete';

  host.innerHTML = `
    <table class="req-table">
      <thead>
        <tr>
          <th>Tracking Reference</th>
          <th>${isDelete ? 'Warehouse Decommission' : 'Proposed Location'}</th>
          ${isDelete ? '' : '<th>Slots Planned</th>'}
          <th>Submitted</th>
          <th>Review Decision</th>
        </tr>
      </thead>
      <tbody>
        ${requests.map(entry => `
          <tr>
            <td><span class="ref">${escapeHtml(entry.ref)}</span></td>
            <td>
              ${isDelete
                ? `<div class="city">${escapeHtml(entry.city)}</div><div class="sub-line">${escapeHtml(entry.warehouseId)}</div>`
                : `<div class="city">${escapeHtml(entry.city)}</div><div class="sub-line">${escapeHtml(entry.address)}</div>`}
            </td>
            ${isDelete ? '' : `<td><strong>${entry.proposedSlots}</strong> slots</td>`}
            <td>${timeAgo(entry.submittedAt)}</td>
            <td>
              <span class="status ${entry.status}">
                ${statusLabel(entry.status)}
              </span>
              ${entry.status === 'approved' && isDelete
                ? `<div class="sub-line">Decommission finalized</div>` : ''}
              ${entry.status === 'approved' && !isDelete && entry.warehouseId
                ? `<div class="sub-line">Operational as <strong>${escapeHtml(entry.warehouseId)}</strong> (Passcode: <code>${escapeHtml(entry.passcode)}</code>)</div>`
                : ''}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}


function initReqFilters(){
  document.querySelectorAll('[data-reqfilter]').forEach(button => {
    button.addEventListener('click', function(){
      reqFilter = button.dataset.reqfilter;
      document.querySelectorAll('[data-reqfilter]').forEach(other =>
        other.classList.toggle('on', other === button));
      renderRequests();
    });
  });
}


function statusLabel(status){
  if(status === 'approved') return 'APPROVED';
  if(status === 'rejected') return 'DECLINED';
  return 'PENDING APPROVAL';
}


function renderNavCount(){
  const badge = document.getElementById('reqCount');
  if(!badge) return;

  const waiting = requestsForCompany(COMPANY)
    .filter(entry => entry.status === 'pending').length;

  badge.textContent = waiting;
  badge.hidden = waiting === 0;
}


/* ---------------------------------------------------------------
   Navigation between the two views
   --------------------------------------------------------------- */
function initNav(){
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', function(){
      currentView = button.dataset.view;

      document.querySelectorAll('[data-view]').forEach(other =>
        other.classList.toggle('active', other === button));

      document.querySelectorAll('.view').forEach(section =>
        section.classList.toggle('on', section.dataset.section === currentView));
    });
  });
}


function initFilters(){
  const searchInput = document.getElementById('siteSearchInput');
  if(searchInput){
    searchInput.addEventListener('input', function(){
      siteSearchQuery = searchInput.value.trim().toLowerCase();
      renderSites();
    });
  }

  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', function(){
      siteFilter = button.dataset.filter;

      document.querySelectorAll('[data-filter]').forEach(other =>
        other.classList.toggle('on', other === button));

      renderSites();
    });
  });
}


/* ---------------------------------------------------------------
   Filing a request for a new warehouse
   --------------------------------------------------------------- */
function initRequestModal(){
  const modal = document.getElementById('reqModal');
  const form = document.getElementById('reqForm');

  document.querySelectorAll('[data-open-request]').forEach(button => {
    button.addEventListener('click', function(){
      resetRequestForm();
      modal.classList.add('on');
      window.setTimeout(function(){
        const first = document.getElementById('reqCity');
        if(first) first.focus();
      }, 80);
    });
  });

  document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', function(){
      modal.classList.remove('on');
    });
  });

  if(modal){
    modal.addEventListener('click', function(event){
      if(event.target === modal) modal.classList.remove('on');
    });
  }

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape' && modal) modal.classList.remove('on');
  });

  if(form){
    form.addEventListener('submit', function(event){
      event.preventDefault();
      handleRequestSubmit();
    });
  }
}


function resetRequestForm(){
  const form = document.getElementById('reqForm');
  const error = document.getElementById('reqError');
  const sent = document.getElementById('reqSent');
  const body = document.getElementById('reqBody');

  if(form) form.reset();
  if(error) error.hidden = true;
  if(sent) sent.hidden = true;
  if(body) body.hidden = false;

  document.querySelectorAll('#reqForm input, #reqForm textarea')
    .forEach(field => field.classList.remove('bad'));
}


function handleRequestSubmit(){
  const city = valueOf('reqCity');
  const address = valueOf('reqAddress');
  const slots = Number(valueOf('reqSlots'));
  const contact = valueOf('reqContact');
  const note = valueOf('reqNote');

  const fields = ['reqCity','reqAddress','reqSlots','reqContact'];
  fields.forEach(id => {
    const node = document.getElementById(id);
    if(node) node.classList.remove('bad');
  });

  if(!city || !address || !contact || !slots){
    fields.forEach(id => {
      const node = document.getElementById(id);
      if(node && !node.value.trim()) node.classList.add('bad');
    });
    showRequestError('Fill in the city, address, slot estimate and contact person.');
    return;
  }

  if(slots < 8){
    document.getElementById('reqSlots').classList.add('bad');
    showRequestError('A site needs at least 8 slots to be worth opening.');
    return;
  }

  const request = submitWarehouseRequest({
    company: COMPANY,
    city: city,
    address: address,
    proposedSlots: slots,
    contact: contact,
    note: note
  });

  // show the confirmation in place of the form
  setText('sentRef', request.ref);
  document.getElementById('reqBody').hidden = true;
  document.getElementById('reqSent').hidden = false;

  renderEverything();
}


function showRequestError(message){
  const box = document.getElementById('reqError');
  if(!box) return;
  box.textContent = message;
  box.hidden = false;
}


function valueOf(id){
  const node = document.getElementById(id);
  return node ? node.value.trim() : '';
}


async function syncAllCompanySitesFromCloud(){
  try{
    if(typeof syncWarehousesForCompany === 'function'){
      await syncWarehousesForCompany(COMPANY);
      renderEverything();
    }
    const mySites = typeof warehousesForCompany === 'function'
      ? warehousesForCompany(COMPANY)
      : WAREHOUSE_DIRECTORY.filter(entry => entry.company === COMPANY);

    if(typeof syncFromCloud === 'function'){
      await Promise.all(mySites.map(site => syncFromCloud(site.id)));
      renderEverything();
    }
  }catch(err){
    console.warn('[Company Dashboard Cloud Sync Note]', err);
  }
}

/* ---------------------------------------------------------------
   Keeping the ledger current
   A supervisor works in a different tab. The storage event fires
   when another tab writes to LocalStorage, so the ledger updates
   without a refresh. Coming back to this tab also re-reads.
   --------------------------------------------------------------- */
function initLiveRefresh(){
  window.addEventListener('storage', function(event){
    if(!event.key) return;

    const touchesWarehouse = event.key.indexOf(FLOOR_KEYS.warehousePrefix) === 0;
    const touchesRequests = event.key === FLOOR_KEYS.requests;

    if(touchesWarehouse || touchesRequests){
      renderEverything();
      syncAllCompanySitesFromCloud();
      flashLiveNote();
    }
  });

  window.addEventListener('focus', function(){
    renderEverything();
    syncAllCompanySitesFromCloud();
  });
}


function flashLiveNote(){
  const note = document.getElementById('liveNote');
  if(!note) return;

  note.textContent = 'Updated just now from site activity';
  window.setTimeout(function(){
    note.textContent = 'Figures synchronized live from supervisor floor activity';
  }, 4000);
}

function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}