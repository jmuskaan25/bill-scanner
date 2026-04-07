// ============================================
// Cab Bill Scanner - Submissions Page Logic
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, getDocs, orderBy, limit, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, signInWithRedirect, getRedirectResult, onAuthStateChanged, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

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

const signingInOverlay = document.getElementById('signingInOverlay');
const isSigningIn = localStorage.getItem('via_signing_in') === '1';
const isAuthed = localStorage.getItem('via_authed') === '1';

if (signInWall && (isAuthed || isSigningIn)) signInWall.style.display = 'none';
if (isSigningIn && signingInOverlay) signingInOverlay.style.display = 'flex';

let currentUser = null;

function onSignedIn(user) {
  currentUser = user;
  localStorage.setItem('via_authed', '1');
  localStorage.removeItem('via_signing_in');
  if (signInWall) signInWall.style.display = 'none';
  if (signingInOverlay) signingInOverlay.style.display = 'none';
  loadRecentSubmissions();
}

function showWall() {
  localStorage.removeItem('via_authed');
  localStorage.removeItem('via_signing_in');
  if (signingInOverlay) signingInOverlay.style.display = 'none';
  if (signInWall) signInWall.style.display = 'flex';
}

// ---- Auth ----
if (auth) {
  getRedirectResult(auth)
    .then(result => { if (result?.user) onSignedIn(result.user); })
    .catch(err => { console.error(err); showWall(); });

  onAuthStateChanged(auth, (user) => {
    if (user) onSignedIn(user);
    else if (!isSigningIn) showWall();
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
    localStorage.setItem('via_signing_in', '1');
    await signInWithRedirect(auth, provider);
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

  submissionsBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#9ca3af;">Loading...</td></tr>`;

  try {
    const q = query(
      collection(db, 'reimbursements'),
      where('email', '==', currentUser.email),
      orderBy('submittedAt', 'desc'),
      limit(50)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      submissionsBody.innerHTML = `
        <tr><td colspan="8">
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
        ? d.submittedAt.toDate().toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : '--';

      // Ride date + time from the bill
      const rideDate = d.date || '--';

      const statusClass = {
        pending: 'badge-pending',
        approved: 'badge-approved',
        rejected: 'badge-rejected'
      }[d.status] || 'badge-pending';

      let submittedByHtml = escapeHtml(d.submittedBy || '--');
      if (d.photoURL) {
        submittedByHtml = `<span style="display:inline-flex;align-items:center;gap:6px;"><img src="${escapeHtml(d.photoURL)}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;">${submittedByHtml}</span>`;
      }

      const currency = d.currency || 'INR';
      const symbol = currency === 'INR' ? '₹' : currency + ' ';
      const amount = d.totalAmount != null ? `${symbol}${Number(d.totalAmount).toFixed(2)}` : '--';

      tr.innerHTML = `
        <td style="white-space:nowrap;">${escapeHtml(submittedAt)}</td>
        <td>${submittedByHtml}</td>
        <td>${escapeHtml(d.provider || '--')}</td>
        <td style="white-space:nowrap;">${escapeHtml(rideDate)}</td>
        <td style="max-width:180px;">${escapeHtml(d.pickup || '--')}</td>
        <td style="max-width:180px;">${escapeHtml(d.drop || '--')}</td>
        <td><strong>${escapeHtml(amount)}</strong></td>
        <td><span class="badge ${statusClass}">${escapeHtml(d.status || 'pending')}</span></td>
      `;
      submissionsBody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading submissions:', err);
    if (err.code === 'failed-precondition') {
      submissionsBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#9ca3af;">Setting up index, please try again in a moment.</td></tr>`;
    }
  }
}

// ---- Utility ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
