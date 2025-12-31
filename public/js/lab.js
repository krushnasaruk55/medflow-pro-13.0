const socket = io();
let currentSection = 'overview';

// Join Lab Room
socket.on('connect', () => {
    socket.emit('join', 'lab');
});

// Socket Listeners
socket.on('lab-update', () => {
    loadSection(currentSection);
    showToast('New lab update received', 'info');
});

document.addEventListener('DOMContentLoaded', () => {
    showSection('overview');
});

function showSection(section) {
    currentSection = section;

    // Update Sidebar
    document.querySelectorAll('.lab-nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.textContent.toLowerCase().includes(section.replace('-', ' '))) {
            item.classList.add('active');
        }
    });

    loadSection(section);
}

async function loadSection(section) {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div style="text-align:center; padding: 40px;">Loading...</div>';

    try {
        switch (section) {
            case 'overview':
                await renderOverview(content);
                break;
            case 'requests':
                await renderRequests(content);
                break;
            case 'collection':
                await renderCollection(content);
                break;
            case 'processing':
                await renderProcessing(content);
                break;
            case 'results':
                await renderResultsList(content);
                break;
            case 'reports':
                await renderReports(content);
                break;
            case 'inventory':
                await renderInventory(content);
                break;
            case 'settings':
                await renderSettings(content);
                break;
        }
    } catch (error) {
        console.error(error);
        content.innerHTML = `<div class="card" style="color: var(--danger);">Error loading section: ${error.message}</div>`;
    }
}

// --- Render Functions ---

async function renderOverview(container) {
    try {
        const res = await fetch('/api/lab/stats');
        const stats = await res.json();

        container.innerHTML = `
            <div class="overview-grid">
                <div class="stats-card">
                    <div class="stats-number">${stats.pending || 0}</div>
                    <div class="stats-label">Pending Requests</div>
                </div>
                <div class="stats-card">
                    <div class="stats-number">${stats.collection || 0}</div>
                    <div class="stats-label">Sample Collection</div>
                </div>
                <div class="stats-card">
                    <div class="stats-number">${stats.processing || 0}</div>
                    <div class="stats-label">In Processing</div>
                </div>
                <div class="stats-card">
                    <div class="stats-number">${stats.completed || 0}</div>
                    <div class="stats-label">Completed Today</div>
                </div>
            </div>
            
            <!-- Analytics Charts -->
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 30px;">
                <div class="card">
                    <h3>Tests Overview (Last 7 Days)</h3>
                    <canvas id="testsChart"></canvas>
                </div>
                <div class="card">
                    <h3>Status Distribution</h3>
                    <canvas id="statusChart"></canvas>
                </div>
            </div>
        `;

        // Render Charts
        renderCharts(stats);

    } catch (e) {
        container.innerHTML = `<div class="card">Error loading stats</div>`;
        console.error(e);
    }
}

function renderCharts(stats) {
    const ctx1 = document.getElementById('testsChart').getContext('2d');
    const ctx2 = document.getElementById('statusChart').getContext('2d');

    // Mock Historical Data (Since API just gives current counts for now, we'll simulate for demo)
    // Ideally backend gives { dates: [], counts: [] }
    const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toLocaleDateString('en-US', { weekday: 'short' });
    });

    // Simulate trend based on completed count
    const base = stats.completed || 5;
    const dataPoints = dates.map(() => Math.floor(Math.random() * 10) + base);

    new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [{
                label: 'Tests Completed',
                data: dataPoints,
                backgroundColor: '#0EA5E9',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } }
        }
    });

    new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: ['Pending', 'Processing', 'Completed'],
            datasets: [{
                data: [stats.pending || 0, stats.processing || 0, stats.completed || 0],
                backgroundColor: ['#F59E0B', '#3B82F6', '#10B981']
            }]
        },
        options: {
            responsive: true,
            cutout: '60%'
        }
    });
}

