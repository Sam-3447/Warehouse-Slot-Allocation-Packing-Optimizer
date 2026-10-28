/* ==========================================================
   NEXVAULT — Sign In / Sign Up page interactions
   All user and company authentication is handled via MongoDB backend.
   Browser storage retains only the active login session & JWT token.
   ========================================================== */

/* ---------- storage keys, kept in one place ---------- */
const STORAGE = {
  role: 'nexvault-role',
  session: 'nexvault-session'
};

// Purge any legacy mock company database from browser storage
try { localStorage.removeItem('nexvault-companies'); localStorage.removeItem('optivault-companies'); } catch (e) { }

/* ---------- where each role goes after a good sign-in ---------- */
const ROLE_DESTINATIONS = {
  'company-admin': 'company-dashboard.html',
  'supervisor': 'warehouse-select.html',
  'platform-admin': 'platform-admin.html'
};

/* ---------- labels shown on the sign-in card ---------- */
const ROLE_LABELS = {
  'company-admin': 'Company admin access',
  'supervisor': 'Supervisor access',
  'platform-admin': 'Platform admin access'
};

document.addEventListener('DOMContentLoaded', () => {
  animateSlotCards();
  initSignInForm();
  initSignUpForm();
  initPasswordToggles();
  initGoogleAuth();
});

/* ---------- which role did they pick in the modal? ---------- */
function getSelectedRole() {
  const fromUrl = new URLSearchParams(window.location.search).get('role');
  const fromStore = localStorage.getItem(STORAGE.role);
  return fromUrl || fromStore || 'company-admin';
}


/* Animate each zone card's percentage + bar fill on load,
   staggered left-to-right so the panel feels "live". */
function animateSlotCards() {
  const cards = document.querySelectorAll('.scard');
  if (!cards.length) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  cards.forEach((card, i) => {
    const target = parseInt(card.dataset.target, 10);
    const pctEl = card.querySelector('.scard-pct');
    const barEl = card.querySelector('.scard-bar i');
    if (reduceMotion) {
      pctEl.textContent = `${target}%`;
      barEl.style.width = `${target}%`;
      return;
    }
    const delay = 250 + i * 90;
    setTimeout(() => {
      barEl.style.width = `${target}%`;
      const duration = 900;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        pctEl.textContent = `${Math.round(target * eased)}%`;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay);
  });
}


/* ==========================================================
   SIGN IN
   Validation is unchanged. The placeholder setTimeout is now
   a real LocalStorage check.
   ========================================================== */
function initSignInForm() {
  const form = document.getElementById('signinForm');
  if (!form) return;

  const email = document.getElementById('orgEmail');
  const password = document.getElementById('orgPassword');
  const btn = form.querySelector('.enter-btn');
  const btnText = btn.querySelector('.btn-text');
  const errorBox = document.getElementById('formError');

  let role = getSelectedRole();

  function applyRole(newRole) {
    role = newRole;
    try { localStorage.setItem(STORAGE.role, newRole); } catch (e) { }
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set('role', newRole);
      window.history.replaceState({}, '', url);
    }
    showRoleOnCard(newRole);
  }

  // Bind interactive in-page role switcher pills
  document.querySelectorAll('[data-role-btn]').forEach(pill => {
    pill.addEventListener('click', () => {
      applyRole(pill.dataset.roleBtn);
    });
  });

  applyRole(role);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let valid = true;
    hideError(errorBox);
    [email, password].forEach(field => field.classList.remove('field-error'));

    if (!email.value || !email.validity.valid) {
      email.classList.add('field-error');
      valid = false;
    }
    if (!password.value) {
      password.classList.add('field-error');
      valid = false;
    }
    if (!valid) {
      const firstInvalid = form.querySelector('.field-error');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    btn.disabled = true;
    btnText.textContent = 'VERIFYING…';

    // Short pause so the state change is visible.
    setTimeout(async () => {

      const result = await checkCredentials(
        role,
        email.value.trim().toLowerCase(),
        password.value
      );

      if (result.ok) {
        startSession(result.session);
        const destination = result.session.role === 'platform-admin'
          ? 'platform-admin.html'
          : (ROLE_DESTINATIONS[result.session.role || role] || 'index.html');
        window.location.href = destination;
        return;
      }

      btnText.textContent = 'ENTER WORKSPACE';
      btn.disabled = false;
      showError(errorBox, result.message);
      password.value = '';
      password.focus();

    }, 600);
  });

  [email, password].forEach(field => {
    field.addEventListener('input', () => {
      field.classList.remove('field-error');
      hideError(errorBox);
    });
  });
}


