import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
const PORT = process.env.PORT || 3001;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Configure Cloudinary storage for profile images
const profileImageStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ezstudy-profiles',
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
        transformation: [{ width: 200, height: 200, crop: 'fill' }]
    }
});

const uploadProfileImage = multer({ storage: profileImageStorage });

// Security headers middleware
app.use((req, res, next) => {
    // Remove manual CORS headers to let the cors middleware handle it
    // Permissive CSP for development
    res.setHeader('Content-Security-Policy', "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *");

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// Middleware
app.use(cors({
    origin: true, // Reflects the request origin, effectively allowing all origins while supporting credentials
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Simple content moderation helper (local rules)
function moderateContent(text) {
    if (!text || typeof text !== 'string') return { allowed: true };
    const lowered = text.toLowerCase();

    // Basic adult/sexual content keywords
    const adultKeywords = [
        'porn', 'sex', 'xxx', 'nude', 'naked', 'escort', 'adult', 'bdsm', 'fetish'
    ];

    // Basic illegal content keywords
    const illegalKeywords = [
        'bomb', 'explosive', 'hack bank', 'kill', 'murder', 'drugs', 'buy heroin', 'build a bomb'
    ];

    for (const k of adultKeywords) {
        if (lowered.includes(k)) return { allowed: false, reason: 'adult' };
    }
    for (const k of illegalKeywords) {
        if (lowered.includes(k)) return { allowed: false, reason: 'illegal' };
    }

    return { allowed: true };
}

// AI API utility function with fallback
async function callAIAPI(messages, config = {}, fileContext = '') {
    const googleApiKey = process.env.GOOGLE_GEMINI_API_KEY;
    const groqApiKey = process.env.GROQ_API_KEY;

    // Try Google Gemini first
    if (googleApiKey && googleApiKey !== 'your_google_gemini_api_key_here') {
        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

            // Build chat history for Gemini while preserving original roles
            // messages is expected to already contain a `system` message (with file context) as the first item
            const history = messages.slice(0, -1).map(msg => {
                // preserve `system`, `assistant`, and `user` roles
                const role = msg.role === 'system' ? 'system' : (msg.role === 'assistant' ? 'assistant' : (msg.role === 'user' ? 'user' : 'user'));
                return {
                    role,
                    parts: [{ text: msg.content }]
                };
            });

            const chat = model.startChat({
                history,
                generationConfig: {
                    temperature: config?.tone === 'creative' ? 0.9 : (config?.tone === 'precise' ? 0.3 : 0.7),
                    maxOutputTokens: 2048,
                }
            });

            const userMessage = messages[messages.length - 1].content;
            const result = await chat.sendMessage(userMessage);
            const response = result.response;
            const text = response.text();

            return {
                choices: [{
                    message: {
                        content: text,
                        role: 'assistant'
                    }
                }],
                usage: {
                    provider: 'google'
                }
            };
        } catch (error) {
            console.log('Google Gemini API failed, falling back to Groq:', error && (error.message || error.toString()));

            // Detect common auth/quota/billing HTTP codes/messages to decide fallback
            const msg = (error && (error.message || JSON.stringify(error))) || '';
            const fallbackSignals = ['api_key', 'api-key', 'quota', 'billing', '401', '403', '429', 'invalid api', 'invalid key', 'permission'];
            const shouldFallback = fallbackSignals.some(sig => msg.toLowerCase().includes(sig));

            if (!shouldFallback) {
                throw error; // Not an expected limit/auth error — surface it
            }
            // otherwise continue to Groq fallback
        }
    }

    // Fallback to Groq API
    if (!groqApiKey) {
        throw new Error('No AI API keys configured');
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqApiKey}`
        },
        body: JSON.stringify({
            messages: messages,
            model: 'llama-3.3-70b-versatile',
            temperature: config?.tone === 'creative' ? 0.9 : (config?.tone === 'precise' ? 0.3 : 0.7),
            max_tokens: 2048
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `Groq API error: ${response.status}`);
    }

    const data = await response.json();
    data.usage = { provider: 'groq' };
    return data;
}

// Health check endpoint
app.get('/', (req, res) => {
    res.send('EzStudy Backend is running! Access API at /api/health');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'EzStudy Backend is running!' });
});

// Chat completion endpoint - uses Google Gemini with Groq fallback
app.post('/api/chat', upload.array('files'), async (req, res) => {
    try {
        const messages = JSON.parse(req.body.messages || '[]');
        const userMessage = req.body.userMessage || '';
        const config = JSON.parse(req.body.config || '{}');
        const files = req.files || [];

        // Process uploaded files
        let fileContext = "";
        console.log('Chat endpoint received', files.length, 'file(s)');
        if (files && files.length > 0) {
            console.log('Uploaded files:', files.map(f => ({ originalname: f.originalname, path: f.path, mimetype: f.mimetype })));
        }
        if (files && files.length > 0) {
            fileContext = "\n\n--- Uploaded Files Context ---\n";

            for (const file of files) {
                try {
                    const fileName = file.originalname;
                    const filePath = file.path;
                    const fileType = file.mimetype;

                    fileContext += `\n[FILE: ${fileName}]\n`;

                    if (fileType.startsWith('image/')) {
                        fileContext += "[IMAGE UPLOADED - Analyze visual content, diagrams, charts, text in images]\n";
                    } else if (fileType === 'application/pdf') {
                        // Parse PDF
                        try {
                            const pdfBuffer = fs.readFileSync(filePath);
                            const pdfData = await pdfParse(pdfBuffer);
                            const pdfText = pdfData.text.substring(0, 3000);
                            fileContext += `[PDF CONTENT]:\n${pdfText}\n`;
                        } catch (pdfErr) {
                            fileContext += "[PDF FILE - Unable to parse, but available for context]\n";
                        }
                    } else if (fileType.startsWith('text/') || fileType === 'application/x-yaml' || fileType === 'application/javascript') {
                        // Read text files
                        try {
                            const textContent = fs.readFileSync(filePath, 'utf-8').substring(0, 3000);
                            fileContext += `[TEXT CONTENT]:\n${textContent}\n`;
                        } catch (textErr) {
                            fileContext += "[Text file - Unable to read]\n";
                        }
                    } else {
                        fileContext += `[${fileType} FILE]\n`;
                    }
                } catch (err) {
                    console.error(`Error processing file:`, err);
                    fileContext += `[Error processing file: ${file.originalname}]\n`;
                }
            }
            fileContext += "--- End of Files ---\n";
        }

        // Clean up uploaded files
        files.forEach(file => {
            try {
                fs.unlinkSync(file.path);
            } catch (err) {
                console.error(`Error deleting file: ${file.path}`, err);
            }
        });

        // Prepare messages for AI API
        // Add explicit study-only / safety instructions to system message
        const safetyInstructions = `\n\nSafety and scope: Only answer study-related, educational, or academic questions. If a user asks for adult, sexual, illegal, violent, or political content, refuse and respond with: "I can only help with study-related questions."`;

        // Dynamic context: current date/time/year/month and optional location/weather
        const now = new Date();
        const currentDate = now.toLocaleDateString();
        const currentTime = now.toLocaleTimeString();
        const currentYear = now.getFullYear();
        const currentMonth = now.toLocaleString('default', { month: 'long' });
        const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        // Determine location: prefer device-provided location in config.deviceContext, then config.location (string), otherwise default env var
        let locationObj = null;
        if (config && config.deviceContext && config.deviceContext.location) {
            locationObj = config.deviceContext.location; // expected { lat, lon, label }
        } else if (config && config.location) {
            locationObj = config.location; // could be string or { lat, lon }
        }
        const defaultLocation = process.env.DEFAULT_LOCATION || null;

        // Helper to fetch weather (OpenWeatherMap) if API key provided
        let weatherSummary = '';
        const weatherApiKey = process.env.WEATHER_API_KEY;
        if (weatherApiKey) {
            try {
                let weatherResp;
                if (locationObj && typeof locationObj === 'object' && locationObj.lat && locationObj.lon) {
                    // fetch by coordinates
                    weatherResp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${locationObj.lat}&lon=${locationObj.lon}&units=metric&appid=${weatherApiKey}`);
                } else if (locationObj && typeof locationObj === 'string') {
                    weatherResp = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(locationObj)}&units=metric&appid=${weatherApiKey}`);
                } else if (defaultLocation) {
                    weatherResp = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(defaultLocation)}&units=metric&appid=${weatherApiKey}`);
                }

                if (weatherResp && weatherResp.ok) {
                    const w = await weatherResp.json();
                    const desc = w.weather && w.weather[0] && w.weather[0].description ? w.weather[0].description : '';
                    const temp = w.main && w.main.temp ? `${w.main.temp}°C` : '';
                    const feels = w.main && w.main.feels_like ? `${w.main.feels_like}°C` : '';
                    const locLabel = (locationObj && locationObj.label) || (typeof locationObj === 'string' ? locationObj : (defaultLocation || `${locationObj?.lat || ''},${locationObj?.lon || ''}`));
                    weatherSummary = `${locLabel ? `Current weather in ${locLabel}: ` : 'Current weather:'}${desc}. Temperature: ${temp}. Feels like: ${feels}.`;
                } else if (weatherResp) {
                    console.log('Weather API responded with status', weatherResp.status);
                }
            } catch (werr) {
                console.log('Weather fetch failed:', werr && (werr.message || werr.toString()));
            }
        }

        const locationLabel = (locationObj && (locationObj.label || (locationObj.lat && locationObj.lon ? `${locationObj.lat},${locationObj.lon}` : null))) || defaultLocation || 'unspecified location';

        const dynamicContext = `\n\nContext: Current server date: ${currentDate}; time: ${currentTime}; year: ${currentYear}; month: ${currentMonth}; timezone: ${serverTimezone}; location: ${locationLabel}. ${weatherSummary}`;

        // Attach device-provided context if present (frontend should send config.deviceContext)
        const deviceContextBlock = (config && config.deviceContext) ? `\n\nDevice Context (from user's device): ${JSON.stringify(config.deviceContext)}` : '';

        // Explicit system instructions: allow the model to use provided device/server context for real-time answers
        const realTimeInstruction = `\n\nReal-time behavior: If the request asks for the current time, date, location, or weather, use the values provided in the Device Context above (if present). If Device Context is not provided, use the server dynamic context included in the prompt. Do NOT claim you lack access to the current time or location when this contextual information is provided. If neither source is available, say: "I don't have device or server time/location available right now."`;

        const systemMessage = {
            role: 'system',
            content: `You are EzStudy AI, a ${config?.personality || 'friendly'} ${config?.mode || 'tutor'}.
    Your tone should be ${config?.tone || 'balanced'}.
    ${config?.mode === 'tutor' ? 'Focus on explaining concepts clearly and asking guiding questions.' : ''}
    ${config?.mode === 'summarizer' ? 'Focus on condensing information into high-impact bullet points.' : ''}
    ${config?.mode === 'examiner' ? 'Focus on testing the user knowledge and providing critical feedback.' : ''}
    ${fileContext ? `Files have been uploaded. Please carefully read and analyze their content when answering the user's questions. Use specific information from the files.${fileContext}` : ''}
    Provide answers in clear markdown format.${safetyInstructions}${dynamicContext}${deviceContextBlock}${realTimeInstruction}`
        };

        const apiMessages = [systemMessage, ...messages, { role: 'user', content: userMessage }];

        // Moderate user message and file context before calling AI
        const userCheck = moderateContent(userMessage || apiMessages.map(m => m.content).join('\n'));
        if (!userCheck.allowed) {
            return res.status(400).json({ error: 'Request blocked: content not allowed', reason: userCheck.reason });
        }

        // Call AI API with fallback
        const data = await callAIAPI(apiMessages, config, fileContext);
        res.json(data);

    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Generate quiz endpoint
app.post('/api/quiz', async (req, res) => {
    try {
        const { topic, difficulty } = req.body;

        const messages = [
            {
                role: 'system',
                content: 'You are a quiz generator. Generate exactly 5 multiple choice questions in JSON format. Return ONLY valid JSON array with no markdown or explanation.'
            },
            {
                role: 'user',
                content: `Generate 5 ${difficulty || 'medium'} difficulty quiz questions about: ${topic}. Format as JSON array: [{"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}]`
            }
        ];

        // Moderate input topic/text before calling AI
        const mod = moderateContent(topic || '');
        if (!mod.allowed) {
            return res.status(400).json({ error: 'Request blocked: content not allowed', reason: mod.reason });
        }

        const data = await callAIAPI(messages);
        const content = data.choices[0]?.message?.content || '[]';

        // Try to parse JSON from response
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            const questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
            res.json({ questions });
        } catch (parseError) {
            res.json({ questions: [], raw: content });
        }

    } catch (error) {
        console.error('Quiz API Error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Generate notes/summary endpoint
app.post('/api/summarize', async (req, res) => {
    try {
        const { text, style } = req.body;

        const messages = [
            {
                role: 'system',
                content: `You are a study notes generator. Create ${style || 'bullet point'} style notes that are clear and easy to study from.`
            },
            {
                role: 'user',
                content: `Create study notes from the following content:\n\n${text}`
            }
        ];

        const data = await callAIAPI(messages);
        res.json({
            notes: data.choices[0]?.message?.content || 'Could not generate notes.'
        });

    } catch (error) {
        console.error('Summarize API Error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Profile image upload endpoint
app.post('/api/upload-profile-image', uploadProfileImage.single('profileImage'), (req, res) => {
    console.log('Profile image upload request received');
    console.log('File:', req.file);
    console.log('Body:', req.body);

    try {
        if (!req.file) {
            console.log('No file uploaded');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('File uploaded successfully:', req.file);

        // Return the Cloudinary URL
        const imageUrl = req.file.path;
        console.log('Image URL:', imageUrl);

        res.json({
            success: true,
            imageUrl: imageUrl,
            message: 'Profile image uploaded successfully'
        });
    } catch (error) {
        console.error('Profile image upload error:', error);
        res.status(500).json({ error: 'Failed to upload profile image' });
    }
});

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

app.listen(PORT, () => {
    console.log(`🚀 EzStudy Backend running on http://localhost:${PORT}`);
    console.log(`📚 API endpoints:`);
    console.log(`   GET  /api/health - Health check`);
    console.log(`   POST /api/chat   - Chat with AI`);
    console.log(`   POST /api/quiz   - Generate quiz`);
    console.log(`   POST /api/summarize - Generate notes`);
    console.log(`   POST /api/upload-profile-image - Upload profile image`);
});
