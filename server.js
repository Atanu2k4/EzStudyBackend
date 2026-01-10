import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

dotenv.config();

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

// Security headers middleware
app.use((req, res, next) => {
    // Allow requests from frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Permissive CSP for development
    res.setHeader('Content-Security-Policy', "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:");

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177', 'http://localhost:5178', 'http://localhost:5179', 'http://localhost:5180', 'http://localhost:5181'],
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'EzStudy Backend is running!' });
});

// Chat completion endpoint - proxies to Groq API
app.post('/api/chat', upload.array('files'), async (req, res) => {
    try {
        const messages = JSON.parse(req.body.messages || '[]');
        const userMessage = req.body.userMessage || '';
        const config = JSON.parse(req.body.config || '{}');
        const files = req.files || [];

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Groq API key not configured on server' });
        }

        // Process uploaded files
        let fileContext = "";
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

        // Construct system prompt based on config
        const systemPrompt = `You are EzStudy AI, a ${config?.personality || 'friendly'} ${config?.mode || 'tutor'}. 
Your tone should be ${config?.tone || 'balanced'}. 
${config?.mode === 'tutor' ? 'Focus on explaining concepts clearly and asking guiding questions.' : ''}
${config?.mode === 'summarizer' ? 'Focus on condensing information into high-impact bullet points.' : ''}
${config?.mode === 'examiner' ? 'Focus on testing the user knowledge and providing critical feedback.' : ''}
${fileContext ? `Files have been uploaded. Please carefully read and analyze their content when answering the user's questions. Use specific information from the files.${fileContext}` : ''}
Provide answers in clear markdown format.`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages,
                    { role: 'user', content: userMessage }
                ],
                model: 'llama-3.3-70b-versatile',
                temperature: config?.tone === 'creative' ? 0.9 : (config?.tone === 'precise' ? 0.3 : 0.7),
                max_tokens: 2048
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            return res.status(response.status).json({
                error: errorData.error?.message || `Groq API error: ${response.status}`
            });
        }

        const data = await response.json();
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

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Groq API key not configured on server' });
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'system',
                        content: 'You are a quiz generator. Generate exactly 5 multiple choice questions in JSON format. Return ONLY valid JSON array with no markdown or explanation.'
                    },
                    {
                        role: 'user',
                        content: `Generate 5 ${difficulty || 'medium'} difficulty quiz questions about: ${topic}. Format as JSON array: [{"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}]`
                    }
                ],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.7,
                max_tokens: 2048
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            return res.status(response.status).json({
                error: errorData.error?.message || `Groq API error: ${response.status}`
            });
        }

        const data = await response.json();
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

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Groq API key not configured on server' });
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'system',
                        content: `You are a study notes generator. Create ${style || 'bullet point'} style notes that are clear and easy to study from.`
                    },
                    {
                        role: 'user',
                        content: `Create study notes from the following content:\n\n${text}`
                    }
                ],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.5,
                max_tokens: 2048
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            return res.status(response.status).json({
                error: errorData.error?.message || `Groq API error: ${response.status}`
            });
        }

        const data = await response.json();
        res.json({
            notes: data.choices[0]?.message?.content || 'Could not generate notes.'
        });

    } catch (error) {
        console.error('Summarize API Error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Profile image upload endpoint
app.post('/api/upload-profile-image', upload.single('profileImage'), (req, res) => {
    console.log('Profile image upload request received');
    console.log('File:', req.file);
    console.log('Body:', req.body);

    try {
        if (!req.file) {
            console.log('No file uploaded');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('File uploaded successfully:', req.file.filename);

        // Return the file path that can be accessed by the frontend
        const imageUrl = `/uploads/${req.file.filename}`;
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
