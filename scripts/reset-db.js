const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Explicitly load models to ensure schemas are registered
const {
    Patient,
    Appointment,
    PharmacyOrder,
    LabTest,
    LabResult,
    Bed,
    RoundNote,
    IPDMedication,
    PharmacyBill,
    User,
    Hospital
} = require('../database');

const resetData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/medflow');
        console.log('Connected to MongoDB...');

        console.log('Clearing Patients...');
        await Patient.deleteMany({});

        console.log('Clearing Appointments...');
        await Appointment.deleteMany({});

        console.log('Clearing Pharmacy Orders...');
        await PharmacyOrder.deleteMany({});

        console.log('Clearing Pharmacy Bills...');
        await PharmacyBill.deleteMany({});

        console.log('Clearing Lab Tests...');
        await LabTest.deleteMany({});

        console.log('Clearing Lab Results...');
        await LabResult.deleteMany({});

        console.log('Clearing Round Notes...');
        await RoundNote.deleteMany({});

        console.log('Clearing IPD Medications...');
        await IPDMedication.deleteMany({});

        console.log('Resetting Bed Status...');
        // Instead of deleting beds (which are hospital infrastructure), reset them to 'available'
        await Bed.updateMany({}, { status: 'available', patientId: null });

        // Optional: Clear Users/Hospitals?
        // IF USER WANTS "FROM SCRATCH", they probably want to Register a Hospital again.
        // Uncomment below to wipe EVERYTHING.
        // console.log('Clearing Users & Hospitals...');
        // await User.deleteMany({});
        // await Hospital.deleteMany({});

        console.log('-----------------------------------');
        console.log('✅ DATA CLEARED SUCCESSFULLY!');
        console.log('   - Patients: 0');
        console.log('   - Queue: 0');
        console.log('   - Orders: 0');
        console.log('   - Beds: All Available');
        console.log('-----------------------------------');

        process.exit(0);
    } catch (err) {
        console.error('Error clearing data:', err);
        process.exit(1);
    }
};

resetData();
