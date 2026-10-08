/* Login / Register helpers: show-hide password, confirm check, busy button.
   The real validation always happens on the Flask server. */
(() => {
  'use strict';

  document.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('on', show);
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  const pw = document.getElementById('password');
  const confirm = document.getElementById('confirm');
  if (pw && confirm) {
    const check = () => confirm.setCustomValidity(
      confirm.value && confirm.value !== pw.value ? 'Passwords do not match.' : ''
    );
    pw.addEventListener('input', check);
    confirm.addEventListener('input', check);
  }

  const form = document.querySelector('form.auth-form');
  if (!form) return;
  const button = form.querySelector('.auth-submit');
  const label = button.querySelector('.btn-label');
  const spinner = button.querySelector('.spinner');
  const idle = label.textContent;

  const setBusy = (busy) => {
    button.disabled = busy;
    spinner.hidden = !busy;
    label.textContent = busy ? 'Please wait...' : idle;
  };
  form.addEventListener('submit', () => setBusy(true));
  window.addEventListener('pageshow', () => setBusy(false));   // Back button
})();
