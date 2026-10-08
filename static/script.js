/* ==========================================================
   Contact Manager - frontend logic (vanilla JavaScript)

   Uses ONLY these Flask endpoints:
     GET    /items          -> load contacts
     POST   /items          -> add a contact
     GET    /items/search   -> search contacts
     DELETE /items/<id>     -> delete a contact

   The frontend never calls /health or /metrics.

   Privacy masking is a DISPLAY feature in the browser.
   It is not server-side access control.
   ========================================================== */
(() => {
  'use strict';

  const API = {
    items: '/items',
    search: '/items/search'
  };

  const REVEAL_MS = 8000;          // how long a revealed number stays visible
  const SEARCH_DEBOUNCE_MS = 300;
  const RECENT_COUNT = 3;          // dashboard preview size
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const state = {
    view: 'dashboard',
    contacts: [],        // everything returned by GET /items
    base: [],            // current result set (all contacts or search results)
    filter: 'all',
    query: '',
    loading: true,
    loadError: false,
    revealed: new Set(),
    timers: new Map(),
    searchSeq: 0,
    pendingDelete: null, // contact waiting for delete confirmation
    deleting: false
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    views: Array.from(document.querySelectorAll('.view')),
    grid: $('contact-grid'),
    count: $('result-count'),
    recent: $('recent-list'),
    search: $('search-input'),
    clear: $('search-clear'),
    addBtns: document.querySelectorAll('[data-open-modal]'),
    modal: $('modal'),
    form: $('contact-form'),
    formError: $('form-error'),
    name: $('input-name'),
    phone: $('input-phone'),
    email: $('input-email'),
    counter: $('phone-counter'),
    saveBtn: $('save-btn'),
    confirmModal: $('confirm-modal'),
    confirmName: $('confirm-name'),
    confirmBtn: $('confirm-delete'),
    confirmCancel: $('confirm-cancel'),
    toasts: $('toasts'),
    statTotal: $('stat-total'),
    statPrivate: $('stat-private'),
    statDirectory: $('stat-directory'),
    insightHeadline: $('insight-headline'),
    insightPct: $('insight-pct'),
    insightMeter: $('insight-meter'),
    insightBar: $('insight-bar'),
    insightSub: $('insight-sub'),
    sidebar: $('sidebar'),
    backdrop: $('sidebar-backdrop'),
    menuBtn: $('menu-btn')
  };

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function request(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
    try {
      const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
      // Session expired or logged out in another tab: go back to Login.
      if (res.status === 401) window.location.replace('/login');
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeContact(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name ?? '').trim();
    const phone = String(raw.phone ?? '').trim();
    const email = String(raw.email ?? '').trim();
    if (raw.id === undefined || raw.id === null) return null;
    if (name === '' && phone === '') return null;
    return { id: raw.id, name: name, phone: phone, email: email };
  }

  function normalizeList(data) {
    return (Array.isArray(data) ? data : []).map(normalizeContact).filter(Boolean);
  }

  function contactKey(c) {
    return 'id:' + c.id;
  }

  function maskPhone(phone) {
    const s = String(phone).replace(/\s+/g, '');
    if (s.length <= 4) return '\u2022'.repeat(Math.max(s.length, 4));
    return s.slice(0, 2) + '\u2022'.repeat(s.length - 4) + s.slice(-2);
  }

  function initials(name) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    const first = words[0].charAt(0);
    const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  function avatarClass(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return 'av-' + (hash % 6);
  }

  /* Name, phone and email search (same rules the server uses). */
  function matches(contact, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (contact.name.toLowerCase().includes(q)) return true;
    if (contact.email.toLowerCase().includes(q)) return true;
    const qDigits = q.replace(/\D/g, '');
    return qDigits.length > 0 && contact.phone.replace(/\D/g, '').includes(qDigits);
  }

  function animateNumber(node, target) {
    const start = parseInt(node.dataset.value || '0', 10) || 0;
    node.dataset.value = String(target);
    if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.textContent = String(target);
      return;
    }
    const duration = 450;
    const t0 = performance.now();
    function frame(now) {
      const p = Math.min((now - t0) / duration, 1);
      node.textContent = String(Math.round(start + (target - start) * p));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function readServerMessage(res) {
    try {
      const data = await res.json();
      const msg = data && (data.error || data.message);
      if (typeof msg === 'string' && msg.length <= 140) return msg;
    } catch (e) { /* no JSON body */ }
    return '';
  }

  /* ---------------------------------------------------------
     Toasts
     --------------------------------------------------------- */
  function toast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast ' + (type || 'info');
    node.innerHTML = icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'shield') +
      '<span>' + escapeHtml(message) + '</span>';
    el.toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 260);
    }, 3500);
  }

  /* ---------------------------------------------------------
     Views: Dashboard / Contacts (only one is visible)
     --------------------------------------------------------- */
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  const VIEW_NAMES = el.views.map((v) => v.id);

  function showView(name) {
    if (!VIEW_NAMES.includes(name)) name = 'dashboard';
    state.view = name;
    el.views.forEach((view) => { view.hidden = view.id !== name; });
    navLinks.forEach((link) => {
      const active = link.dataset.view === name;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (window.history && history.replaceState) history.replaceState(null, '', '#' + name);
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-view]');
    if (!trigger) return;
    event.preventDefault();
    showView(trigger.dataset.view);
    closeSidebar();
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

  /* ---------------------------------------------------------
     Loading contacts: GET /items
     silent = true refreshes the data without flashing skeletons
     --------------------------------------------------------- */
  async function loadContacts(silent) {
    if (!silent) {
      state.loading = true;
      state.loadError = false;
      render();
    }
    try {
      const res = await request(API.items, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error('bad status ' + res.status);
      state.contacts = normalizeList(await res.json());
      state.loadError = false;
    } catch (err) {
      state.loadError = true;
      state.contacts = [];
      toast(err instanceof TypeError || err.name === 'AbortError'
        ? 'Unable to connect to server.'
        : 'Failed to load contacts.', 'error');
    }
    state.loading = false;
    await applySearch();
  }

  /* ---------------------------------------------------------
     Search: GET /items/search?q=...
     The server result is combined with a local match on the
     contacts already loaded, so name, phone and email searches
     always work.
     --------------------------------------------------------- */
  async function applySearch() {
    const query = state.query.trim();
    const seq = ++state.searchSeq;

    if (!query) {
      state.base = state.contacts;
      render();
      return;
    }

    const local = state.contacts.filter((c) => matches(c, query));
    let merged = local;

    try {
      const res = await request(API.search + '?q=' + encodeURIComponent(query), { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (res.ok) {
        const remote = normalizeList(await res.json()).filter((c) => matches(c, query));
        const seen = new Set(local.map(contactKey));
        merged = local.concat(remote.filter((c) => !seen.has(contactKey(c))));
      }
    } catch (err) { /* fall back to local matches silently */ }

    if (seq !== state.searchSeq) return;   // a newer search replaced this one
    state.base = merged;
    render();
  }

  /* ---------------------------------------------------------
     Rendering
     --------------------------------------------------------- */
  function visibleContacts() {
    return state.base.filter((c) => {
      if (state.filter === 'private') return !state.revealed.has(contactKey(c));
      return true;
    });
  }

  function renderStats() {
    const total = state.contacts.length;
    const privateCount = state.contacts.filter((c) => !state.revealed.has(contactKey(c))).length;

    if (state.loading) {
      el.statTotal.textContent = '\u2014';
      el.statPrivate.textContent = '\u2014';
      el.statDirectory.textContent = 'Loading';
      el.statDirectory.className = 'stat-value stat-text';
    } else if (state.loadError) {
      el.statTotal.textContent = '\u2014';
      el.statPrivate.textContent = '\u2014';
      el.statDirectory.textContent = 'Unavailable';
      el.statDirectory.className = 'stat-value stat-text bad';
    } else {
      animateNumber(el.statTotal, total);
      animateNumber(el.statPrivate, privateCount);
      el.statDirectory.textContent = total > 0 ? 'Active' : 'Empty';
      el.statDirectory.className = 'stat-value stat-text' + (total > 0 ? ' ok' : '');
    }
  }

  /* Dashboard "Directory Overview": only values calculated from the
     loaded contacts (count + how many phone numbers are masked). */
  function renderInsight() {
    const total = state.contacts.length;
    const masked = state.contacts.filter((c) => !state.revealed.has(contactKey(c))).length;
    let pct = 0;
    let headline = '\u2014';
    let pctText = '\u2014';
    let sub = 'Checking your directory...';

    if (state.loadError) {
      headline = 'Directory unavailable';
      sub = 'Unable to load contacts right now.';
    } else if (!state.loading && total === 0) {
      headline = 'No contacts yet';
      sub = 'Contacts you save will appear here.';
    } else if (!state.loading) {
      pct = Math.round((masked / total) * 100);
      headline = total + (total === 1 ? ' contact' : ' contacts');
      pctText = pct + '%';
      sub = masked + ' of ' + total + (total === 1 ? ' phone number is' : ' phone numbers are') + ' masked (privacy display on).';
    }

    el.insightHeadline.textContent = headline;
    el.insightPct.textContent = pctText;
    el.insightSub.textContent = sub;
    el.insightBar.style.width = pct + '%';
    el.insightMeter.setAttribute('aria-valuenow', String(pct));
  }

  /* Dashboard preview: newest contacts, phone always masked. */
  function renderRecent() {
    if (state.loading) {
      let rows = '';
      for (let i = 0; i < RECENT_COUNT; i++) {
        rows += '<li class="recent-item skeleton-row"><div class="sk sk-circle"></div>' +
          '<div class="recent-main"><div class="sk sk-line" style="width:45%"></div></div></li>';
      }
      el.recent.innerHTML = rows;
      return;
    }
    if (state.loadError) {
      el.recent.innerHTML = '<li class="recent-empty">Unable to load contacts.</li>';
      return;
    }
    if (state.contacts.length === 0) {
      el.recent.innerHTML = '<li class="recent-empty">No contacts yet. Open the Contacts page to add your first one.</li>';
      return;
    }
    el.recent.innerHTML = state.contacts.slice(-RECENT_COUNT).reverse().map((c) =>
      '<li class="recent-item">' +
        '<div class="avatar ' + avatarClass(c.name) + '">' + escapeHtml(initials(c.name)) + '</div>' +
        '<div class="recent-main"><strong title="' + escapeHtml(c.name) + '">' + escapeHtml(c.name || 'Unnamed') + '</strong>' +
          '<span>' + escapeHtml(c.email || 'No email') + '</span></div>' +
        '<span class="recent-phone">' + icon('lock') + escapeHtml(maskPhone(c.phone)) + '</span>' +
      '</li>'
    ).join('');
  }

  function cardHtml(c, index, animate) {
    const key = contactKey(c);
    const shown = state.revealed.has(key);

    return '' +
      '<article class="contact-card' + (animate ? '' : ' no-anim') + '" data-key="' + escapeHtml(key) + '" style="--i:' + Math.min(index, 12) + '">' +
        '<div class="cc-top">' +
          '<div class="avatar ' + avatarClass(c.name) + '">' + escapeHtml(initials(c.name)) + '</div>' +
          '<div class="cc-id"><h3 title="' + escapeHtml(c.name) + '">' + escapeHtml(c.name || 'Unnamed') + '</h3><small>PHONEBOOK CONTACT</small></div>' +
        '</div>' +
        '<div class="cc-phone">' +
          '<div class="cc-phone-main">' + icon('phone') +
            '<span class="phone-num ' + (shown ? 'shown' : 'masked') + '">' + escapeHtml(shown ? c.phone : maskPhone(c.phone)) + '</span>' +
          '</div>' +
          '<button class="eye-btn" type="button" data-action="reveal" aria-pressed="' + shown + '" aria-label="' + (shown ? 'Hide phone number' : 'Show phone number') + '">' +
            icon(shown ? 'eye-off' : 'eye') + (shown ? 'Hide' : 'Show') +
          '</button>' +
        '</div>' +
        '<div class="cc-email">' + icon('mail') + '<span title="' + escapeHtml(c.email) + '">' + escapeHtml(c.email || 'No email') + '</span></div>' +
        '<div class="cc-foot">' +
          (shown
            ? '<span class="badge visible">' + icon('eye') + 'Visible briefly</span>'
            : '<span class="badge private">' + icon('lock') + 'Private</span>') +
          '<button class="del-btn" type="button" data-action="delete" aria-label="Delete ' + escapeHtml(c.name) + '">' + icon('trash') + 'Delete</button>' +
        '</div>' +
      '</article>';
  }

  function skeletonHtml() {
    let out = '';
    for (let i = 0; i < 6; i++) {
      out += '<div class="contact-card skeleton no-anim">' +
        '<div class="cc-top"><div class="sk sk-circle"></div><div class="cc-id"><div class="sk sk-line" style="width:60%"></div></div></div>' +
        '<div class="sk sk-box"></div><div class="sk sk-line" style="width:35%"></div></div>';
    }
    return out;
  }

  function stateHtml(kind) {
    if (kind === 'error') {
      return '<div class="state"><div class="state-icon bad">' + icon('alert') + '</div>' +
        '<h3>Failed to load contacts</h3><p>Unable to reach the server. Check that the application is running and try again.</p>' +
        '<button class="btn btn-ghost" type="button" data-action="retry">Try again</button></div>';
    }
    if (kind === 'empty') {
      return '<div class="state"><div class="state-icon">' + icon('users') + '</div>' +
        '<h3>No contacts yet</h3><p>Add your first contact to get started.</p>' +
        '<button class="btn btn-primary" type="button" data-action="add">' + icon('plus') + 'Add Contact</button></div>';
    }
    if (kind === 'search') {
      return '<div class="state"><div class="state-icon">' + icon('search') + '</div>' +
        '<h3>No contacts found</h3><p>Try a different name, phone number or email.</p></div>';
    }
    return '<div class="state"><div class="state-icon">' + icon('lock') + '</div>' +
      '<h3>Nothing to show</h3><p>Every contact in this view is currently revealed.</p></div>';
  }

  function render() {
    renderStats();
    renderInsight();
    renderRecent();

    if (state.loading) {
      el.grid.innerHTML = skeletonHtml();
      el.count.textContent = 'Loading contacts...';
      return;
    }
    if (state.loadError) {
      el.grid.innerHTML = stateHtml('error');
      el.count.textContent = 'Contacts unavailable';
      return;
    }

    const list = visibleContacts();
    const total = state.contacts.length;

    if (total === 0) {
      el.grid.innerHTML = stateHtml('empty');
      el.count.textContent = '0 contacts';
      return;
    }

    if (list.length === 0) {
      el.grid.innerHTML = stateHtml(state.query.trim() ? 'search' : 'filter');
      el.count.textContent = '0 contacts shown';
      return;
    }

    el.grid.innerHTML = list.map((c, i) => cardHtml(c, i, true)).join('');
    el.count.textContent = state.query.trim() || state.filter !== 'all'
      ? list.length + ' of ' + total + ' contacts shown'
      : total + (total === 1 ? ' contact' : ' contacts');
  }

  function findContact(key) {
    return state.contacts.find((c) => contactKey(c) === key) ||
           state.base.find((c) => contactKey(c) === key);
  }

  function updateCard(key) {
    const contact = findContact(key);
    if (!contact) return;
    const old = Array.from(el.grid.querySelectorAll('.contact-card')).find((n) => n.dataset.key === key);
    if (old) {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(contact, 0, false);
      old.replaceWith(tmp.firstElementChild);
    }
    renderStats();
    renderInsight();
  }

  /* ---------------------------------------------------------
     Privacy: reveal / hide (display only)
     --------------------------------------------------------- */
  function hideNumber(key) {
    state.revealed.delete(key);
    clearTimeout(state.timers.get(key));
    state.timers.delete(key);
    updateCard(key);
  }

  function toggleReveal(key) {
    if (state.revealed.has(key)) {
      hideNumber(key);
      return;
    }
    state.revealed.add(key);
    state.timers.set(key, setTimeout(() => hideNumber(key), REVEAL_MS));
    updateCard(key);
  }

  /* ---------------------------------------------------------
     Events: contact grid (delegation)
     --------------------------------------------------------- */
  el.grid.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const card = btn.closest('.contact-card');
    const key = card ? card.dataset.key : null;

    if (action === 'reveal') toggleReveal(key);
    else if (action === 'delete') askDelete(key);
    else if (action === 'add') openModal();
    else if (action === 'retry') loadContacts();
  });

  /* Search box */
  let searchTimer = null;
  el.search.addEventListener('input', () => {
    state.query = el.search.value;
    el.clear.hidden = state.query === '';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
  });
  el.clear.addEventListener('click', () => {
    el.search.value = '';
    state.query = '';
    el.clear.hidden = true;
    el.search.focus();
    applySearch();
  });

  /* Filter buttons */
  function setFilter(name) {
    state.filter = name;
    document.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.filter === name));
  }
  document.querySelectorAll('.seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      setFilter(btn.dataset.filter);
      render();
    });
  });

  /* ---------------------------------------------------------
     Overlay helpers (Add Contact modal + Delete confirmation)
     --------------------------------------------------------- */
  const focusMemory = new WeakMap();

  function openOverlay(node, focusTarget) {
    focusMemory.set(node, document.activeElement);
    node.hidden = false;
    requestAnimationFrame(() => node.classList.add('open'));
    setTimeout(() => { if (focusTarget) focusTarget.focus(); }, 60);
  }

  function closeOverlay(node) {
    node.classList.remove('open');
    setTimeout(() => { if (!node.classList.contains('open')) node.hidden = true; }, 200);
    const prev = focusMemory.get(node);
    if (prev && prev.focus && document.contains(prev)) prev.focus();
  }

  /* ---------------------------------------------------------
     Add Contact modal + POST /items
     --------------------------------------------------------- */
  function openModal() {
    el.form.reset();
    clearErrors();
    updateCounter();
    openOverlay(el.modal, el.name);
  }

  function closeModal() {
    closeOverlay(el.modal);
  }

  function setFieldError(fieldId, errId, message) {
    const field = $(fieldId);
    $(errId).textContent = message || '';
    field.classList.toggle('invalid', Boolean(message));
  }

  function clearErrors() {
    setFieldError('field-name', 'err-name', '');
    setFieldError('field-phone', 'err-phone', '');
    setFieldError('field-email', 'err-email', '');
    el.formError.hidden = true;
    el.formError.textContent = '';
  }

  function nameError() {
    return el.name.value.trim() === '' ? 'Please enter a full name.' : '';
  }

  function phoneError() {
    const value = el.phone.value.trim();
    if (value === '') return 'Please enter a valid 10-digit mobile number.';
    if (/[A-Za-z]/.test(value)) return 'Phone number must contain digits only, no letters.';
    if (/\D/.test(value)) return 'Phone number must contain digits only.';
    if (value.length !== 10) return 'Please enter a valid 10-digit mobile number.';
    return '';
  }

  function emailError() {
    const value = el.email.value.trim();
    if (value === '') return 'Please enter an email address.';
    if (!EMAIL_RE.test(value)) return 'Please enter a valid email address.';
    return '';
  }

  function updateCounter() {
    const len = el.phone.value.trim().length;
    el.counter.textContent = len + '/10';
    el.counter.classList.toggle('done', len === 10 && !/\D/.test(el.phone.value));
  }

  el.addBtns.forEach((btn) => btn.addEventListener('click', openModal));
  el.name.addEventListener('input', () => {
    if ($('field-name').classList.contains('invalid')) setFieldError('field-name', 'err-name', nameError());
  });
  el.phone.addEventListener('input', () => {
    updateCounter();
    if ($('field-phone').classList.contains('invalid')) setFieldError('field-phone', 'err-phone', phoneError());
  });
  el.email.addEventListener('input', () => {
    if ($('field-email').classList.contains('invalid')) setFieldError('field-email', 'err-email', emailError());
  });

  function postContact(payload) {
    return request(API.items, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const nErr = nameError();
    const pErr = phoneError();
    const eErr = emailError();
    setFieldError('field-name', 'err-name', nErr);
    setFieldError('field-phone', 'err-phone', pErr);
    setFieldError('field-email', 'err-email', eErr);
    if (nErr || pErr || eErr) {
      (nErr ? el.name : pErr ? el.phone : el.email).focus();
      return;
    }

    const payload = {
      name: el.name.value.trim(),
      phone: el.phone.value.trim(),
      email: el.email.value.trim()
    };
    setSaving(true);

    try {
      const res = await postContact(payload);
      if (res.ok) {
        // Show the new contact immediately: clear any search / filter.
        el.search.value = '';
        state.query = '';
        el.clear.hidden = true;
        setFilter('all');
        closeModal();
        toast('Contact added successfully.', 'success');
        await loadContacts(true);
      } else {
        const serverMsg = await readServerMessage(res);
        el.formError.textContent = 'Contact could not be added.' + (serverMsg ? ' ' + serverMsg : '');
        el.formError.hidden = false;
        toast('Contact could not be added.', 'error');
      }
    } catch (err) {
      el.formError.textContent = 'Unable to connect to server.';
      el.formError.hidden = false;
      toast('Unable to connect to server.', 'error');
    } finally {
      setSaving(false);
    }
  });

  function setSaving(on) {
    el.saveBtn.disabled = on;
    el.saveBtn.querySelector('.spinner').hidden = !on;
    el.saveBtn.querySelector('.btn-label').textContent = on ? 'Saving...' : 'Save Contact';
  }

  /* ---------------------------------------------------------
     Delete: confirmation dialog + DELETE /items/<id>
     --------------------------------------------------------- */
  function askDelete(key) {
    const contact = findContact(key);
    if (!contact) return;
    state.pendingDelete = contact;
    el.confirmName.textContent = contact.name;
    openOverlay(el.confirmModal, el.confirmCancel);
  }

  function cancelDelete() {
    if (state.deleting) return;
    state.pendingDelete = null;
    closeOverlay(el.confirmModal);
  }

  function setDeleting(on) {
    state.deleting = on;
    el.confirmBtn.disabled = on;
    el.confirmCancel.disabled = on;
    el.confirmBtn.querySelector('.spinner').hidden = !on;
    el.confirmBtn.querySelector('.btn-label').textContent = on ? 'Deleting...' : 'Delete';
  }

  async function confirmDelete() {
    const contact = state.pendingDelete;
    if (!contact || state.deleting) return;
    setDeleting(true);

    try {
      const res = await request(API.items + '/' + encodeURIComponent(contact.id), {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });

      if (res.ok || res.status === 404) {
        const key = contactKey(contact);
        clearTimeout(state.timers.get(key));
        state.timers.delete(key);
        state.revealed.delete(key);
        toast(res.ok ? 'Contact deleted.' : 'That contact was already removed.', res.ok ? 'success' : 'info');
        state.pendingDelete = null;
        closeOverlay(el.confirmModal);
        await loadContacts(true);   // refresh list, count, stats and recent preview
      } else {
        const serverMsg = await readServerMessage(res);
        toast('Contact could not be deleted.' + (serverMsg ? ' ' + serverMsg : ''), 'error');
      }
    } catch (err) {
      toast('Unable to connect to server.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  el.confirmBtn.addEventListener('click', confirmDelete);

  /* ---------------------------------------------------------
     Overlay close behaviour (backdrop click, Cancel / X buttons)
     --------------------------------------------------------- */
  el.modal.addEventListener('click', (event) => {
    if (event.target === el.modal || event.target.closest('[data-close]')) closeModal();
  });
  el.confirmModal.addEventListener('click', (event) => {
    if (event.target === el.confirmModal || event.target.closest('[data-close]')) cancelDelete();
  });

  /* Keyboard: Esc closes dialogs / menu, Tab stays inside the open dialog */
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!el.confirmModal.hidden) cancelDelete();
      else if (!el.modal.hidden) closeModal();
      closeSidebar();
    }
    if (event.key === 'Tab') {
      const open = document.querySelector('.overlay:not([hidden])');
      if (!open) return;
      const focusable = open.querySelectorAll('button:not([disabled]), input, [href]');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  /* ---------------------------------------------------------
     Sidebar (mobile)
     --------------------------------------------------------- */
  function openSidebar() {
    el.sidebar.classList.add('open');
    el.backdrop.hidden = false;
    el.menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    el.sidebar.classList.remove('open');
    el.backdrop.hidden = true;
    el.menuBtn.setAttribute('aria-expanded', 'false');
  }
  el.menuBtn.addEventListener('click', openSidebar);
  el.backdrop.addEventListener('click', closeSidebar);

  /* ---------------------------------------------------------
     Start
     --------------------------------------------------------- */
  showView(location.hash.slice(1));
  loadContacts();
})();
