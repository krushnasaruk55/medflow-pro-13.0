const API_BASE = ''; // Relative path for production consistency
const socket = io();
const hospitalId = sessionStorage.getItem('hospitalId');
const role = sessionStorage.getItem('role') || 'reception';

socket.on('connect', () => {
  console.log('Connected to socket, joining room...');
  socket.emit('join', { role, hospitalId });
});

// DOM Elements
const form = document.getElementById('regForm');
const tableBody = document.getElementById('patients-table-body');
const emptyState = document.getElementById('empty-state');
const statusDiv = document.getElementById('status');
const deptSelect = document.getElementById('department');
const doctorSelect = document.getElementById('doctor');
const phoneInput = document.getElementById('phone');
const searchInput = document.getElementById('universalSearch'); // New
const fileInput = document.getElementById('reports');
const fileLabelText = document.getElementById('fileLabelText');

// Stats Elements
const statTotal = document.getElementById('stat-total');
const statWaiting = document.getElementById('stat-waiting');
const statDoctor = document.getElementById('stat-doctor');
const statCompleted = document.getElementById('stat-completed');

let allDoctors = [];
let patientsList = [];

// Pagination State
let currentPage = 1;
let totalPages = 1;
const LIMIT = 50;

// --- Initialization ---
function init() {
  loadDepartments();
  loadPatients(currentPage);
  setupEventListeners();

  // Search Debounce
  let debounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const val = e.target.value.trim();
        loadPatients(1, val);
      }, 300);
    });
  }
  // Search Debounce defined above
}

function setupEventListeners() {
  // File Input Change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      fileLabelText.innerText = `${fileInput.files.length} file(s) selected`;
      fileLabelText.style.color = 'var(--primary)';
    } else {
      fileLabelText.innerText = 'Click to upload files (Images/PDF)';
      fileLabelText.style.color = 'var(--text-muted)';
    }
  });

  // Form Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const patientData = {
      hospitalId: sessionStorage.getItem('hospitalId'), // Get from session
      name: document.getElementById('name').value,
      age: document.getElementById('age').value,
      gender: document.getElementById('gender').value,
      phone: document.getElementById('phone').value,
      address: document.getElementById('address').value,
      patientType: document.getElementById('patientType').value,
      opdIpd: document.getElementById('opdipd').value,
      department: deptSelect.value,
      doctorId: doctorSelect.value || null,
      reason: document.getElementById('reason').value,
      cost: parseFloat(document.getElementById('cost').value) || 0
    };

    statusDiv.innerText = 'Registering...';
    statusDiv.style.color = 'var(--status-waiting)';

    // Register via socket
    socket.emit('register-patient', patientData);

    // Clear form
    form.reset();
    fileLabelText.innerText = 'Click to upload files (Images/PDF)';
    fileLabelText.style.color = 'var(--text-muted)';
  });

  // Auto-fetch patient
  phoneInput.addEventListener('blur', () => {
    const val = phoneInput.value.trim();
    if (!val) return;
    fetch(`${API_BASE}/api/patients?phone=` + encodeURIComponent(val), { credentials: 'include' })
      .then(r => r.json())
      .then(response => {
        // Handle both paginated and non-paginated response for backward compatibility or search
        const list = response.data || response;
        if (list && list.length) {
          const p = list[0];
          document.getElementById('name').value = p.name || '';
          document.getElementById('age').value = p.age || '';
          document.getElementById('gender').value = p.gender || '';
          document.getElementById('address').value = p.address || '';
          document.getElementById('patientType').value = 'Follow-up';
        }
      })
      .catch(err => console.error('Error fetching patient details:', err));
  });

  // Dept change
  deptSelect.addEventListener('change', () => loadDoctors(deptSelect.value));

  // Export Buttons
  document.getElementById('exportMonth')?.addEventListener('click', () => {
    window.location.href = `${API_BASE}/api/export?type=month`;
  });
  document.getElementById('exportYear')?.addEventListener('click', () => {
    window.location.href = `${API_BASE}/api/export?type=year`;
  });

  // Pagination Controls
  document.getElementById('prevPage').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadPatients(currentPage);
    }
  });

  document.getElementById('nextPage').addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadPatients(currentPage);
    }
  });

  // Table Actions (Delegation)
  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'assign') {
      // Find selected doctor in the row
      const row = btn.closest('tr');
      const select = row.querySelector('.row-doctor-select');
      const doctorId = select ? select.value : null;

      if (!doctorId) return alert('Please select a doctor');

      socket.emit('move-patient', { id, status: 'with-doctor', doctorId });
      // Update local state immediately for better UX
      const idx = patientsList.findIndex(x => x.id === id);
      if (idx >= 0) {
        patientsList[idx].status = 'with-doctor';
        patientsList[idx].doctorId = doctorId;
        renderTable();
        updateStats();
      }
    } else if (action === 'pharmacy') {
      socket.emit('move-patient', { id, status: 'pharmacy' });
      // Update local state immediately for better UX
      const idx = patientsList.findIndex(x => x.id === id);
      if (idx >= 0) {
        patientsList[idx].status = 'pharmacy';
        renderTable();
        updateStats();
      }
    } else if (action === 'cancel') {
      if (confirm('Cancel this token?')) {
        // Implement cancel logic if needed, or just mark completed/cancelled
        socket.emit('move-patient', { id, status: 'cancelled' });
        // Update local state immediately for better UX
        const idx = patientsList.findIndex(x => x.id === id);
        if (idx >= 0) {
          patientsList[idx].status = 'cancelled';
          renderTable();
          updateStats();
        }
      }
    }
  });
}

