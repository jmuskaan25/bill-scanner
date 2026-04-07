// ============================================
// Bill Scanner - Main Application Logic
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, getDocs, orderBy, limit, query, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

// ---- Firebase Init ----
let db = null;
let storage = null;
let functions = null;

try {
  const app = initializeApp(CONFIG.FIREBASE);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app);
} catch (e) {
  console.warn('Firebase not configured yet. Submissions will not be saved.', e);
}

// ---- State ----
let currentFile = null;
let currentBase64 = null;
let extractedData = null;

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
const extractedCard = document.getElementById('extractedCard');
const submitBtn = document.getElementById('submitBtn');
const submitBtnText = document.getElementById('submitBtnText');
const submitLoading = document.getElementById('submitLoading');
const reimbursementForm = document.getElementById('reimbursementForm');
const toastContainer = document.getElementById('toastContainer');
const submissionsBody = document.getElementById('submissionsBody');

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
  extractedData = null;
  extractedCard.classList.remove('visible');

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
    extractedData = result.data;
    displayExtractedData(extractedData);
    populateForm(extractedData);
    showToast('Bill scanned successfully!', 'success');
  } catch (err) {
    console.error('Scan error:', err);
    showToast(`Scan failed: ${err.message}`, 'error');
  } finally {
    scanBtn.disabled = false;
    scanBtnText.innerHTML = '🔍 Scan Bill';
    scanLoading.classList.remove('visible');
  }
}


function displayExtractedData(data) {
  document.getElementById('extractedCompany').textContent = data.companyName || '--';
  document.getElementById('extractedDate').textContent = data.date || '--';
  document.getElementById('extractedAmount').textContent =
    data.totalAmount != null ? `${data.currency || ''} ${Number(data.totalAmount).toFixed(2)}` : '--';
  document.getElementById('extractedTax').textContent =
    data.taxAmount != null ? `${data.currency || ''} ${Number(data.taxAmount).toFixed(2)}` : 'N/A';
  document.getElementById('extractedCurrency').textContent = data.currency || '--';
  document.getElementById('extractedCategory').textContent = data.category
    ? data.category.charAt(0).toUpperCase() + data.category.slice(1)
    : '--';

  // Line items
  const lineItemsSection = document.getElementById('lineItemsSection');
  const lineItemsBody = document.getElementById('lineItemsBody');
  lineItemsBody.innerHTML = '';

  if (data.lineItems && data.lineItems.length > 0) {
    lineItemsSection.style.display = 'block';
    data.lineItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.description || '')}</td>
        <td style="text-align:right;">${item.amount != null ? Number(item.amount).toFixed(2) : '--'}</td>
      `;
      lineItemsBody.appendChild(tr);
    });
  } else {
    lineItemsSection.style.display = 'none';
  }

  extractedCard.classList.add('visible');
}

function populateForm(data) {
  if (data.companyName) document.getElementById('formCompany').value = data.companyName;
  if (data.date) document.getElementById('formDate').value = data.date;
  if (data.totalAmount != null) document.getElementById('formAmount').value = data.totalAmount;
  if (data.taxAmount != null) document.getElementById('formTax').value = data.taxAmount;

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

  // Set category
  if (data.category) {
    const catSelect = document.getElementById('formCategory');
    const option = Array.from(catSelect.options).find(
      o => o.value.toLowerCase() === data.category.toLowerCase()
    );
    if (option) catSelect.value = option.value;
  }

  submitBtn.disabled = false;
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

  if (!currentFile) {
    showToast('Please upload a bill first.', 'error');
    return;
  }

  const name = document.getElementById('submitterName').value.trim();
  const email = document.getElementById('submitterEmail').value.trim();
  const purpose = document.getElementById('formPurpose').value.trim();
  const companyName = document.getElementById('formCompany').value.trim();
  const billDate = document.getElementById('formDate').value;
  const totalAmount = parseFloat(document.getElementById('formAmount').value);
  const currency = document.getElementById('formCurrency').value;
  const taxAmount = parseFloat(document.getElementById('formTax').value) || null;
  const category = document.getElementById('formCategory').value;

  if (!name || !email || !purpose || !totalAmount || !category) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtnText.innerHTML = '<span class="spinner"></span> Submitting...';
  submitLoading.classList.add('visible');

  try {
    // Upload image to Firebase Storage
    const timestamp = Date.now();
    const ext = currentFile.name.split('.').pop();
    const storageRef = ref(storage, `bills/${timestamp}_${currentFile.name}`);
    await uploadBytes(storageRef, currentFile);
    const imageUrl = await getDownloadURL(storageRef);

    // Save to Firestore
    const docData = {
      submittedBy: name,
      email: email,
      purpose: purpose,
      companyName: companyName,
      date: billDate,
      totalAmount: totalAmount,
      currency: currency,
      taxAmount: taxAmount,
      lineItems: extractedData?.lineItems || [],
      category: category,
      imageUrl: imageUrl,
      submittedAt: serverTimestamp(),
      status: 'pending'
    };

    await addDoc(collection(db, 'reimbursements'), docData);

    showToast('Reimbursement submitted successfully!', 'success');

    // Reset form
    resetForm();

    // Refresh table
    await loadRecentSubmissions();

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
  extractedData = null;
  previewContainer.classList.remove('visible');
  extractedCard.classList.remove('visible');
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
        <tr><td colspan="6">
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <p>No submissions yet. Upload a bill to get started!</p>
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

      const categoryLabels = {
        food: 'Food & Dining',
        travel: 'Travel',
        accommodation: 'Accommodation',
        office: 'Office Supplies',
        other: 'Other'
      };

      tr.innerHTML = `
        <td>${escapeHtml(submittedAt)}</td>
        <td>${escapeHtml(d.submittedBy || '--')}</td>
        <td>${escapeHtml(d.companyName || '--')}</td>
        <td><strong>${escapeHtml(d.currency || '')} ${d.totalAmount != null ? Number(d.totalAmount).toFixed(2) : '--'}</strong></td>
        <td>${escapeHtml(categoryLabels[d.category] || d.category || '--')}</td>
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
// Enable submit button when form has a scanned bill or user manually fills fields
document.getElementById('formAmount').addEventListener('input', () => {
  if (document.getElementById('formAmount').value) {
    submitBtn.disabled = false;
  }
});

// Load submissions on page load
loadRecentSubmissions();
