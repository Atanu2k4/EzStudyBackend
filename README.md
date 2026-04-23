# EzStudy Backend 🚀

```text
               ┌───────────────────────────────────────────────────────────────┐
               │                                                               │
               │  ███████╗███████╗███████╗████████╗██╗   ██╗██████╗ ██╗   ██╗  │
               │  ██╔════╝╚══███╔╝██╔════╝╚══██╔══╝██║   ██║██╔══██╗╚██╗ ██╔╝  │
               │  █████╗    ███╔╝ ███████╗   ██║   ██║   ██║██║  ██║ ╚████╔╝   │
               │  ██╔══╝   ███╔╝  ╚════██║   ██║   ██║   ██║██║  ██║  ╚██╔╝    │
               │  ███████╗███████╗███████║   ██║   ╚██████╔╝██████╔╝   ██║     │
               │  ╚══════╝╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚═════╝    ╚═╝     │
               │                                                               │
               │     AI-Powered Study Assistant with Chat, Notes & Quiz        │
               │                                                               │
               └───────────────────────────────────────────────────────────────┘
```

The backend component of EzStudy, built with Express.js, providing AI integration, file processing, and API services for the learning platform.

## 📋 Overview

EzStudy Backend is a robust Express.js server that handles:
- 🤖 AI chat completions via Google Gemini (primary) with Groq fallback
- 📤 File upload and processing (PDFs, images, text files)
- 🔐 API routing and CORS management
- 📊 Data processing and response formatting
- 🗃️ MongoDB Atlas persistence for users and chat history

## 🛠️ Tech Stack

- 🚀 **Express.js** with CORS support
- 📤 **Multer** for file upload handling
- 📕 **PDF-parse** for PDF text extraction
- 🧠 **Groq API** integration for AI chat completions
- 🍃 **MongoDB Node Driver** for Atlas persistence
- 🔧 **ESM modules** for modern JavaScript

## 📁 Project Structure

```
EzStudyBackend/
├── server.js              # 🖥️ Main Express server file
├── package.json           # 📦 Dependencies and scripts
├── .env                   # 🔑 Environment variables
├── .gitignore             # 🚫 Git ignore rules
├── uploads/               # 📁 Temporary file storage (cleaned after processing)
└── node_modules/          # 📦 Installed dependencies
```

## 🚀 Getting Started

### Prerequisites
- 🟢 Node.js (Latest LTS version recommended)
- 📦 npm

### Installation

1. **Navigate to backend directory:**
   ```bash
   cd EzStudyBackend
   ```

2. **Install dependencies:**
   ```bash
   npm install --legacy-peer-deps
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory. Required and optional variables:
   ```env
   # Required for AI functionality (fallback provider)
   GROQ_API_KEY=your_groq_api_key_here
   MONGODB_URI=your_mongodb_atlas_connection_string
   MONGODB_DB_NAME=EzStudyDB
   GOOGLE_CLIENT_ID=your_google_oauth_client_id
   PORT=3001
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