// --- Data Loading ---
function loadDepartments() {
  fetch(`${API_BASE}/api/departments`, { credentials: 'include' })
    .then(r => r.json())
    .then(list => {
      deptSelect.innerHTML = '';
      list.forEach(d => {
        const o = document.createElement('option'); o.value = d; o.textContent = d; deptSelect.appendChild(o);
      });
      loadDoctors(list[0]); // Load doctors for first dept
    })
    .catch(err => console.error('Error loading departments:', err));
}

function loadDoctors(dept) {
  let url = `${API_BASE}/api/doctors`;
  if (dept) url += '?dept=' + encodeURIComponent(dept);
  fetch(url, { credentials: 'include' })
    .then(r => r.json())
    .then(list => {
      allDoctors = list;
      doctorSelect.innerHTML = '<option value="">(Auto Assign)</option>';
      list.forEach(d => {
        const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; doctorSelect.appendChild(o);
      });
    })
    .catch(err => console.error('Error loading doctors:', err));
}

function loadPatients(page = 1, searchQuery = '') {
  // Use showLoading() if it takes time, but maybe generic spinner is enough
  // showLoading('Fetching patients...'); 

  let url = `${API_BASE}/api/patients?page=${page}&limit=${LIMIT}`;
  if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

  fetch(url, { credentials: 'include' })
    .then(r => r.json())
    // ... rest is same
    .then(response => {
      // hideLoading();
      // Support both formats (array or object with data)
      if (Array.isArray(response)) {
        patientsList = response;
        totalPages = 1;
      } else {
        patientsList = response.data;
        totalPages = response.pagination.totalPages;
        currentPage = response.pagination.page;
      }

      updatePaginationControls();
      renderTable();
      updateStats();
    })
    .catch(err => {
      // hideLoading();
      console.error('Error loading patients:', err);
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Failed to load patients.</td></tr>';
    });
}

// Backup Function
window.downloadBackup = function () {
  window.location.href = '/api/backup';
};

function updatePaginationControls() {
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const indicator = document.getElementById('pageIndicator');

  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  if (indicator) indicator.innerText = `Page ${currentPage} of ${totalPages || 1}`;
}

// --- Rendering ---
function renderTable() {
  tableBody.innerHTML = '';

  // Filter for "Today" (optional, for now show all recent)
  // In a real app, you'd filter by date here or in API
  const displayList = patientsList; // Already paginated from server

  if (displayList.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  displayList.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'animate-fade-in';

    // Status Badge
    let badgeClass = 'waiting';
    if (p.status === 'with-doctor') badgeClass = 'with-doctor';
    if (p.status === 'pharmacy') badgeClass = 'pharmacy';
    if (p.status === 'completed') badgeClass = 'completed';

    // Doctor Cell
    let doctorHtml = '-';
    if (p.doctorId) {
      const d = allDoctors.find(doc => doc.id == p.doctorId); // Might need to fetch all doctors globally or store map
      doctorHtml = d ? d.name : `Dr. ID ${p.doctorId}`;
    } else {
      // Dropdown to assign
      doctorHtml = `
        <div class="flex gap-2">
          <select class="row-doctor-select" style="padding: 4px; font-size: 0.85rem; width: 120px;">
            <option value="">Select...</option>
            ${allDoctors.map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-primary" data-id="${p.id}" data-action="assign">Assign</button>
        </div>
      `;
    }

    // Actions
    let actionsHtml = '';
    if (p.status === 'with-doctor' || p.status === 'waiting') {
      actionsHtml += `<button class="btn btn-sm btn-accent" data-id="${p.id}" data-action="pharmacy">Pharmacy</button>`;
    }

    tr.innerHTML = `
      <td><strong>#${p.token}</strong></td>
      <td>
        <div style="font-weight:600;">${p.name}</div>
        <div class="text-muted" style="font-size:0.85rem;">${p.phone}</div>
      </td>
      <td>${p.age} / ${p.gender}</td>
      <td>${p.department}</td>
      <td>${doctorHtml}</td>
      <td><span class="badge ${badgeClass}">${p.status}</span></td>
      <td>${actionsHtml}</td>
    `;
    tableBody.appendChild(tr);
  });
}

