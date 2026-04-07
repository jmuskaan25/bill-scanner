// ============================================
// Cab Bill Scanner - Submissions Page Logic
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, getDocs, orderBy, limit, query } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ---- Firebase Init ----
let db = null;
let auth = null;

try {
  const app = initializeApp(CONFIG.FIREBASE);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (e) {
  console.warn('Firebase not configured yet.', e);
}

// ---- DOM Refs ----
const submissionsBody = document.getElementById('submissionsBody');
const toastContainer = document.getElementById('toastContainer');
const signInWall = document.getElementById('signInWall');
const wallSignInBtn = document.getElementById('wallSignInBtn');

// Hide wall immediately if already authed or mid-sign-in
if ((sessionStorage.getItem('via_authed') === '1' || sessionStorage.getItem('via_signing_in') === '1') && signInWall) {
  signInWall.style.display = 'none';
}

// ---- Auth ----
if (auth) {
  getRedirectResult(auth)
    .then(result => { if (result?.user) onSignedIn(result.user); })
    .catch(() => { sessionStorage.removeItem('via_signing_in'); });

  onAuthStateChanged(auth, (user) => {
    if (user) onSignedIn(user);
    else {
      sessionStorage.removeItem('via_authed');
      sessionStorage.removeItem('via_signing_in');
      signInWall.style.display = 'flex';
    }
  });
}

function onSignedIn(user) {
  sessionStorage.setItem('via_authed', '1');
  sessionStorage.removeItem('via_signing_in');
  signInWall.style.display = 'none';
  loadRecentSubmissions();
}

// Wall sign-in button
wallSignInBtn.addEventListener('click', async () => {
  if (!auth) {
    showToast('Firebase not initialized.', 'error');
    return;
  }
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (popupErr) {
      if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/popup-cancelled') {
        sessionStorage.setItem('via_signing_in', '1');
        await signInWithRedirect(auth, provider);
      } else {
        throw popupErr;
      }
    }
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('Sign-in error:', err);
      showToast(`Sign-in failed: ${err.message}`, 'error');
    }
  }
});

// ---- Toast Notifications ----
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---- Load Recent Submissions ----
async function loadRecentSubmissions() {
  if (!db) return;

  try {
    const q = query(
      collection(db, 'reimbursements'),
      orderBy('submittedAt', 'desc'),
      limit(20)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      submissionsBody.innerHTML = `
        <tr><td colspan="7">
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <p>No submissions yet. Upload a cab receipt to get started!</p>
          </div>
        </td></tr>`;
      return;
    }

    submissionsBody.innerHTML = '';
    snapshot.forEach(doc => {
      const d = doc.data();
      const tr = document.createElement('tr');

      const submittedAt = d.submittedAt?.toDate
        ? d.submittedAt.toDate().toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
          })
        : '--';

      const statusClass = {
        pending: 'badge-pending',
        approved: 'badge-approved',
        rejected: 'badge-rejected'
      }[d.status] || 'badge-pending';

      // Build route string, truncated
      const pickup = d.pickup || '';
      const drop = d.drop || '';
      let route = '--';
      if (pickup || drop) {
        const truncate = (s, len) => s.length > len ? s.substring(0, len) + '...' : s;
        route = `${truncate(pickup, 20)} → ${truncate(drop, 20)}`;
      }

      // Submitted by with avatar
      let submittedByHtml = escapeHtml(d.submittedBy || '--');
      if (d.photoURL) {
        submittedByHtml = `<span style="display:inline-flex;align-items:center;gap:6px;"><img src="${escapeHtml(d.photoURL)}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;"> ${submittedByHtml}</span>`;
      }

      tr.innerHTML = `
        <td>${escapeHtml(submittedAt)}</td>
        <td>${submittedByHtml}</td>
        <td>${escapeHtml(d.provider || '--')}</td>
        <td>${escapeHtml(d.rideId || '--')}</td>
        <td>${escapeHtml(route)}</td>
        <td><strong>${escapeHtml(d.currency || '')} ${d.totalAmount != null ? Number(d.totalAmount).toFixed(2) : '--'}</strong></td>
        <td><span class="badge ${statusClass}">${escapeHtml(d.status || 'pending')}</span></td>
      `;
      submissionsBody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading submissions:', err);
  }
}

// ---- Utility ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
