import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { v2 as cloudinary } from 'cloudinary';
import multerStorageCloudinary from 'multer-storage-cloudinary';
import { MongoClient, ObjectId } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'EzStudyDB';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

let mongoClient = null;
let usersCollection = null;
let chatsCollection = null;

const googleAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

const parseObjectId = (value) => {
    try {
        if (!value || !ObjectId.isValid(value)) return null;
        return new ObjectId(value);
    } catch (error) {
        return null;
    }
};

const maskEmail = (email) => {
    try {
        const normalized = normalizeEmail(email);
        const [local, domain] = normalized.split('@');
        const localMasked = local.length > 1 ? `${local[0]}***` : '***';
        const domainParts = domain ? domain.split('.') : [];
        const domainMasked = domainParts.length ? `${domainParts[0][0]}***.${domainParts.slice(1).join('.')}` : '***';
        return `${localMasked}@${domainMasked}`;
    } catch (error) {
        return '***@***.***';
    }
};

const decodeJwtWithoutVerification = (token) => {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map((char) => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`)
                .join('')
        );
        return JSON.parse(jsonPayload);
    } catch (error) {
        return null;
    }
};

const serializeUser = (userDoc) => {
    if (!userDoc) return null;

    return {
        id: userDoc._id?.toString?.() || userDoc.id,
        name: userDoc.name || '',
        email: userDoc.emailLower || userDoc.email || '',
        emailMasked: maskEmail(userDoc.emailLower || userDoc.email || ''),
        provider: userDoc.provider || (Array.isArray(userDoc.authMethods) && userDoc.authMethods.includes('google') ? 'google' : 'local'),
        authMethods: userDoc.authMethods || [],
        profileImage: userDoc.profileImage || null,
        createdAt: userDoc.createdAt || null,
        lastLoginAt: userDoc.lastLoginAt || null,
        activeChatId: userDoc.activeChatId || null,
    };
};

const normalizeMessage = (message) => ({
    id: message.id || Date.now(),
    sender: message.sender === 'user' ? 'user' : 'ai',
    text: message.text || '',
    timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
});

const serializeChat = (chatDoc) => ({
    id: chatDoc.chatId,
    title: chatDoc.title || 'New Study Session',
    preview: chatDoc.preview || 'Ready to help you excel!',
    date: chatDoc.date || chatDoc.updatedAt || new Date(),
    isActive: Boolean(chatDoc.isActive),
    messages: Array.isArray(chatDoc.messages) ? chatDoc.messages.map(normalizeMessage) : [],
    createdAt: chatDoc.createdAt || null,
    updatedAt: chatDoc.updatedAt || null,
});

const initializeMongo = async () => {
    if (!MONGODB_URI) {
        console.warn('MONGODB_URI is not set. MongoDB persistence endpoints will return 503 until configured.');
        return false;
    }

    try {
        mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();

        const db = mongoClient.db(MONGODB_DB_NAME);
        usersCollection = db.collection('users');
        chatsCollection = db.collection('chats');

        await usersCollection.createIndex({ emailLower: 1 }, { unique: true });
        await chatsCollection.createIndex({ userId: 1, chatId: 1 }, { unique: true });
        await chatsCollection.createIndex({ userId: 1, updatedAt: -1 });

        console.log(`MongoDB connected using database: ${MONGODB_DB_NAME}`);
        return true;
    } catch (error) {
        console.error('MongoDB initialization failed:', error);
        usersCollection = null;
        chatsCollection = null;
        return false;
    }
};

const mongoReadyPromise = initializeMongo();

const ensureMongoReady = async (res) => {
    await mongoReadyPromise;
    if (!usersCollection || !chatsCollection) {
        res.status(503).json({ error: 'MongoDB Atlas is not configured or unavailable on the backend' });
        return false;
    }
    return true;
};

const findUserByEmail = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    return usersCollection.findOne({ emailLower: normalizedEmail });
};

const syncChatsForUser = async (userId, chats) => {
    const now = new Date();
    const chatIds = chats.map((chat) => chat.id);

    if (chatIds.length === 0) {
        await chatsCollection.deleteMany({ userId });
        return;
    }

    for (const chat of chats) {
        const normalizedMessages = Array.isArray(chat.messages) ? chat.messages.map(normalizeMessage) : [];
        await chatsCollection.updateOne(
            { userId, chatId: chat.id },
            {
                $set: {
                    userId,
                    chatId: chat.id,
                    title: chat.title || 'New Study Session',
                    preview: chat.preview || 'Ready to help you excel!',
                    date: chat.date ? new Date(chat.date) : now,
                    isActive: Boolean(chat.isActive),
                    messages: normalizedMessages,
                    updatedAt: now,
                },
                $setOnInsert: {
                    createdAt: chat.createdAt ? new Date(chat.createdAt) : now,
                },
            },
            { upsert: true }
        );
    }

    await chatsCollection.deleteMany({ userId, chatId: { $nin: chatIds } });
};

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
const PORT = process.env.PORT || 3001;
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://ezstudyai.vercel.app',
    'http://localhost:5178',
    'http://localhost:5180',
].filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        // Allow non-browser tools/calls without Origin, and configured frontend origins.
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With'],
};

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
const profileImageStorage = multerStorageCloudinary({
    cloudinary: cloudinary,
    folder: 'ezstudy-profiles',
    allowedFormats: ['jpg', 'jpeg', 'png', 'gif'],
    transformation: [{ width: 200, height: 200, crop: 'fill' }]
});

const uploadProfileImage = multer({ storage: profileImageStorage });

// Security headers middleware
app.use((req, res, next) => {
    // Keep CSP permissive for current app behavior.
    res.setHeader('Content-Security-Policy', "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *");

    next();
});

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
    res.send('EzStudy Backend is running! Access API at /api/health');
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'EzStudy Backend is running!',
        mongodb: usersCollection && chatsCollection ? 'connected' : 'not-connected'
    });
});

app.post('/api/auth/signup', async (req, res) => {
    try {
        if (!await ensureMongoReady(res)) return;

        const { name, email, passwordHash } = req.body || {};
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || !passwordHash) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const existingUser = await findUserByEmail(normalizedEmail);
        if (existingUser) {
            return res.status(409).json({ error: 'User already exists with this email' });
        }

        const now = new Date();
        const userDoc = {
            name: name?.trim() || normalizedEmail.split('@')[0] || 'User',
            email: normalizedEmail,
            emailLower: normalizedEmail,
            passwordHash,
            authMethods: ['local'],
            provider: 'local',
            profileImage: null,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
            signInCount: 1,
            activeChatId: null,
        };

        const result = await usersCollection.insertOne(userDoc);
        const savedUser = await usersCollection.findOne({ _id: result.insertedId });

        return res.status(201).json({ user: serializeUser(savedUser) });
    } catch (error) {
        console.error('Signup error:', error);
        if (error.code === 11000) {
            return res.status(409).json({ error: 'User already exists with this email' });
        }
        res.status(500).json({ error: error.message || 'Signup failed' });
    }
});

app.post('/api/auth/signin', async (req, res) => {
    try {
        if (!await ensureMongoReady(res)) return;

        const { email, passwordHash } = req.body || {};
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || !passwordHash) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await usersCollection.findOne({ emailLower: normalizedEmail, passwordHash });
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const now = new Date();
        await usersCollection.updateOne(
            { _id: user._id },
            {
                $set: {
                    lastLoginAt: now,
                    updatedAt: now,
                },
                $addToSet: { authMethods: 'local' },
                $inc: { signInCount: 1 },
            }
        );

        const refreshedUser = await usersCollection.findOne({ _id: user._id });
        return res.json({ user: serializeUser(refreshedUser) });
    } catch (error) {
        console.error('Signin error:', error);
        res.status(500).json({ error: error.message || 'Signin failed' });
    }
});

app.post('/api/auth/google', async (req, res) => {
    try {
        if (!await ensureMongoReady(res)) return;

        const { credential, profile } = req.body || {};
        let payload = profile || null;

        if (credential) {
            if (googleAuthClient) {
                const ticket = await googleAuthClient.verifyIdToken({
                    idToken: credential,
                    audience: GOOGLE_CLIENT_ID,
                });
                payload = ticket.getPayload();
            } else {
                payload = decodeJwtWithoutVerification(credential);
            }
        }

        if (!payload?.email) {
            return res.status(400).json({ error: 'Unable to read Google account details' });
        }

        const normalizedEmail = normalizeEmail(payload.email);
        const now = new Date();
        const updateDoc = {
            $set: {
                name: payload.name || payload.given_name || normalizedEmail.split('@')[0] || 'Google User',
                email: normalizedEmail,
                emailLower: normalizedEmail,
                googleSub: payload.sub || null,
                profileImage: payload.picture || null,
                provider: 'google',
                lastLoginAt: now,
                updatedAt: now,
            },
            $setOnInsert: {
                createdAt: now,
                passwordHash: null,
                activeChatId: null,
                signInCount: 0,
            },
            $addToSet: { authMethods: 'google' },
            $inc: { signInCount: 1 },
        };

        const result = await usersCollection.findOneAndUpdate(
            { emailLower: normalizedEmail },
            updateDoc,
            { upsert: true, returnDocument: 'after' }
        );

        return res.json({ user: serializeUser(result.value) });
    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ error: error.message || 'Google authentication failed' });
    }
});

app.get('/api/chats/:userId', async (req, res) => {
    try {
        if (!await ensureMongoReady(res)) return;

        const userObjectId = parseObjectId(req.params.userId);
        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        const user = await usersCollection.findOne({ _id: userObjectId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const chats = await chatsCollection.find({ userId: userObjectId.toString() }).sort({ updatedAt: -1 }).toArray();

        res.json({
            chats: chats.map(serializeChat),
            activeChatId: user.activeChatId || null,
        });
    } catch (error) {
        console.error('Fetch chats error:', error);
        res.status(500).json({ error: error.message || 'Failed to load chats' });
    }
});

app.put('/api/chats/:userId', async (req, res) => {
    try {
        if (!await ensureMongoReady(res)) return;

        const userObjectId = parseObjectId(req.params.userId);
        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        const { chats = [], activeChatId = null } = req.body || {};
        if (!Array.isArray(chats)) {
            return res.status(400).json({ error: 'Chats must be an array' });
        }

        await syncChatsForUser(userObjectId.toString(), chats);

        await usersCollection.updateOne(
            { _id: userObjectId },
            {
                $set: {
                    activeChatId,
                    updatedAt: new Date(),
                },
            }
        );

        res.json({
            success: true,
            chats: chats.map(serializeChat),
            activeChatId,
        });
    } catch (error) {
        console.error('Save chats error:', error);
        res.status(500).json({ error: error.message || 'Failed to save chats' });
    }
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
