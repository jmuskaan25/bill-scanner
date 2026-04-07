// ============================================
// Cab Bill Scanner - Submissions Page Logic
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, signInWithPopup, onAuthStateChanged, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

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

let currentUser = null;
localStorage.removeItem('via_signing_in');

if (sessionStorage.getItem('via_authed') === '1' && signInWall) {
  signInWall.style.display = 'none';
}

// ---- Auth ----
if (auth) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      sessionStorage.setItem('via_authed', '1');
      if (signInWall) signInWall.style.display = 'none';
      loadRecentSubmissions();
    } else {
      sessionStorage.removeItem('via_authed');
      if (signInWall) signInWall.style.display = 'flex';
    }
  });
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
    await signInWithPopup(auth, provider);
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
  if (!db || !currentUser) return;

  submissionsBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#9ca3af;">Loading...</td></tr>`;

  try {
    // Filter by current user's email — no orderBy so no index required
    const q = query(
      collection(db, 'reimbursements'),
      where('email', '==', currentUser.email)
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

    // Sort client-side: newest first
    const docs = [];
    snapshot.forEach(doc => docs.push(doc.data()));
    docs.sort((a, b) => {
      const ta = a.submittedAt?.toDate?.() || new Date(0);
      const tb = b.submittedAt?.toDate?.() || new Date(0);
      return tb - ta;
    });

    submissionsBody.innerHTML = '';
    docs.forEach(d => {
      const tr = document.createElement('tr');

      const submittedAt = d.submittedAt?.toDate
        ? d.submittedAt.toDate().toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric'
          })
        : '--';

      // Ride date from the bill (d.date is YYYY-MM-DD)
      let rideDate = '--';
      if (d.date && /^\d{4}-\d{2}-\d{2}/.test(d.date)) {
        rideDate = new Date(d.date).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric'
        });
      }

      let submittedByHtml = escapeHtml(d.submittedBy || '--');
      if (d.photoURL) {
        submittedByHtml = `<span style="display:inline-flex;align-items:center;gap:6px;"><img src="${escapeHtml(d.photoURL)}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;">${escapeHtml(d.submittedBy || '--')}</span>`;
      }

      const currency = d.currency || 'INR';
      const symbol = currency === 'INR' ? '₹' : currency + ' ';
      const amount = d.totalAmount != null ? `${symbol}${Number(d.totalAmount).toFixed(2)}` : '--';

      tr.innerHTML = `
        <td style="white-space:nowrap;">${escapeHtml(submittedAt)}</td>
        <td>${submittedByHtml}</td>
        <td>${escapeHtml(d.provider || '--')}</td>
        <td style="white-space:nowrap;">${escapeHtml(rideDate)}</td>
        <td>${escapeHtml(d.pickup || '--')}</td>
        <td>${escapeHtml(d.drop || '--')}</td>
        <td><strong>${escapeHtml(amount)}</strong></td>
      `;
      submissionsBody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading submissions:', err);
    submissionsBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#ef4444;">Failed to load. Please refresh.</td></tr>`;
  }
}

// ---- Utility ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
