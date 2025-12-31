require('dotenv').config();
const {
  sendFollowUpReminder,
  sendAppointmentConfirmation,
  sendPrescriptionReady,
  sendLabResultReady
} = require('./notificationService');

// In-memory chat history (Limit to last 50 messages)
const chatHistory = [];
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const {
  connectDB, Hospital, User, Patient, Vital, LabTest,
  LabResult, Inventory, Appointment, LabInventory,
  LabTestType, PrescriptionTemplate, PharmacyBill,
  PharmacyOrder, Bed, RoundNote, IPDMedication
} = require('./database');
const auth = require('./auth');
const QRCode = require('qrcode');
const crypto = require('crypto');
const os = require('os');
const { registerValidators, loginValidators, templateValidators } = require('./middleware/validators');

// Connect to MongoDB
connectDB();

function getLocalExternalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Trust proxy - required for Render and other reverse proxies
app.set('trust proxy', 1);

// Enforce HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for simplicity with inline scripts/styles in this project
}));
app.use(compression());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware with persistent MongoDB storage
const sessionMiddleware = session({
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60 // 1 day
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Secure cookies in production (HTTPS)
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax' // CSRF protection
  }
});

app.use(sessionMiddleware);

// Sample departments and doctors (Static for now)
const departments = [
  'General', 'Orthopedics', 'Gynecology', 'Pediatrics', 'ENT', 'Dermatology', 'Cardiology', 'Medicine'
];

const doctors = [
  { id: '1', name: 'Dr. Asha Patel', dept: 'General', status: 'available' },
  { id: '2', name: 'Dr. Rajesh Singh', dept: 'Orthopedics', status: 'available' },
  { id: '3', name: 'Dr. Nisha Rao', dept: 'Gynecology', status: 'available' },
  { id: '4', name: 'Dr. Vikram Shah', dept: 'Cardiology', status: 'available' }
];

// Helper to generate secure public token
function generatePublicToken() {
  return crypto.randomBytes(32).toString('hex');
}

