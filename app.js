// ============================================
// Cab Bill Scanner - Main Application Logic
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, getDocs, orderBy, limit, query, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getAuth, signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ---- Firebase Init ----
let db = null;
let storage = null;
let functions = null;
let auth = null;
let currentUser = null;

try {
  const app = initializeApp(CONFIG.FIREBASE);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app);
  auth = getAuth(app);
} catch (e) {
  console.warn('Firebase not configured yet. Submissions will not be saved.', e);
}

// ---- State ----
let currentFile = null;
let currentBase64 = null;

// ---- DOM Refs ----
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const previewContainer = document.getElementById('previewContainer');
const previewImage = document.getElementById('previewImage');
const pdfIndicator = document.getElementById('pdfIndicator');
const pdfFileName = document.getElementById('pdfFileName');
const fileNameEl = document.getElementById('fileName');
const scanBtn = document.getElementById('scanBtn');
const scanBtnText = document.getElementById('scanBtnText');
const scanLoading = document.getElementById('scanLoading');
const submitBtn = document.getElementById('submitBtn');
const submitBtnText = document.getElementById('submitBtnText');
const submitLoading = document.getElementById('submitLoading');
const reimbursementForm = document.getElementById('reimbursementForm');
const toastContainer = document.getElementById('toastContainer');
const submissionsBody = document.getElementById('submissionsBody');

// Auth DOM refs
const signedOutView = document.getElementById('signedOutView');
const signedInView = document.getElementById('signedInView');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const signOutLink = document.getElementById('signOutLink');

// ---- Auth ----
if (auth) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      signedOutView.style.display = 'none';
      signedInView.style.display = 'block';
      userAvatar.src = user.photoURL || '';
      userName.textContent = user.displayName || 'User';
      userEmail.textContent = user.email || '';
      // Enable submit if amount is filled
      if (document.getElementById('formAmount').value) {
        submitBtn.disabled = false;
      }
    } else {
      signedOutView.style.display = 'block';
      signedInView.style.display = 'none';
      submitBtn.disabled = true;
    }
  });
}

googleSignInBtn.addEventListener('click', async () => {
  if (!auth) {
    showToast('Firebase not initialized.', 'error');
    return;
  }
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('Sign-in error:', err);
      showToast(`Sign-in failed: ${err.message}`, 'error');
    }
  }
});

signOutLink.addEventListener('click', async () => {
  if (!auth) return;
  try {
    await signOut(auth);
    showToast('Signed out.', 'info');
  } catch (err) {
    console.error('Sign-out error:', err);
  }
});

// ---- Tab Switching ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // Update active tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Show/hide content
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.add('hidden'));
    const target = tab.getAttribute('data-tab');
    document.getElementById(`tab-${target}`).classList.remove('hidden');

    // Refresh submissions when switching to that tab
    if (target === 'submissions') {
      loadRecentSubmissions();
    }
  });
});

// ---- Toast Notifications ----
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---- File Upload Handling ----
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileUpload(file);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFileUpload(file);
});

function handleFileUpload(file) {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!validTypes.includes(file.type)) {
    showToast('Please upload a JPG, PNG, WEBP, or PDF file.', 'error');
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    showToast('File too large. Maximum size is 20MB.', 'error');
    return;
  }

  currentFile = file;

  // Read file as base64
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    currentBase64 = dataUrl.split(',')[1];

    // Show preview
    previewContainer.classList.add('visible');
    fileNameEl.textContent = file.name;

    if (file.type === 'application/pdf') {
      previewImage.style.display = 'none';
      pdfIndicator.style.display = 'flex';
      pdfFileName.textContent = file.name;
    } else {
      pdfIndicator.style.display = 'none';
      previewImage.style.display = 'block';
      previewImage.src = dataUrl;
    }

    uploadZone.classList.add('has-file');
    scanBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

// ---- Scan Bill with Claude API ----
scanBtn.addEventListener('click', scanBill);

