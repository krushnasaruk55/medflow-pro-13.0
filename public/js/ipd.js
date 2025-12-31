
let currentBeds = [];
let selectedBed = null;

// Initial Setup Helper
async function initializeBeds() {
    if (!confirm('This will reset all beds to default configuration. Are you sure?')) return;

    // Default Ward Configuration
    const wards = [
        { name: 'General Ward Male', prefix: 'GM', count: 10, type: 'General' },
        { name: 'General Ward Female', prefix: 'GF', count: 10, type: 'General' },
        { name: 'Private Ward', prefix: 'PVT', count: 5, type: 'Private' },
        { name: 'ICU', prefix: 'ICU', count: 4, type: 'ICU' }
    ];

    try {
        const res = await fetch('/api/ipd/beds/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wards })
        });
        const data = await res.json();
        if (data.success) {
            alert('Beds initialized!');
            loadBeds();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Failed to init beds');
    }
}

async function loadBeds() {
    const container = document.getElementById('wards-container');
    // container.innerHTML = '<div style="text-align: center; padding: 20px;">Loading...</div>';

    try {
        const res = await fetch('/api/ipd/beds');
        const beds = await res.json();
        currentBeds = beds;
        renderBeds(beds);
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="color: red; text-align: center;">Failed to load beds.</div>';
    }
}