// --- Public Patient Portal API ---
app.get('/api/public/prescription/:token', async (req, res) => {
  const token = req.params.token;

  try {
    const patient = await Patient.findOne({ publicToken: token });
    if (!patient) return res.status(404).json({ error: 'Invalid token' });

    // Fetch hospital details
    const hospital = await Hospital.findById(patient.hospitalId);

    // Fetch doctor details (if assigned)
    const doctor = doctors.find(d => d.id === patient.doctorId);

    res.json({
      patient: {
        name: patient.name,
        age: patient.age,
        gender: patient.gender,
        diagnosis: patient.diagnosis,
        prescription: patient.prescription,
        updatedAt: patient.appointmentDate || patient.registeredAt
      },
      hospital: hospital || { name: 'Medical Center' },
      doctor: doctor || { name: 'Attending Physician' }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Authentication & Hospital Management APIs ---

// Hospital Registration
app.get('/api/hospitals/list', async (req, res) => {
  try {
    const list = await Hospital.find({ subscriptionStatus: 'active' })
      .select('name address phone email')
      .sort({ name: 1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hospitals/register', registerValidators, async (req, res) => {
  const { hospital, admin } = req.body;

  if (!hospital || !hospital.name || !hospital.email || !admin || !admin.username || !admin.password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    // Check if email already exists
    const existing = await Hospital.findOne({ email: hospital.email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Hospital email already registered' });
    }

    // Insert hospital
    const subscriptionExpiry = new Date();
    subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 30); // 30-day trial

    const newHospital = await Hospital.create({
      name: hospital.name,
      email: hospital.email,
      phone: hospital.phone || null,
      address: hospital.address || null,
      subscriptionStatus: 'active',
      subscriptionExpiry: subscriptionExpiry.toISOString(),
      createdAt: new Date()
    });

    const hospitalId = newHospital._id;

    // Generate monthly password for hospital
    // Note: generateHospitalPassword uses integer ID logic usually, but we can pass string ID
    // If auth.js expects number, we might need to adjust. Assuming it handles string or we just pass string.
    const monthlyPassword = auth.generateHospitalPassword(hospitalId.toString());

    // Hash admin password
    const hashedPassword = await auth.hashPassword(admin.password);

    // Insert admin user
    await User.create({
      hospitalId: hospitalId,
      username: admin.username,
      email: admin.email || null,
      role: 'admin',
      password: hashedPassword,
      createdAt: new Date()
    });

    res.json({
      success: true,
      message: 'Hospital registered successfully',
      hospitalId: hospitalId,
      password: monthlyPassword
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to register: ' + err.message });
  }
});

// Login endpoint
app.post('/api/login', loginValidators, async (req, res) => {
  const { hospitalPassword, username, userPassword } = req.body;

  if (!hospitalPassword || !username || !userPassword) {
    return res.status(400).json({ success: false, message: 'Missing credentials' });
  }

  try {
    // First, find if any hospital has this password
    // Since password generation might depend on ID, and we can't easily reverse it without checking all,
    // we fetch all hospitals. (Inefficient for large scale, but fine for now)
    const hospitals = await Hospital.find({});

    // Check which hospital matches the password
    let matchedHospitalId = null;
    for (const hospital of hospitals) {
      if (auth.verifyHospitalPassword(hospital.id, hospitalPassword)) {
        if (hospital.subscriptionStatus !== 'active') {
          return res.status(403).json({ success: false, message: 'Subscription expired' });
        }
        matchedHospitalId = hospital._id;
        break;
      }
    }

    if (!matchedHospitalId) {
      return res.status(401).json({ success: false, message: 'Invalid hospital password' });
    }

    // Now verify user credentials for this hospital
    const user = await User.findOne({ hospitalId: matchedHospitalId, username: username });

    if (!user || !(await auth.comparePassword(userPassword, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    // Update last login
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    await Hospital.findByIdAndUpdate(matchedHospitalId, { lastLogin: new Date() });

    // Set session
    req.session.userId = user._id;
    req.session.hospitalId = matchedHospitalId;
    req.session.username = user.username;
    req.session.role = user.role;

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        hospitalId: matchedHospitalId
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed: ' + err.message });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// --- Hospital Admin Settings APIs ---

// 1. Get Profile
app.get('/api/hospital/profile', async (req, res) => {
  if (!req.session.hospitalId) return res.status(401).json({ success: false });
  try {
    const hospital = await Hospital.findById(req.session.hospitalId);
    const accessCode = auth.generateHospitalPassword(hospital._id.toString());
    res.json({ success: true, hospital, accessCode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Update Profile
app.put('/api/hospital/profile', async (req, res) => {
  if (!req.session.hospitalId || req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  try {
    const { name, address, phone } = req.body;
    await Hospital.findByIdAndUpdate(req.session.hospitalId, { name, address, phone });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Get Users
app.get('/api/hospital/users', async (req, res) => {
  if (!req.session.hospitalId || req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  try {
    const users = await User.find({ hospitalId: req.session.hospitalId }).select('-password');
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Add User
app.post('/api/hospital/users', async (req, res) => {
  if (!req.session.hospitalId || req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  try {
    const { username, role, password, dept } = req.body;
    const hashedPassword = await auth.hashPassword(password);

    await User.create({
      hospitalId: req.session.hospitalId,
      username,
      role,
      password: hashedPassword,
      dept: dept || null,
      createdAt: new Date()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Delete User
app.delete('/api/hospital/users/:id', async (req, res) => {
  if (!req.session.hospitalId || req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  try {
    await User.findOneAndDelete({ _id: req.params.id, hospitalId: req.session.hospitalId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// Auth status check
app.get('/api/auth/status', (req, res) => {
  if (req.session.userId) {
    res.json({
      authenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role,
        hospitalId: req.session.hospitalId
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user's hospital info
app.get('/api/hospital/info', async (req, res) => {
  if (!req.session.hospitalId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const hospital = await Hospital.findById(req.session.hospitalId);
    res.json(hospital);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Superadmin APIs ---

// Middleware for superadmin
const requireAdmin = (req, res, next) => {
  if (req.session.role === 'superadmin') {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Superadmin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (auth.verifySuperAdminPassword(password)) {
    req.session.role = 'superadmin';
    req.session.username = 'Super Admin';
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// List all hospitals
app.get('/api/admin/hospitals', requireAdmin, async (req, res) => {
  try {
    const hospitals = await Hospital.find({}).sort({ createdAt: -1 });
    res.json(hospitals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get hospital password
app.get('/api/admin/hospital-password/:id', requireAdmin, (req, res) => {
  const hospitalId = req.params.id; // String ID
  const password = auth.generateHospitalPassword(hospitalId);
  res.json({ password });
});

// Update hospital subscription status
app.put('/api/admin/hospitals/:id/status', requireAdmin, async (req, res) => {
  const hospitalId = req.params.id;
  const { status } = req.body;

  try {
    await Hospital.findByIdAndUpdate(hospitalId, { subscriptionStatus: status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update hospital subscription expiry
app.put('/api/admin/hospitals/:id/expiry', requireAdmin, async (req, res) => {
  const hospitalId = req.params.id;
  const { expiryDate, daysToAdd } = req.body;

  try {
    let newExpiry;
    if (expiryDate) {
      newExpiry = new Date(expiryDate).toISOString();
      await Hospital.findByIdAndUpdate(hospitalId, {
        subscriptionExpiry: newExpiry,
        subscriptionStatus: 'active'
      });
      res.json({ success: true, expiryDate: newExpiry });
    } else if (daysToAdd) {
      const hospital = await Hospital.findById(hospitalId);
      const baseDate = hospital && hospital.subscriptionExpiry ? new Date(hospital.subscriptionExpiry) : new Date();
      baseDate.setDate(baseDate.getDate() + parseInt(daysToAdd));
      newExpiry = baseDate.toISOString();

      await Hospital.findByIdAndUpdate(hospitalId, {
        subscriptionExpiry: newExpiry,
        subscriptionStatus: 'active'
      });
      res.json({ success: true, expiryDate: newExpiry });
    } else {
      return res.status(400).json({ error: 'Either expiryDate or daysToAdd required' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public endpoint to get list of hospitals (for login page)
app.get('/api/hospitals', async (req, res) => {
  try {
    const hospitals = await Hospital.find({}, 'name email address phone').sort({ name: 1 });
    res.json(hospitals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get patients with hospital filtering and pagination
app.get('/api/patients', async (req, res) => {
  const { phone, search, page = 1, limit = 50 } = req.query;
  const hospitalId = req.session.hospitalId;
  const skip = (page - 1) * limit;

  const query = {};
  if (hospitalId) query.hospitalId = hospitalId;

  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { name: searchRegex },
      { phone: searchRegex },
      { token: parseInt(search) || -1 } // Exact match for token if number
    ];
  } else if (phone) {
    query.phone = phone; // Backward compat
  }

  try {
    const total = await Patient.countDocuments(query);
    const patients = await Patient.find(query)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      data: patients,
      pagination: {
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/patients/:id', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  const query = { _id: req.params.id };
  if (hospitalId) query.hospitalId = hospitalId;

  try {
    const patient = await Patient.findOne(query);
    if (!patient) return res.status(404).json({ error: 'Not found' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/doctors', (req, res) => {
  const { dept } = req.query;
  if (dept) return res.json(doctors.filter(d => d.dept === dept));
  res.json(doctors);
});

app.get('/api/departments', (req, res) => {
  res.json(departments);
});

app.get('/api/prescriptions', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  const query = {
    $or: [
      { prescription: { $ne: null, $ne: '' } },
      { status: 'pharmacy' },
      { pharmacyState: { $ne: null } }
    ]
  };
  if (hospitalId) query.hospitalId = hospitalId;

  try {
    const patients = await Patient.find(query).sort({ token: 1 });
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/backup', async (req, res) => {
  if (!req.session.hospitalId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const hospitalId = req.session.hospitalId;
    const backupData = {
      hospital: await Hospital.findById(hospitalId),
      users: await User.find({ hospitalId }),
      patients: await Patient.find({ hospitalId }),
      inventory: await Inventory.find({ hospitalId }), // Pharmacy
      labTests: await LabTest.find({ hospitalId }),
      labInventory: await LabInventory.find({ hospitalId }),
      generatedAt: new Date()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=backup_${new Date().toISOString().slice(0, 10)}.json`);
    res.send(JSON.stringify(backupData, null, 2));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excel Export Endpoint
app.get('/api/export', async (req, res) => {
  const { type } = req.query; // 'month' or 'year'
  const now = new Date();
  let startDate;

  if (type === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  try {
    const patients = await Patient.find({ registeredAt: { $gte: startDate } }).sort({ registeredAt: -1 });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Patients');

    sheet.columns = [
      { header: 'Patient Name', key: 'name', width: 25 },
      { header: 'Visit Date', key: 'registeredAt', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Age', key: 'age', width: 10 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Reason', key: 'reason', width: 20 },
      { header: 'Prescription', key: 'prescription', width: 30 },
      { header: 'Cost Paid', key: 'cost', width: 12 },
      { header: 'Status', key: 'status', width: 15 }
    ];

    const formattedRows = patients.map(row => ({
      ...row.toObject(),
      registeredAt: new Date(row.registeredAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }),
      cost: row.cost || 0
    }));

    sheet.addRows(formattedRows);

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0EA5E9' }
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=patients_${type}_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).send('Database error: ' + err.message);
  }
});

// --- Pharmacy Inventory APIs ---

app.get('/api/pharmacy/inventory', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const items = await Inventory.find({ hospitalId }).sort({ medicationName: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pharmacy/inventory', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  const { medicationName, batchNumber, quantity, unitPrice, expiryDate, manufacturer, category, minLevel } = req.body;

  try {
    const newItem = await Inventory.create({
      hospitalId,
      medicationName,
      batchNumber,
      quantity,
      unitPrice,
      expiryDate,
      manufacturer,
      category,
      minLevel,
      lastUpdated: new Date()
    });
    res.json({ success: true, item: newItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pharmacy/alerts', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Low Stock
    const allItems = await Inventory.find({ hospitalId });
    const lowStock = allItems.filter(item => item.quantity <= (item.minLevel || 10));

    // Expiring Soon (within 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const expiring = allItems.filter(item => {
      if (!item.expiryDate) return false;
      const exp = new Date(item.expiryDate);
      return exp > new Date() && exp <= thirtyDaysFromNow;
    });

    // Expired
    const expired = allItems.filter(item => {
      if (!item.expiryDate) return false;
      return new Date(item.expiryDate) < new Date();
    });

    res.json({ lowStock, expiring, expired });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Pharmacy Billing APIs ---

app.post('/api/pharmacy/billing', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  // Use inventory model name consistently 'LabInventory' or 'Inventory'? 
  // In line 726 it uses 'Inventory'.
  const { patientName, phone, items, paymentMethod } = req.body;

  if (!hospitalId) return res.status(401).json({ error: 'Auth required' });

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items in bill' });
  }

  try {
    let finalStatus = 'paid';

    // 1. IPD Check & Charge
    if (paymentMethod === 'IPD') {
      const admittedPatient = await Patient.findOne({
        hospitalId,
        isAdmitted: true,
        name: { $regex: new RegExp('^' + patientName + '$', 'i') }
      });

      if (!admittedPatient) {
        return res.status(404).json({ success: false, error: 'Admitted Patient not found with this name.' });
      }

      const subtotal = items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
      const tax = subtotal * 0.18;
      const finalBill = subtotal + tax;

      admittedPatient.ipdCharges.push({
        description: `Pharmacy Bill (${items.length} items)`,
        amount: finalBill,
        type: 'pharmacy',
        date: new Date()
      });

      admittedPatient.cost = (admittedPatient.cost || 0) + finalBill;
      await admittedPatient.save();

      finalStatus = 'IPD';
    }

    // 2. Verify Stock & Calculate Total
    let subtotal = 0;
    for (const item of items) {
      if (item.inventoryId) {
        const product = await Inventory.findById(item.inventoryId);
        if (!product || product.quantity < item.quantity) {
          throw new Error(`Insufficient stock for ${item.itemName}`);
        }
        // Deduct Stock
        product.quantity -= item.quantity;
        await product.save();
      }
      subtotal += (item.unitPrice * item.quantity);
    }

    // 3. Create Bill
    const newBill = await PharmacyBill.create({
      hospitalId,
      patientName,
      phone,
      items,
      subtotal,
      tax: subtotal * 0.18,
      totalAmount: subtotal * 1.18,
      paymentMethod,
      billingStatus: finalStatus,
      billDate: new Date()
    });

    res.json({ success: true, billId: newBill._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/pharmacy/billing', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  try {
    const bills = await PharmacyBill.find({ hospitalId }).sort({ billDate: -1 }).limit(50);
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- Lab Alerts API ---
app.get('/api/lab/alerts', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const allItems = await LabInventory.find({ hospitalId });
    const lowStock = allItems.filter(item => item.quantity <= (item.minLevel || 10));

    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const expiring = allItems.filter(item => {
      if (!item.expiryDate) return false;
      const exp = new Date(item.expiryDate);
      return exp >= today && exp <= thirtyDaysFromNow;
    });

    const expired = allItems.filter(item => {
      if (!item.expiryDate) return false;
      const exp = new Date(item.expiryDate);
      return exp < today;
    });

    res.json({ lowStock, expiring, expired });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- Lab Dashboard APIs ---

// Get Lab Stats
app.get('/api/lab/stats', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const pending = await LabTest.countDocuments({ hospitalId, status: 'pending' });
    const inProgress = await LabTest.countDocuments({ hospitalId, status: 'in_progress' });
    const completed = await LabTest.countDocuments({ hospitalId, status: 'completed' });
    const urgent = await LabTest.countDocuments({ hospitalId, priority: 'urgent', status: { $ne: 'completed' } });
    const samplesToCollect = await LabTest.countDocuments({ hospitalId, sampleStatus: 'pending' });

    res.json({ pending, inProgress, completed, urgent, samplesToCollect });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Lab Tests with Filters
app.get('/api/lab/tests', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  const { status, date, search } = req.query;
  const query = { hospitalId };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (date) {
    // Assuming date is YYYY-MM-DD
    // Need to handle string date matching or range
    // Since orderedAt is Date, we need range
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    query.orderedAt = { $gte: start, $lt: end };
  }

  try {
    let tests = await LabTest.find(query)
      .populate('patientId', 'name age gender phone')
      .sort({ priority: -1, orderedAt: -1 }); // Urgent first

    // Manual search filter if needed (or use regex in query)
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      // Since we populated, we can filter in memory or use aggregate
      // For simplicity, filter in memory
      tests = tests.filter(t =>
        (t.patientId && (searchRegex.test(t.patientId.name) || searchRegex.test(t.patientId.phone)))
      );
    }

    // Flatten structure for frontend compatibility
    const formattedTests = tests.map(t => {
      const obj = t.toObject();
      if (obj.patientId) {
        obj.patientName = obj.patientId.name;
        obj.patientAge = obj.patientId.age;
        obj.patientGender = obj.patientId.gender;
        obj.patientPhone = obj.patientId.phone;
        delete obj.patientId;
      }
      return obj;
    });

    res.json(formattedTests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assign Technician
app.post('/api/lab/tests/:id/assign', async (req, res) => {
  const { technicianId } = req.body;
  try {
    await LabTest.findByIdAndUpdate(req.params.id, { technicianId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Sample Status
app.post('/api/lab/tests/:id/sample', async (req, res) => {
  const { status, rejectionReason } = req.body;
  const user = req.session.username || 'Unknown';
  const now = new Date();

  const update = {
    sampleStatus: status,
    sampleCollectedBy: user,
    sampleCollectedAt: now
  };

  if (status === 'rejected') {
    update.rejectionReason = rejectionReason;
  }

  try {
    await LabTest.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Test Processing Status
app.post('/api/lab/tests/:id/process', async (req, res) => {
  const { status, machineId } = req.body;
  const now = new Date();
  const update = { status };

  if (status === 'in_progress') {
    update.startedAt = now;
    update.machineId = machineId;
  } else if (status === 'completed') {
    update.completedAt = now;
  }

  try {
    await LabTest.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save Lab Results
app.post('/api/lab/tests/:id/results', async (req, res) => {
  const testId = req.params.id;
  const { results } = req.body;

  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'Invalid results data' });
  }

  try {
    // Clear old results
    await LabResult.deleteMany({ testId });

    // Insert new results
    const resultDocs = results.map(r => ({
      testId,
      parameterName: r.parameterName,
      value: r.value,
      unit: r.unit,
      referenceRange: r.referenceRange,
      isAbnormal: r.isAbnormal,
      notes: r.notes
    }));

    await LabResult.insertMany(resultDocs);

    // Mark test as completed
    await LabTest.findByIdAndUpdate(testId, {
      status: 'completed',
      resultDate: new Date()
    });

    // Notification Trigger
    const updatedTest = await LabTest.findById(testId).populate('patientId');
    if (updatedTest && updatedTest.patientId) {
      sendLabResultReady(updatedTest.patientId, updatedTest.testName).catch(console.error);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Test Details & Results
app.get('/api/lab/tests/:id', async (req, res) => {
  try {
    const test = await LabTest.findById(req.params.id).populate('patientId');
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const results = await LabResult.find({ testId: test._id });

    const testObj = test.toObject();
    if (testObj.patientId) {
      testObj.patientName = testObj.patientId.name;
      testObj.patientAge = testObj.patientId.age;
      testObj.patientGender = testObj.patientId.gender;
      testObj.patientPhone = testObj.patientId.phone;
    }

    res.json({ ...testObj, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inventory Management
app.get('/api/lab/inventory', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  try {
    const items = await LabInventory.find({ hospitalId });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lab/inventory', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  const { itemName, quantity, unit, minLevel } = req.body;

  try {
    const newItem = await LabInventory.create({
      hospitalId, itemName, quantity, unit, minLevel, addedAt: new Date()
    });
    res.json({ success: true, id: newItem._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/lab/inventory/:id', async (req, res) => {
  const { change } = req.body; // +1 or -1 or any number
  try {
    const item = await LabInventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    item.quantity = (item.quantity || 0) + Number(change);
    if (item.quantity < 0) item.quantity = 0;

    await item.save();
    res.json({ success: true, quantity: item.quantity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate Lab Report PDF
app.get('/api/lab/report/:id', async (req, res) => {
  try {
    const test = await LabTest.findById(req.params.id).populate('patientId');
    if (!test) return res.status(404).send('Test not found');

    // Get Results
    const results = await LabResult.find({ testId: test._id });

    const hospital = await Hospital.findById(test.hospitalId);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Lab_Report_${test.testName.replace(/ /g, '_')}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).text(hospital.name, { align: 'center' });
    doc.fontSize(10).text(hospital.address || '', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text('LABORATORY REPORT', { align: 'center', underline: true });
    doc.moveDown();

    // Patient Details
    doc.fontSize(12);
    const p = test.patientId || {};
    doc.text(`Patient Name: ${p.name || 'Unknown'}`);
    doc.text(`Age/Gender: ${p.age || '-'} / ${p.gender || '-'}`);
    doc.text(`Ref. By: ${test.orderedBy || 'Self'}`);
    doc.text(`Date: ${new Date(test.resultDate || Date.now()).toLocaleDateString()}`);
    doc.moveDown();

    doc.rect(50, doc.y, 500, 20).fill('#f0f0f0').stroke();
    doc.fillColor('black').text('Test Name: ' + test.testName, 60, doc.y - 15);
    doc.moveDown();

    // Results Table Header
    const tableTop = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('Investigation', 50, tableTop);
    doc.text('Result', 250, tableTop);
    doc.text('Unit', 350, tableTop);
    doc.text('Ref. Range', 450, tableTop);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.font('Helvetica');
    doc.moveDown(0.5);

    // Results Rows
    results.forEach(r => {
      const y = doc.y;
      doc.text(r.parameterName, 50, y);
      doc.text(r.value, 250, y);
      doc.text(r.unit || '-', 350, y);
      doc.text(r.referenceRange || '-', 450, y);
      doc.moveDown();
    });

    doc.moveDown(2);
    doc.fontSize(10).text('End of Report', { align: 'center' });
    doc.text('Technician Signature', { align: 'right' });

    doc.end();

  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Test Types (Templates)
app.get('/api/lab/settings/test-types', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  try {
    const types = await LabTestType.find({ hospitalId });
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lab/settings/test-types', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  const { name, category, parameters, price } = req.body;

  try {
    const newType = await LabTestType.create({
      hospitalId, name, category, parameters: JSON.stringify(parameters), price
    });
    res.json({ success: true, id: newType._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Prescription Template APIs ---

app.get('/api/prescription-template', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const template = await PrescriptionTemplate.findOne({ hospitalId });

    if (!template) {
      return res.json({
        hospitalId,
        templateName: 'Default Template',
        fontSize: 12,
        fontFamily: 'Helvetica',
        primaryColor: '#0EA5E9',
        secondaryColor: '#666666',
        paperSize: 'A4',
        showQRCode: true,
        showWatermark: false,
        showLetterhead: true,
        marginTop: 50,
        marginBottom: 50,
        marginLeft: 50,
        marginRight: 50,
        showVitals: true,
        showDiagnosis: true,
        showHistory: true,
        layoutStyle: 'classic',
        doctorSignature: ''
      });
    }
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prescription-template', templateValidators, async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  const data = req.body;
  data.hospitalId = hospitalId;
  data.updatedAt = new Date();

  try {
    await PrescriptionTemplate.findOneAndUpdate(
      { hospitalId },
      data,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, message: 'Template updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate Prescription PDF
app.get('/api/prescription-pdf/:patientId', async (req, res) => {
  let hospitalId = req.session.hospitalId;
  const patientId = req.params.patientId;
  const token = req.query.token;

  try {
    let patient;
    if (token) {
      patient = await Patient.findOne({ _id: patientId, publicToken: token });
      if (patient) hospitalId = patient.hospitalId;
    } else {
      if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });
      patient = await Patient.findOne({ _id: patientId, hospitalId });
    }

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Generate public token if missing
    if (!patient.publicToken) {
      patient.publicToken = generatePublicToken();
      await patient.save();
    }

    // Generate QR Code
    const baseUrl = process.env.BASE_URL || `http://${getLocalExternalIp()}:${process.env.PORT || 3000}`;
    const portalUrl = `${baseUrl}/api/public/prescription/${patient.publicToken}`;

    const qrCodeBuffer = await QRCode.toBuffer(portalUrl, {
      errorCorrectionLevel: 'M', type: 'png', width: 150, margin: 1
    });

    // Get template
    const template = await PrescriptionTemplate.findOne({ hospitalId }) || {};

    // Get hospital info
    const hospital = await Hospital.findById(hospitalId);

    // Get doctor info
    const doctorName = req.session.username || 'Dr. Unknown';

    const PDFDocument = require('pdfkit');
    const validSizes = ['A4', 'LETTER', 'A5', 'LEGAL'];
    let paperSize = (template.paperSize || 'A4').toUpperCase();
    if (!validSizes.includes(paperSize)) paperSize = 'A4';

    const doc = new PDFDocument({
      size: paperSize,
      margins: {
        top: Number(template.marginTop) || 50,
        bottom: Number(template.marginBottom) || 50,
        left: Number(template.marginLeft) || 50,
        right: Number(template.marginRight) || 50
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=prescription_${patient.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`);

    doc.pipe(res);

    // ... (PDF Generation Logic - mostly same, just using template/hospital objects)
    // I'll reuse the logic but adapted for object access
    const primaryColor = template.primaryColor || '#0EA5E9';
    const secondaryColor = template.secondaryColor || '#666666';
    const fontSize = Number(template.fontSize) || 12;

    if (template.showWatermark && template.watermarkText) {
      doc.save();
      doc.fontSize(60).fillColor('#f0f0f0').opacity(0.1)
        .rotate(45, { origin: [300, 300] })
        .text(template.watermarkText, 100, 100, { align: 'center', width: 400 });
      doc.restore();
    }

    if (template.showLetterhead) {
      doc.fontSize(20).fillColor(primaryColor)
        .text(template.hospitalName || hospital.name || 'Medical Center', { align: 'center' });
      doc.fontSize(10).fillColor(secondaryColor)
        .text(template.hospitalAddress || hospital.address || '', { align: 'center' })
        .text((template.hospitalPhone || hospital.phone || '') + (template.hospitalEmail ? ' | ' + template.hospitalEmail : ''), { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor(primaryColor).stroke();
      doc.moveDown(1.5);
    }

    doc.fontSize(fontSize).fillColor('#000000')
      .text(`Doctor: ${doctorName}`, { continued: true })
      .text(`Date: ${new Date().toLocaleDateString('en-IN')}`, { align: 'right' });
    doc.moveDown(1);

    doc.fontSize(fontSize + 2).fillColor(primaryColor).text('Patient Information', { underline: true });
    doc.fontSize(fontSize).fillColor('#000000').moveDown(0.5)
      .text(`Name: ${patient.name}`)
      .text(`Age: ${patient.age} years | Gender: ${patient.gender}`)
      .text(`Phone: ${patient.phone}`)
      .text(`Token No: ${patient.token}`)
      .text(`Department: ${patient.department}`);
    doc.moveDown(1.5);

    if (patient.reason) {
      doc.fontSize(fontSize + 2).fillColor(primaryColor).text('Chief Complaint', { underline: true });
      doc.fontSize(fontSize).fillColor('#000000').moveDown(0.5).text(patient.reason);
      doc.moveDown(1.5);
    }

    if (patient.diagnosis) {
      doc.fontSize(fontSize + 2).fillColor(primaryColor).text('Diagnosis', { underline: true });
      doc.fontSize(fontSize).fillColor('#000000').moveDown(0.5).text(patient.diagnosis);
      doc.moveDown(1.5);
    }

    doc.fontSize(fontSize + 4).fillColor(primaryColor).text('â„ž Prescription', { underline: true });
    doc.fontSize(fontSize).fillColor('#000000').moveDown(0.5);

    if (patient.prescription) {
      const prescriptionLines = patient.prescription.split('\n');
      prescriptionLines.forEach(line => {
        if (line.trim()) doc.text(`â€¢ ${line.trim()}`);
      });
    } else {
      doc.text('No prescription provided');
    }
    doc.moveDown(2);

    if (template.headerText) {
      doc.fontSize(fontSize - 2).fillColor(secondaryColor).text(template.headerText, { align: 'center' });
    }

    const bottomY = doc.page.height - (Number(template.marginBottom) || 50) - 50;
    if (doc.y < bottomY) doc.y = bottomY;

    if (template.footerText) {
      doc.fontSize(fontSize - 2).fillColor(secondaryColor).text(template.footerText, { align: 'center' });
    }

    doc.moveDown(2);
    const qrHeight = 120;
    const spaceNeeded = qrHeight + 50;
    if (doc.y + spaceNeeded > doc.page.height - (Number(template.marginBottom) || 50)) {
      doc.addPage();
    }

    const qrX = doc.page.width - 170;
    const qrY = doc.y;
    doc.image(qrCodeBuffer, qrX, qrY, { width: 100 });
    doc.fontSize(8).fillColor(secondaryColor).text('Scan to download PDF', qrX, qrY + 105, { width: 100, align: 'center' });

    doc.fontSize(fontSize - 1).fillColor('#000000')
      .text('_____________________', 50, qrY, { align: 'left' })
      .text(doctorName, 50, qrY + 15, { align: 'left', width: 200 });

    doc.end();

  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// --- Socket.io Middleware ---
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);

io.use(wrap(sessionMiddleware));

io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.userId) {
    socket.user = {
      id: session.userId,
      username: session.username,
      role: session.role,
      hospitalId: session.hospitalId
    };
  }
  next();
});

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    if (!socket.user) return; // Require auth

    const roleName = socket.user.role;
    const hospitalId = socket.user.hospitalId;

    if (roleName === 'doctor') socket.join('doctors');
    if (roleName === 'reception') socket.join('reception');
    if (roleName === 'pharmacy') socket.join('pharmacy');
    if (roleName === 'lab') socket.join('lab');

    socket.role = roleName;

    if (hospitalId) {
      socket.join(hospitalId.toString());
      console.log(`Socket ${socket.id} joined hospital ${hospitalId} as ${roleName}`);
    }
  });

  socket.on('join-patient-room', (data) => {
    // Patient App might not have socket.user (session), needs logic or skip for now.
    // If we skip, we leave it open, but data.hospitalId is user provided.
    // Risk: Listening to other hospital rooms? Yes. 
    // Fix: Validating if the socket is from a legitimate patient app instance is hard without auth.
    // We will leave this one for now as it's for public patient app notifications.
    if (data && data.hospitalId) {
      socket.join(data.hospitalId.toString());
      // console.log(`Patient App Socket ${socket.id} joined hospital room ${data.hospitalId}`);
    }
  });

  socket.on('register-patient', async (data) => {
    if (!socket.user) return socket.emit('patient-registration-error', { message: 'Unauthorized' });

    const dept = data.department || 'General';
    const hospitalId = socket.user.hospitalId; // Enforce server-side ID

    if (!data.name || !data.name.trim()) {
      return socket.emit('patient-registration-error', { message: 'Patient name is required' });
    }

    try {
      // Calculate token
      const count = await Patient.countDocuments({ department: dept, hospitalId });
      const token = count + 1;

      let assignedDoctor = data.doctorId || null;
      if (!assignedDoctor) {
        const avail = doctors.find(d => d.dept === dept && d.status === 'available');
        if (avail) assignedDoctor = avail.id;
      }

      const newPatient = await Patient.create({
        hospitalId,
        token,
        name: data.name || 'Unknown',
        age: data.age,
        gender: data.gender,
        phone: data.phone,
        address: data.address,
        patientType: data.patientType || 'New',
        opdIpd: data.opdIpd || 'OPD',
        department: dept,
        doctorId: assignedDoctor,
        reason: data.reason,
        status: 'waiting',
        registeredAt: new Date(),
        vitals: JSON.stringify(data.vitals || {}),
        prescription: data.prescription,
        history: JSON.stringify(data.history || []),
        pharmacyState: null,
        cost: data.cost || 0
      });

      console.log(`Registered patient ${newPatient.id} token ${token}`);

      // Notification Trigger
      sendAppointmentConfirmation(newPatient).catch(console.error);

      io.to('doctors').emit('patient-registered', newPatient);
      io.to('reception').emit('patient-registered', newPatient);
      io.emit('queue-updated', { patient: newPatient });
      socket.emit('patient-registered', newPatient);

    } catch (err) {
      console.error(err);
      socket.emit('patient-registration-error', { message: err.message });
    }
  });

  // Chat Events
  socket.emit('chat-history', chatHistory);

  socket.on('send-chat-message', (data) => {
    const msg = {
      id: Date.now(),
      sender: data.sender || 'Anonymous',
      role: data.role,
      text: data.text,
      timestamp: new Date()
    };

    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();

    io.emit('chat-message', msg);
  });

  socket.on('move-patient', async ({ id, status, doctorId, pharmacyState }) => {
    if (!socket.user) return;

    try {
      // Ensure patient belongs to user's hospital
      const patient = await Patient.findOne({ _id: id, hospitalId: socket.user.hospitalId });
      if (!patient) return;

      if (status) patient.status = status;
      if (doctorId) patient.doctorId = doctorId;
      if (pharmacyState) patient.pharmacyState = pharmacyState;

      await patient.save();

      io.emit('patient-updated', patient);
      io.to('doctors').emit('queue-updated', { patient });
      io.to('reception').emit('queue-updated', { patient });
      io.to('pharmacy').emit('queue-updated', { patient });

      // Notify Patient App (specific hospital room)
      if (patient.hospitalId) {
        io.to(patient.hospitalId.toString()).emit('queue-updated', { patient });

        // Also handle "Current Token" broadcast logic
        if (status === 'with-doctor') {
          // This patient is now being served.
          // Broadcast to everyone in this hospital that this token is active.
          io.to(patient.hospitalId.toString()).emit('current-token-update', {
            token: patient.token,
            doctorId: patient.doctorId
          });
        }
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('update-prescription', async ({ id, prescription, followUpDate }) => {
    if (!socket.user) return;

    try {
      const updateData = { prescription };
      if (followUpDate) updateData.followUpDate = followUpDate;

      // Restrict to hospital
      const patient = await Patient.findOneAndUpdate(
        { _id: id, hospitalId: socket.user.hospitalId },
        updateData,
        { new: true }
      );
      if (!patient) return;

      // Notification Trigger
      if (followUpDate) {
        let doctorName = 'Doctor';
        const doc = doctors.find(d => d.id === patient.doctorId);
        if (doc) doctorName = doc.name;
        // Fire and forget
        sendFollowUpReminder(patient, doctorName).catch(console.error);
      } else if (prescription && prescription.length > 5) {
        // Prescription Ready Notification (if not just a follow up update)
        if (!patient.publicToken) {
          patient.publicToken = generatePublicToken();
          await patient.save();
        }
        const baseUrl = process.env.BASE_URL || `http://${getLocalExternalIp()}:${process.env.PORT || 3000}`;
        const link = `${baseUrl}/api/public/prescription/${patient.publicToken}`;
        sendPrescriptionReady(patient, link).catch(console.error);
      }

      // Check for lab keywords
      const labKeywords = ['test', 'lab', 'cbc', 'blood', 'urine', 'x-ray', 'scan', 'profile', 'panel'];
      const lowerPrescription = prescription.toLowerCase();
      const hasLabRequest = labKeywords.some(keyword => lowerPrescription.includes(keyword));

      if (hasLabRequest) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await LabTest.findOne({
          patientId: id,
          orderedAt: { $gte: today },
          status: 'pending'
        });

        if (!existing) {
          const testName = "Lab Test Request (from Prescription)";
          let doctorName = 'Doctor';
          const doc = doctors.find(d => d.id === patient.doctorId);
          if (doc) doctorName = doc.name;

          await LabTest.create({
            hospitalId: patient.hospitalId,
            patientId: id,
            testName,
            orderedBy: doctorName,
            orderedAt: new Date(),
            status: 'pending',
            priority: 'normal',
            sampleStatus: 'pending'
          });

          io.to('lab').emit('lab-update');
        }
      }

      io.to('doctors').emit('prescription-updated', patient);
      io.to('reception').emit('prescription-updated', patient);
      socket.emit('prescription-updated', patient);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('create-lab-request', async ({ patientId, testName, doctorId }) => {
    if (!socket.user) return;

    try {
      console.log('create-lab-request received:', { patientId, testName, doctorId });
      // Validate patient hospital
      const patient = await Patient.findOne({ _id: patientId, hospitalId: socket.user.hospitalId });
      if (!patient) {
        console.error('Patient not found or unauthorized:', patientId);
        socket.emit('lab-request-created', { success: false, message: 'Patient not found' });
        return;
      }

      let doctorName = 'Doctor';
      const doc = doctors.find(d => d.id === doctorId);
      if (doc) doctorName = doc.name;

      const newTest = await LabTest.create({
        hospitalId: patient.hospitalId,
        patientId,
        testName: testName || "Manual Lab Request",
        orderedBy: doctorName,
        orderedAt: new Date(),
        status: 'pending',
        priority: 'normal',
        sampleStatus: 'pending'
      });

      io.to('lab').emit('lab-update');
      socket.emit('lab-request-created', { success: true, testId: newTest._id });
    } catch (err) {
      socket.emit('lab-request-created', { success: false, message: err.message });
    }
  });

  socket.on('disconnect', () => { });
});

// --- Patient App APIs ---

// 1. Patient App Register
app.post('/api/patient-app/register', async (req, res) => {
  const { hospitalId, name, phone, password, age, gender } = req.body;

  if (!hospitalId || !name || !phone || !password) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  try {
    // Check if already registered in this hospital
    const existing = await Patient.findOne({ hospitalId, phone });
    if (existing && existing.password) {
      return res.status(400).json({ success: false, message: 'Already registered in this hospital' });
    }

    if (existing) {
      // "Claim" existing patient record
      existing.password = await auth.hashPassword(password); // Re-using auth helper if available or simple
      // wait, `auth` module usage in server.js? 
      // check imports: const auth = require('./auth');
      // auth.hashPassword available? YES.
      existing.name = name; // Update details
      existing.age = age;
      existing.gender = gender;
      await existing.save();
      return res.json({ success: true, patientId: existing._id });
    }

    // Create new
    const hashedPassword = await auth.hashPassword(password);
    const newPatient = await Patient.create({
      hospitalId,
      name,
      phone,
      password: hashedPassword,
      age,
      gender,
      registeredAt: new Date()
    });

    res.json({ success: true, patientId: newPatient._id });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Patient App Login
app.post('/api/patient-app/login', async (req, res) => {
  const { phone, password } = req.body;

  try {
    // Find patient in ANY hospital (assuming phone/password is consistent, or just pick one)
    // This is a bit weak for multi-hospital, but fits the schema constraints.
    // We'll search for all records with this phone.
    const patients = await Patient.find({ phone });

    let validPatient = null;
    for (const p of patients) {
      if (p.password && (await auth.comparePassword(password, p.password))) {
        validPatient = p;
        break;
      }
    }

    if (validPatient) {
      res.json({
        success: true,
        patient: {
          id: validPatient._id,
          name: validPatient.name,
          phone: validPatient.phone,
          hospitalId: validPatient.hospitalId
        }
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Book Appointment
// 3. Book Appointment
app.post('/api/patient-app/book', async (req, res) => {
  const { patientId, hospitalId, doctorId, date, time, reason } = req.body;

  try {
    const sourcePatient = await Patient.findById(patientId);
    if (!sourcePatient) return res.status(404).json({ success: false, message: 'Patient not found' });

    let finalPatientId = patientId;
    const targetHospitalId = hospitalId || sourcePatient.hospitalId;

    // Handle Cross-Hospital Booking
    if (sourcePatient.hospitalId.toString() !== targetHospitalId.toString()) {
      // Check if patient exists in target hospital
      let targetPatient = await Patient.findOne({
        hospitalId: targetHospitalId,
        phone: sourcePatient.phone
      });

      if (!targetPatient) {
        // Auto-register at new hospital
        targetPatient = await Patient.create({
          hospitalId: targetHospitalId,
          name: sourcePatient.name,
          phone: sourcePatient.phone,
          age: sourcePatient.age,
          gender: sourcePatient.gender,
          password: sourcePatient.password, // Sync password
          registeredAt: new Date()
        });
      }
      finalPatientId = targetPatient._id;
    }

    // Video Call Link Generation (Simple Logic)
    let videoLink = null;
    let type = req.body.type || 'offline';

    if (type === 'online') {
      // Generate Jitsi Link: https://meet.jit.si/MedFlow-<HospitalID>-<Random>
      const uniqueId = Math.random().toString(36).substring(7);
      videoLink = `https://meet.jit.si/MedFlow-${targetHospitalId}-${uniqueId}`;
    }

    const newAppointment = await Appointment.create({
      hospitalId: targetHospitalId,
      patientId: finalPatientId,
      patientName: sourcePatient.name,
      phone: sourcePatient.phone,
      doctorId,
      appointmentDate: date,
      appointmentTime: time,
      type: type,
      videoLink: videoLink,
      status: 'scheduled',
      notes: reason,
      createdAt: new Date()
    });

    // Notify the hospital (Reception/Doctor)
    io.to(targetHospitalId.toString()).emit('new-appointment', newAppointment);

    res.json({ success: true, message: 'Appointment booked successfully', videoLink });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Pharmacy Online Orders APIs ---

// 1. Place Order (Patient App)
app.post('/api/patient-app/pharmacy/order', async (req, res) => {
  const { patientId, prescription, hospitalId } = req.body;

  if (!patientId || !prescription || !hospitalId) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  try {
    const patient = await Patient.findById(patientId);

    const order = await PharmacyOrder.create({
      hospitalId,
      patientId,
      patientName: patient.name,
      phone: patient.phone,
      prescription,
      status: 'pending',
      orderDate: new Date()
    });

    io.to(hospitalId.toString()).emit('new-pharmacy-order', order);

    res.json({ success: true, orderId: order._id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Get My Orders (Patient App)
app.get('/api/patient-app/pharmacy/orders/:patientId', async (req, res) => {
  try {
    const orders = await PharmacyOrder.find({ patientId: req.params.patientId }).sort({ orderDate: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Get Hospital Orders (Pharmacy Dashboard)
app.get('/api/pharmacy/online-orders', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Auth required' });

  try {
    const orders = await PharmacyOrder.find({ hospitalId }).sort({ orderDate: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update Order Status
app.put('/api/pharmacy/online-orders/:id', async (req, res) => {
  const { status, totalAmount } = req.body;
  try {
    const update = { status };
    if (totalAmount) update.totalAmount = totalAmount;

    await PharmacyOrder.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Hospital Appointments (For Reception)
app.get('/api/hospital/appointments', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  const { date } = req.query;

  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  const query = { hospitalId };
  if (date) {
    query.appointmentDate = date;
  }

  try {
    const appointments = await Appointment.find(query).sort({ appointmentDate: 1, appointmentTime: 1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get My Appointments
app.get('/api/patient-app/appointments/:patientId', async (req, res) => {
  try {
    const appointments = await Appointment.find({ patientId: req.params.patientId }).sort({ appointmentDate: -1 });
    res.json({ success: true, appointments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Get My Lab Tests (Patient App)
app.get('/api/patient-app/lab-tests/:patientId', async (req, res) => {
  try {
    const tests = await LabTest.find({ patientId: req.params.patientId }).sort({ orderedAt: -1 });

    // Enrich with results
    const fullTests = [];
    for (const test of tests) {
      const results = await LabResult.find({ testId: test._id });
      const t = test.toObject();
      t.results = results;
      fullTests.push(t);
    }

    res.json({ success: true, tests: fullTests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Update Profile
app.put('/api/patient-app/profile/:patientId', async (req, res) => {
  const { name, age, gender, address } = req.body;
  try {
    const patient = await Patient.findByIdAndUpdate(
      req.params.patientId,
      { name, age, gender, address },
      { new: true }
    );
    res.json({ success: true, patient });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// --- AI Integration Endpoint (Mock/Stub for now) ---
app.post('/api/ai/generate', async (req, res) => {
  const { prompt, type } = req.body;

  // Initialize Gemini if key exists
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY; // Fallback support

  if (!apiKey) {
    // Fallback Mock Response
    console.log("AI API Key missing, returning mock response.");
    let mockResponse = "This is a simulated AI response. Configure GEMINI_API_KEY in .env for real intelligence.";

    if (type === 'prescription') {
      mockResponse = "1. Amoxicillin 500mg - 1 tab - 3 times a day (5 days)\n2. Paracetamol 650mg - 1 tab - SOS";
    } else if (prompt.toLowerCase().includes('diagnosis')) {
      mockResponse = "Based on the symptoms, potential diagnosis could be Viral Fever. Recommend complete blood count.";
    } else if (type === 'chat') {
      mockResponse = "I am a medical assistant (in mock mode). Please assist the developer by setting up a valid API key to unlock my full potential.";
    }

    // Simulate delay
    setTimeout(() => res.json({ result: mockResponse }), 1000);
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.json({ result: text });
  } catch (err) {
    console.error("AI Generation Error:", err);
    res.status(500).json({ error: "Failed to generate AI response. " + err.message });
  }
});



// --- IPD Medication Management APIs ---

// 1. Get IPD Medications
app.get('/api/ipd/medications/:patientId', async (req, res) => {
  try {
    const medications = await IPDMedication.find({ patientId: req.params.patientId, isStopped: false }).sort({ startDate: -1 });
    res.json(medications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Add IPD Medication (and Deduct Stock)
app.post('/api/ipd/medications', async (req, res) => {
  const { patientId, drugName, dosage, route, frequency, instructions } = req.body;
  const hospitalId = req.session.hospitalId;

  if (!hospitalId) return res.status(401).json({ error: 'Auth required' });

  try {
    // 1. Check & Deduct Inventory (Optional but recommended)
    // Find item by name (Case insensitive regex)
    const inventoryItem = await Inventory.findOne({
      hospitalId,
      medicationName: { $regex: new RegExp('^' + drugName + '$', 'i') }
    });

    if (inventoryItem) {
      if (inventoryItem.quantity > 0) {
        inventoryItem.quantity -= 1; // Deduct 1 unit per prescription entry for now
        await inventoryItem.save();
      } else {
        // Option: allow negative or block? Let's warn but allow for critical care, or block. 
        // For now, we will just proceed but flag it in description? 
        // Let's strictly block to ensure stock integrity as per user request
        return res.status(400).json({ error: `Out of stock: ${drugName}. Available: 0` });
      }
    }

    // 2. Add to IPD Chart
    const newMed = await IPDMedication.create({
      hospitalId,
      patientId,
      drugName,
      dosage,
      route,
      frequency,
      instructions,
      startDate: new Date(),
      doctorName: 'Duty Doctor' // Replace with session user if available
    });

    // 3. Add to IPD Charges (Per dose or per day? Simplified: One-time charge for the strip/unit)
    // We'll add a charge if inventory item was found (price known)
    if (inventoryItem) {
      const patient = await Patient.findById(patientId);
      if (patient) {
        patient.ipdCharges.push({
          description: `Med: ${drugName}`,
          amount: inventoryItem.unitPrice || 0,
          type: 'pharmacy',
          date: new Date()
        });
        patient.cost = (patient.cost || 0) + (inventoryItem.unitPrice || 0);
        await patient.save();
      }
    }

    res.json({ success: true, med: newMed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Stop Medication
app.put('/api/ipd/medications/:id/stop', async (req, res) => {
  try {
    await IPDMedication.findByIdAndUpdate(req.params.id, {
      isStopped: true,
      stoppedAt: new Date()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Generate Discharge Summary PDF
app.get('/api/ipd/discharge-summary/:id', async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).send('Patient not found');

    const hospital = await Hospital.findById(patient.hospitalId);

    // Fetch related data
    const meds = await IPDMedication.find({ patientId: patient._id });
    const labs = await LabTest.find({ patientId: patient._id });
    const notes = await RoundNote.find({ patientId: patient._id });

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Discharge_Summary_${patient.name}.pdf`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text(hospital.name, { align: 'center' });
    doc.fontSize(10).text(hospital.address || '', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text('DISCHARGE SUMMARY', { align: 'center', underline: true });
    doc.moveDown();

    // Patient Info
    doc.fontSize(12);
    doc.text(`Patient Name: ${patient.name}`);
    doc.text(`Age/Gender: ${patient.age} / ${patient.gender}`);
    doc.text(`IPD No: ${patient.token || '-'}`);
    doc.text(`Admission Date: ${patient.admissionDate ? new Date(patient.admissionDate).toLocaleDateString() : '-'}`);
    doc.text(`Discharge Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    // Clinical Summary
    doc.font('Helvetica-Bold').text('Diagnosis:');
    doc.font('Helvetica').text(patient.diagnosis || 'N/A');
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Treatment Given (Medications):');
    doc.font('Helvetica');
    if (meds.length > 0) {
      meds.forEach(m => doc.text(`- ${m.drugName} ${m.dosage} (${m.frequency})`));
    } else {
      doc.text('Nil');
    }
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Lab Investigations:');
    doc.font('Helvetica');
    if (labs.length > 0) {
      labs.forEach(l => doc.text(`- ${l.testName} (${l.status})`));
    } else {
      doc.text('Nil');
    }
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Course in Hospital / Round Notes:');
    doc.font('Helvetica');
    if (notes.length > 0) {
      notes.forEach(n => doc.text(`- ${new Date(n.createdAt).toLocaleDateString()}: ${n.note}`));
    } else {
      doc.text('Uneventful');
    }
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Discharge Advice:');
    doc.font('Helvetica').text(patient.dischargeAdvice || '-');
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Follow Up:');
    doc.font('Helvetica').text(patient.followUpDate || '-');
    doc.moveDown(2);

    doc.text('Treating Doctor', { align: 'right' });

    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

// --- IPD / Bed Management APIs ---

// 1. Get All Beds (with Patient Details if occupied)
app.get('/api/ipd/beds', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  // if (!hospitalId) return res.status(401).json({ error: 'Auth required' });

  try {
    const beds = await Bed.find(hospitalId ? { hospitalId } : {});
    res.json(beds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Initialize Beds (Admin/Setup)
app.post('/api/ipd/beds/init', async (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Auth required' });

  const { wards } = req.body;

  if (!wards || !Array.isArray(wards)) {
    return res.status(400).json({ error: 'Invalid wards configuration' });
  }

  try {
    // Clear existing beds
    await Bed.deleteMany({ hospitalId });

    const newBeds = [];
    for (const ward of wards) {
      for (let i = 1; i <= ward.count; i++) {
        newBeds.push({
          hospitalId,
          ward: ward.name,
          bedNumber: `${ward.prefix}-${i.toString().padStart(2, '0')}`,
          type: ward.type,
          status: 'available'
        });
      }
    }

    await Bed.insertMany(newBeds);
    res.json({ success: true, count: newBeds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update Bed Status
app.put('/api/ipd/beds/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    const bed = await Bed.findByIdAndUpdate(req.params.id, {
      status,
      lastUpdated: new Date()
    }, { new: true });
    res.json({ success: true, bed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Admit Patient
app.post('/api/ipd/admit', async (req, res) => {
  const { patientId, ward, bedNumber, note } = req.body;
  const hospitalId = req.session.hospitalId;

  if (!hospitalId) return res.status(401).json({ error: 'Auth required' });

  try {
    const bed = await Bed.findOne({ hospitalId, ward, bedNumber });
    if (!bed) return res.status(404).json({ error: 'Bed not found' });
    if (bed.status === 'occupied') return res.status(400).json({ error: 'Bed is occupied' });

    bed.status = 'occupied';
    bed.patientId = patientId;
    bed.lastUpdated = new Date();
    await bed.save();

    await Patient.findByIdAndUpdate(patientId, {
      isAdmitted: true,
      admissionDate: new Date(),
      ward,
      bedNumber,
      status: 'admitted',
      opdIpd: 'IPD'
    });

    if (note) {
      await RoundNote.create({
        hospitalId,
        patientId,
        doctorName: 'Admitting Doctor',
        note: `Admission Note: ${note}`,
        createdAt: new Date()
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Discharge Patient
app.post('/api/ipd/discharge', async (req, res) => {
  const { patientId } = req.body;

  try {
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    if (patient.ward && patient.bedNumber) {
      await Bed.findOneAndUpdate(
        { hospitalId: patient.hospitalId, ward: patient.ward, bedNumber: patient.bedNumber },
        { status: 'cleaning', patientId: null, lastUpdated: new Date() }
      );
    }

    patient.isAdmitted = false;
    patient.dischargeDate = new Date();
    patient.status = 'completed';
    patient.opdIpd = 'OPD';
    await patient.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get/Add Round Notes
app.get('/api/ipd/rounds/:patientId', async (req, res) => {
  try {
    const notes = await RoundNote.find({ patientId: req.params.patientId }).sort({ createdAt: -1 });
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ipd/rounds', async (req, res) => {
  const { patientId, note } = req.body;
  const hospitalId = req.session.hospitalId;

  if (!hospitalId) return res.status(401).json({ error: 'Auth required' });

  try {
    const newNote = await RoundNote.create({
      hospitalId,
      patientId,
      doctorName: 'Duty Doctor', // Replace with req.session.username if available
      note,
      createdAt: new Date()
    });
    res.json({ success: true, note: newNote });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Transfer Patient Bed
app.post('/api/ipd/transfer', async (req, res) => {
  const { patientId, toWard, toBed } = req.body;
  const hospitalId = req.session.hospitalId;

  try {
    const patient = await Patient.findById(patientId);
    if (!patient || !patient.isAdmitted) return res.status(400).json({ error: 'Patient not admitted' });

    // 1. Check New Bed
    const newBed = await Bed.findOne({ hospitalId, ward: toWard, bedNumber: toBed });
    if (!newBed) return res.status(404).json({ error: 'Target bed not found' });
    if (newBed.status === 'occupied') return res.status(400).json({ error: 'Target bed occupied' });

    // 2. Clear Old Bed
    await Bed.findOneAndUpdate(
      { hospitalId, ward: patient.ward, bedNumber: patient.bedNumber },
      { status: 'cleaning', patientId: null, lastUpdated: new Date() }
    );

    // 3. Occupy New Bed
    newBed.status = 'occupied';
    newBed.patientId = patientId;
    newBed.lastUpdated = new Date();
    await newBed.save();

    // 4. Update Patient
    patient.ward = toWard;
    patient.bedNumber = toBed;
    await patient.save();

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. Add IPD Charge (Medication/Lab/Other)
app.post('/api/ipd/charges', async (req, res) => {
  const { patientId, description, amount, type } = req.body;
  try {
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    patient.ipdCharges.push({
      description,
      amount,
      type: type || 'other',
      date: new Date()
    });

    // Also update total cost if we are tracking it cumulatively
    patient.cost = (patient.cost || 0) + Number(amount);

    await patient.save();
    res.json({ success: true, charges: patient.ipdCharges });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 9. Get IPD Charges
app.get('/api/ipd/charges/:patientId', async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient.ipdCharges || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
