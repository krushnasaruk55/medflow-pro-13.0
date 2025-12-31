const API_BASE = ''; // Relative path for production consistency
const socket = io();
const hospitalId = sessionStorage.getItem('hospitalId');
const role = sessionStorage.getItem('role') || 'doctor';

socket.on('connect', () => {
  socket.emit('join', { role, hospitalId });
});

// DOM Elements
const doctorSelect = document.getElementById('doctorSelect');
const queueList = document.getElementById('queue-list');
const consultationArea = document.getElementById('consultation-area');
const emptyConsultation = document.getElementById('empty-consultation');

// Patient Details Elements
const pName = document.getElementById('p-name');
const pDetails = document.getElementById('p-details');
const pToken = document.getElementById('p-token');
const pReason = document.getElementById('p-reason');
const pReports = document.getElementById('p-reports');
const diagnosisInput = document.getElementById('diagnosis');
const prescriptionInput = document.getElementById('prescription');

let currentDoctorId = localStorage.getItem('doctorId') || '';
let selectedPatient = null;
let allPatients = [];

// --- Initialization ---
function init() {
  loadDoctors();
  loadPatients();
  setupEventListeners();
}

function setupEventListeners() {
  doctorSelect.addEventListener('change', () => {
    currentDoctorId = doctorSelect.value;
    localStorage.setItem('doctorId', currentDoctorId);
    renderQueue();
  });

  // Back Button for Mobile
  const btnBackQueue = document.getElementById('btn-back-queue');
  if (btnBackQueue) {
    btnBackQueue.addEventListener('click', () => {
      document.body.classList.remove('mobile-mode-consultation');
    });
  }

  document.getElementById('btn-download-pdf').addEventListener('click', downloadPrescriptionPDF);
  document.getElementById('btn-save').addEventListener('click', () => updatePatient('save'));
  document.getElementById('btn-pharmacy').addEventListener('click', () => updatePatient('pharmacy'));
  document.getElementById('btn-lab').addEventListener('click', () => sendToLab());
  document.getElementById('btn-complete').addEventListener('click', () => updatePatient('completed'));
  document.getElementById('btn-admit').addEventListener('click', openAdmissionModal);

  // Speech to Text
  const btnMicPrescription = document.getElementById('btn-mic-prescription');
  if (btnMicPrescription) {
    btnMicPrescription.onclick = () => toggleSpeechRecognition('prescription');
  }
  const btnMicDiagnosis = document.getElementById('btn-mic-diagnosis');
  if (btnMicDiagnosis) {
    btnMicDiagnosis.onclick = () => toggleSpeechRecognition('diagnosis');
  }

  // AI Suggestion
  const btnAiSuggest = document.getElementById('btn-ai-suggest');
  if (btnAiSuggest) {
    btnAiSuggest.addEventListener('click', async () => {
      const diagnosis = document.getElementById('diagnosis').value;
      if (!diagnosis) {
        alert('Please enter a diagnosis first to get AI suggestions.');
        return;
      }

      const originalText = btnAiSuggest.innerText;
      btnAiSuggest.innerText = '⏳';

      try {
        const suggestion = await AIService.suggestPrescription(diagnosis);
        const presField = document.getElementById('prescription');

        // Append or Replace? Let's Append if empty, or double newline if exists
        if (presField.value.trim()) {
          presField.value += '\n\n[AI Suggestion]\n' + suggestion;
        } else {
          presField.value = suggestion;
        }
      } catch (e) {
        alert('AI Error: ' + e.message);
      } finally {
        btnAiSuggest.innerText = originalText;
      }
    });
  }
}

