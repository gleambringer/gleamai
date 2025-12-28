const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON and serve static files
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/**
 * Chat Endpoint
 * Interfaces with the Gemini API using the server-side API Key
 */
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ 
            error: "System Configuration Error: API Key missing from Gleam Core." 
        });
    }

    // Gemini 2.5 Flash Endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
    const payload = {
        contents: [{ parts: [{ text: message }] }],
        systemInstruction: { 
            parts: [{ 
                text: "You are GleamAI, a helpful, sophisticated digital guide. Your tone is professional and slightly futuristic. Ensure all responses are clean, safe, and age-appropriate for users under 18. Avoid all harmful, illegal, or suggestive topics. Focus on providing helpful information within the Gleam aesthetic." 
            }] 
        }
    };

    let attempts = 0;
    const delays = [1000, 2000, 4000, 8000, 16000];

    // Implementation of exponential backoff for API reliability
    async function callGemini() {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'API_FAILURE');
            }

            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch (error) {
            if (attempts < 5) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, delays[attempts - 1]));
                return callGemini();
            }
            throw error;
        }
    }

    try {
        const aiText = await callGemini();
        res.json({ text: aiText || "The transmission was lost in the void." });
    } catch (error) {
        res.status(500).json({ error: "Connection to the Gleam core failed after several retries." });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`GleamAI Service initialized on port ${PORT}`);
});