function renderBeds(beds) {
    const container = document.getElementById('wards-container');
    container.innerHTML = '';

    if (!beds || beds.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <h3 style="color: var(--text-secondary); margin-bottom: 20px;">No beds configured.</h3>
                <p style="color: #64748b; margin-bottom: 30px;">Initialize the bed map to get started.</p>
                <button class="btn btn-primary" onclick="initializeBeds()" style="max-width: 200px;">Initialize Defaults</button>
            </div>
        `;
        return;
    }

    // Group by Ward
    const wards = {};
    beds.forEach(bed => {
        if (!wards[bed.ward]) wards[bed.ward] = [];
        wards[bed.ward].push(bed);
    });

    for (const [wardName, bedList] of Object.entries(wards)) {
        const wardSection = document.createElement('div');
        wardSection.className = 'ward-section';

        const title = document.createElement('div');
        title.className = 'ward-header';
        title.innerHTML = `<span>🏥</span> ${wardName} <span class="ward-capacity">${bedList.length} Beds</span>`;
        wardSection.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'bed-grid';

        bedList.forEach(bed => {
            const card = document.createElement('div');
            card.className = `bed-card ${bed.status}`;
            card.onclick = () => selectBed(bed);

            let icon = '🛏️';
            if (bed.status === 'occupied') icon = '🛌';
            if (bed.status === 'cleaning') icon = '🧹';

            let content = `
                <span class="bed-icon">${icon}</span>
                <div class="bed-number">${bed.bedNumber}</div>
            `;

            grid.appendChild(card);
            card.innerHTML = content;
        });

        wardSection.appendChild(grid);
        container.appendChild(wardSection);
    }
}


async function selectBed(bed) {
    selectedBed = bed;
    const panel = document.getElementById('side-panel');

    panel.innerHTML = `
        <div class="patient-details">
            <h2 style="color: var(--primary); margin-bottom: 4px;">Bed ${bed.bedNumber}</h2>
            <div style="color: var(--text-secondary); margin-bottom: 20px; font-size: 0.9rem;">${bed.ward} - ${bed.type}</div>
            
            <div style="padding: 10px; background: ${getStatusColor(bed.status)}20; border-radius: 8px; color: ${getStatusColor(bed.status)}; font-weight: 600; text-transform: uppercase; font-size: 0.8rem; text-align: center; margin-bottom: 20px;">
                ${bed.status}
            </div>
            
            <div id="bed-actions"></div>
        </div>
    `;

    const actionContainer = document.getElementById('bed-actions');

    if (bed.status === 'occupied' && bed.patientId) {
        // Fetch Patient Details
        actionContainer.innerHTML = 'Loading patient details...';
        try {
            const pRes = await fetch(`/api/patients/${bed.patientId}`);
            const patient = await pRes.json();

            const nRes = await fetch(`/api/ipd/rounds/${bed.patientId}`);
            const notes = await nRes.json();

            let notesHtml = notes.map(n => `
                <div class="note-item">
                    <div style="font-weight: 600; font-size: 0.75rem; color: #666; margin-bottom: 2px;">
                        ${new Date(n.createdAt).toLocaleString()} - ${n.doctorName || 'Doctor'}
                    </div>
                    <div>${n.note}</div>
                </div>
            `).join('');


            // Fetch Charges
            const cRes = await fetch(`/api/ipd/charges/${bed.patientId}`);
            const charges = await cRes.json();
            const totalBill = charges.reduce((acc, c) => acc + (c.amount || 0), 0);

            actionContainer.innerHTML = `
                <div class="detail-row"><span class="detail-label">Patient:</span> ${patient.name}</div>
                <div class="detail-row"><span class="detail-label">Age/Sex:</span> ${patient.age} / ${patient.gender}</div>
                <div class="detail-row"><span class="detail-label">Admitted:</span> ${new Date(patient.admissionDate).toLocaleDateString()}</div>
                <div class="detail-row"><span class="detail-label">Diagnosis:</span> ${patient.diagnosis || '-'}</div>

                <!-- Transfer Bed Button -->
                <button class="btn-action" style="background: #e0f2fe; color: #0284c7; margin-top: 10px;" onclick="openTransferModal('${patient._id}', '${patient.ward}', '${patient.bedNumber}')">🔁 Transfer Bed</button>

                <!-- Medication Chart Section -->
                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed #ccc;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h3 style="font-size: 1rem; margin: 0;">Medication Chart</h3>
                        <button class="btn-action" style="width: auto; padding: 4px 10px; font-size: 0.8rem; background: var(--primary); color: white;" onclick="openMedicationModal('${patient._id}')">+ Add Drug</button>
                    </div>
                    <div id="med-list-${patient._id}" style="font-size: 0.9rem;">Loading meds...</div>
                </div>

                <!-- Vitals Chart Section -->
                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed #ccc;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h3 style="font-size: 1rem; margin: 0;">Vitals History</h3>
                        <button class="btn-action" style="width: auto; padding: 4px 10px; font-size: 0.8rem; background: var(--secondary); color: white;" onclick="openVitalModal('${patient._id}')">+ Record</button>
                    </div>
                    <div id="vital-list-${patient._id}" style="font-size: 0.85rem; max-height: 150px; overflow-y: auto;">Loading vitals...</div>
                </div>

                <!-- Lab Reports Section -->
                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed #ccc;">
                        <h3 style="font-size: 1rem; margin: 0;">Lab Reports</h3>
                        <button class="btn-action" style="width: auto; padding: 4px 10px; font-size: 0.8rem; background: var(--secondary); color: white;" onclick="openLabRequestModal('${patient._id}')">+ Order Test</button>
                    </div>
                    <div id="lab-list-${patient._id}" style="font-size: 0.85rem; max-height: 150px; overflow-y: auto;">Loading labs...</div>
                </div>

                <!-- Billing Section -->
                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed #ccc;">
                    <h3 style="font-size: 1rem; margin: 0 0 10px 0;">Current Bill</h3>
                    <div style="font-size: 0.9rem; margin-bottom: 4px;">Pharmacy: ₹${charges.filter(c => c.type === 'pharmacy').reduce((a, b) => a + b.amount, 0)}</div>
                    <div style="font-size: 0.9rem; margin-bottom: 4px;">Lab: ₹${charges.filter(c => c.type === 'lab').reduce((a, b) => a + b.amount, 0)}</div>
                    <div style="font-size: 0.9rem; margin-bottom: 4px;">Room/Other: ₹${charges.filter(c => c.type !== 'pharmacy' && c.type !== 'lab').reduce((a, b) => a + b.amount, 0)}</div>
                    <div style="font-weight: 700; font-size: 1.1rem; margin-top: 8px; color: var(--primary);">Total: ₹${totalBill}</div>
                </div>

                <div style="margin-top: 24px; display: flex; justify-content: space-between; align-items: center;">
                     <h3 style="margin: 0; font-size: 1rem;">Round Notes</h3>
                     <button class="btn-action btn-add-note" style="width: auto; padding: 4px 10px; font-size: 0.8rem;" onclick="openNoteModal('${patient._id}')">+ Add</button>
                </div>
                
                <div class="notes-list">${notesHtml || '<div style="color: #999; text-align: center; padding: 20px;">No notes yet.</div>'}</div>

                <div style="margin-top: 24px;">
                    <button class="btn-action btn-discharge" onclick="openDischargeModal('${patient._id}')">Discharge Patient</button>
                </div>
            `;
            // Fetch and Render Medications
            loadMedications(patient._id);
            // Fetch Vitals
            loadVitals(patient._id);
            // Fetch Labs
            loadLabs(patient._id);
        } catch (e) {
            console.error(e);
            actionContainer.innerHTML = 'Error loading patient details.';
        }
    } else if (bed.status === 'cleaning') {
        actionContainer.innerHTML = `
            <p style="color: #666; font-size: 0.9rem; margin-bottom: 16px;">Housekeeping in progress.</p>
            <button class="btn-action btn-clean" onclick="markAvailable('${bed._id}')">Mark as Clean & Available</button>
        `;
    } else {
        actionContainer.innerHTML = `
            <p style="color: #666; font-size: 0.9rem;">Bed is ready for admission.</p>
            <div style="font-size: 0.8rem; color: #999; margin-top: 10px;">To admit a patient, go to the Doctor Dashboard.</div>
        `;
    }
}

function getStatusColor(status) {
    if (status === 'available') return '#22c55e';
    if (status === 'occupied') return '#ef4444';
    return '#eab308';
}

let activePatientId = null;

function openNoteModal(patientId) {
    activePatientId = patientId;
    document.getElementById('noteModal').style.display = 'flex';
    document.getElementById('noteText').value = '';
    document.getElementById('noteText').focus();
}

function closeModal() {
    document.getElementById('noteModal').style.display = 'none';
    activePatientId = null;
}

async function saveNote() {
    const note = document.getElementById('noteText').value;
    if (!note) return;

    try {
        const res = await fetch('/api/ipd/rounds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId: activePatientId, note })
        });
        const data = await res.json();
        if (data.success) {
            closeModal();
            selectBed(selectedBed); // Reload sidebar
        } else {
            alert('Error adding note');
        }
    } catch (e) {
        console.error(e);
    }
}

// --- Discharge Logic ---
let dischargePatientId = null;

function openDischargeModal(patientId) {
    dischargePatientId = patientId;
    let modal = document.getElementById('dischargeModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dischargeModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Discharge Patient</h2>
                <div class="form-group">
                    <label>Clinical Summary / Treatment Given</label>
                    <textarea id="disSummary" rows="4" placeholder="Brief summary of extraction/treatment..."></textarea>
                </div>
                <div class="form-group">
                    <label>Discharge Advice / Medication</label>
                    <textarea id="disAdvice" rows="3" placeholder="Rest for 2 days..."></textarea>
                </div>
                <div class="form-group">
                    <label>Follow Up Date</label>
                    <input type="date" id="disDate">
                </div>
                <div class="modal-actions">
                    <button class="btn-action" style="background: #f1f5f9; color: #64748b;" onclick="document.getElementById('dischargeModal').style.display='none'">Cancel</button>
                    <button class="btn-action" style="background: var(--danger); color: white;" onclick="submitDischarge()">Discharge & Generate PDF</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById('disSummary').value = '';
    document.getElementById('disAdvice').value = '';
    document.getElementById('disDate').value = '';
    modal.style.display = 'flex';
}

async function submitDischarge() {
    if (!confirm('Confirm discharge? This will release the bed.')) return;

    const dischargeNote = document.getElementById('disSummary').value;
    const dischargeAdvice = document.getElementById('disAdvice').value;
    const followUpDate = document.getElementById('disDate').value;

    try {
        const res = await fetch('/api/ipd/discharge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId: dischargePatientId, dischargeNote, dischargeAdvice, followUpDate })
        });
        const data = await res.json();

        if (data.success) {
            document.getElementById('dischargeModal').style.display = 'none';
            alert('Patient discharged successfully. Downloading summary...');

            // Trigger PDF Download
            window.location.href = `/api/ipd/discharge-summary/${dischargePatientId}`;

            loadBeds(); // Refresh Map
            document.getElementById('side-panel').innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 50px;">Select a bed...</div>';
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Discharge failed');
    }
}


async function markAvailable(bedId) {
    try {
        const res = await fetch(`/api/ipd/beds/${bedId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'available' })
        });
        const data = await res.json();
        if (data.success) {
            loadBeds();
            document.getElementById('side-panel').innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 50px;">Select a bed...</div>';
        }
    } catch (e) {
        console.error(e);
    }
}


