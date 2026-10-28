/* =====================================================================
   NEXVAULT — WAREHOUSE PICKER

   The supervisor signs in with the company account, which gets them
   this list. Getting into a warehouse needs that warehouse's own
   passcode, so one sign-in does not open every site.

   Warehouse definitions, the slot maps and the measurement helpers
   all come from floor.js, which this page loads first.
   ===================================================================== */

let chosenWarehouse = null;
let wrongAttempts = 0;
let currentCompany = 'Demo company';


document.addEventListener('DOMContentLoaded', async function () {

  // this file only runs on the picker page
  if (!document.getElementById('siteGrid')) return;

  showSignedInAs();
  if (typeof syncWarehousesForCompany === 'function') {
    try {
      await syncWarehousesForCompany(currentCompany);
    } catch (err) {
      console.warn('Could not sync company warehouses from cloud:', err);
    }
  }
  renderSites();
  initPasscodeModal();

  // Asynchronously sync all sites from MongoDB Atlas Cloud
  if (typeof syncFromCloud === 'function') {
    const sites = typeof warehousesForCompany === 'function'
      ? warehousesForCompany(currentCompany)
      : WAREHOUSE_DIRECTORY.filter(entry => entry.company === currentCompany);
    await Promise.all(sites.map(s => syncFromCloud(s.id)));
    renderSites();
  }
});


/* ---------------------------------------------------------------
   Who is signed in
   --------------------------------------------------------------- */
function showSignedInAs() {
  let session = null;

  try {
    session = JSON.parse(localStorage.getItem(FLOOR_KEYS.session));
  } catch (err) {
    session = null;
  }

  const banner = document.getElementById('demoBanner');
  const label = document.getElementById('companyLabel');
  const avatar = document.getElementById('whoAmI');

  if (session && session.company) {
    currentCompany = session.company;
    if (label) label.textContent = session.company;
    if (avatar) {
      avatar.textContent = initialsOf(session.company);
      avatar.title = session.company + ' — sign out';
    }
    if (banner) banner.hidden = true;
  } else {
    currentCompany = 'Demo company';
    if (label) label.textContent = 'Demo company';
    if (avatar) avatar.textContent = '—';
    if (banner) banner.hidden = false;
  }

  if (avatar) {
    avatar.addEventListener('click', function () {
      localStorage.removeItem(FLOOR_KEYS.session);
      window.location.href = 'signin.html';
    });
  }
}


/* ---------------------------------------------------------------
   Site cards for the signed-in company.
   Newly registered companies only see their own approved sites.
   --------------------------------------------------------------- */
function renderSites() {
  const host = document.getElementById('siteGrid');
  if (!host) return;

  const sites = typeof warehousesForCompany === 'function'
    ? warehousesForCompany(currentCompany)
    : WAREHOUSE_DIRECTORY.filter(entry => entry.company === currentCompany);

  // Update dynamic header badge with the actual count of sites online
  const badge = document.getElementById('sitesOnlineBadge') || document.querySelector('.hright .live');
  if (badge) {
    badge.textContent = `● ${sites.length} SITE${sites.length === 1 ? '' : 'S'} ONLINE`;
  }

  if (sites.length === 0) {
    host.innerHTML = `<div class="empty-state" style="grid-column:1/-1; text-align:center; padding:54px 24px; background:#fff; border:1px dashed #d5cec5; border-radius:8px;">
        <h3 style="margin-bottom:8px; font-size:18px;">No warehouses assigned yet</h3>
        <p style="color:#666; font-size:14px; margin:0;">Your company administrator has not opened any warehouses yet. Once an addition request is approved by the platform administration team, it will appear here.</p>
      </div>`;
    return;
  }

  host.innerHTML = sites.map(site => {
    const warehouse = loadWarehouse(site.id);
    const stats = warehouseStats(warehouse);

    const state = stats.capacityUsed >= 85 ? 'high'
      : stats.capacityUsed >= 40 ? 'mid'
        : 'low';

    return `
      <button class="site" data-site="${site.id}" type="button">
        <div class="site-top">
          <div>
            <div class="site-city">${site.city}</div>
            <div class="site-name">${site.name}</div>
          </div>
          <span class="site-code">${site.id}</span>
        </div>

        <div class="site-note">${site.note}</div>

        <div class="site-meter">
          <div class="site-meter-row">
            <span>CAPACITY USED</span>
            <b>${stats.capacityUsed}%</b>
          </div>
          <div class="site-bar"><i class="${state}" style="width:${stats.capacityUsed}%"></i></div>
        </div>

        <div class="site-facts">
          <span>${warehouse.racks.length} racks</span>
          <span>${stats.totalSlots} slots</span>
          <span>${stats.emptySlots} empty</span>
        </div>

        <div class="site-foot">
          <span class="lock">🔒 Passcode required</span>
          <span class="go">Enter →</span>
        </div>
      </button>`;
  }).join('');

  host.querySelectorAll('[data-site]').forEach(card => {
    card.addEventListener('click', function () {
      openPasscode(card.dataset.site);
    });
  });
}


