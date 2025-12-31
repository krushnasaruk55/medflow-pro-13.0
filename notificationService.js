const twilio = require('twilio');

const sendNotification = async (to, message, type = 'sms') => {
    if (!to || !message) return;

    // 1. Log to Console (Always active for debugging)
    console.log(`\n--- 📨 ${type.toUpperCase()} LOG ---`);
    console.log(`To: ${to}`);
    console.log(`Message: "${message}"`);
    console.log('---------------------------\n');

    // 2. Real Sending Logic (Active if keys exist)
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
        try {
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

            if (type === 'whatsapp') {
                if (process.env.TWILIO_WHATSAPP_NUMBER) {
                    await client.messages.create({
                        body: message,
                        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
                        to: `whatsapp:${to}`
                    });
                    console.log('✅ WhatsApp sent via Twilio');
                } else {
                    console.log('⚠️ TWILIO_WHATSAPP_NUMBER missing');
                }
            } else {
                await client.messages.create({
                    body: message,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: to
                });
                console.log('✅ SMS sent via Twilio');
            }

        } catch (error) {
            console.error('❌ Failed to send notification:', error.message);
        }
    } else {
        console.log('ℹ️ Real sending skipped. Add TWILIO_ keys to .env to enable.');
    }
};

const sendFollowUpReminder = async (patient, doctorName) => {
    const message = `Hello ${patient.name}, Dr. ${doctorName} has scheduled your follow-up visit on ${patient.followUpDate}. Please visit MedFlow Hospital.`;
    await sendNotification(patient.phone, message, 'sms');
};

const sendAppointmentConfirmation = async (patient) => {
    const message = `Welcome to MedFlow, ${patient.name}. Your registration is confirmed. Token: #${patient.token}. Please wait for your turn.`;
    await sendNotification(patient.phone, message, 'sms');
};

const sendPrescriptionReady = async (patient, link) => {
    const message = `Hello ${patient.name}, your prescription is ready. View it here: ${link}`;
    await sendNotification(patient.phone, message, 'whatsapp'); // Prefer WhatsApp for links
};

const sendLabResultReady = async (patient, testName) => {
    const message = `MedFlow: Your lab report for ${testName} is now ready. Please collect it from the counter or view online.`;
    await sendNotification(patient.phone, message, 'sms');
};

module.exports = {
    sendNotification,
    sendFollowUpReminder,
    sendAppointmentConfirmation,
    sendPrescriptionReady,
    sendLabResultReady
};