// --- Transfer Logic ---
let transferPatientId = null;

function openTransferModal(patientId, currentWard, currentBed) {
    transferPatientId = patientId;
    document.getElementById('currentBedInfo').innerText = `${currentWard} - ${currentBed}`;

    // Reset inputs
    document.getElementById('transferWard').innerHTML = '<option value="">-- Select Ward --</option>';
    document.getElementById('transferBed').innerHTML = '<option value="">-- Select Bed --</option>';

    document.getElementById('transferModal').style.display = 'flex';

    // Load Wards
    const wards = [...new Set(currentBeds.map(b => b.ward))];
    const wardSelect = document.getElementById('transferWard');
    wards.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w;
        opt.innerText = w;
        wardSelect.appendChild(opt);
    });
}

function closeTransferModal() {
    document.getElementById('transferModal').style.display = 'none';
    transferPatientId = null;
}

function loadTransferBeds() {
    const wardName = document.getElementById('transferWard').value;
    const bedSelect = document.getElementById('transferBed');
    bedSelect.innerHTML = '<option value="">-- Select Bed --</option>';

    if (!wardName) return;

    const availableBeds = currentBeds.filter(b => b.ward === wardName && b.status === 'available');

    if (availableBeds.length === 0) {
        bedSelect.innerHTML = '<option value="">No available beds</option>';
        return;
    }

    availableBeds.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.bedNumber;
        opt.innerText = b.bedNumber;
        bedSelect.appendChild(opt);
    });
}

