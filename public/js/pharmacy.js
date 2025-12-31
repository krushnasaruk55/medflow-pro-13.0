const API_BASE = ''; // Use relative paths for production/dev consistency
const socket = io();
const hospitalId = sessionStorage.getItem('hospitalId');
const role = sessionStorage.getItem('role') || 'pharmacy';

socket.on('connect', () => {
  socket.emit('join', { role, hospitalId });
});

// DOM Elements
const tableBody = document.getElementById('pharmacy-table-body');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search');

// Stats Elements
const statPending = document.getElementById('stat-pending');
const statPrepared = document.getElementById('stat-prepared');
const statDelivered = document.getElementById('stat-delivered');

let prescriptionsList = [];

// --- Initialization ---
function init() {
  loadPrescriptions();
  setupEventListeners();
}

function setupEventListeners() {
  searchInput.addEventListener('input', () => renderTable());

  // Table Actions (Delegation)
  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'prepare') {
      socket.emit('move-patient', { id, pharmacyState: 'prepared' });
      const idx = prescriptionsList.findIndex(x => x.id === id);
      if (idx >= 0) {
        prescriptionsList[idx].pharmacyState = 'prepared';
        renderTable();
        updateStats();
      }
    } else if (action === 'deliver') {
      socket.emit('move-patient', { id, pharmacyState: 'delivered', status: 'completed' });
      const idx = prescriptionsList.findIndex(x => x.id === id);
      if (idx >= 0) {
        prescriptionsList[idx].pharmacyState = 'delivered';
        prescriptionsList[idx].status = 'completed';
        renderTable();
        updateStats();
      }
    } else if (action === 'show-qr') {
      showQRCode(id);
    } else if (action === 'download-pdf') {
      downloadPDF(id);
    }
  });
}