/* ---------- the actual access check ---------- */
async function checkCredentials(role, emailValue, passwordValue) {
  try {
    const loginUrl = typeof getApiUrl === 'function' ? getApiUrl('/api/auth/login') : '/api/auth/login';
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailValue, password: passwordValue, role })
    });
    const data = await res.json();
    if (res.ok && data.success && data.token) {
      try {
        localStorage.setItem('nexvault-jwt', data.token);
        localStorage.setItem('optivault-jwt', data.token);
      } catch (err) { }
      return {
        ok: true,
        session: data.user
      };
    }
    return {
      ok: false,
      message: data.message || 'Authentication failed.'
    };
  } catch (netErr) {
    console.warn('Backend not reached:', netErr);
    return {
      ok: false,
      message: 'Could not connect to authentication server. Please ensure backend is running.'
    };
  }
}


/* ---------- remember who is signed in ---------- */
function startSession(session) {
  try {
    localStorage.setItem(STORAGE.session, JSON.stringify(session));
    localStorage.setItem('optivault-session', JSON.stringify(session));
  } catch (err) {
    console.warn('Could not save session:', err);
  }
}


/* ---------- show the chosen role on the card ---------- */
function showRoleOnCard(role) {
  const banner = document.getElementById('roleBanner');
  const label = document.getElementById('roleLabel');
  if (label) label.textContent = ROLE_LABELS[role] || 'Company access';
  if (banner) banner.hidden = false;

  // Update In-Page Interactive Role Switcher Pills
  document.querySelectorAll('[data-role-btn]').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.roleBtn === role);
  });

  const activeBadge = document.getElementById('roleActiveBadge');
  const destText = document.getElementById('roleDestText');

  const roleMeta = {
    'company-admin': {
      badge: 'COMPANY ADMIN',
      desc: 'Routes to multi-facility overview & facility ledger.',
      emailLabel: 'ORGANIZATION EMAIL',
      placeholder: 'Enter company email (e.g. ops@harborbell.com)'
    },
    'supervisor': {
      badge: 'SITE SUPERVISOR',
      desc: 'Routes to warehouse site passcode picker (Mohali, Chandigarh, Patiala).',
      emailLabel: 'SUPERVISOR / COMPANY EMAIL',
      placeholder: 'Enter authorized email (e.g. ops@harborbell.com)'
    },
    'platform-admin': {
      badge: 'PLATFORM ADMIN',
      desc: 'Routes to platform administration console (approvals & metrics).',
      emailLabel: 'ADMIN EMAIL',
      placeholder: 'admin@nexvault.internal'
    }
  };

  const currentMeta = roleMeta[role] || roleMeta['company-admin'];
  if (activeBadge) activeBadge.textContent = currentMeta.badge;
  if (destText) destText.textContent = currentMeta.desc;

  const emailField = document.getElementById('orgEmail');
  const emailLabel = document.querySelector('label[for="orgEmail"]');
  if (emailField && emailLabel) {
    emailLabel.textContent = currentMeta.emailLabel;
    emailField.placeholder = currentMeta.placeholder;
  }

  // Hide Google Sign-In for Platform Admin
  const googleAuthBox = document.getElementById('googleAuthBox');
  if (googleAuthBox) {
    googleAuthBox.style.display = role === 'platform-admin' ? 'none' : '';
  }
}


/* ==========================================================
   SHOW / HIDE PASSWORD
   Every .pw-toggle button sits next to an input and flips
   its type between "password" and "text".
   ========================================================== */
const EYE_ICON =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.6" stroke="currentColor" stroke-width="1.4"/></svg>';

const EYE_OFF_ICON =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 2.5l15 15M8.3 8.4a2.6 2.6 0 0 0 3.4 3.4M5.6 5.7C3.4 7 1 10 1 10s3.5 6 9 6c1.4 0 2.7-.4 3.8-1M12.3 4.3C11.6 4.1 10.8 4 10 4c-5.5 0-9 6-9 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function initPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;

    btn.innerHTML = EYE_ICON;

    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus({ preventScroll: true });
    });
  });
}


