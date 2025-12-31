// Hospital Settings Logic
let hospitalId = null;

// Initial Load
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth via an endpoint or assumption (since this is internal tool, we rely on session)
    // In a real app we'd redirect if not logged in.
    await loadHospitalProfile();
    await loadStaffList();

    // Dynamic form handling
    const roleSelect = document.getElementById('newUserRole');
    roleSelect.addEventListener('change', () => {
        const deptGroup = document.getElementById('deptGroup');
        if (roleSelect.value === 'doctor') {
            deptGroup.style.display = 'block';
        } else {
            deptGroup.style.display = 'none';
        }
    });
});

// Navigation
function switchTab(tabId) {
    // Buttons
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => {
        if (el.textContent.toLowerCase().includes(tabId)) el.classList.add('active');
    });
    // If not matching text, just index based (quick fix for "General Info" vs "general")
    const btnMap = { 'general': 0, 'staff': 1, 'security': 2 };
    document.querySelectorAll('.nav-item')[btnMap[tabId]].classList.add('active');

    // Panels
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
}

// ---------------- API Calls ----------------

async function loadHospitalProfile() {
    try {
        const res = await fetch('/api/hospital/profile');
        if (res.status === 401) {
            window.location.href = 'login.html';
            return;
        }
        const data = await res.json();
        if (data.success) {
            const h = data.hospital;
            hospitalId = h._id || h.id;

            document.getElementById('hospitalName').value = h.name || '';
            document.getElementById('hospitalEmail').value = h.email || '';
            document.getElementById('hospitalAddress').value = h.address || '';
            document.getElementById('hospitalPhone').value = h.phone || '';

            // Access Code (Simulated since real pw isn't always returned or is hashed)
            // In a real scenario, we might show a generated one or the monthly one.
            // Based on server.js login logic, the hospital password IS stored in DB?
            // Actually server.js verifies via auth.verifyHospitalPassword.
            // We usually don't send passwords back. We might need an endpoint to "get my code" or display it if allowed.
            // For now, let's assume we can fetch it or just show a placeholder.
            document.getElementById('hospitalAccessCode').value = data.accessCode || '••••';
        }
    } catch (err) {
        console.error("Failed to load profile", err);
    }
}

async function saveProfile() {
    const data = {
        name: document.getElementById('hospitalName').value,
        address: document.getElementById('hospitalAddress').value,
        phone: document.getElementById('hospitalPhone').value
    };

    try {
        const res = await fetch('/api/hospital/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            alert("Profile updated successfully!");
        } else {
            alert("Update failed: " + result.message);
        }
    } catch (err) {
        alert("Error saving profile");
    }
}

async function loadStaffList() {
    try {
        const res = await fetch('/api/hospital/users');
        const data = await res.json();

        const container = document.getElementById('userList');
        if (!data.users || data.users.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px;">No staff found.</div>';
            return;
        }

        container.innerHTML = data.users.map(u => `
            <div class="user-item">
                <div style="display:flex; align-items:center; gap:16px;">
                    <div style="width:40px; height:40px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-weight:bold; color:var(--text-secondary);">
                        ${u.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight:600; font-size:1.05rem;">${u.username}</div>
                        ${u.role === 'doctor' && u.dept ? `<div style="font-size:0.85rem; color:var(--text-secondary);">${u.dept} Department</div>` : ''}
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:16px;">
                    <span class="role-badge role-${u.role}">${u.role}</span>
                    <button class="btn btn-sm" onclick="deleteUser('${u._id || u.id}')" style="color:var(--danger); border:1px solid var(--danger); background:transparent;">Remove</button>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error("Failed to load staff", err);
    }
}

async function submitNewUser() {
    const username = document.getElementById('newUsername').value;
    const role = document.getElementById('newUserRole').value;
    const password = document.getElementById('newUserPassword').value;
    const dept = document.getElementById('newUserDept').value; // Only used if doctor

    const payload = { username, role, password, dept: (role === 'doctor' ? dept : null) };

    try {
        const res = await fetch('/api/hospital/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
            alert("User created successfully!");
            closeModal();
            loadStaffList();
            // Reset form
            document.getElementById('addUserForm').reset();
        } else {
            alert("Failed to create user: " + result.message);
        }
    } catch (err) {
        alert("Error creating user");
    }
}

async function deleteUser(userId) {
    if (!confirm("Are you sure you want to remove this staff member? They will no longer be able to log in.")) return;

    try {
        const res = await fetch(`/api/hospital/users/${userId}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            loadStaffList();
        } else {
            alert("Failed to delete: " + result.message);
        }
    } catch (err) {
        alert("Error deleting user");
    }
}

// ---------------- UI Helpers ----------------
function openAddUserModal() {
    document.getElementById('addUserModal').classList.add('active');
}

function closeModal() {
    document.getElementById('addUserModal').classList.remove('active');
}

function copyAccessCode() {
    const code = document.getElementById('hospitalAccessCode');
    code.select();
    document.execCommand('copy');
    alert("Access code copied to clipboard");
}

function logout() {
    fetch('/api/logout', { method: 'POST' })
        .then(() => window.location.href = 'login.html');
}