// --- QR Code Modal ---
async function showQRCode(patientId) {
  let patient = prescriptionsList.find(p => p.id === patientId);
  if (!patient) {
    alert('Patient not found.');
    return;
  }

  // If patient doesn't have a publicToken, we need to generate the PDF first to create it
  if (!patient.publicToken) {
    const confirmed = confirm('QR code needs to be generated first. This will create the prescription token. Continue?');
    if (!confirmed) return;

    try {
      // Trigger PDF generation which will create the token
      await fetch(`${API_BASE}/api/prescription-pdf/${patientId}`, {
        method: 'GET',
        credentials: 'include'
      });

      // Wait a moment for the token to be saved
      await new Promise(resolve => setTimeout(resolve, 500));

      // Fetch updated patient data
      const patientResponse = await fetch(`${API_BASE}/api/patients/${patientId}`, {
        credentials: 'include'
      });

      if (patientResponse.ok) {
        patient = await patientResponse.json();
        // Update local list
        const idx = prescriptionsList.findIndex(p => p.id === patientId);
        if (idx >= 0) {
          prescriptionsList[idx] = patient;
        }
      }
    } catch (error) {
      console.error('Error generating token:', error);
      alert('Failed to generate QR code. Please try again.');
      return;
    }
  }

  if (!patient.publicToken) {
    alert('Unable to generate QR code. Please try downloading the PDF first.');
    return;
  }

  const portalUrl = `${window.location.origin}/api/prescription-pdf/${patientId}?token=${patient.publicToken}`;

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width: 500px; text-align: center;">
      <div class="modal-header">
        <h2 class="modal-title">Patient Prescription QR Code</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div style="padding: 20px;">
        <p style="margin-bottom: 20px; color: var(--text-muted);">
          <strong>${patient.name}</strong> - Token #${patient.token}
        </p>
        <div id="qr-code-container" style="display: flex; justify-content: center; margin: 20px 0;">
          <div style="padding: 20px; background: white; border-radius: 12px; box-shadow: var(--shadow-md);">
            <div id="qr-code"></div>
          </div>
        </div>
        <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 20px;">
          Ask the patient to scan this QR code with their phone camera to download their prescription PDF.
        </p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Generate QR code
  loadQRCodeLibrary().then(() => {
    const container = document.getElementById('qr-code');
    if (container && window.QRCode) {
      // Clear previous if any
      container.innerHTML = '';
      try {
        new QRCode(container, {
          text: portalUrl,
          width: 200,
          height: 200,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.H
        });
      } catch (e) {
        console.error('QR Code generation error:', e);
        container.innerHTML = '<p style="color: red;">Failed to generate QR code</p>';
      }
    }
  });

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function loadQRCodeLibrary() {
  return new Promise((resolve) => {
    if (window.QRCode) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '/js/qrcode.min.js';
    script.onload = resolve;
    script.onerror = () => {
      console.error('Failed to load QR code library');
      resolve(); // Resolve anyway to prevent hanging
    };
    document.head.appendChild(script);
  });
}

// --- PDF Download ---
async function downloadPDF(patientId) {
  try {
    const response = await fetch(`${API_BASE}/api/prescription-pdf/${patientId}`, {
      credentials: 'include'
    });

    if (response.status === 401) {
      alert('Session expired. Please log in again.');
      window.location.href = 'login.html';
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to generate PDF');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prescription_${patientId}_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    // Refresh patient data to get the newly generated token
    setTimeout(() => {
      fetch(`${API_BASE}/api/patients/${patientId}`, { credentials: 'include' })
        .then(r => r.json())
        .then(patient => {
          const idx = prescriptionsList.findIndex(p => p.id === patientId);
          if (idx >= 0) {
            prescriptionsList[idx] = patient;
          }
        });
    }, 500);
  } catch (error) {
    console.error('PDF download error:', error);
    alert('Failed to download PDF. Please try again.');
  }
}

// --- Data Loading ---
function loadPrescriptions() {
  fetch(`${API_BASE}/api/prescriptions`, { credentials: 'include' })
    .then(r => r.json())
    .then(response => {
      // Handle both paginated and non-paginated response
      if (Array.isArray(response)) {
        prescriptionsList = response;
      } else if (response.data) {
        prescriptionsList = response.data;
      } else {
        prescriptionsList = [];
      }
      renderTable();
      updateStats();
    })
    .catch(err => {
      console.error('Error loading prescriptions:', err);
      prescriptionsList = [];
      renderTable();
    });
}

// --- Rendering ---
function renderTable() {
  tableBody.innerHTML = '';

  const term = searchInput.value.toLowerCase();
  const filtered = prescriptionsList.filter(p => p.name.toLowerCase().includes(term));

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'animate-fade-in';

    // Status Logic
    let status = p.pharmacyState || 'pending';
    let badgeClass = 'pending';
    if (status === 'prepared') badgeClass = 'prepared';
    if (status === 'delivered') badgeClass = 'delivered';

    // Actions
    let actionsHtml = '';
    if (status === 'pending' || !status) {
      actionsHtml = `<button class="btn btn-sm btn-primary" data-id="${p.id}" data-action="prepare">Mark Prepared</button>`;
    } else if (status === 'prepared') {
      actionsHtml = `<button class="btn btn-sm btn-accent" data-id="${p.id}" data-action="deliver">Mark Delivered</button>`;
    } else {
      actionsHtml = '<span class="text-muted">Completed</span>';
    }

    tr.innerHTML = `
      <td><strong>#${p.token}</strong></td>
      <td>
        <div style="font-weight:600;">${p.name}</div>
        <div class="text-muted" style="font-size:0.85rem;">${p.age} / ${p.gender}</div>
      </td>
      <td>
        <div style="white-space: pre-wrap; font-size: 0.9rem;">${p.prescription || '-'}</div>
      </td>
      <td><span class="badge ${badgeClass}">${status.toUpperCase()}</span></td>
      <td>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          ${actionsHtml}
          <button class="btn btn-sm btn-secondary" data-id="${p.id}" data-action="download-pdf">📄 PDF</button>
          <button class="btn btn-sm btn-secondary" data-id="${p.id}" data-action="show-qr">📱 QR</button>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function updateStats() {
  statPending.innerText = prescriptionsList.filter(p => !p.pharmacyState || p.pharmacyState === 'pending').length;
  statPrepared.innerText = prescriptionsList.filter(p => p.pharmacyState === 'prepared').length;
  statDelivered.innerText = prescriptionsList.filter(p => p.pharmacyState === 'delivered').length;
}

// --- Socket Events ---
socket.on('queue-updated', ({ patient }) => {
  if (patient) {
    const isRelevant = (patient.prescription && patient.prescription !== '') || patient.status === 'pharmacy' || patient.pharmacyState;

    const idx = prescriptionsList.findIndex(x => x.id === patient.id);
    if (idx >= 0) {
      if (isRelevant) prescriptionsList[idx] = patient;
      else prescriptionsList.splice(idx, 1);
    } else if (isRelevant) {
      prescriptionsList.push(patient);
    }
    renderTable();
    updateStats();
  } else {
    loadPrescriptions();
  }
});

socket.on('prescription-updated', (p) => {
  const idx = prescriptionsList.findIndex(x => x.id === p.id);
  if (idx >= 0) prescriptionsList[idx] = p;
  else prescriptionsList.push(p);
  renderTable();
  updateStats();
});

// --- Inventory Management ---

window.loadInventory = function () {
  fetch(`${API_BASE}/api/pharmacy/inventory`, { credentials: 'include' })
    .then(r => r.json())
    .then(items => {
      const tbody = document.getElementById('inventory-table-body');
      tbody.innerHTML = '';

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">No items in inventory</td></tr>';
        return;
      }

      items.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
                <td>${item.medicationName}</td>
                <td>${item.category || '-'}</td>
                <td>${item.batchNumber}</td>
                <td>${item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : '-'}</td>
                <td style="font-weight: bold; color: ${item.quantity <= (item.minLevel || 10) ? 'var(--danger)' : 'inherit'}">
                    ${item.quantity}
                </td>
                <td>₹${item.unitPrice || 0}</td>
            `;
        tbody.appendChild(tr);
      });
    })
    .catch(console.error);
};

