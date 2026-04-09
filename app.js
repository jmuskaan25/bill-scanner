// ============================================
// Cab Bill Scanner - Main Application Logic
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
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
const uploadIdleState = document.getElementById('uploadIdleState');
const uploadScanningState = document.getElementById('uploadScanningState');
const scanFileName = document.getElementById('scanFileName');
const uploadZoneSection = document.getElementById('uploadZoneSection');
const confirmCard = document.getElementById('confirmCard');
const confirmSubmitBtn = document.getElementById('confirmSubmitBtn');
const editToggleBtn = document.getElementById('editToggleBtn');
const cancelBtn = document.getElementById('cancelBtn');
const editForm = document.getElementById('editForm');
const confirmDetailsView = document.getElementById('confirmDetailsView');
const submitLoading = document.getElementById('submitLoading');
const successSection = document.getElementById('successSection');
const toastContainer = document.getElementById('toastContainer');

// Auth DOM refs
const signedOutView = document.getElementById('signedOutView');
const signedInView = document.getElementById('signedInView');
const googleSignInBtn = document.getElementById('googleSignInBtn'); // may not exist if sign-in is wall-only
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const signOutLink = document.getElementById('signOutLink');

// Sign-in wall refs
const signInWall = document.getElementById('signInWall');
const wallSignInBtn = document.getElementById('wallSignInBtn');

// Admin refs
const adminToggleBtn = document.getElementById('adminToggleBtn');
const adminPasswordField = document.getElementById('adminPasswordField');
const adminPasswordInput = document.getElementById('adminPasswordInput');

if (adminToggleBtn && adminPasswordField) {
  adminToggleBtn.addEventListener('click', () => {
    const isVisible = adminPasswordField.style.display !== 'none';
    adminPasswordField.style.display = isVisible ? 'none' : 'block';
    adminToggleBtn.textContent = isVisible ? 'Sign in as Admin' : 'Cancel admin login';
  });
}

// ---- Auth ----
// Hide wall immediately if we know user was recently signed in
if (sessionStorage.getItem('via_authed') === '1' && signInWall) {
  signInWall.style.display = 'none';
}
// Clean up any stale redirect flags
localStorage.removeItem('via_signing_in');

if (auth) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      sessionStorage.setItem('via_authed', '1');
      if (signInWall) signInWall.style.display = 'none';
      if (signedOutView) signedOutView.style.display = 'none';
      signedInView.style.display = 'flex';
      userAvatar.src = user.photoURL || '';
      const userAvatarLarge = document.getElementById('userAvatarLarge');
      if (userAvatarLarge) userAvatarLarge.src = user.photoURL || '';
      userName.textContent = user.displayName || 'User';
      if (userEmail) userEmail.textContent = user.email || '';
      if (sessionStorage.getItem('via_admin') === '1') {
        const manageLink = document.getElementById('manageLink');
        if (manageLink) manageLink.style.display = 'inline-flex';
      }
    } else {
      sessionStorage.removeItem('via_authed');
      if (signInWall) signInWall.style.display = 'flex';
      if (signedOutView) signedOutView.style.display = 'block';
      signedInView.style.display = 'none';
    }
  });
}