function updateStats() {
  // Simple stats based on loaded list (ideally should come from API)
  const today = new Date().toISOString().split('T')[0];
  const todayPatients = patientsList.filter(p => p.registeredAt && p.registeredAt.startsWith(today));

  statTotal.innerText = todayPatients.length;
  statWaiting.innerText = todayPatients.filter(p => p.status === 'waiting').length;
  statDoctor.innerText = todayPatients.filter(p => p.status === 'with-doctor').length;
  statCompleted.innerText = todayPatients.filter(p => p.status === 'completed' || p.status === 'pharmacy').length;
}

// --- Socket Events ---
socket.on('patient-registered', (p) => {
  statusDiv.innerText = `✓ Registered ${p.name} (Token ${p.token})`;
  statusDiv.style.color = 'var(--status-completed)';
  setTimeout(() => statusDiv.innerText = '', 3000);

  // If on page 1, prepend new patient
  if (currentPage === 1) {
    patientsList.unshift(p);
    if (patientsList.length > LIMIT) patientsList.pop(); // Keep list size consistent
    renderTable();
    updateStats();
  } else {
    // Optionally show notification that new patient arrived
    loadPatients(currentPage);
  }
});

socket.on('new-appointment', (ppt) => {
  // Show Toast Notification
  const toast = document.createElement('div');
  toast.className = 'card';
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.padding = '16px';
  toast.style.background = '#fff';
  toast.style.borderLeft = '5px solid var(--primary)';
  toast.style.zIndex = '1000';
  toast.style.animation = 'slideIn 0.3s ease-out';
  toast.innerHTML = `
    <strong>New Appointment</strong><br>
    ${ppt.patientName} for ${ppt.appointmentDate} at ${ppt.appointmentTime}
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);

  // Refresh appointments list if present
  loadAppointments();
});

// --- Scheduled Appointments Logic ---
function loadAppointments() {
  const today = new Date().toISOString().split('T')[0];

  // Create or get container
  let container = document.getElementById('appointments-section');
  if (!container) {
    // Inject sections
    const queueCard = document.querySelector('.card:last-child'); // Assuming last card in right column is queue
    // Or find where to insert. The queue card seems to be the last one in `reception.html`.
    // Let's look for "Patient Queue" title to be safe, but last child is safer for now.
    // Actually, let's inject a new section ABOVE the queue for visibility.
    // Or insert into a new tab? Let's just append it for now.

    container = document.createElement('div');
    container.id = 'appointments-section';
    container.className = 'card mt-4';
    container.style.marginTop = '20px';
    container.style.marginBottom = '20px';
    container.innerHTML = `
            <h3>📅 Scheduled Appointments (Today)</h3>
            <div id="appointments-list" style="margin-top:16px;">Loading...</div>
        `;
    // Insert before the queue card might be better?
    // Let's insert it at the top of the right column (which is the parent of the stats grid).
    // The right column is the second child of .dashboard-grid.
    // But finding it via text is hard. Let's append to the right column container.
    const rightCol = document.querySelector('.dashboard-grid > div:last-child');
    rightCol.insertBefore(container, rightCol.querySelector('.card')); // Insert before queue
  }

  fetch(`${API_BASE}/api/hospital/appointments?date=${today}`, { credentials: 'include' })
    .then(r => r.json())
    .then(list => {
      const listDiv = document.getElementById('appointments-list');
      if (list.length === 0) {
        listDiv.innerHTML = '<div class="text-muted">No appointments scheduled for today.</div>';
        return;
      }

      listDiv.innerHTML = list.map(ppt => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;">
                    <div>
                        <strong>${ppt.appointmentTime} - ${ppt.patientName}</strong> <br>
                        <span class="text-muted" style="font-size:0.85rem;">${ppt.phone} • ${ppt.notes || 'No notes'}</span>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-primary" onclick="checkInPatient('${ppt.patientId}', '${ppt.patientName}', '${ppt.phone}', '${ppt.doctorId}', '${ppt.notes || ''}')">Check In</button>
                    </div>
                </div>
            `).join('');
    })
    .catch(err => console.error(err));
}

// Global function for onclick
window.checkInPatient = (id, name, phone, doctorId, reason) => {
  // Fill the registration form
  document.getElementById('name').value = name;
  document.getElementById('phone').value = phone;
  document.getElementById('patientType').value = 'Follow-up';

  if (doctorId && doctorId !== 'undefined' && doctorId !== 'null') {
    const docSelect = document.getElementById('doctor');
    if (docSelect) docSelect.value = doctorId;
  }

  if (reason && reason !== 'undefined') {
    document.getElementById('reason').value = reason;
  }

  // Trigger phone search logic to fetch full details (age, gender, address)
  const phoneEvent = new Event('blur');
  document.getElementById('phone').dispatchEvent(phoneEvent);

  // Scroll to form
  document.getElementById('regForm').scrollIntoView({ behavior: 'smooth' });

  // Highlight
  document.getElementById('regForm').style.boxShadow = '0 0 0 4px rgba(14, 165, 233, 0.3)';
  setTimeout(() => document.getElementById('regForm').style.boxShadow = 'none', 1000);
};

// Start
init();
loadAppointments(); // Initial load
