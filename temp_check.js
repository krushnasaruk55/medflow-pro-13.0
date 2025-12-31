        // State
        let currentUser = JSON.parse(localStorage.getItem('patientUser'));
        let isLoginMode = true;
        let hospitals = [];

        // Elements
        const screens = {
            home: document.getElementById('homeScreen'),
            appointments: document.getElementById('appointmentsScreen'),
            pharmacy: document.getElementById('pharmacyScreen'), // Added
            auth: document.getElementById('authScreen')
        };
        const navItems = document.querySelectorAll('.nav-item');

        // Socket.io for Real-time Updates
        const socket = io(); // Auto-connects to host

        // Live Queue State
        let activeAppointment = null;

        // Init
        window.addEventListener('load', async () => {
            // Always load hospitals first so user can browse
            await loadHospitals();

            if (currentUser) {
                console.log('Logged in as', currentUser.name);
                loadAppointments();
                if (currentUser.hospitalId) {
                    loadOrders();
                    checkActiveAppointment(); // Check for today's appointment
                }
            }
            updateProfileIcon();
        });

        // ... existing switchTab ...

        // Socket Listeners
        socket.on('connect', () => {
            // Join a room for this Patient or Hospital?
            // Since server emits to 'hospitalId', we need to join that.
            // But we don't know hospitalId until we login.
            if (currentUser && currentUser.hospitalId) {
                socket.emit('join-patient-room', { hospitalId: currentUser.hospitalId });
            }
        });

        socket.on('current-token-update', (data) => {
            if (!activeAppointment) return;
            // Only update if it matches our doctor/hospital (simplified: assume one active appt)
            if (activeAppointment.doctorId == data.doctorId || !data.doctorId) {
                updateQueueUI(data.token);
            }
        });

        async function checkActiveAppointment() {
            if (!currentUser) return;
            // Fetch appointments again to find today's
            try {
                const res = await fetch(`/api/patient-app/appointments/${currentUser.id}`);
                const data = await res.json();
                const today = new Date().toISOString().split('T')[0];

                // Find visible appointment for TODAY
                activeAppointment = data.appointments.find(a => a.appointmentDate === today && a.status !== 'completed' && a.status !== 'cancelled');

                if (activeAppointment) {
                    document.getElementById('liveQueueCard').style.display = 'block';
                    // We don't have token in Appointment schema yet, usually it's in Patient record for the visit.
                    // But let's assume if they booked via app, we rely on the linked Patient record's token.
                    // Ideally, we fetch the Patient details to get the Token.
                    fetchPatientDetails(activeAppointment.patientId);
                } else {
                    document.getElementById('liveQueueCard').style.display = 'none';
                }
            } catch (e) { console.error(e); }
        }

        async function fetchPatientDetails(pid) {
            // We need an endpoint to get patient details including current Token
            // Re-using public or secure endpoint? We are logged in.
            // Let's assume we can hit a new endpoint or existing one.
            // We'll trust the appointment logic for now or add a small helper.
            // Wait, the appointment has patientId. Let's assume it correlates to the queue token.
            // Actually, `activeAppointment` might not have the daily token if it was just booked.
            // The Reception assigns the token usually? Or the system auto-assigns.
            // In server.js, register-patient assigns token. Booking creates Appointment.
            // We need to sync them. For now, let's mock the "My Token" as "Checked In" or fetch if available.

            // Real implementation: Fetch patient status from server
            // We'll emit a socket request to get status? Or poll?
            return;
        }

        function updateQueueUI(currentToken) {
            if (!activeAppointment) return;
            // Mock My Token if not available (In real app, we'd fetch it)
            // Let's assume My Token is stored in localStorage or part of activeAppointment if we updated schema
            const myToken = activeAppointment.token || 12; // Static fallback for demo if missing

            document.getElementById('queueMyToken').innerText = `#${myToken}`;
            document.getElementById('queueCurrentToken').innerText = `#${currentToken}`;

            const diff = myToken - currentToken;
            if (diff < 0) {
                document.getElementById('queueMessage').innerText = "Your turn has passed.";
                document.getElementById('queueWaitTime').innerText = "0 m";
            } else if (diff === 0) {
                document.getElementById('queueMessage').innerText = "It's your turn! Please proceed.";
                document.getElementById('queueMessage').style.color = "#22c55e";
                document.getElementById('queueMessage').style.fontWeight = "bold";
                if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
                document.getElementById('queueWaitTime').innerText = "0 m";
            } else {
                const estMins = diff * 15; // Assume 15 mins per patient
                document.getElementById('queueWaitTime').innerText = `~${estMins} m`;
                document.getElementById('queueMessage').innerText = `${diff} people ahead of you`;
                document.getElementById('queueMessage').style.color = "var(--text-muted)";
            }
        }

        function switchTab(tabName) {
            // Update UI
            Object.values(screens).forEach(s => s.classList.remove('active'));
            if (screens[tabName]) screens[tabName].classList.add('active');

            navItems.forEach((item, index) => {
                // index matches nav order: 0=Home, 1=Visits, 2=Pharmacy, 3=Profile
                if (
                    (tabName === 'home' && index === 0) ||
                    (tabName === 'appointments' && index === 1) ||
                    (tabName === 'pharmacy' && index === 2) ||
                    (tabName === 'auth' && index === 3)
                ) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });

            if ((tabName === 'appointments' || tabName === 'pharmacy') && !currentUser) {
                switchTab('auth'); // Force login
            }

            if (tabName === 'pharmacy' && currentUser) {
                loadOrders();
            }
        }

        // --- Pharmacy Logic ---
        async function loadOrders() {
            if (!currentUser) return;
            try {
                const res = await fetch(`/api/patient-app/pharmacy/orders/${currentUser.id}`);
                const data = await res.json();
                const container = document.getElementById('myOrdersList');
                container.innerHTML = '';

                if (data.orders.length === 0) {
                    container.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">No orders placed yet.</div>';
                    return;
                }

                data.orders.forEach(order => {
                    const statusColor = order.status === 'completed' ? '#22c55e' : (order.status === 'pending' ? '#f59e0b' : '#3b82f6');

                    const div = document.createElement('div');
                    div.className = 'card'; // Reuse card style
                    div.innerHTML = `
                         <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                            <strong style="color:var(--primary);">Order #${order._id.substring(20)}</strong>
                            <span style="font-size:0.85rem; padding:4px 8px; border-radius:12px; background:${statusColor}20; color:${statusColor}; text-transform:capitalize;">${order.status}</span>
                         </div>
                         <div style="font-size:0.95rem; margin-bottom:8px;">${order.prescription}</div>
                         <div style="color:var(--text-muted); font-size:0.85rem; display:flex; justify-content:space-between;">
                            <span>${new Date(order.orderDate).toLocaleDateString()}</span>
                            <span>${order.totalAmount ? '₹' + order.totalAmount : 'Pending Bill'}</span>
                         </div>
                    `;
                    container.appendChild(div);
                });

            } catch (err) { console.error(err); }
        }

        function openPharmacyModal() {
            if (!currentUser) return alert('Please login first');
            // For simplify, just a prompt to enter prescription text
            const text = prompt("Enter medicines to order (comma separated):");
            if (text) {
                if (!currentUser.hospitalId) return alert("Please register with a hospital first.");

                fetch('/api/patient-app/pharmacy/order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        patientId: currentUser.id,
                        hospitalId: currentUser.hospitalId,
                        prescription: text
                    })
                }).then(r => r.json()).then(d => {
                    if (d.success) { alert('Order Placed! Pharmacy will review it.'); loadOrders(); }
                    else { alert(d.message); }
                });
            }
        }

        async function loadHospitals() {
            try {
                const res = await fetch('/api/hospitals'); // Public endpoint
                hospitals = await res.json();
                renderHospitals(hospitals);

                // Populate Register Select
                const regSelect = document.getElementById('regHospitalSelect');
                regSelect.innerHTML = '<option value="">Select Hospital...</option>';
                hospitals.forEach(h => {
                    const opt = document.createElement('option');
                    opt.value = h.id || h._id; // handling both just in case
                    opt.textContent = h.name;
                    regSelect.appendChild(opt);
                });

            } catch (err) {
                console.error(err);
            }
        }

        function renderHospitals(list) {
            const container = document.getElementById('hospitalList');
            container.innerHTML = '';

            list.forEach(h => {
                const div = document.createElement('div');
                div.className = 'hospital-card';
                div.innerHTML = `
                    <div>
                        <div class="h-name">${h.name}</div>
                        <div class="h-sub">${h.email}</div> <!-- using email as sub for now -->
                    </div>
                    <button class="btn btn-outline" onclick="openBooking('${h._id}')">Book</button>
                `;
                container.appendChild(div);
            });
        }

        // Auth Logic
        function toggleAuthMode(e) {
            e.preventDefault();
            isLoginMode = !isLoginMode;

            const title = document.getElementById('authTitle');
            const btn = document.getElementById('authSubmitBtn');
            const switchText = document.getElementById('authSwitchText');
            const regFields = document.getElementById('registerFields');

            if (isLoginMode) {
                title.textContent = 'Login';
                btn.textContent = 'Login';
                switchText.textContent = 'New user?';
                regFields.style.display = 'none';
            } else {
                title.textContent = 'Register';
                btn.textContent = 'Register';
                switchText.textContent = 'Already have an account?';
                regFields.style.display = 'block';
            }
        }

        document.getElementById('authForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());

            const endpoint = isLoginMode ? '/api/patient-app/login' : '/api/patient-app/register';

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();

                if (result.success) {
                    if (isLoginMode) {
                        currentUser = result.patient;
                        localStorage.setItem('patientUser', JSON.stringify(currentUser));
                        alert('Login Successful!');
                        updateProfileIcon();
                        switchTab('home');
                        loadAppointments();
                    } else {
                        alert('Registration Successful! Please login.');
                        toggleAuthMode({ preventDefault: () => { } }); // Switch to login
                    }
                } else {
                    alert(result.message || 'Error occurred');
                }
            } catch (err) {
                alert('Connection error');
            }
        });

        function updateProfileIcon() {
            const icon = document.getElementById('profileBtn');
            if (currentUser) {
                icon.style.background = '#dbeafe'; // active color
                icon.textContent = currentUser.name.charAt(0);
            } else {
                icon.textContent = '👤';
            }
        }

        function toggleAuth() {
            switchTab('auth');
        }

        // Booking Logic
        function openBooking(hospitalId) {
            if (!currentUser) {
                alert('Please login to book an appointment');
                switchTab('auth');
                return;
            }

            const hospital = hospitals.find(h => (h.id === hospitalId || h._id === hospitalId));
            const hospitalName = hospital ? hospital.name : 'Hospital';

            document.getElementById('bookingModal').style.display = 'flex';
            document.getElementById('bookingHospitalName').textContent = hospitalName;
            document.getElementById('bookHospitalId').value = hospitalId;

            // Set min date to today
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('bookingDate').min = today;
        }

        function closeBookingModal() {
            document.getElementById('bookingModal').style.display = 'none';
        }

        document.getElementById('bookingForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());

            data.patientId = currentUser.id;

            try {
                const res = await fetch('/api/patient-app/book', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();

                if (result.success) {
                    alert('Appointment Booked Successfully!');
                    closeBookingModal();
                    switchTab('appointments');
                    loadAppointments();
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Error booking appointment');
            }
        });

        async function loadAppointments() {
            if (!currentUser) return;
            try {
                const res = await fetch(`/api/patient-app/appointments/${currentUser.id}`);
                const data = await res.json();

                const container = document.getElementById('myAppointmentsList');
                container.innerHTML = '';

                if (data.appointments.length === 0) {
                    container.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">No appointments found.</div>';
                    return;
                }

                data.appointments.forEach(app => {
                    let actionHtml = '';
                    if (app.type === 'online' && app.videoLink) {
                        actionHtml = `<a href="${app.videoLink}" target="_blank" class="btn btn-outline" style="text-decoration:none; margin-top:10px; display:inline-block; font-size:0.9rem; padding:8px 12px;">📹 Join Video Call</a>`;
                    }

                    const div = document.createElement('div');
                    div.className = 'card';
                    div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                            <span style="font-weight:600; color:var(--primary);">${app.appointmentDate} at ${app.appointmentTime}</span>
                            <span style="font-size:0.9rem; background:#f1f5f9; padding:4px 8px; border-radius:4px;">${app.status}</span>
                        </div>
                        <div style="font-weight:600;">Dr. ID: ${app.doctorId} <span style="font-weight:400; color:var(--text-muted); font-size:0.9rem;">(${app.type === 'online' ? 'Online' : 'In-Person'})</span></div>
                        <div style="margin-top:8px; font-size:0.9rem;">${app.notes || 'Routine Checkup'}</div>
                        ${actionHtml}
                    `;
                    container.appendChild(div);
                });

            } catch (err) {
                console.error(err);
            }
        }

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = hospitals.filter(h => h.name.toLowerCase().includes(term));
            renderHospitals(filtered);
        });

    </script>
</body>

</html>