/* ---------- error helpers ---------- */
function showError(box, message) {
  if (!box) return;
  box.textContent = message;
  box.classList.add('show');
}

function hideError(box) {
  if (!box) return;
  box.classList.remove('show');
}


/* ==========================================================
   SIGN UP — register a new company
   Saves the company as "pending", then plays the success
   screen where a grid of boxes clears away to reveal
   the message.
   ========================================================== */
function initSignUpForm() {
  const form = document.getElementById('signupForm');
  if (!form) return;

  const companyName = document.getElementById('companyName');
  const contactName = document.getElementById('contactName');
  const workEmail = document.getElementById('workEmail');
  const warehouses = document.getElementById('warehouseCount');
  const password = document.getElementById('newPassword');
  const confirm = document.getElementById('confirmPassword');
  const btn = form.querySelector('.enter-btn');
  const btnText = btn.querySelector('.btn-text');
  const errorBox = document.getElementById('formError');

  const fields = [companyName, contactName, workEmail, warehouses, password, confirm];


  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let valid = true;
    hideError(errorBox);
    fields.forEach(field => field.classList.remove('field-error'));

    // every field is required
    fields.forEach(field => {
      if (!field.value.trim()) {
        field.classList.add('field-error');
        valid = false;
      }
    });

    if (workEmail.value && !workEmail.validity.valid) {
      workEmail.classList.add('field-error');
      valid = false;
    }

    if (!valid) {
      showError(errorBox, 'Please fill in every field with a valid value.');
      const firstInvalid = form.querySelector('.field-error');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    if (password.value.length < 6) {
      password.classList.add('field-error');
      showError(errorBox, 'Choose a password of at least 6 characters.');
      password.focus();
      return;
    }

    if (password.value !== confirm.value) {
      confirm.classList.add('field-error');
      showError(errorBox, 'The two passwords do not match.');
      confirm.focus();
      return;
    }

    const emailValue = workEmail.value.trim().toLowerCase();
    btn.disabled = true;
    btnText.textContent = 'SENDING…';

    const regUrl = typeof getApiUrl === 'function' ? getApiUrl('/api/auth/register') : '/api/auth/register';

    try {
      const res = await fetch(regUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.value.trim(),
          contactName: contactName.value.trim(),
          workEmail: emailValue,
          warehouseCount: parseInt(warehouses.value, 10),
          password: password.value
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        btn.disabled = false;
        btnText.textContent = 'REQUEST WORKSPACE';
        workEmail.classList.add('field-error');
        showError(errorBox, data.message || 'Registration could not be completed. Please try again.');
        workEmail.focus();
        return;
      }

      const ref = data.reference || ('OV-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000));
      const refSlot = document.getElementById('successRef');
      if (refSlot) refSlot.textContent = ref;

      playSuccessScreen(companyName.value.trim(), ref);
    } catch (netErr) {
      btn.disabled = false;
      btnText.textContent = 'REQUEST WORKSPACE';
      showError(errorBox, 'Could not connect to the backend server. Please check your connection.');
    }
  });

  fields.forEach(field => {
    field.addEventListener('input', () => {
      field.classList.remove('field-error');
      hideError(errorBox);
    });
  });
}


/* ==========================================================
   SUCCESS SCREEN
   Fills the screen with boxes, clears them one by one,
   then reveals the message underneath.
   ========================================================== */
function playSuccessScreen(company, customRef) {
  const screen = document.getElementById('successScreen');
  const boxWrap = document.getElementById('successBoxes');
  const message = document.getElementById('successMessage');
  const nameSlot = document.getElementById('successCompany');
  const refSlot = document.getElementById('successRef');

  if (!screen || !boxWrap || !message) return;

  if (nameSlot) nameSlot.textContent = company;
  if (refSlot) refSlot.textContent = customRef || makeReference();

  // how many rows fit the screen, 12 boxes per row
  const columns = 12;
  const boxSize = window.innerWidth / columns;
  const rows = Math.ceil(window.innerHeight / boxSize) + 1;
  const total = columns * rows;

  boxWrap.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  boxWrap.innerHTML = '';

  for (let i = 0; i < total; i++) {
    boxWrap.appendChild(document.createElement('span'));
  }

  screen.classList.add('active');
  document.body.style.overflow = 'hidden';

  const boxes = Array.from(boxWrap.querySelectorAll('span'));
  const reduceMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    boxes.forEach(box => box.classList.add('box-hide'));
    message.classList.add('show');
    return;
  }

  // same idea as the landing page: one box at a time
  const blockDelay = 18;

  boxes.forEach((box, index) => {
    setTimeout(() => {
      box.classList.add('box-hide');
    }, index * blockDelay);
  });

  const lastBox = (boxes.length - 1) * blockDelay;

  setTimeout(() => {
    message.classList.add('show');
  }, lastBox + 400);
}