async function renderRequests(container) {
    const res = await fetch('/api/lab/tests?status=pending');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>Test Requests</h2>
        </div>
        <div class="filter-bar">
            <input type="text" placeholder="Search patient..." class="form-control" onkeyup="filterTests(this.value)">
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No pending test requests.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <div>
                            <strong>${test.patientName}</strong> <span class="text-muted">(${test.patientAge}/${test.patientGender})</span>
                            <div class="text-sm text-muted">Dr. ${test.orderedBy} • ${new Date(test.createdAt).toLocaleDateString()}</div>
                        </div>
                        <div class="status-badge status-pending">Pending</div>
                    </div>
                    <div class="test-body">
                        <p><strong>Test:</strong> ${test.testName}</p>
                        ${test.notes ? `<p class="text-sm">Note: ${test.notes}</p>` : ''}
                    </div>
                    <div class="test-actions">
                        <button class="btn btn-primary" onclick="updateTestStatus('${test._id}', 'collection_pending')">Accept & Collect Sample</button>
                    </div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderCollection(container) {
    const res = await fetch('/api/lab/tests?status=collection_pending');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>Sample Collection</h2>
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No samples to collect.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <div>
                            <strong>${test.patientName}</strong>
                            <div class="text-sm text-muted">${test.testName}</div>
                        </div>
                        <button class="btn btn-outline" onclick="printLabel('${test._id}')">🖨️ Label</button>
                    </div>
                    <div class="test-actions" style="margin-top: 15px;">
                        <button class="btn btn-success" onclick="updateTestStatus('${test._id}', 'processing')">Sample Collected</button>
                        <button class="btn btn-danger" onclick="rejectSample('${test._id}')">Reject Sample</button>
                    </div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderProcessing(container) {
    const res = await fetch('/api/lab/tests?status=processing');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>In Processing</h2>
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No tests in processing.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <strong>${test.patientName}</strong>
                        <span class="status-badge status-processing">Processing</span>
                    </div>
                    <div class="test-body">
                        <p>${test.testName}</p>
                    </div>
                    <div class="test-actions">
                        <button class="btn btn-primary" onclick="enterResults('${test._id}')">Enter Results</button>
                    </div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderResultsList(container) {
    // Reusing processing logic for now, or maybe a separate list of 'results_pending' if that state existed
    // But usually 'processing' leads to 'completed' after entering results.
    // Let's assume this is for reviewing results before final signoff, or just redirect to processing.
    await renderProcessing(container);
}

async function renderReports(container) {
    const res = await fetch('/api/lab/tests?status=completed');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>Completed Reports</h2>
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No completed reports.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <strong>${test.patientName}</strong>
                        <span class="status-badge status-completed">Completed</span>
                    </div>
                    <div class="test-body">
                        <p>${test.testName}</p>
                        <div class="text-sm text-muted">Completed: ${new Date(test.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <div class="test-actions">
                        <button class="btn btn-outline" onclick="viewReport('${test._id}')">View Report</button>
                        <button class="btn btn-primary" onclick="printReport('${test._id}')">Print</button>
                        <button class="btn btn-secondary" onclick="emailReport('${test._id}')">✉️ Email</button>
                    </div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderInventory(container) {
    try {
        const [invRes, alertRes] = await Promise.all([
            fetch('/api/lab/inventory'),
            fetch('/api/lab/alerts')
        ]);
        const items = await invRes.json();
        const alerts = await alertRes.json();

        let html = `
            <div class="section-title" style="display: flex; justify-content: space-between; align-items: center;">
                <h2>Inventory & Alerts</h2>
                <button class="btn btn-primary" onclick="addInventoryItem()">+ Add Item</button>
            </div>

            <!-- Alerts Section -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 24px;">
                <div class="card" style="border-left: 4px solid var(--danger);">
                     <h4 style="color: var(--danger); margin-bottom: 12px; display:flex; align-items:center; gap:8px;">⚠️ Low Stock Alerts</h4>
                     <div style="max-height: 150px; overflow-y: auto;">
                        ${alerts.lowStock.length ? alerts.lowStock.map(i => `
                            <div style="display:flex; justify-content:space-between; padding: 4px 0; border-bottom: 1px solid #eee;">
                                <span>${i.itemName}</span>
                                <strong style="color:var(--danger)">${i.quantity} ${i.unit}</strong>
                            </div>`).join('')
                : '<p class="text-muted">✓ Stock levels are healthy</p>'}
                     </div>
                </div>
                <div class="card" style="border-left: 4px solid var(--status-waiting);">
                     <h4 style="color: #b45309; margin-bottom: 12px; display:flex; align-items:center; gap:8px;">⏳ Expiry Alerts</h4>
                      <div style="max-height: 150px; overflow-y: auto;">
                        ${[...alerts.expiring, ...alerts.expired].length ? [...alerts.expiring, ...alerts.expired].map(i => {
                    const isExpired = new Date(i.expiryDate) < new Date();
                    return `
                            <div style="display:flex; justify-content:space-between; padding: 4px 0; border-bottom: 1px solid #eee;">
                                <span>${i.itemName}</span>
                                <strong style="color:${isExpired ? 'var(--danger)' : '#b45309'}">
                                    ${isExpired ? 'EXPIRED' : new Date(i.expiryDate).toLocaleDateString()}
                                </strong>
                            </div>`;
                }).join('')
                : '<p class="text-muted">✓ No items expiring soon</p>'}
                      </div>
                </div>
            </div>

            <div class="card">
                <table style="width:100%; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 2px solid #eee; text-align: left;">
                            <th style="padding:12px;">Item Name</th>
                            <th style="padding:12px;">Quantity</th>
                            <th style="padding:12px;">Unit</th>
                            <th style="padding:12px;">Status</th>
                            <th style="padding:12px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (items.length === 0) {
            html += `<tr><td colspan="5" style="text-align:center; padding: 20px;">No inventory items.</td></tr>`;
        } else {
            items.forEach(item => {
                const isLow = item.quantity <= (item.minLevel || 10);
                html += `
                    <tr style="border-bottom: 1px solid #f0f0f0;">
                        <td style="padding:12px;">${item.itemName}</td>
                        <td style="padding:12px;">${item.quantity}</td>
                        <td style="padding:12px;">${item.unit}</td>
                        <td style="padding:12px;">${isLow ? '<span style="color: var(--danger); font-weight:bold;">Low Stock</span>' : '<span style="color: #10b981; font-weight:bold;">OK</span>'}</td>
                        <td style="padding:12px;">
                            <button class="btn btn-sm btn-outline" style="padding: 4px 8px;" onclick="updateStock('${item._id}', 1)">+</button>
                            <button class="btn btn-sm btn-outline" style="padding: 4px 8px;" onclick="updateStock('${item._id}', -1)">-</button>
                        </td>
                    </tr>
                `;
            });
        }
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="card" style="color: var(--danger);">Error loading inventory: ${e.message}</div>`;
    }
}

async function renderSettings(container) {
    const res = await fetch('/api/lab/settings/test-types');
    const types = await res.json();

    let html = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3>Test Catalog & Normal Ranges</h3>
                <button class="btn btn-primary" onclick="openTestTypeModal()">+ Add Test Type</button>
            </div>
            <table style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid #eee; text-align: left;">
                        <th style="padding:10px;">Test Name</th>
                        <th style="padding:10px;">Category</th>
                        <th style="padding:10px;">Parameters</th>
                        <th style="padding:10px;">Price</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (types.length === 0) {
        html += `<tr><td colspan="4" class="text-muted" style="padding:20px; text-align:center;">No test types defined.</td></tr>`;
    } else {
        types.forEach(t => {
            const params = JSON.parse(t.parameters || '[]');
            html += `
                <tr style="border-bottom: 1px solid #f0f0f0;">
                    <td style="padding:10px; font-weight:bold;">${t.name}</td>
                    <td style="padding:10px;">${t.category}</td>
                    <td style="padding:10px;">${params.map(p => `<span class="badge" style="font-size:0.7em; margin-right:4px;">${p.name}</span>`).join('')}</td>
                    <td style="padding:10px;">$${t.price || 0}</td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

// --- Modals & Advanced Logic ---

function openTestTypeModal() {
    const modal = document.getElementById('actionModal');
    document.getElementById('modalTitle').innerText = 'Add Test Type';
    document.getElementById('modalContent').innerHTML = `
        <div class="form-group">
            <label>Test Name</label>
            <input type="text" id="ttName" class="form-control" placeholder="e.g. CBC, Lipid Profile">
        </div>
        <div class="form-group">
            <label>Category</label>
            <input type="text" id="ttCategory" class="form-control" placeholder="e.g. Hematology">
        </div>
        <div class="form-group">
            <label>Price</label>
            <input type="number" id="ttPrice" class="form-control" value="0">
        </div>
        <div class="form-group">
            <label>Parameters (JSON or CSV for now? Let's do simple multiline)</label>
            <small class="text-muted">Format per line: Parameter Name | Unit | Ref Range</small>
            <textarea id="ttParams" class="form-control" rows="5" placeholder="Hemoglobin | g/dL | 13-17&#10;WBC Count | /cumm | 4000-11000"></textarea>
        </div>
    `;
    modal.style.display = 'flex';

    document.getElementById('modalConfirmBtn').onclick = async () => {
        const name = document.getElementById('ttName').value;
        const category = document.getElementById('ttCategory').value;
        const price = document.getElementById('ttPrice').value;
        const rawParams = document.getElementById('ttParams').value;

        const parameters = rawParams.split('\n').filter(l => l.trim()).map(l => {
            const parts = l.split('|');
            return {
                name: parts[0]?.trim(),
                unit: parts[1]?.trim() || '',
                refRange: parts[2]?.trim() || ''
            };
        });

        await fetch('/api/lab/settings/test-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, category, price, parameters })
        });

        showToast('Test Type Added', 'success');
        closeModal();
        loadSection('settings');
    };
}

function closeModal() {
    document.getElementById('actionModal').style.display = 'none';
}

// --- Action Functions ---

async function updateTestStatus(testId, status) {
    try {
        await fetch(`/api/lab/tests/${testId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        showToast('Status updated', 'success');
        loadSection(currentSection);
    } catch (e) {
        console.error(e);
        showToast('Error updating status', 'error');
    }
}

function rejectSample(testId) {
    const reason = prompt("Enter rejection reason:");
    if (reason) {
        fetch(`/api/lab/tests/${testId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'rejected', rejectionReason: reason })
        }).then(() => {
            showToast('Sample rejected', 'warning');
            loadSection(currentSection);
        });
    }
}

function printLabel(testId) {
    const win = window.open('', 'Print Label', 'width=400,height=200');
    win.document.write(`
        <div style="text-align: center; font-family: monospace; padding: 20px;">
            <h3>LAB SAMPLE</h3>
            <p>ID: ${testId}</p>
            <p>Date: ${new Date().toLocaleDateString()}</p>
        </div>
    `);
    win.print();
    // win.close(); // Keep open for debug
}

async function enterResults(testId) {
    // Fetch test details first to see name
    const res = await fetch(`/api/lab/tests/${testId}`);
    const test = await res.json();

    // Fetch matching template if any
    const typeRes = await fetch('/api/lab/settings/test-types');
    const types = await typeRes.json();
    const template = types.find(t => t.name.toLowerCase() === test.testName.toLowerCase());

    const modal = document.getElementById('actionModal');
    document.getElementById('modalTitle').innerText = `Enter Results: ${test.testName}`;

    let fieldsHtml = '';

    if (template) {
        const params = JSON.parse(template.parameters || '[]');
        params.forEach((p, idx) => {
            fieldsHtml += `
                <div class="form-group" style="margin-bottom:10px;">
                    <label>${p.name} <small class="text-muted">(${p.unit})</small></label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" class="form-control result-val" data-idx="${idx}" placeholder="Value">
                        <input type="hidden" class="result-name" value="${p.name}">
                        <input type="hidden" class="result-unit" value="${p.unit}">
                        <input type="text" class="form-control result-ref" value="${p.refRange}" readonly style="background:#f9fafb; width:150px;" title="Ref Range">
                    </div>
                </div>
            `;
        });
    } else {
        // Dynamic Entry for unknown tests
        fieldsHtml = `
            <p class="text-muted">No template found. Enter generic result.</p>
            <div class="form-group">
                <label>Result / Findings</label>
                <textarea id="genericResult" class="form-control" rows="4"></textarea>
            </div>
        `;
    }

    document.getElementById('modalContent').innerHTML = `<div id="resultForm">${fieldsHtml}</div>`;
    modal.style.display = 'flex';

    document.getElementById('modalConfirmBtn').onclick = async () => {
        let results = [];

        if (template) {
            const inputs = document.querySelectorAll('.result-val');
            inputs.forEach(input => {
                const parent = input.parentElement;
                results.push({
                    parameterName: parent.querySelector('.result-name').value,
                    value: input.value,
                    unit: parent.querySelector('.result-unit').value,
                    referenceRange: parent.querySelector('.result-ref').value,
                    isAbnormal: false // TODO: logic to check range
                });
            });
        } else {
            results.push({
                parameterName: 'Findings',
                value: document.getElementById('genericResult').value,
                unit: '',
                referenceRange: '',
                isAbnormal: false
            });
        }

        await fetch(`/api/lab/tests/${testId}/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results })
        });

        showToast('Results saved', 'success');
        closeModal();
        loadSection(currentSection);
    };
}

async function viewReport(testId) {
    const res = await fetch(`/api/lab/tests/${testId}`);
    const test = await res.json();

    // Simple alert for now
    alert(JSON.stringify(test.results, null, 2));
}

async function addInventoryItem() {
    const name = prompt("Item Name:");
    const qty = prompt("Quantity:");
    const unit = prompt("Unit:");

    if (name && qty) {
        await fetch('/api/lab/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemName: name, quantity: qty, unit: unit || 'units', minLevel: 10 })
        });
        showToast('Item added', 'success');
        loadSection('inventory');
    }
}

async function updateStock(itemId, change) {
    try {
        await fetch(`/api/lab/inventory/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ change })
        });
        showToast('Inventory updated', 'success');
        // Refresh view while keeping scroll position ideally, or just reload section
        loadSection('inventory');
    } catch (e) {
        console.error(e);
        showToast('Update failed', 'error');
    }
}

function printReport(testId) {
    // Open in new tab which starts download
    window.open(`/api/lab/report/${testId}`, '_blank');
}

async function emailReport(testId) {
    if (!confirm('Send report to patient email?')) return;

    try {
        const res = await fetch(`/api/lab/report/${testId}/email`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Email Sending...', 'info');
        } else {
            showToast('Failed: ' + data.error, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Network error', 'error');
    }
}

function showToast(message, type = 'info') {
    const container = document.querySelector('.toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}