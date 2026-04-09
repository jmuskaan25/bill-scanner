// ============================================
// Cab Bill Scanner - Admin Management Page
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

// ---- Firebase Init ----
let db = null;
let auth = null;
let functions = null;

try {
  const app = initializeApp(CONFIG.FIREBASE);
  db = getFirestore(app);
  auth = getAuth(app);
  functions = getFunctions(app);
} catch (e) {
  console.warn('Firebase not configured yet.', e);
}

// ---- DOM Refs ----
const manageBody = document.getElementById('manageBody');
const toastContainer = document.getElementById('toastContainer');
const signInWall = document.getElementById('signInWall');
const wallSignInBtn = document.getElementById('wallSignInBtn');
const adminToggleBtn = document.getElementById('adminToggleBtn');
const adminPasswordField = document.getElementById('adminPasswordField');
const adminPasswordInput = document.getElementById('adminPasswordInput');

let currentUser = null;
localStorage.removeItem('via_signing_in');

// ---- Admin Toggle ----
if (adminToggleBtn && adminPasswordField) {
  adminToggleBtn.addEventListener('click', () => {
    const isVisible = adminPasswordField.style.display !== 'none';
    adminPasswordField.style.display = isVisible ? 'none' : 'block';
    adminToggleBtn.textContent = isVisible ? 'Sign in as Admin' : 'Cancel admin login';
  });
}

// Hide wall if already authed as admin
if (sessionStorage.getItem('via_authed') === '1' && sessionStorage.getItem('via_admin') === '1' && signInWall) {
  signInWall.style.display = 'none';
}

// ---- Auth ----
if (auth) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      if (sessionStorage.getItem('via_admin') === '1') {
        sessionStorage.setItem('via_authed', '1');
        if (signInWall) signInWall.style.display = 'none';
        loadAllSubmissions();
      } else {
        // Not admin — show error and redirect
        showToast('Admin access required.', 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
      }
    } else {
      sessionStorage.removeItem('via_authed');
      if (signInWall) signInWall.style.display = 'flex';
    }
  });
}

// ---- Wall Sign-In Button ----
wallSignInBtn.addEventListener('click', async () => {
  if (!auth) {
    showToast('Firebase not initialized.', 'error');
    return;
  }

  wallSignInBtn.disabled = true;
  wallSignInBtn.textContent = 'Signing in...';

  const isAdminAttempt = adminPasswordField && adminPasswordField.style.display !== 'none';
  if (!isAdminAttempt) {
    showToast('Please use the admin login toggle below.', 'error');
    wallSignInBtn.disabled = false;
    wallSignInBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Continue with Google';
    return;
  }

  if (!adminPasswordInput || adminPasswordInput.value !== 'admin') {
    showToast('Incorrect admin password.', 'error');
    wallSignInBtn.disabled = false;
    wallSignInBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Continue with Google';
    return;
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    if (result.user) {
      sessionStorage.setItem('via_authed', '1');
      sessionStorage.setItem('via_admin', '1');
      if (signInWall) signInWall.style.display = 'none';
    }
  } catch (err) {
    wallSignInBtn.disabled = false;
    wallSignInBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Continue with Google';
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('Sign-in error:', err);
      showToast(`Sign-in failed: ${err.message}`, 'error');
    }
  }
});

// ---- Toast ----
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---- Load All Submissions ----
async function loadAllSubmissions() {
  if (!db) return;

  manageBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#9ca3af;">Loading...</td></tr>';

  try {
    const snapshot = await getDocs(collection(db, 'reimbursements'));

    if (snapshot.empty) {
      manageBody.innerHTML = `
        <tr><td colspan="7">
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <p>No submissions yet.</p>
          </div>
        </td></tr>`;
      return;
    }

    // Sort client-side: newest first
    const docs = [];
    snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
    docs.sort((a, b) => {
      const ta = a.submittedAt?.toDate?.() || new Date(0);
      const tb = b.submittedAt?.toDate?.() || new Date(0);
      return tb - ta;
    });

    manageBody.innerHTML = '';
    docs.forEach(d => {
      const tr = document.createElement('tr');

      const submittedAt = d.submittedAt?.toDate
        ? d.submittedAt.toDate().toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric'
          })
        : '--';

      let submittedByHtml = escapeHtml(d.submittedBy || '--');
      if (d.photoURL) {
        submittedByHtml = `<span style="display:inline-flex;align-items:center;gap:6px;"><img src="${escapeHtml(d.photoURL)}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;">${escapeHtml(d.submittedBy || '--')}</span>`;
      }

      const currency = d.currency || 'INR';
      const symbol = currency === 'INR' ? '\u20B9' : currency + ' ';
      const amount = d.totalAmount != null ? `${symbol}${Number(d.totalAmount).toFixed(2)}` : '--';

      const status = d.status || 'pending';

      tr.innerHTML = `
        <td style="white-space:nowrap;">${escapeHtml(submittedAt)}</td>
        <td>${submittedByHtml}</td>
        <td>${escapeHtml(d.provider || '--')}</td>
        <td>${escapeHtml(d.pickup || '--')}</td>
        <td>${escapeHtml(d.drop || '--')}</td>
        <td><strong>${escapeHtml(amount)}</strong></td>
        <td>
          <select class="status-select status-${escapeHtml(status)}" data-doc-id="${escapeHtml(d.id)}" data-current="${escapeHtml(status)}">
            <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="approved" ${status === 'approved' ? 'selected' : ''}>Approved</option>
            <option value="rejected" ${status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </td>
      `;
      manageBody.appendChild(tr);
    });

    // Attach change listeners to status dropdowns
    manageBody.querySelectorAll('.status-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const docId = e.target.dataset.docId;
        const newStatus = e.target.value;
        const oldStatus = e.target.dataset.current;
        if (newStatus === oldStatus) return;

        e.target.disabled = true;
        try {
          await updateDoc(doc(db, 'reimbursements', docId), { status: newStatus });
          const updateSheetFn = httpsCallable(functions, 'updateSheetStatus');
          await updateSheetFn({ docId, status: newStatus });
          e.target.dataset.current = newStatus;
          e.target.className = `status-select status-${newStatus}`;
          showToast(`Updated to ${newStatus}`, 'success');
        } catch (err) {
          console.error(err);
          e.target.value = oldStatus;
          showToast(`Failed: ${err.message}`, 'error');
        } finally {
          e.target.disabled = false;
        }
      });
    });

  } catch (err) {
    console.error('Error loading submissions:', err);
    manageBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#ef4444;">Failed to load. Please refresh.</td></tr>';
  }
}

// ---- Sync Sheet ----
const syncSheetBtn = document.getElementById('syncSheetBtn');
if (syncSheetBtn) {
  syncSheetBtn.addEventListener('click', async () => {
    syncSheetBtn.disabled = true;
    syncSheetBtn.textContent = 'Syncing...';
    try {
      const backfillFn = httpsCallable(functions, 'backfillSheet');
      const result = await backfillFn({});
      showToast(`Synced ${result.data.synced} records to Google Sheet`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`Sync failed: ${err.message}`, 'error');
    } finally {
      syncSheetBtn.disabled = false;
      syncSheetBtn.textContent = '🔄 Sync Sheet';
    }
  });
}

// ---- Utility ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