/* ---------- a reference number for the request ---------- */
function makeReference() {
  const now = new Date();
  const year = now.getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `OV-${year}-${random}`;
}

/* ==========================================================
   GOOGLE AUTHENTICATION (Google Identity Services)
   ========================================================== */
async function initGoogleAuth() {
  const host = document.getElementById('googleBtnHost');
  if (!host) return;

  const currentRole = typeof getSelectedRole === 'function' ? getSelectedRole() : 'company-admin';
  const googleAuthBox = document.getElementById('googleAuthBox');
  if (googleAuthBox && currentRole === 'platform-admin') {
    googleAuthBox.style.display = 'none';
  }

  let clientId = window.__GOOGLE_CLIENT_ID__ || null;

  if (!clientId) {
    try {
      const url = typeof getApiUrl === 'function' ? getApiUrl('/api/auth/google/client-id') : '/api/auth/google/client-id';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.clientId && !data.clientId.includes('your-google-client-id')) {
          clientId = data.clientId;
        }
      }
    } catch (e) {
      console.warn('[Google Auth Init Note]', e);
    }
  }

  // If no client ID configured yet, display a placeholder button with clear guidance
  if (!clientId) {
    host.innerHTML = `
      <button type="button" class="google-btn-fake" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:320px;padding:9px 16px;background:#ffffff;border:1px solid #dadce0;border-radius:4px;font-family:inherit;font-size:14px;font-weight:500;color:#3c4043;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.06);transition:background 0.2s;">
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.347 2.825.957 4.039l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/></svg>
        <span>Sign in with Google</span>
      </button>
    `;
    const btn = host.querySelector('.google-btn-fake');
    if (btn) {
      btn.addEventListener('click', () => {
        const errorBox = document.getElementById('formError');
        showError(errorBox, 'Google Client ID is not configured yet. Add GOOGLE_CLIENT_ID to your .env file.');
      });
    }
    return;
  }

  // Load Google SDK if not already present
  if (typeof google === 'undefined' || !google.accounts) {
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  try {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleAuthCallback,
      auto_select: false
    });

    google.accounts.id.renderButton(host, {
      type: 'standard',
      shape: 'rectangular',
      theme: 'outline',
      text: 'signin_with',
      size: 'large',
      logo_alignment: 'left',
      width: 320
    });
  } catch (err) {
    console.warn('[Google Auth Button Error]', err);
  }
}

async function handleGoogleAuthCallback(response) {
  const errorBox = document.getElementById('formError');
  if (!response || !response.credential) {
    showError(errorBox, 'Google authentication failed or was cancelled.');
    return;
  }

  hideError(errorBox);
  const role = typeof getSelectedRole === 'function' ? getSelectedRole() : 'company-admin';
  if (role === 'platform-admin') {
    showError(errorBox, 'Sign in with Google is not available for Platform Admin.');
    return;
  }

  try {
    const url = typeof getApiUrl === 'function' ? getApiUrl('/api/auth/google') : '/api/auth/google';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: response.credential,
        role: role
      })
    });

    const data = await res.json();

    if (!data.success) {
      showError(errorBox, data.message || 'Google authentication was declined.');
      return;
    }

    // Existing approved company or platform admin: Save token and session
    if (data.token) {
      try {
        localStorage.setItem('nexvault-jwt', data.token);
        localStorage.setItem('optivault-jwt', data.token);
      } catch (e) { }
    }

    if (data.user) {
      startSession(data.user);
      const destination = data.user.role === 'platform-admin'
        ? 'platform-admin.html'
        : (ROLE_DESTINATIONS[data.user.role || role] || 'company-dashboard.html');
      window.location.href = destination;
    }
  } catch (err) {
    console.error('[Google Auth Error]', err);
    showError(errorBox, 'Could not reach NexVault server. Please check your internet connection.');
  }
}