The server will start on `http://localhost:3001`

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GROQ_API_KEY` | Your Groq API key for AI chat completions | ✅ |
| `MONGODB_URI` | MongoDB Atlas connection string for EzStudy data | ✅ |
| `MONGODB_DB_NAME` | Separate database name for this project (defaults to `EzStudyDB`) | ❌ |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for Google sign-in verification | ✅ for Google auth |
| `PORT` | Server port (default: 3001) | ❌ |

### Getting API Keys

#### Groq API Key (Required)
1. Visit [Groq Console](https://console.groq.com/)
2. Sign up for an account
3. Generate an API key
4. Add it to your `.env` file as `GROQ_API_KEY`

#### Google Gemini API Key (Optional - for primary AI responses)
1. Visit [Google AI Studio](https://aistudio.google.com/)
2. Sign in with your Google account
3. Create a new API key
4. Add it to your `.env` file as `GOOGLE_GEMINI_API_KEY`

**Note:** If Google Gemini API key is not provided, the system will use Groq as the primary API. When Google Gemini API expires or reaches quota limits, it automatically falls back to Groq.

## 📡 API Endpoints

### Chat API
- **POST** `/api/chat` - Process chat messages with AI
  - Supports file uploads (PDFs, images, text)
  - Returns formatted AI responses with markdown support

### Authentication API
- **POST** `/api/auth/signup` - Store a manual sign-up in MongoDB
- **POST** `/api/auth/signin` - Validate a manual sign-in against MongoDB
- **POST** `/api/auth/google` - Verify and store a Google sign-in / sign-up in MongoDB

### Chat Persistence API
- **GET** `/api/chats/:userId` - Load all saved chats for a user
- **PUT** `/api/chats/:userId` - Replace a user's saved chat history

### Quiz API
- **POST** `/api/quiz` - Generate quiz questions
  - Creates multiple choice questions based on topics

## 🔧 Available Scripts

- `npm start` - Start the production server
- `npm run dev` - Start with auto-restart (if nodemon is configured)

### AI Integration

The backend supports a dual-provider setup with automatic switching:

- Primary: Google Gemini (used when `GOOGLE_GEMINI_API_KEY` is configured)
- Fallback: Groq (used when Gemini is not configured or when Gemini returns auth/quota/billing errors)

Automatic API switching is handled server-side so the frontend experiences a seamless service.

### AI Features
- 📝 Contextual chat responses
- 📄 Document analysis and summarization
- 🖼️ Image content analysis
- 📊 Educational content generation
- **Markdown Formatting**: AI responses include proper formatting
- **File Context**: Uploaded files are analyzed and included in responses
- **Personality Modes**: Tutor, Summarizer, and Examiner modes
- **Tone Control**: Creative, Balanced, or Precise response styles

## 📁 File Processing

### Supported Formats
- 📕 **PDF files**: Text extraction and analysis
- 🖼️ **Images**: Content description and analysis
- 📄 **Text files**: Direct content reading
- 🎥 **Video files**: Description support

### Upload Process
1. Files are temporarily stored in `uploads/` directory
2. Content is extracted and analyzed
3. Files are automatically cleaned up after processing
4. Context is provided to AI for relevant responses

## 🔒 Security Features

- ✅ **CORS protection** with specific origin allowlist
- ✅ **File type validation** for uploads
- ✅ **Request size limits** to prevent abuse
- ✅ **Environment variable protection** for sensitive data

## 🐛 Error Handling

The server includes comprehensive error handling for:
- API key validation
- File processing errors
- Network timeouts
- Invalid requests

## 📊 Logging

- Console logging for server events
- Error logging with detailed stack traces
- File upload/delete operation logging

## 🤝 Integration with Frontend

Integration notes for local development:

- Frontend recommended dev port: `5178` (Vite) and backend default port: `3001`.
- Use `VITE_BACKEND_URL` in frontend `.env` to point to the backend (e.g. `http://localhost:3001`).
- Authentication in the sample frontend uses a local `AuthModal` (credentials are hashed client-side and only masked user info is stored in `localStorage`).
- File uploads use `multipart/form-data` and are cleaned up server-side after processing.

## 🚀 Deployment

### Environment Setup
- Set `NODE_ENV=production`
- Configure production database if needed
- Set up proper file storage (AWS S3, etc.)
- Configure domain allowlist for CORS

### Production Considerations
- Use process manager (PM2, etc.)
- Set up reverse proxy (nginx)
- Configure SSL certificates
- Monitor server performance

## 🐛 Troubleshooting

### Common Issues

**Server won't start:**
- Check if port 3001 is available
- Verify `.env` file exists with correct API key
- Ensure all dependencies are installed with `npm install --legacy-peer-deps`
- Check for dependency conflicts and use `--legacy-peer-deps` if needed

**File upload fails:**
- Check file size limits
- Verify supported file types
- Check uploads directory permissions

**AI responses not working:**
- Verify Groq API key is valid (required)
- Check Google Gemini API key if using primary service
- Check internet connection
- Review API rate limits
- System automatically falls back to Groq if Gemini fails

## 📈 Performance

- ⚡ Fast file processing with streaming
- 🚀 Efficient memory usage
- 📊 Optimized API response times
- 🔄 Automatic cleanup of temporary files

## 🤝 Contributing

1. Follow the existing code style
2. Add proper error handling
3. Update documentation for new features
4. Test thoroughly before submitting PRs

---

Built with ❤️ for the EzStudy learning platform. Updated as of January 21, 2026.