async function submitTransfer() {
    const toWard = document.getElementById('transferWard').value;
    const toBed = document.getElementById('transferBed').value;

    if (!toWard || !toBed) {
        alert('Please select Ward and Bed');
        return;
    }

    try {
        const res = await fetch('/api/ipd/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId: transferPatientId, toWard, toBed })
        });

        const data = await res.json();
        if (data.success) {
            alert('Transfer successful!');
            closeTransferModal();
            loadBeds(); // Refresh Map
            document.getElementById('side-panel').innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 50px;">Select new bed to see details...</div>';
        } else {
            alert('Transfer failed: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Error processing transfer');
    }
}

// --- Medication Chart Logic ---
async function loadMedications(patientId) {
    const container = document.getElementById(`med-list-${patientId}`);
    if (!container) return;

    try {
        const res = await fetch(`/api/ipd/medications/${patientId}`);
        const meds = await res.json();

        if (meds.length === 0) {
            container.innerHTML = '<div style="color: #999; font-style: italic;">No active medications.</div>';
            return;
        }

        container.innerHTML = meds.map(m => `
            <div style="background: #f8fafc; padding: 8px; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid var(--primary);">
                <div style="font-weight: 600; font-size: 0.9rem;">${m.drugName} <span style="font-weight: 400; color: #666;">(${m.dosage})</span></div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                    <div style="font-size: 0.8rem; color: #475569;">${m.route} • ${m.frequency} • ${m.instructions || ''}</div>
                    <button onclick="stopMedication('${m._id}', '${patientId}')" style="background: none; border: none; color: #ef4444; font-size: 0.8rem; cursor: pointer; text-decoration: underline;">Stop</button>
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Started: ${new Date(m.startDate).toLocaleDateString()}</div>
            </div>
        `).join('');

    } catch (e) {
        console.error(e);
        container.innerText = 'Error loading meds.';
    }
}