/* ---------------------------------------------------------------
   Passcode gate
   --------------------------------------------------------------- */
function openPasscode(siteId) {
  chosenWarehouse = warehouseInfo(siteId);
  wrongAttempts = 0;

  if (!chosenWarehouse) return;

  const modal = document.getElementById('passModal');
  const field = document.getElementById('siteCode');

  setText('passSite', chosenWarehouse.name);
  setText('passCity', chosenWarehouse.city + ' · ' + chosenWarehouse.id);

  hidePassError();

  if (field) {
    field.value = '';
    field.dataset.real = '';
    field.dataset.masked = '';
  }

  modal.classList.add('on');

  window.setTimeout(function () {
    if (field) field.focus();
  }, 80);
}


function closePasscode() {
  const modal = document.getElementById('passModal');
  if (modal) modal.classList.remove('on');
  chosenWarehouse = null;
}


function initPasscodeModal() {
  const form = document.getElementById('passForm');
  const modal = document.getElementById('passModal');

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      checkPasscode();
    });
  }

  document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', closePasscode);
  });

  if (modal) {
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closePasscode();
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closePasscode();
  });

  const field = document.getElementById('siteCode');
  if (field) {
    field.addEventListener('input', hidePassError);
    maskPasscodeInput(field);
  }
}


/* ---------------------------------------------------------------
   Manual dot-masking
   The field is type="text" (not type="password") so that Chrome's
   built-in key/eye password-manager icons never appear on a plain
   4-digit site passcode. We fake the masked look ourselves and keep
   the real digits in a data attribute for validation on submit.
   --------------------------------------------------------------- */
function maskPasscodeInput(field) {
  field.dataset.real = '';

  field.addEventListener('input', function (event) {
    const cursorWasAtEnd = field.selectionStart === field.value.length;

    // figure out the real digits from whatever the user just typed
    const typed = field.value;
    const prevMasked = field.dataset.masked || '';
    let real = field.dataset.real || '';

    if (typed.length > prevMasked.length) {
      // characters were added — the new ones are real input, not dots
      const added = typed.slice(prevMasked.length).replace(/[^0-9]/g, '');
      real += added;
    } else {
      // characters were removed
      real = real.slice(0, typed.length);
    }

    real = real.slice(0, 12); // reasonable upper bound

    const masked = '•'.repeat(real.length);
    field.dataset.real = real;
    field.dataset.masked = masked;
    field.value = masked;

    if (cursorWasAtEnd) {
      field.setSelectionRange(masked.length, masked.length);
    }
  });
}


function realPasscodeValue(field) {
  return field && field.dataset.real ? field.dataset.real : '';
}


function checkPasscode() {
  const field = document.getElementById('siteCode');
  const entered = realPasscodeValue(field).trim();

  if (!chosenWarehouse) return;

  if (!entered) {
    showPassError('Enter the passcode for this warehouse.');
    return;
  }

  if (entered !== chosenWarehouse.passcode) {
    wrongAttempts++;
    showPassError(
      wrongAttempts >= 3
        ? 'Still not right. Check the code issued for this site.'
        : 'That passcode does not match this warehouse.'
    );
    field.value = '';
    field.dataset.real = '';
    field.dataset.masked = '';
    field.focus();
    return;
  }

  // Correct: remember which warehouse is open, then go to the floor.
  localStorage.setItem(FLOOR_KEYS.active, chosenWarehouse.id);
  localStorage.setItem(FLOOR_KEYS.unlocked, chosenWarehouse.id);
  try {
    sessionStorage.removeItem('nexvault-admin-view');
    sessionStorage.removeItem('optivault-admin-view');
  } catch (e) { }

  const button = document.getElementById('passSubmit');
  if (button) {
    button.disabled = true;
    button.textContent = 'OPENING…';
  }

  window.setTimeout(function () {
    window.location.href = 'warehouse-floor.html';
  }, 350);
}


function showPassError(message) {
  const box = document.getElementById('passError');
  const panel = document.querySelector('#passModal .modal-panel');

  if (box) {
    box.textContent = message;
    box.hidden = false;
  }

  if (panel) {
    panel.classList.remove('shake');
    void panel.offsetWidth;          // restart the animation
    panel.classList.add('shake');
  }
}


function hidePassError() {
  const box = document.getElementById('passError');
  if (box) box.hidden = true;
}