async function downloadPrescriptionPDF() {
  if (!selectedPatient) {
    alert('Please select a patient first');
    return;
  }

  try {
    const btn = document.getElementById('btn-download-pdf');
    const originalText = btn.innerText;
    btn.innerText = '⏳ Downloading...';
    btn.disabled = true;

    const response = await fetch(`${API_BASE}/api/prescription-pdf/${selectedPatient.id}`, {
      credentials: 'include' // Important to send session cookies
    });

    if (response.status === 401) {
      alert('Session expired. Please log in again.');
      window.location.href = 'login.html';
      return;
    }

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to generate PDF');
    }

    // Create blob link to download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prescription_${selectedPatient.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

  } catch (error) {
    console.error('Download error:', error);
    alert('Error downloading PDF: ' + error.message);
  } finally {
    const btn = document.getElementById('btn-download-pdf');
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

function sendToLab() {
  if (!selectedPatient) {
    alert('Please select a patient first');
    return;
  }

  // Optional: Prompt for specific test name
  const testName = prompt("Enter test name (e.g. CBC, X-Ray) or leave empty for general request:", "General Lab Request");
  if (testName === null) return; // Cancelled

  socket.emit('create-lab-request', {
    patientId: selectedPatient._id || selectedPatient.id,
    testName: testName || "General Lab Request",
    doctorId: currentDoctorId
  });
}

// --- Data Loading ---
function loadDoctors() {
  fetch(`${API_BASE}/api/doctors`, { credentials: 'include' })
    .then(r => r.json())
    .then(list => {
      doctorSelect.innerHTML = '<option value="">Select Profile...</option>';
      list.forEach(d => {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = `${d.name} (${d.dept})`;
        doctorSelect.appendChild(o);
      });
      if (currentDoctorId) doctorSelect.value = currentDoctorId;
    })
    .catch(err => console.error('Error loading doctors:', err));
}

function loadPatients() {
  fetch(`${API_BASE}/api/patients`, { credentials: 'include' })
    .then(r => r.json())
    .then(response => {
      // Handle both paginated and non-paginated response
      if (Array.isArray(response)) {
        allPatients = response;
      } else if (response.data) {
        allPatients = response.data;
      } else {
        allPatients = [];
      }
      renderQueue();
    })
    .catch(err => {
      console.error('Error loading patients:', err);
      queueList.innerHTML = '<div style="text-align: center; padding: 20px; color: red;">Failed to load patient queue.</div>';
    });
}

// --- Rendering ---
function renderQueue() {
  queueList.innerHTML = '';

  // Filter: Waiting or With Doctor, and assigned to current doctor (or unassigned if general view)
  // For simplicity, showing all assigned to this doctor OR unassigned in their dept
  const filtered = allPatients.filter(p => {
    const isActive = p.status === 'waiting' || p.status === 'with-doctor';
    if (!isActive) return false;
    if (!currentDoctorId) return true; // Show all if no doctor selected
    return p.doctorId == currentDoctorId || !p.doctorId;
  });

  if (filtered.length === 0) {
    queueList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No patients waiting.</div>';
    return;
  }

  filtered.forEach(p => {
    const div = document.createElement('div');
    // Using new 'queue-item' class instead of generic card
    div.className = 'queue-item';
    if (selectedPatient && (selectedPatient.id === p.id || selectedPatient._id === p.id)) {
      div.classList.add('active');
    }

    // Generate Initials
    const initials = p.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    // Mapping Status to UI
    let statusLabel = 'WAITING';
    let statusClass = 'waiting';
    if (p.status === 'with-doctor') {
      statusLabel = 'ACTIVE';
      statusClass = 'with-doctor';
    }

    div.innerHTML = `
      <div class="queue-avatar">${initials}</div>
      <div style="flex: 1;">
        <div style="font-weight: 700; font-size: 1rem; color: var(--secondary);">${p.name}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">
           ${p.age} Yrs • ${p.gender}
        </div>
        <div style="font-size: 0.8rem; color: var(--primary); margin-top: 4px; font-weight:500;">
           ${p.reason || 'General Visit'}
        </div>
      </div>
      <div class="badge ${statusClass}">#${p.token}</div>
    `;

    // Use onclick for direct assignment, ensuring no duplicate listeners
    div.onclick = function () {
      console.log('Patient clicked:', p.name);
      selectPatient(p);
    };
    queueList.appendChild(div);
  });
}

function selectPatient(p) {
  selectedPatient = p;
  renderQueue(); // Re-render to highlight

  consultationArea.style.display = 'flex';
  emptyConsultation.style.display = 'none';

  // Mobile View Switch
  if (window.innerWidth <= 1024) {
    document.body.classList.add('mobile-mode-consultation');
  }

  // Update UI
  pName.innerText = p.name;
  pDetails.innerText = `${p.age} yrs / ${p.gender} / ${p.phone}`;
  pToken.innerText = `Token #${p.token}`;
  pReason.innerText = p.reason || '-';

  diagnosisInput.value = ''; // Reset or load from history if exists
  prescriptionInput.value = p.prescription || '';
  if (document.getElementById('followUpDate')) {
    document.getElementById('followUpDate').value = p.followUpDate || '';
  }

  // Render Reports
  pReports.innerHTML = '';
  let reports = [];
  try {
    reports = JSON.parse(p.reports || '[]');
  } catch (e) {
    console.error('Error parsing reports', e);
  }

  if (reports.length > 0) {
    reports.forEach(filename => {
      const link = document.createElement('a');
      link.href = `${API_BASE}/uploads/${filename}`;
      link.target = '_blank';
      link.className = 'btn btn-sm btn-secondary';
      link.style.textDecoration = 'none';
      link.innerHTML = `📄 ${filename.substring(0, 20)}...`;
      pReports.appendChild(link);
    });
  } else {
    pReports.innerHTML = '<span class="text-muted" style="font-size: 0.9rem;">No reports attached.</span>';
  }

  // If status is waiting, auto-move to with-doctor
  if (p.status === 'waiting' && currentDoctorId) {
    socket.emit('move-patient', { id: p.id, status: 'with-doctor', doctorId: currentDoctorId });
  }
}

function updatePatient(action) {
  if (!selectedPatient) return;

  const prescription = prescriptionInput.value;
  const followUpDate = document.getElementById('followUpDate').value;

  socket.emit('update-prescription', {
    id: selectedPatient._id || selectedPatient.id,
    prescription,
    followUpDate
  });

  if (action === 'pharmacy') {
    socket.emit('move-patient', { id: selectedPatient.id, status: 'pharmacy' });
    resetSelection();
  } else if (action === 'completed') {
    socket.emit('move-patient', { id: selectedPatient.id, status: 'completed' });
    resetSelection();
  } else {
    alert('Notes saved!');
  }
}

function resetSelection() {
  selectedPatient = null;
  consultationArea.style.display = 'none';
  emptyConsultation.style.display = 'flex';
  renderQueue();
}

// --- Socket Events ---
socket.on('patient-registered', (p) => {
  allPatients.unshift(p);
  renderQueue();
});

socket.on('queue-updated', ({ patient }) => {
  if (patient) {
    const idx = allPatients.findIndex(x => x.id === patient.id);
    if (idx >= 0) allPatients[idx] = patient;
    else allPatients.unshift(patient);

    // Update selected if it changed
    if (selectedPatient && selectedPatient.id === patient.id) {
      selectedPatient = patient;
      // Don't re-render full selection to avoid losing unsaved input, just queue list
    }
    renderQueue();
  } else {
    loadPatients();
  }
});

socket.on('prescription-updated', (p) => {
  const idx = allPatients.findIndex(x => x.id === p.id);
  if (idx >= 0) allPatients[idx] = p;
});

socket.on('lab-request-created', (res) => {
  if (res.success) {
    alert('Lab request sent successfully!');
  } else {
    alert('Failed to send lab request: ' + res.message);
  }
});

// --- Supremely Great & Fast Speech to Text ---
let recognition = null;
let isListening = false;
let currentTargetId = null;
let restartTimer = null;

function toggleSpeechRecognition(targetId) {
  const btn = document.getElementById(`btn-mic-${targetId}`);

  if (isListening) {
    const sameTarget = (currentTargetId === targetId);

    // Show stopping state
    if (btn) btn.innerText = '⌛';

    userStopRecognition();

    if (!sameTarget) {
      setTimeout(() => userStartRecognition(targetId), 300);
    } else {
      setTimeout(() => { if (btn) btn.innerText = '🎤'; }, 500);
    }
  } else {
    userStartRecognition(targetId);
  }
}

function userStartRecognition(targetId) {
  startRecognition(targetId);
}

function userStopRecognition() {
  isListening = false;
  if (restartTimer) clearTimeout(restartTimer);
  if (recognition) {
    try {
      recognition.onend = null;
      recognition.onresult = null;
      recognition.stop();
      recognition.abort(); // Instant termination
    } catch (e) { }
  }
  cleanupMicUI();
}

function cleanupMicUI() {
  document.querySelectorAll('.btn-mic-toggle').forEach(b => {
    b.classList.remove('listening');
    b.innerText = '🎤';
  });
  const overlay = document.getElementById('voice-status');
  if (overlay) overlay.classList.remove('active');
  currentTargetId = null;
}

function startRecognition(targetId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return alert("Speech recognition not supported.");

  cleanupMicUI();
  currentTargetId = targetId;

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  const userLang = document.getElementById('languageSelect')?.value || 'en';
  const langMap = { 'en': 'en-US', 'hi': 'hi-IN', 'mr': 'mr-IN' };
  recognition.lang = langMap[userLang] || 'en-US';

  const btn = document.getElementById(`btn-mic-${targetId}`);
  const overlay = document.getElementById('voice-status');
  const interimDisplay = document.getElementById('interim-text');
  const targetElement = document.getElementById(targetId);

  recognition.onstart = () => {
    isListening = true;
    if (btn) {
      btn.classList.add('listening');
      btn.innerText = '🔴';
    }
    overlay?.classList.add('active');
    if (interimDisplay) interimDisplay.innerText = 'Speak now...';
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalSegment = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalSegment += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (interimDisplay && interimTranscript) {
      interimDisplay.innerText = interimTranscript;
    }

    if (finalSegment && targetElement) {
      let processed = finalSegment.trim();

      // Context-Aware Commands
      const commands = {
        'new line': '\n', 'नया लाइन': '\n', 'पुढची ओळ': '\n', 'नया पैराग्राफ': '\n',
        'full stop': '.', 'पॉइंट': '.', 'पूर्णविराम': '.',
        'comma': ',', 'स्वल्पविराम': ',', 'अल्पविराम': ','
      };

      Object.keys(commands).forEach(cmd => {
        const regex = new RegExp(`\\b${cmd}\\b`, 'gi');
        processed = processed.replace(regex, commands[cmd]);
      });

      // Spacing
      if (targetElement.value.length > 0 && !targetElement.value.endsWith(' ') && !targetElement.value.endsWith('\n')) {
        targetElement.value += ' ';
      }

      // Smart Capitalization
      const needsCap = targetElement.value.length === 0 ||
        targetElement.value.trim().endsWith('.') ||
        targetElement.value.endsWith('\n') ||
        targetElement.value.trim().endsWith('?');

      if (needsCap && processed.length > 0) {
        processed = processed.charAt(0).toUpperCase() + processed.slice(1);
      }

      targetElement.value += processed;
      targetElement.scrollTop = targetElement.scrollHeight;

      if (interimDisplay) interimDisplay.innerText = 'Recognized!';
    }
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') return;
    console.error("Mic error:", e.error);
    userStopRecognition();
  };

  recognition.onend = () => {
    if (isListening) {
      // Reconnect pulse
      restartTimer = setTimeout(() => {
        if (currentTargetId === targetId) startRecognition(targetId);
      }, 200);
    } else {
      cleanupMicUI();
    }
  };

  try {
    recognition.start();
  } catch (e) {
    userStopRecognition();
  }
}

// Initial Logic
init();


// --- Admission Logic ---

function openAdmissionModal() {
  if (!selectedPatient) {
    alert('Please select a patient to admit.');
    return;
  }
  document.getElementById('admitModal').style.display = 'flex';
  loadWardsAndBeds();
}

async function loadWardsAndBeds() {
  const wardSelect = document.getElementById('admitWard');
  wardSelect.innerHTML = '<option value="">Loading...</option>';

  try {
    const res = await fetch(`${API_BASE}/api/ipd/beds`); // We'll filter client side for simplicity
    const beds = await res.json();

    // Extract unique Ward Names
    const wards = [...new Set(beds.map(b => b.ward))];

    wardSelect.innerHTML = '<option value="">-- Select Ward --</option>';
    wards.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w;
      opt.innerText = w;
      wardSelect.appendChild(opt);
    });

    // Store beds globally to filter later
    window.allBeds = beds;
  } catch (e) {
    console.error(e);
    wardSelect.innerHTML = '<option value="">Error loading wards</option>';
  }
}

