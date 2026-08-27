let consoleView = 'requests';

document.addEventListener('DOMContentLoaded', function(){

  if(!document.getElementById('requestQueue')) return;

  guardConsole();
  renderConsole();
  initConsoleNav();
  initSignOut();
});

function guardConsole(){
  let session = null;

  try{
    session = JSON.parse(localStorage.getItem(FLOOR_KEYS.session));
  }catch(err){
    session = null;
  }

  const banner = document.getElementById('demoBanner');

  if(session && session.role === 'platform-admin'){
    if(banner) banner.hidden = true;
    setText('adminWho', session.email || 'Platform admin');
  }else{
    if(banner) banner.hidden = false;
    setText('adminWho', 'Demo mode');
  }
}

function renderConsole(){
  renderConsoleStats();
  renderRequestQueue();
  renderCompanyQueue();
  renderSiteTable();
  renderConsoleCounts();
}

function renderConsoleStats(){
  const requests = loadRequests();
  const companies = loadCompanyAccounts();

  const waitingRequests = requests.filter(entry => entry.status === 'pending');
  const waitingCompanies = companies.filter(entry => entry.status === 'pending');

  const totalSlots = WAREHOUSE_DIRECTORY
    .reduce((total, info) => total + allSlots(loadWarehouse(info.id)).length, 0);

  setText('cStatCompanies', companies.length);
  setText('cStatCompaniesSub',
    waitingCompanies.length ? waitingCompanies.length + ' awaiting approval' : 'all approved');

  setText('cStatRequests', waitingRequests.length);
  setText('cStatRequestsSub',
    waitingRequests.length ? 'need a decision' : 'queue is clear');

  setText('cStatSites', WAREHOUSE_DIRECTORY.length);
  setText('cStatSitesSub', 'across every client');

  setText('cStatSlots', totalSlots.toLocaleString());
  setText('cStatSlotsSub', 'under management');

  const reqCard = document.getElementById('cStatRequestsCard');
  if(reqCard) reqCard.classList.toggle('warn', waitingRequests.length > 0);

  const compCard = document.getElementById('cStatCompaniesCard');
  if(compCard) compCard.classList.toggle('warn', waitingCompanies.length > 0);
}

function renderConsoleCounts(){
  const requests = loadRequests().filter(entry => entry.status === 'pending').length;
  const companies = loadCompanyAccounts().filter(entry => entry.status === 'pending').length;

  const reqBadge = document.getElementById('navReqCount');
  if(reqBadge){
    reqBadge.textContent = requests;
    reqBadge.hidden = requests === 0;
  }

  const compBadge = document.getElementById('navCompCount');
  if(compBadge){
    compBadge.textContent = companies;
    compBadge.hidden = companies === 0;
  }
}

function renderRequestQueue(){
  const host = document.getElementById('requestQueue');
  if(!host) return;

  const requests = loadRequests();

  if(requests.length === 0){
    host.innerHTML = `<div class="empty">
        <b>No warehouse requests</b>
        When a company admin files one from their ledger, it lands here for a decision.
      </div>`;
    return;
  }

  host.innerHTML = requests.map(entry => `
    <div class="item ${entry.status !== 'pending' ? 'decided' : ''}">

      <div class="item-top">
        <div>
          <h3>${entry.type === 'delete' ? 'Remove ' + entry.city : entry.city}</h3>
          <div class="meta">${entry.type === 'delete' ? entry.warehouseId : entry.address}</div>
          <div class="ref">${entry.ref} · filed by ${entry.company}</div>
        </div>
        <span class="chip ${entry.status}">${statusWord(entry.status)}</span>
      </div>

      ${entry.type === 'delete' ? `
      <div class="facts">
        <div>Warehouse<b>${entry.warehouseId}</b></div>
        <div>City<b>${entry.city}</b></div>
        <div>Filed<b>${timeAgo(entry.submittedAt)}</b></div>
      </div>` : `
      <div class="facts">
        <div>Slots requested<b>${entry.proposedSlots}</b></div>
        <div>Racks it would build<b>${plannedRacks(entry.proposedSlots)}</b></div>
        <div>Contact<b>${entry.contact}</b></div>
        <div>Filed<b>${timeAgo(entry.submittedAt)}</b></div>
      </div>`}

      ${entry.note ? `<div class="item-note">“${entry.note}”</div>` : ''}

      ${entry.status === 'pending' ? `
        <div class="actions">
          <button class="btn go" data-approve-request="${entry.ref}" type="button">${entry.type === 'delete' ? 'Approve and remove site' : 'Approve and open site'}</button>
          <button class="btn no" data-reject-request="${entry.ref}" type="button">Decline</button>
        </div>` : ''}

      ${entry.status === 'approved' ? `
        <div class="outcome">
          ${entry.type === 'delete'
            ? `Warehouse <code>${entry.warehouseId}</code> was removed from the platform. Decided ${timeAgo(entry.decidedAt)}.`
            : `Site opened as <code>${entry.warehouseId}</code> with passcode
          <code>${entry.passcode}</code>. It now appears on the company's ledger
          and in the supervisor picker. Decided ${timeAgo(entry.decidedAt)}.`}
        </div>` : ''}

      ${entry.status === 'rejected' ? `
        <div class="outcome bad">
          Declined ${timeAgo(entry.decidedAt)}. ${entry.type === 'delete' ? 'The warehouse was not removed.' : 'No warehouse was created.'}
        </div>` : ''}

    </div>`).join('');

  host.querySelectorAll('[data-approve-request]').forEach(button => {
    button.addEventListener('click', function(){
      const ref = button.dataset.approveRequest;
      const req = loadRequests().find(entry => entry.ref === ref);
      if(req && req.type === 'delete') approveDeleteRequest(ref);
      else approveWarehouseRequest(ref);
      renderConsole();
    });
  });

  host.querySelectorAll('[data-reject-request]').forEach(button => {
    button.addEventListener('click', function(){
      const ref = button.dataset.rejectRequest;
      const req = loadRequests().find(entry => entry.ref === ref);
      if(req && req.type === 'delete') rejectDeleteRequest(ref);
      else rejectWarehouseRequest(ref);
      renderConsole();
    });
  });
}