window.loadAlerts = function () {
  fetch(`${API_BASE}/api/pharmacy/alerts`, { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      // Render Low Stock
      const lowStockDiv = document.getElementById('alert-low-stock');
      if (data.lowStock.length === 0) {
        lowStockDiv.innerHTML = '<p style="color: var(--status-completed);">✓ Stock levels are healthy</p>';
      } else {
        lowStockDiv.innerHTML = data.lowStock.map(item => `
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #eee;">
                    <span style="font-weight:500;">${item.medicationName}</span>
                    <span style="color:var(--danger); font-weight:bold;">${item.quantity} left</span>
                </div>
            `).join('');
      }

      // Render Expiry
      const expiryDiv = document.getElementById('alert-expiry');
      const combinedExpiry = [...data.expiring, ...data.expired];
      if (combinedExpiry.length === 0) {
        expiryDiv.innerHTML = '<p style="color: var(--status-completed);">✓ No medicines expiring soon</p>';
      } else {
        expiryDiv.innerHTML = combinedExpiry.map(item => {
          const isExpired = new Date(item.expiryDate) < new Date();
          return `
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #eee;">
                    <span style="font-weight:500;">${item.medicationName}</span>
                    <span style="color:${isExpired ? 'var(--danger)' : 'var(--status-waiting)'}; font-weight:bold;">
                        ${isExpired ? 'EXPIRED' : 'Exp: ' + new Date(item.expiryDate).toLocaleDateString()}
                    </span>
                </div>
            `}).join('');
      }
    })
    .catch(console.error);
};

