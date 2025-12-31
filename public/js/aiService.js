// AI Service for MedFlow Pro
// Handles interactions with the backend AI endpoints

const AIService = {
    /**
     * Generate clinical suggestions based on context
     * @param {string} prompt - The prompt to send to the AI
     * @param {string} type - 'prescription', 'summary', or 'chat'
     * @returns {Promise<string>}
     */
    async generate(prompt, type = 'chat') {
        try {
            const response = await fetch('/api/ai/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, type })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'AI generation failed');
            }

            const data = await response.json();
            return data.result;
        } catch (error) {
            console.error('AI Service Error:', error);
            return 'AI Service Unavailable: ' + error.message;
        }
    },

    /**
     * Suggest prescription based on diagnosis
     * @param {string} diagnosis 
     */
    async suggestPrescription(diagnosis) {
        if (!diagnosis) return "Please enter a diagnosis first.";

        const prompt = `Based on the following diagnosis, suggest a standard prescription with dosage and duration. Format as a clear list. Diagnosis: ${diagnosis}`;
        return this.generate(prompt, 'prescription');
    },

    /**
     * Summarize patient history
     * @param {object} patient 
     */
    async summarizeHistory(patient) {
        const history = patient.history ? JSON.parse(patient.history) : [];
        if (history.length === 0) return "No medical history available to summarize.";

        const prompt = `Summarize the following patient history into a concise clinical overview: ${JSON.stringify(history)}`;
        return this.generate(prompt, 'summary');
    }
};

window.AIService = AIService;