function loadAvailableBeds() {
  const wardName = document.getElementById('admitWard').value;
  const bedSelect = document.getElementById('admitBed');
  bedSelect.innerHTML = '<option value="">-- Select Bed --</option>';

  if (!wardName || !window.allBeds) return;

  const availableBeds = window.allBeds.filter(b => b.ward === wardName && b.status === 'available');

  if (availableBeds.length === 0) {
    bedSelect.innerHTML = '<option value="">No beds available</option>';
    return;
  }

  availableBeds.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.bedNumber;
    opt.innerText = `${b.bedNumber} (${b.type})`;
    bedSelect.appendChild(opt);
  });
}

async function submitAdmission() {
  const ward = document.getElementById('admitWard').value;
  const bedNumber = document.getElementById('admitBed').value;
  const note = document.getElementById('admitNote').value;

  if (!ward || !bedNumber) {
    alert('Please select Ward and Bed.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/ipd/admit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: selectedPatient._id || selectedPatient.id,
        ward,
        bedNumber,
        note
      })
    });

    const data = await res.json();
    if (data.success) {
      alert('Patient admitted successfully!');
      document.getElementById('admitModal').style.display = 'none';
      // Mark as completed from queue or just refresh
      updatePatient('completed');
    } else {
      alert('Admission failed: ' + data.error);
    }
  } catch (e) {
    console.error(e);
    alert('Network error during admission.');
  }
}
// --- Socket Events ---
socket.on('patient-registered', (p) => {
  allPatients.push(p);
  renderQueue();
  showToast(`New Patient: ${p.name}`);
});

socket.on('queue-updated', ({ patient }) => {
  if (patient) {
    const idx = allPatients.findIndex(x => x.id === patient.id || x._id === patient._id);
    if (idx >= 0) {
      allPatients[idx] = patient;
    } else {
      allPatients.push(patient);
    }
    renderQueue();
  } else {
    loadPatients(); // Fallback reload
  }
});

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'card'; // Reuse card style
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.padding = '12px 20px';
  toast.style.backgroundColor = 'var(--text-main)';
  toast.style.color = 'white';
  toast.style.zIndex = 9999;
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