// Add Inventory Form Handler
const invForm = document.getElementById('inventory-form');
if (invForm) {
  invForm.addEventListener('submit', function (e) {
    e.preventDefault();

    const data = {
      medicationName: document.getElementById('inv-name').value,
      category: document.getElementById('inv-category').value,
      batchNumber: document.getElementById('inv-batch').value,
      quantity: Number(document.getElementById('inv-qty').value),
      minLevel: Number(document.getElementById('inv-min').value),
      expiryDate: document.getElementById('inv-expiry').value,
      unitPrice: Number(document.getElementById('inv-price').value)
    };

    fetch(`${API_BASE}/api/pharmacy/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    })
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          alert('Item added successfully!');
          document.getElementById('inventory-modal').style.display = 'none';
          invForm.reset();
          window.loadInventory();
          window.loadAlerts();
        } else {
          alert('Error: ' + res.error);
        }
      })
      .catch(err => alert('Failed to add item: ' + err.message));
  });
}

// --- Billing System ---

let availableMedicines = [];
let currentBillItems = [];

window.initBilling = function () {
  loadMedicineList();
  loadBillingHistory();
};

function loadMedicineList() {
  fetch(`${API_BASE}/api/pharmacy/inventory`, { credentials: 'include' })
    .then(r => r.json())
    .then(items => {
      availableMedicines = items;
      const dataList = document.getElementById('med-list');
      dataList.innerHTML = '';
      items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.medicationName;
        opt.textContent = `Stock: ${item.quantity} | ₹${item.unitPrice}`;
        dataList.appendChild(opt);
      });
    });
}

const btnAddBillItem = document.getElementById('btn-add-bill-item');
if (btnAddBillItem) {
  btnAddBillItem.addEventListener('click', () => {
    const nameInput = document.getElementById('bill-item-search');
    const qtyInput = document.getElementById('bill-item-qty');

    const name = nameInput.value;
    const qty = parseInt(qtyInput.value);

    if (!name || qty <= 0) return alert('Please check item name and quantity');

    const product = availableMedicines.find(m => m.medicationName === name);
    if (!product) return alert('Medicine not found in inventory');
    if (qty > product.quantity) return alert(`Insufficient stock. Only ${product.quantity} available.`);

    // Add to list
    currentBillItems.push({
      inventoryId: product._id || product.id,
      itemName: product.medicationName,
      batch: product.batchNumber,
      quantity: qty,
      unitPrice: product.unitPrice,
      amount: qty * product.unitPrice
    });

    // Reset Inputs
    nameInput.value = '';
    qtyInput.value = 1;
    nameInput.focus();

    renderBillItems();
  });
}

function renderBillItems() {
  const tbody = document.getElementById('bill-items-body');
  tbody.innerHTML = '';

  let subtotal = 0;

  currentBillItems.forEach((item, index) => {
    subtotal += item.amount;

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #f1f5f9';
    tr.innerHTML = `
            <td style="padding: 8px;">${item.itemName}</td>
            <td style="padding: 8px; color:#64748b; font-size:0.9rem;">${item.batch}</td>
            <td style="padding: 8px;">${item.quantity}</td>
            <td style="padding: 8px;">₹${item.unitPrice}</td>
            <td style="padding: 8px;">₹${item.amount}</td>
            <td style="padding: 8px;">
                <button onclick="removeBillItem(${index})" style="background:none; border:none; color:red; cursor:pointer;">×</button>
            </td>
        `;
    tbody.appendChild(tr);
  });

  // Calculate Totals
  const tax = subtotal * 0.18; // 18% GST assumption
  const total = subtotal + tax;

  document.getElementById('bill-subtotal').innerText = `₹${subtotal.toFixed(2)}`;
  document.getElementById('bill-tax').innerText = `₹${tax.toFixed(2)}`;
  document.getElementById('bill-total').innerText = `₹${total.toFixed(2)}`;
}

window.removeBillItem = function (index) {
  currentBillItems.splice(index, 1);
  renderBillItems();
};

const btnGenerateBill = document.getElementById('btn-generate-bill');
if (btnGenerateBill) {
  btnGenerateBill.addEventListener('click', () => {
    const pName = document.getElementById('bill-p-name').value;
    const pPhone = document.getElementById('bill-p-phone').value;
    const paymentMethod = document.getElementById('payment-method').value;

    if (!pName || currentBillItems.length === 0) {
      return alert('Please enter patient name and add at least one item.');
    }

    // Disable button
    const originalText = btnGenerateBill.innerText;
    btnGenerateBill.innerText = 'Processing...';
    btnGenerateBill.disabled = true;

    fetch(`${API_BASE}/api/pharmacy/billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        patientName: pName,
        phone: pPhone,
        items: currentBillItems,
        paymentMethod
      })
    })
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          alert('Bill Generated Successfully!');
          // Reset Form
          currentBillItems = [];
          renderBillItems();
          document.getElementById('bill-p-name').value = '';
          document.getElementById('bill-p-phone').value = '';

          // Refresh Inventory (stock deducted) and History
          loadMedicineList();
          loadBillingHistory();

          // "Print" Mock (In real app, open PDF url)
          // window.open(`/api/pharmacy/billing/pdf/${res.billId}`, '_blank');
        } else {
          alert('Error: ' + res.error);
        }
      })
      .catch(err => alert('Failed: ' + err.message))
      .finally(() => {
        btnGenerateBill.innerText = originalText;
        btnGenerateBill.disabled = false;
      });
  });
}

function loadBillingHistory() {
  const listDiv = document.getElementById('billing-history-list');
  fetch(`${API_BASE}/api/pharmacy/billing`, { credentials: 'include' })
    .then(r => r.json())
    .then(bills => {
      if (bills.length === 0) {
        listDiv.innerHTML = '<p class="text-muted" style="text-align:center;">No recent bills.</p>';
        return;
      }

      listDiv.innerHTML = bills.map(b => `
                <div style="padding: 12px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: start;">
                    <div>
                        <div style="font-weight: 600;">${b.patientName}</div>
                        <div style="font-size: 0.85rem; color: #64748b;">${new Date(b.billDate).toLocaleString()}</div>
                        <div style="font-size: 0.8rem; color: #94a3b8;">${b.items.length} items • ${b.paymentMethod}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: bold; color: var(--primary);">₹${b.totalAmount.toFixed(2)}</div>
                        <button class="btn btn-sm btn-secondary" style="font-size: 0.75rem; padding: 2px 6px; margin-top: 4px;">Print</button>
                    </div>
                </div>
            `).join('');
    });
}

// Start
init();
window.loadAlerts(); // Load alerts on startup too
