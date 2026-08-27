let currentView = 'overview';
let siteFilter = 'all';
let reqFilter = 'open';
let COMPANY = 'Demo company';

document.addEventListener('DOMContentLoaded', function(){

  
  if(!document.getElementById('siteGrid')) return;

  identifyCompany();
  renderEverything();

  initNav();
  initFilters();
  initReqFilters();
  initRequestModal();
  initDeleteModal();
  initLiveRefresh();
});

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
    who.title = COMPANY + ' — sign out';
    who.addEventListener('click', function(){
      localStorage.removeItem(FLOOR_KEYS.session);
      window.location.href = 'signin.html';
    });
  }
}

function renderEverything(){
  renderCompanyStats();
  renderSites();
  renderRequests();
  renderNavCount();
}

function collectSites(){
  return WAREHOUSE_DIRECTORY.map(info => {
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

  if(sites.length === 0){
    host.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <b>No warehouse matches this view</b>
        Switch back to All sites to see the whole company.
      </div>`;
    return;
  }

  host.innerHTML = sites.map(site => {
    const stats = site.stats;

    return `
      <div class="card">
        <div class="card-top">
          <div>
            <h3>${site.info.city}</h3>
            <div class="region">${site.info.address}</div>
          </div>
          <div class="status active">ACTIVE</div>
        </div>

        <div class="bar"><i class="${barClass(stats.capacityUsed)}" style="width:${stats.capacityUsed}%"></i></div>
        <div class="util"><span>Utilization</span><b>${stats.capacityUsed}%</b></div>

        <table>
          <tr><td>Racks</td><td>${stats.rackCount}</td></tr>
          <tr><td>Total slots</td><td>${stats.totalSlots}</td></tr>
          <tr><td>Occupied</td><td>${site.occupied}</td></tr>
          <tr><td>Open</td><td>${stats.emptySlots}</td></tr>
          <tr><td>Units waiting</td><td class="${stats.pending ? 'flagged' : ''}">${stats.pending}</td></tr>
        </table>

        <div class="note">${site.info.note}. Last floor activity: ${lastActivity(site.warehouse)}.</div>
        <button class="btn plain" style="margin-top:12px;font-size:11px;padding:6px 10px" data-delete-site="${site.info.id}" data-city="${site.info.city}" type="button">Request removal</button>
      </div>`;
  }).join('');

  host.querySelectorAll('[data-delete-site]').forEach(button => {
    button.addEventListener('click', function(){
      openDeleteModal(button.dataset.deleteSite, button.dataset.city);
    });
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

function renderRequests(){
  const host = document.getElementById('requestList');
  if(!host) return;

  const requests = requestsForCompany(COMPANY).filter(entry =>
    reqFilter === 'delete' ? entry.type === 'delete' : entry.type !== 'delete');

  if(requests.length === 0){
    host.innerHTML = `<div class="empty-state">
        <b>No ${reqFilter === 'delete' ? 'removal' : 'addition'} requests filed yet</b>
        ${reqFilter === 'delete'
          ? 'Use “Request removal” on a warehouse card to ask the platform team to take a site down.'
          : 'Use “Submit warehouse request” to ask the platform team to open a new site.'}
      </div>`;
    return;
  }

  const isDelete = reqFilter === 'delete';

  host.innerHTML = `
    <table class="req-table">
      <thead>
        <tr>
          <th>Reference</th>
          <th>${isDelete ? 'Warehouse' : 'Proposed site'}</th>
          ${isDelete ? '' : '<th>Slots</th>'}
          <th>Filed</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${requests.map(entry => `
          <tr>
            <td class="ref">${entry.ref}</td>
            <td>
              ${isDelete
                ? `<div class="city">${entry.city}</div><div class="sub-line">${entry.warehouseId}</div>`
                : `<div class="city">${entry.city}</div><div class="sub-line">${entry.address}</div>`}
            </td>
            ${isDelete ? '' : `<td>${entry.proposedSlots}</td>`}
            <td>${timeAgo(entry.submittedAt)}</td>
            <td class="status ${entry.status}">
              ${statusLabel(entry.status)}
              ${entry.status === 'approved' && isDelete
                ? `<div class="sub-line">Warehouse removed</div>` : ''}
              ${entry.status === 'approved' && !isDelete && entry.warehouseId
                ? `<div class="sub-line">Opened as ${entry.warehouseId} · passcode ${entry.passcode}</div>`
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
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', function(){
      siteFilter = button.dataset.filter;

      document.querySelectorAll('[data-filter]').forEach(other =>
        other.classList.toggle('on', other === button));

      renderSites();
    });
  });
}

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

function initLiveRefresh(){
  window.addEventListener('storage', function(event){
    if(!event.key) return;

    const touchesWarehouse = event.key.indexOf(FLOOR_KEYS.warehousePrefix) === 0;
    const touchesRequests = event.key === FLOOR_KEYS.requests;

    if(touchesWarehouse || touchesRequests){
      renderEverything();
      flashLiveNote();
    }
  });

  window.addEventListener('focus', renderEverything);
}

function flashLiveNote(){
  const note = document.getElementById('liveNote');
  if(!note) return;

  note.textContent = 'Updated just now from site activity';
  window.setTimeout(function(){
    note.textContent = 'Figures read live from each site as supervisors work';
  }, 4000);
}
