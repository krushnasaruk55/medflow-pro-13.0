const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

// --- Schemas ---

const HospitalSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: String,
  address: String,
  subscriptionStatus: { type: String, default: 'active' },
  subscriptionExpiry: String,
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const UserSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  username: { type: String, required: true },
  email: String,
  role: { type: String, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });
// Compound index for unique username per hospital
UserSchema.index({ hospitalId: 1, username: 1 }, { unique: true });

const PatientSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  token: Number, // Keeping as Number for token display logic if needed, or could be String
  publicToken: String,
  name: String,
  age: Number,
  gender: String,
  phone: String,
  address: String,
  bloodGroup: String,
  emergencyContact: String,
  emergencyPhone: String,
  insuranceId: String,
  medicalHistory: String,
  allergies: String,
  chronicConditions: String,
  patientType: String,
  opdIpd: String,
  department: String,
  doctorId: Number, // Keeping as Number to match static doctors array in server.js
  reason: String,
  status: String,
  registeredAt: { type: Date, default: Date.now },
  appointmentDate: String,
  vitals: String, // JSON string in SQLite, can be Object here but keeping String for minimal refactor
  prescription: String, // JSON string
  diagnosis: String,
  pharmacyState: String,
  history: String, // JSON string
  cost: { type: Number, default: 0 },
  reports: String, // JSON string
  followUpDate: String, // YYYY-MM-DD
  isAdmitted: { type: Boolean, default: false },
  admissionDate: Date,
  dischargeDate: Date,
  ward: String,
  bedNumber: String,
  dischargeNote: String, // IPD Discharge Summary
  dischargeAdvice: String,
  followUpDate: String, // YYYY-MM-DD
  password: String, // For patient app login
  ipdCharges: [{ // For IPD Billing
    description: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    type: String // 'pharmacy', 'lab', 'room', 'other'
  }]
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const VitalSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  bloodPressure: String,
  temperature: Number,
  pulse: Number,
  oxygenSaturation: Number,
  weight: Number,
  height: Number,
  recordedAt: { type: Date, default: Date.now },
  recordedBy: String
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const LabTestSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  testName: String,
  testType: String,
  orderedBy: String,
  orderedAt: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' },
  result: String, // Summary result
  resultDate: Date,
  priority: { type: String, default: 'normal' },
  sampleStatus: { type: String, default: 'pending' },
  technicianId: Number,
  machineId: String,
  sampleCollectedAt: Date,
  sampleCollectedBy: String,
  rejectionReason: String,
  startedAt: Date,
  completedAt: Date
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const LabResultSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest', required: true },
  parameterName: { type: String, required: true },
  value: String,
  unit: String,
  referenceRange: String,
  isAbnormal: { type: Boolean, default: false },
  notes: String
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const InventorySchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  medicationName: String,
  batchNumber: String,
  quantity: Number,
  unitPrice: Number,
  expiryDate: String,
  manufacturer: String,
  category: String,
  minLevel: { type: Number, default: 10 },
  addedAt: { type: Date, default: Date.now },
  lastUpdated: Date
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const AppointmentSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  patientName: String,
  phone: String,
  department: String,
  doctorId: Number,
  appointmentDate: String,
  appointmentTime: String,
  type: { type: String, default: 'offline' }, // 'offline' or 'online'
  videoLink: String,
  status: { type: String, default: 'scheduled' },
  notes: String,
  createdAt: { type: Date, default: Date.now }
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const PharmacyOrderSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  patientName: String,
  phone: String,
  prescription: String, // Text or Medication List
  status: { type: String, default: 'pending' }, // pending, accepted, ready, completed
  totalAmount: Number,
  orderDate: { type: Date, default: Date.now }
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const LabInventorySchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  itemName: { type: String, required: true },
  batchNumber: String,
  quantity: { type: Number, default: 0 },
  unit: String,
  expiryDate: String,
  minLevel: { type: Number, default: 10 },
  status: { type: String, default: 'ok' },
  addedAt: { type: Date, default: Date.now },
  updatedAt: Date
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const LabTestTypeSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  name: { type: String, required: true },
  category: String,
  parameters: String, // JSON
  price: { type: Number, default: 0 },
  turnaroundTime: Number
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const PrescriptionTemplateSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, unique: true },
  templateName: { type: String, default: 'Default Template' },
  hospitalName: String,
  hospitalAddress: String,
  hospitalPhone: String,
  hospitalEmail: String,
  hospitalLogo: String,
  doctorNamePosition: { type: String, default: 'top-left' },
  headerText: String,
  footerText: String,
  showQRCode: { type: Boolean, default: true },
  showWatermark: { type: Boolean, default: false },
  watermarkText: String,
  fontSize: { type: Number, default: 12 },
  fontFamily: { type: String, default: 'Helvetica' },
  primaryColor: { type: String, default: '#0EA5E9' },
  secondaryColor: { type: String, default: '#666666' },
  paperSize: { type: String, default: 'A4' },
  marginTop: { type: Number, default: 50 },
  marginBottom: { type: Number, default: 50 },
  marginLeft: { type: Number, default: 50 },
  marginRight: { type: Number, default: 50 },
  showLetterhead: { type: Boolean, default: true },
  showVitals: { type: Boolean, default: true },
  showDiagnosis: { type: Boolean, default: true },
  showHistory: { type: Boolean, default: true },
  layoutStyle: { type: String, default: 'classic' },
  doctorSignature: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const PharmacyBillSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' }, // Optional (for guest)
  patientName: { type: String, required: true },
  phone: String,
  items: [{
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
    itemName: String,
    batch: String,
    quantity: Number,
    unitPrice: Number,
    amount: Number
  }],
  subtotal: Number,
  tax: Number,
  discount: Number,
  totalAmount: Number,
  paymentMethod: { type: String, default: 'Cash' },
  billDate: { type: Date, default: Date.now }
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const BedSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  ward: { type: String, required: true },
  bedNumber: { type: String, required: true },
  type: { type: String, default: 'General' }, // General, ICU, Private
  status: { type: String, default: 'available' }, // available, occupied, cleaning, maintenance
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' }, // If occupied
  lastUpdated: { type: Date, default: Date.now }
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });
// Ensure unique bed number per ward per hospital
BedSchema.index({ hospitalId: 1, ward: 1, bedNumber: 1 }, { unique: true });

const RoundNoteSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  doctorName: String,
  note: String,
  createdAt: { type: Date, default: Date.now }
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

const IPDMedicationSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  drugName: { type: String, required: true },
  dosage: String, // e.g. 500mg
  route: String, // e.g. Oral, IV, IM
  frequency: String, // e.g. BD, TID
  instructions: String, // e.g. After food
  startDate: { type: Date, default: Date.now },
  endDate: Date,
  isStopped: { type: Boolean, default: false },
  stoppedAt: Date,
  doctorName: String
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

// --- Models ---
const Hospital = mongoose.model('Hospital', HospitalSchema);
const User = mongoose.model('User', UserSchema);
const Patient = mongoose.model('Patient', PatientSchema);
const Vital = mongoose.model('Vital', VitalSchema);
const LabTest = mongoose.model('LabTest', LabTestSchema);
const LabResult = mongoose.model('LabResult', LabResultSchema);
const Inventory = mongoose.model('Inventory', InventorySchema);
const Appointment = mongoose.model('Appointment', AppointmentSchema);
const PharmacyOrder = mongoose.model('PharmacyOrder', PharmacyOrderSchema);
const LabInventory = mongoose.model('LabInventory', LabInventorySchema);
const LabTestType = mongoose.model('LabTestType', LabTestTypeSchema);
const PrescriptionTemplate = mongoose.model('PrescriptionTemplate', PrescriptionTemplateSchema);
const PharmacyBill = mongoose.model('PharmacyBill', PharmacyBillSchema);
const Bed = mongoose.model('Bed', BedSchema);
const RoundNote = mongoose.model('RoundNote', RoundNoteSchema);
const IPDMedication = mongoose.model('IPDMedication', IPDMedicationSchema);

module.exports = {
  connectDB,
  Hospital,
  User,
  Patient,
  Vital,
  LabTest,
  LabResult,
  Inventory,
  Appointment,
  PharmacyOrder,
  LabInventory,
  LabTestType,
  PrescriptionTemplate,
  PharmacyBill,
  Bed,
  IPDMedication,
  RoundNote
};
