let chosenWarehouse = null;
let wrongAttempts = 0;

document.addEventListener('DOMContentLoaded', function(){

  
  if(!document.getElementById('siteGrid')) return;

  showSignedInAs();
  renderSites();
  initPasscodeModal();
});

function showSignedInAs(){
  let session = null;

  try{
    session = JSON.parse(localStorage.getItem(FLOOR_KEYS.session));
  }catch(err){
    session = null;
  }

  const banner = document.getElementById('demoBanner');
  const label = document.getElementById('companyLabel');
  const avatar = document.getElementById('whoAmI');

  if(session && session.company){
    if(label) label.textContent = session.company;
    if(avatar){
      avatar.textContent = initialsOf(session.company);
      avatar.title = session.company + ' — sign out';
    }
    if(banner) banner.hidden = true;
  }else{
    if(label) label.textContent = 'Demo company';
    if(avatar) avatar.textContent = '—';
    if(banner) banner.hidden = false;
  }

  if(avatar){
    avatar.addEventListener('click', function(){
      localStorage.removeItem(FLOOR_KEYS.session);
      window.location.href = 'signin.html';
    });
  }
}

function renderSites(){
  const host = document.getElementById('siteGrid');
  if(!host) return;

  host.innerHTML = WAREHOUSE_DIRECTORY.map(site => {
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
    card.addEventListener('click', function(){
      openPasscode(card.dataset.site);
    });
  });
}

function openPasscode(siteId){
  chosenWarehouse = warehouseInfo(siteId);
  wrongAttempts = 0;

  if(!chosenWarehouse) return;

  const modal = document.getElementById('passModal');
  const field = document.getElementById('siteCode');

  setText('passSite', chosenWarehouse.name);
  setText('passCity', chosenWarehouse.city + ' · ' + chosenWarehouse.id);

  hidePassError();

  if(field){
    field.value = '';
    field.dataset.real = '';
    field.dataset.masked = '';
  }

  modal.classList.add('on');

  window.setTimeout(function(){
    if(field) field.focus();
  }, 80);
}

function closePasscode(){
  const modal = document.getElementById('passModal');
  if(modal) modal.classList.remove('on');
  chosenWarehouse = null;
}

function initPasscodeModal(){
  const form = document.getElementById('passForm');
  const modal = document.getElementById('passModal');

  if(form){
    form.addEventListener('submit', function(event){
      event.preventDefault();
      checkPasscode();
    });
  }

  document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', closePasscode);
  });

  if(modal){
    modal.addEventListener('click', function(event){
      if(event.target === modal) closePasscode();
    });
  }

  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape') closePasscode();
  });

  const field = document.getElementById('siteCode');
  if(field){
    field.addEventListener('input', hidePassError);
    maskPasscodeInput(field);
  }
}

function maskPasscodeInput(field){
  field.dataset.real = '';

  field.addEventListener('input', function(event){
    const cursorWasAtEnd = field.selectionStart === field.value.length;

    
    const typed = field.value;
    const prevMasked = field.dataset.masked || '';
    let real = field.dataset.real || '';

    if(typed.length > prevMasked.length){
      
      const added = typed.slice(prevMasked.length).replace(/[^0-9]/g, '');
      real += added;
    }else{
      
      real = real.slice(0, typed.length);
    }

    real = real.slice(0, 12); 

    const masked = '•'.repeat(real.length);
    field.dataset.real = real;
    field.dataset.masked = masked;
    field.value = masked;

    if(cursorWasAtEnd){
      field.setSelectionRange(masked.length, masked.length);
    }
  });
}

function realPasscodeValue(field){
  return field && field.dataset.real ? field.dataset.real : '';
}

function checkPasscode(){
  const field = document.getElementById('siteCode');
  const entered = realPasscodeValue(field).trim();

  if(!chosenWarehouse) return;

  if(!entered){
    showPassError('Enter the passcode for this warehouse.');
    return;
  }

  if(entered !== chosenWarehouse.passcode){
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

  
  localStorage.setItem(FLOOR_KEYS.active, chosenWarehouse.id);
  localStorage.setItem(FLOOR_KEYS.unlocked, chosenWarehouse.id);

  const button = document.getElementById('passSubmit');
  if(button){
    button.disabled = true;
    button.textContent = 'OPENING…';
  }

  window.setTimeout(function(){
    window.location.href = 'warehouse-floor.html';
  }, 350);
}

function showPassError(message){
  const box = document.getElementById('passError');
  const panel = document.querySelector('#passModal .modal-panel');

  if(box){
    box.textContent = message;
    box.hidden = false;
  }

  if(panel){
    panel.classList.remove('shake');
    void panel.offsetWidth;          
    panel.classList.add('shake');
  }
}

function hidePassError(){
  const box = document.getElementById('passError');
  if(box) box.hidden = true;
}