function plannedRacks(slots){
  return Math.max(2, Math.min(8, Math.round(slots / 8)));
}

function statusWord(status){
  if(status === 'approved') return 'Approved';
  if(status === 'rejected') return 'Declined';
  return 'Pending';
}

function renderCompanyQueue(){
  const host = document.getElementById('companyQueue');
  if(!host) return;

  const companies = loadCompanyAccounts();

  if(companies.length === 0){
    host.innerHTML = `<div class="empty">
        <b>No companies registered</b>
        Sign-ups from the registration page appear here for approval.
      </div>`;
    return;
  }

  host.innerHTML = companies.map(entry => `
    <div class="item ${entry.status !== 'pending' ? 'decided' : ''}">

      <div class="item-top">
        <div>
          <h3>${entry.name}</h3>
          <div class="meta">${entry.email}</div>
          ${entry.contact ? `<div class="ref">Contact: ${entry.contact}</div>` : ''}
        </div>
        <span class="chip ${entry.status}">${statusWord(entry.status)}</span>
      </div>

      <div class="facts">
        <div>Warehouses wanted<b>${entry.requestedWarehouses || '—'}</b></div>
        <div>Sites live<b>${sitesForCompany(entry.name)}</b></div>
      </div>

      ${entry.status === 'pending' ? `
        <div class="actions">
          <button class="btn go" data-approve-company="${entry.email}" type="button">Approve account</button>
          <button class="btn no" data-reject-company="${entry.email}" type="button">Decline</button>
        </div>` : ''}

      ${entry.status === 'approved' ? `
        <div class="outcome">
          Account is active — this company can sign in and its supervisors can reach their warehouses.
        </div>` : ''}

      ${entry.status === 'rejected' ? `
        <div class="outcome bad">
          Declined. Sign-in stays blocked for this account.
        </div>` : ''}

    </div>`).join('');

  host.querySelectorAll('[data-approve-company]').forEach(button => {
    button.addEventListener('click', function(){
      decideCompany(button.dataset.approveCompany, 'approved');
      renderConsole();
    });
  });

  host.querySelectorAll('[data-reject-company]').forEach(button => {
    button.addEventListener('click', function(){
      decideCompany(button.dataset.rejectCompany, 'rejected');
      renderConsole();
    });
  });
}

function sitesForCompany(company){
  return WAREHOUSE_DIRECTORY.filter(entry => entry.company === company).length;
}

function renderSiteTable(){
  const host = document.getElementById('siteTable');
  if(!host) return;

  host.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Site</th>
          <th>Location</th>
          <th>Racks</th>
          <th>Slots</th>
          <th>Utilization</th>
          <th>Waiting</th>
        </tr>
      </thead>
      <tbody>
        ${WAREHOUSE_DIRECTORY.map(info => {
          const warehouse = loadWarehouse(info.id);
          const stats = warehouseStats(warehouse);
          const shade = stats.capacityUsed >= 85 ? 'full'
                      : stats.capacityUsed >= 65 ? 'busy' : '';

          return `
            <tr>
              <td>
                <span class="site-id">${info.id}</span>
                ${info.openedAt ? '<span class="tag-new">OPENED BY REQUEST</span>' : ''}
              </td>
              <td>
                <div class="city">${info.city}</div>
                <div class="sub-line">${info.address}</div>
              </td>
              <td>${stats.rackCount}</td>
              <td>${stats.totalSlots}</td>
              <td>
                <div class="mini-bar"><i class="${shade}" style="width:${stats.capacityUsed}%"></i></div>
                <div class="sub-line">${stats.capacityUsed}%</div>
              </td>
              <td>${stats.pending}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function initConsoleNav(){
  document.querySelectorAll('[data-console-view]').forEach(button => {
    button.addEventListener('click', function(){
      consoleView = button.dataset.consoleView;

      document.querySelectorAll('[data-console-view]').forEach(other =>
        other.classList.toggle('active', other === button));

      document.querySelectorAll('.view').forEach(section =>
        section.classList.toggle('on', section.dataset.section === consoleView));
    });
  });
}

function initSignOut(){
  const button = document.getElementById('consoleSignOut');
  if(!button) return;

  button.addEventListener('click', function(){
    localStorage.removeItem(FLOOR_KEYS.session);
    window.location.href = 'signin.html';
  });
}