// Wall sign-in button
wallSignInBtn.addEventListener('click', async () => {
  if (!auth) {
    showToast('Firebase not initialized.', 'error');
    return;
  }
  // Show loading state on the button immediately
  wallSignInBtn.disabled = true;
  wallSignInBtn.textContent = 'Signing in...';

  const isAdminAttempt = adminPasswordField && adminPasswordField.style.display !== 'none';
  if (isAdminAttempt) {
    if (!adminPasswordInput || adminPasswordInput.value !== 'admin') {
      showToast('Incorrect admin password.', 'error');
      wallSignInBtn.disabled = false;
      wallSignInBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Continue with Google';
      return;
    }
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    // Hide wall immediately — don't wait for onAuthStateChanged
    if (result.user) {
      sessionStorage.setItem('via_authed', '1');
      if (isAdminAttempt) {
        sessionStorage.setItem('via_admin', '1');
      }
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

if (googleSignInBtn) googleSignInBtn.addEventListener('click', async () => {
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

signOutLink.addEventListener('click', async () => {
  if (!auth) return;
  try {
    sessionStorage.removeItem('via_admin');
    await signOut(auth);
    showToast('Signed out.', 'info');
  } catch (err) {
    console.error('Sign-out error:', err);
  }
});

// ---- Profile Dropdown ----
const profileDropdown = document.getElementById('profileDropdown');
if (userAvatar) {
  userAvatar.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!profileDropdown) return;
    const isOpen = profileDropdown.style.display === 'block';
    profileDropdown.style.display = isOpen ? 'none' : 'block';
  });
}
if (profileDropdown) {
  document.addEventListener('click', () => { profileDropdown.style.display = 'none'; });
  profileDropdown.addEventListener('click', (e) => e.stopPropagation());
}

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

  // Show scanning state immediately
  uploadIdleState.style.display = 'none';
  uploadScanningState.style.display = 'block';
  scanFileName.textContent = file.name;

  // Read file as base64 then auto-scan
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    currentBase64 = dataUrl.split(',')[1];
    // Auto-scan immediately
    scanBill();
  };
  reader.readAsDataURL(file);
}

// ---- Scan Bill with Claude API ----
async function scanBill() {
  if (!currentFile || !currentBase64) return;

  if (!functions) {
    showToast('Firebase not initialized.', 'error');
    resetUploadState();
    return;
  }

  try {
    const scanBillFn = httpsCallable(functions, 'scanBill');
    const result = await scanBillFn({ imageBase64: currentBase64, mediaType: currentFile.type });
    const data = result.data;

    populateConfirmCard(data);
  } catch (err) {
    console.error('Scan error:', err);
    showToast(`Scan failed: ${err.message}`, 'error');
    resetUploadState();
  }
}

// ---- Populate Confirm Card ----
function populateConfirmCard(data) {
  // Header
  document.getElementById('confirmProvider').textContent = data.provider || 'Unknown';
  const currency = data.currency || 'INR';
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
  document.getElementById('confirmAmount').textContent = `${symbol}${Number(data.totalAmount || 0).toFixed(2)}`;
  document.getElementById('confirmDate').textContent = data.date || '';

  // Route
  document.getElementById('confirmPickup').textContent = data.pickup || '-';
  document.getElementById('confirmDrop').textContent = data.drop || '-';

  // Details
  document.getElementById('dRideId').textContent = data.rideId || '-';
  document.getElementById('dRiderName').textContent = data.riderName || '-';
  document.getElementById('dDriverName').textContent = data.driverName || '-';
  document.getElementById('dVehicle').textContent = data.vehicleNumber || '-';
  document.getElementById('dPayment').textContent = data.paymentMethod || '-';
  document.getElementById('dCurrency').textContent = currency;

  // Edit form (pre-populate)
  document.getElementById('formProvider').value = data.provider || 'Other';
  document.getElementById('formRideId').value = data.rideId || '';
  document.getElementById('formRiderName').value = data.riderName || '';
  document.getElementById('formDriverName').value = data.driverName || '';
  document.getElementById('formVehicleNumber').value = data.vehicleNumber || '';
  document.getElementById('formPickup').value = data.pickup || '';
  document.getElementById('formDrop').value = data.drop || '';
  document.getElementById('formDate').value = data.date || '';
  document.getElementById('formAmount').value = data.totalAmount || '';
  document.getElementById('formCurrency').value = currency;
  document.getElementById('formPaymentMethod').value = data.paymentMethod || 'cash';

  // Clear purpose
  document.getElementById('confirmPurposeInput').value = '';

  // Reset edit state
  editForm.style.display = 'none';
  confirmDetailsView.style.display = 'grid';
  editToggleBtn.textContent = 'Edit details';

  // Show confirm card with animation
  uploadZoneSection.style.display = 'none';
  confirmCard.style.display = 'block';
  requestAnimationFrame(() => confirmCard.classList.add('visible'));
}

// ---- Edit Toggle ----
editToggleBtn.addEventListener('click', () => {
  const isEditing = editForm.style.display !== 'none';
  if (isEditing) {
    // Save edits back to display view
    const currency = document.getElementById('formCurrency').value;
    const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;

    document.getElementById('confirmProvider').textContent = document.getElementById('formProvider').value || 'Unknown';
    document.getElementById('confirmAmount').textContent = `${symbol}${Number(document.getElementById('formAmount').value || 0).toFixed(2)}`;
    document.getElementById('confirmDate').textContent = document.getElementById('formDate').value || '';
    document.getElementById('confirmPickup').textContent = document.getElementById('formPickup').value || '-';
    document.getElementById('confirmDrop').textContent = document.getElementById('formDrop').value || '-';
    document.getElementById('dRideId').textContent = document.getElementById('formRideId').value || '-';
    document.getElementById('dRiderName').textContent = document.getElementById('formRiderName').value || '-';
    document.getElementById('dDriverName').textContent = document.getElementById('formDriverName').value || '-';
    document.getElementById('dVehicle').textContent = document.getElementById('formVehicleNumber').value || '-';
    document.getElementById('dPayment').textContent = document.getElementById('formPaymentMethod').value || '-';
    document.getElementById('dCurrency').textContent = currency;

    editForm.style.display = 'none';
    confirmDetailsView.style.display = 'grid';
    editToggleBtn.textContent = 'Edit details';
  } else {
    editForm.style.display = 'block';
    confirmDetailsView.style.display = 'none';
    editToggleBtn.textContent = 'Done editing';
  }
});

// ---- Cancel (upload different receipt) ----
cancelBtn.addEventListener('click', () => {
  confirmCard.style.display = 'none';
  confirmCard.classList.remove('visible');
  uploadZoneSection.style.display = 'block';
  resetUploadState();
});

// ---- Submit ----
confirmSubmitBtn.addEventListener('click', async () => {
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
  const formPurpose = document.getElementById('confirmPurposeInput').value.trim();

  if (!formAmount) {
    showToast('Please fill in the total amount.', 'error');
    return;
  }

  confirmSubmitBtn.disabled = true;
  submitLoading.style.display = 'flex';

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

    // Build success message
    const symbol = formCurrency === 'INR' ? '₹' : formCurrency === 'USD' ? '$' : formCurrency === 'EUR' ? '€' : formCurrency === 'GBP' ? '£' : formCurrency;
    document.getElementById('successMsg').textContent = `${symbol}${formAmount.toFixed(2)} from ${formProvider} has been submitted.`;

    // Show success state
    confirmCard.style.display = 'none';
    confirmCard.classList.remove('visible');
    successSection.style.display = 'block';

    showToast('Reimbursement submitted successfully!', 'success');
  } catch (err) {
    console.error('Submit error:', err);
    showToast(`Submission failed: ${err.message}`, 'error');
  } finally {
    confirmSubmitBtn.disabled = false;
    submitLoading.style.display = 'none';
  }
}

// ---- Submit Another ----
document.getElementById('submitAnotherBtn').addEventListener('click', () => {
  successSection.style.display = 'none';
  uploadZoneSection.style.display = 'block';
  resetUploadState();
});

// ---- Reset Upload State ----
function resetUploadState() {
  currentFile = null;
  currentBase64 = null;
  fileInput.value = '';
  uploadIdleState.style.display = 'block';
  uploadScanningState.style.display = 'none';
  scanFileName.textContent = '';
}

// ---- Utility ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