function openMedicationModal(patientId) {
    // Create modal dynamically if not exists
    let modal = document.getElementById('medModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'medModal';
        modal.className = 'modal'; // Assuming global modal class styles exist
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Add Medication</h2>
                <input type="hidden" id="medPatientId">
                <div class="form-group">
                    <label>Drug Name</label>
                    <input type="text" id="medDrugName" placeholder="e.g. Inj. Pan 40">
                </div>
                <div class="form-group">
                    <label>Dosage</label>
                    <input type="text" id="medDosage" placeholder="e.g. 40mg">
                </div>
                <div class="form-group">
                    <label>Route</label>
                    <select id="medRoute">
                        <option value="Oral">Oral</option>
                        <option value="IV">IV</option>
                        <option value="IM">IM</option>
                        <option value="SC">Subcutaneous</option>
                        <option value="Topical">Topical</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Frequency</label>
                    <select id="medFrequency">
                        <option value="OD">OD (Once a day)</option>
                        <option value="BD">BD (Twice a day)</option>
                        <option value="TDS">TDS (Thrice a day)</option>
                        <option value="QID">QID (Authors a day)</option>
                        <option value="SOS">SOS (As needed)</option>
                        <option value="STAT">STAT (Immediately)</option>
                    </select>
                </div>
                 <div class="form-group">
                    <label>Instructions</label>
                    <input type="text" id="medInstructions" placeholder="e.g. After food">
                </div>
                <div class="modal-actions">
                    <button class="btn-action" style="background: #f1f5f9; color: #64748b;" onclick="document.getElementById('medModal').style.display='none'">Cancel</button>
                    <button class="btn-action" style="background: var(--primary); color: white;" onclick="submitMedication()">Add</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('medPatientId').value = patientId;
    document.getElementById('medDrugName').value = '';
    document.getElementById('medDosage').value = '';
    document.getElementById('medInstructions').value = '';
    modal.style.display = 'flex'; // Use flex to center if css supports it, otherwise block
}

async function submitMedication() {
    const patientId = document.getElementById('medPatientId').value;
    const drugName = document.getElementById('medDrugName').value;
    const dosage = document.getElementById('medDosage').value;
    const route = document.getElementById('medRoute').value;
    const frequency = document.getElementById('medFrequency').value;
    const instructions = document.getElementById('medInstructions').value;

    if (!drugName) return alert('Drug Name is required');

    try {
        const res = await fetch('/api/ipd/medications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId, drugName, dosage, route, frequency, instructions })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('medModal').style.display = 'none';
            loadMedications(patientId);
        } else {
            alert('Failed to add medication');
        }
    } catch (e) {
        console.error(e);
        alert('Error adding medication');
    }
}

async function stopMedication(id, patientId) {
    if (!confirm('Stop this medication?')) return;
    try {
        await fetch(`/api/ipd/medications/${id}/stop`, { method: 'PUT' });
        loadMedications(patientId);
    } catch (e) {
        console.error(e);
    }
}

// --- Vitals Logic ---
async function loadVitals(patientId) {
    const container = document.getElementById(`vital-list-${patientId}`);
    if (!container) return;

    try {
        const res = await fetch(`/api/ipd/vitals/${patientId}`);
        const vitals = await res.json();

        if (vitals.length === 0) {
            container.innerHTML = '<div style="color: #999; font-style: italic;">No vitals recorded.</div>';
            return;
        }

        // Simple Table View
        let html = `
            <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
                <thead>
                    <tr style="text-align: left; border-bottom: 1px solid #ddd; color: #666;">
                        <th style="padding: 4px;">Time</th>
                        <th style="padding: 4px;">BP</th>
                        <th style="padding: 4px;">Pulse</th>
                        <th style="padding: 4px;">Temp</th>
                        <th style="padding: 4px;">SpO2</th>
                    </tr>
                </thead>
                <tbody>
        `;

        vitals.forEach(v => {
            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 4px; color: #666;">${new Date(v.recordedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td style="padding: 4px;">${v.bloodPressure || '-'}</td>
                    <td style="padding: 4px;">${v.pulse || '-'}</td>
                    <td style="padding: 4px;">${v.temperature || '-'}</td>
                    <td style="padding: 4px;">${v.oxygenSaturation || '-'}%</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        container.innerText = 'Error loading vitals.';
    }
}

function openVitalModal(patientId) {
    let modal = document.getElementById('vitalModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'vitalModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Record Vitals</h2>
                <input type="hidden" id="vitalPatientId">
                <div class="form-group"><label>BP (mmHg)</label><input type="text" id="vitalBP" placeholder="120/80"></div>
                <div class="form-group"><label>Pulse (bpm)</label><input type="number" id="vitalPulse" placeholder="72"></div>
                <div class="form-group"><label>Temp (°F)</label><input type="number" id="vitalTemp" placeholder="98.6" step="0.1"></div>
                <div class="form-group"><label>SpO2 (%)</label><input type="number" id="vitalSpO2" placeholder="98"></div>
                <div class="form-group"><label>Weight (kg)</label><input type="number" id="vitalWeight" placeholder="60"></div>
                
                <div class="modal-actions">
                    <button class="btn-action" style="background: #f1f5f9; color: #64748b;" onclick="document.getElementById('vitalModal').style.display='none'">Cancel</button>
                    <button class="btn-action" style="background: var(--primary); color: white;" onclick="submitVital()">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('vitalPatientId').value = patientId;
    // Clear inputs
    ['vitalBP', 'vitalPulse', 'vitalTemp', 'vitalSpO2', 'vitalWeight'].forEach(id => document.getElementById(id).value = '');

    modal.style.display = 'flex';
}

async function submitVital() {
    const patientId = document.getElementById('vitalPatientId').value;
    const bloodPressure = document.getElementById('vitalBP').value;
    const pulse = document.getElementById('vitalPulse').value;
    const temperature = document.getElementById('vitalTemp').value;
    const oxygenSaturation = document.getElementById('vitalSpO2').value;
    const weight = document.getElementById('vitalWeight').value;

    if (!document.getElementById('vitalTemp').value && !document.getElementById('vitalBP').value) {
        return alert('Enter at least one reading');
    }

    try {
        const res = await fetch('/api/ipd/vitals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId, bloodPressure, pulse, temperature, oxygenSaturation, weight })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('vitalModal').style.display = 'none';
            loadVitals(patientId);
        } else {
            alert('Failed to save vitals');
        }
    } catch (e) {
        console.error(e);
        alert('Error saving vitals');
    }
}

// --- Lab Logic ---
async function loadLabs(patientId) {
    const container = document.getElementById(`lab-list-${patientId}`);
    if (!container) return;

    try {
        const res = await fetch(`/api/ipd/labs/${patientId}`);
        const tests = await res.json();

        if (tests.length === 0) {
            container.innerHTML = '<div style="color: #999; font-style: italic;">No lab tests found.</div>';
            return;
        }

        container.innerHTML = tests.map(t => {
            const isCompleted = t.status === 'completed';
            const statusColor = isCompleted ? '#22c55e' : '#f59e0b';
            return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
                <div>
                    <div style="font-weight: 500; font-size: 0.9rem;">${t.testName}</div>
                    <div style="font-size: 0.75rem; color: #666;">${new Date(t.orderedAt).toLocaleDateString()} • <span style="color: ${statusColor};">${t.status}</span></div>
                </div>
                ${isCompleted ? `<button onclick="viewLabResult('${t._id}')" style="background: var(--primary); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">View</button>` : ''}
            </div>
            `;
        }).join('');

    } catch (e) {
        console.error(e);
        container.innerText = 'Error loading labs.';
    }
}

async function viewLabResult(testId) {
    try {
        const res = await fetch(`/api/lab/tests/${testId}`);
        const data = await res.json();

        let modal = document.getElementById('labResultModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'labResultModal';
            modal.className = 'modal';
            modal.style.display = 'none';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2 id="lrTestName">Test Result</h2>
                    <div style="margin-bottom: 20px; font-size: 0.95rem; color: var(--text-secondary); background: #f8fafc; padding: 10px; border-radius: 8px;">
                        Date: <span id="lrDate" style="font-weight: 600;"></span>
                    </div>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <thead>
                                <tr style="background: #f1f5f9; text-align: left;">
                                    <th style="padding: 12px; border-bottom: 2px solid #e2e8f0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Parameter</th>
                                    <th style="padding: 12px; border-bottom: 2px solid #e2e8f0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Value</th>
                                    <th style="padding: 12px; border-bottom: 2px solid #e2e8f0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Unit</th>
                                    <th style="padding: 12px; border-bottom: 2px solid #e2e8f0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Ref. Range</th>
                                </tr>
                            </thead>
                            <tbody id="lrBody"></tbody>
                        </table>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-action" style="background: var(--primary); color: white;" onclick="document.getElementById('labResultModal').style.display='none'">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        document.getElementById('lrTestName').innerText = data.testName;
        document.getElementById('lrDate').innerText = new Date(data.resultDate || data.completedAt || Date.now()).toLocaleString();

        const tbody = document.getElementById('lrBody');
        if (data.results && data.results.length > 0) {
            tbody.innerHTML = data.results.map(r => `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${r.parameterName}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: 600; color: ${r.isAbnormal ? '#ef4444' : 'inherit'}">${r.value}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${r.unit || ''}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666; font-size: 0.85rem;">${r.referenceRange || ''}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4" style="padding: 10px; text-align: center;">Result summary: ' + (data.result || 'No details') + '</td></tr>';
        }

        modal.style.display = 'flex';

    } catch (e) {
        console.error(e);
        alert('Error loading result');
    }
}

// --- Lab Request Logic ---
function openLabRequestModal(patientId) {
    let modal = document.getElementById('labRequestModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'labRequestModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Order Lab Test</h2>
                <input type="hidden" id="lrPatientId">
                <div class="form-group">
                    <label>Test Name</label>
                    <input type="text" id="lrTestName" placeholder="e.g. CBC, Lipid Profile, X-Ray Chest">
                </div>
                <div class="modal-actions">
                    <button class="btn-action" style="background: #f1f5f9; color: #64748b;" onclick="document.getElementById('labRequestModal').style.display='none'">Cancel</button>
                    <button class="btn-action" style="background: var(--primary); color: white;" onclick="submitLabRequest()">Send Request</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById('lrPatientId').value = patientId;
    document.getElementById('lrTestName').value = '';
    modal.style.display = 'flex';
}

function submitLabRequest() {
    const patientId = document.getElementById('lrPatientId').value;
    const testName = document.getElementById('lrTestName').value;

    if (!testName) return alert('Please enter test name');

    // Use Socket.io to send request matchign server.js event
    if (typeof socket === 'undefined') {
        alert('Socket connection not available');
        return;
    }

    socket.emit('create-lab-request', {
        patientId,
        testName,
        doctorId: 'IPD-NURSE' // Context for orderedBy
    });

    document.getElementById('labRequestModal').style.display = 'none';
    // Optimistic UI update or wait for socket event? 
    // Server emits 'lab-request-created' to socket. Let's listen to it globally.
}

// socket event listener is needed! 
// ipd.js does not initialize socket at top? 
// Checking ipd.html -> includes /socket.io/socket.io.js then ipd.js
// But ipd.js top lines show: let currentBeds = []; etc. NO socket init.
// server.js initializes socket.io on the server.
// client needs: const socket = io();
// I need to add socket initialization to ipd.js if it's missing.

// Looking at ipd.js content again... lines 1-4:
// 1: 
// 2: let currentBeds = [];
// ...
// It does NOT have const socket = io();
// I must add it.

const socket = io(); // Initialize socket

socket.on('lab-request-created', (res) => {
    if (res.success) {
        alert('Lab Request Sent!');
        if (selectedBed && selectedBed.patientId) {
            loadLabs(selectedBed.patientId);
        }
    } else {
        alert('Failed: ' + res.message);
    }
});

// Init
document.addEventListener('DOMContentLoaded', loadBeds);
