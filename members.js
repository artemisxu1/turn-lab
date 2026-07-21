// ---------- Lab members gate ----------
//
// HOW TO CHANGE THE PASSWORD
// 1. Open a terminal and run (replacing the example password):
//      printf '%s' 'your-new-password' | shasum -a 256
// 2. Paste the resulting hex string into PASS_HASH below.
//
// IMPORTANT — what this does and does not protect.
// This site is static (GitHub Pages), so the check runs in the visitor's
// browser. The password is never stored in plain text, but the protected
// text below is still present in the page source for anyone who knows to
// look. Treat this as a "not for casual visitors" door, not a lock: keep
// real protocols and inventories behind institutional links (UW Box,
// Google Drive, Benchling) that require their own sign-in, and put only
// links and short descriptions on this page.
//
// Current password: turnlab-crossroads   <-- change this before sharing
const PASS_HASH = '82528be40dcfca4e6494b8d806bf71e6c462b9ba0e6344053c790780f24e859a';

(function () {
  const form = document.getElementById('gateForm');
  const card = document.getElementById('gateCard');
  const area = document.getElementById('memberArea');
  const input = document.getElementById('gatePass');
  const error = document.getElementById('gateError');
  const signOut = document.getElementById('signOut');
  if (!form || !card || !area) return;

  const KEY = 'turnlab-member';

  // crypto.subtle only exists in a secure context (https:// or localhost).
  // Opening the file directly with file:// will not work.
  if (!(window.crypto && crypto.subtle)) {
    error.textContent = 'This page must be served over https:// or localhost to sign in.';
    error.hidden = false;
    return;
  }

  async function hash(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function unlock() {
    card.hidden = true;
    area.hidden = false;
    // the reveal observer already ran, so show anything inside immediately
    area.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  }

  if (sessionStorage.getItem(KEY) === 'ok') unlock();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const ok = (await hash(input.value.trim())) === PASS_HASH;
    if (ok) {
      sessionStorage.setItem(KEY, 'ok');
      unlock();
    } else {
      error.hidden = false;
      input.value = '';
      input.focus();
    }
  });

  if (signOut) signOut.addEventListener('click', () => {
    sessionStorage.removeItem(KEY);
    location.reload();
  });
})();