async function scanBill() {
  if (!currentFile || !currentBase64) return;

  if (!functions) {
    showToast('Firebase not initialized.', 'error');
    return;
  }

  // Show loading
  scanBtn.disabled = true;
  scanBtnText.innerHTML = '<span class="spinner"></span> Scanning...';
  scanLoading.classList.add('visible');

  try {
    const scanBillFn = httpsCallable(functions, 'scanBill');
    const result = await scanBillFn({ imageBase64: currentBase64, mediaType: currentFile.type });
    const data = result.data;

    // Populate cab-specific fields
    document.getElementById('formProvider').value = data.provider || '';
    document.getElementById('formRideId').value = data.rideId || '';
    document.getElementById('formRiderName').value = data.riderName || '';
    document.getElementById('formDriverName').value = data.driverName || '';
    document.getElementById('formVehicleNumber').value = data.vehicleNumber || '';
    document.getElementById('formPickup').value = data.pickup || '';
    document.getElementById('formDrop').value = data.drop || '';
    document.getElementById('formDate').value = data.date || '';
    document.getElementById('formAmount').value = data.totalAmount || '';
    document.getElementById('formPaymentMethod').value = data.paymentMethod || 'cash';

    // Set currency
    if (data.currency) {
      const currencySelect = document.getElementById('formCurrency');
      const option = Array.from(currencySelect.options).find(
        o => o.value.toLowerCase() === data.currency.toLowerCase()
      );
      if (option) {
        currencySelect.value = option.value;
      } else {
        currencySelect.value = 'OTHER';
      }
    }

    // Enable submit if user is signed in
    if (currentUser) {
      submitBtn.disabled = false;
    }

    showToast('Receipt scanned successfully!', 'success');
  } catch (err) {
    console.error('Scan error:', err);
    showToast(`Scan failed: ${err.message}`, 'error');
  } finally {
    scanBtn.disabled = false;
    scanBtnText.innerHTML = '🔍 Scan Receipt';
    scanLoading.classList.remove('visible');
  }
}

// ---- Submit Reimbursement ----
reimbursementForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await submitReimbursement();
});

async function submitReimbursement() {
  if (!db || !storage) {
    showToast('Firebase is not configured. Please update config.js.', 'error');
    return;
  }

  if (!currentUser) {
    showToast('Please sign in with Google first.', 'error');
    return;
  }

  if (!currentFile) {
    showToast('Please upload a receipt first.', 'error');
    return;
  }

  const formProvider = document.getElementById('formProvider').value;
  const formRideId = document.getElementById('formRideId').value.trim();
  const formRiderName = document.getElementById('formRiderName').value.trim();
  const formDriverName = document.getElementById('formDriverName').value.trim();
  const formVehicleNumber = document.getElementById('formVehicleNumber').value.trim();
  const formPickup = document.getElementById('formPickup').value.trim();
  const formDrop = document.getElementById('formDrop').value.trim();
  const formDate = document.getElementById('formDate').value;
  const formAmount = parseFloat(document.getElementById('formAmount').value);
  const formCurrency = document.getElementById('formCurrency').value;
  const formPaymentMethod = document.getElementById('formPaymentMethod').value;
  const formPurpose = document.getElementById('formPurpose').value.trim();

  if (!formAmount) {
    showToast('Please fill in the total amount.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtnText.innerHTML = '<span class="spinner"></span> Submitting...';
  submitLoading.classList.add('visible');

  try {
    // Upload image to Firebase Storage
    const timestamp = Date.now();
    const storageRef = ref(storage, `bills/${timestamp}_${currentFile.name}`);
    await uploadBytes(storageRef, currentFile);
    const imageUrl = await getDownloadURL(storageRef);

    // Save to Firestore
    const docData = {
      submittedBy: currentUser.displayName,
      email: currentUser.email,
      photoURL: currentUser.photoURL,
      provider: formProvider,
      rideId: formRideId,
      riderName: formRiderName,
      driverName: formDriverName,
      vehicleNumber: formVehicleNumber,
      pickup: formPickup,
      drop: formDrop,
      date: formDate,
      totalAmount: formAmount,
      currency: formCurrency,
      paymentMethod: formPaymentMethod,
      purpose: formPurpose,
      category: 'travel',
      imageUrl: imageUrl,
      submittedAt: serverTimestamp(),
      status: 'pending'
    };

    await addDoc(collection(db, 'reimbursements'), docData);

    showToast('Reimbursement submitted successfully!', 'success');

    // Reset form
    resetForm();

  } catch (err) {
    console.error('Submit error:', err);
    showToast(`Submission failed: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtnText.textContent = 'Submit Reimbursement';
    submitLoading.classList.remove('visible');
  }
}

function resetForm() {
  reimbursementForm.reset();
  currentFile = null;
  currentBase64 = null;
  previewContainer.classList.remove('visible');
  uploadZone.classList.remove('has-file');
  scanBtn.disabled = true;
  submitBtn.disabled = true;
  fileInput.value = '';
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

// ---- Init ----
// Enable submit button when amount changes and user is signed in
document.getElementById('formAmount').addEventListener('input', () => {
  if (document.getElementById('formAmount').value && currentUser) {
    submitBtn.disabled = false;
  }
});

// Load submissions on page load
loadRecentSubmissions();
