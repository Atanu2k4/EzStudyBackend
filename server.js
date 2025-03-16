import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import multer from "multer";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";

dotenv.config();
const app = express();
const port = 5000;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cors());

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// Function to extract text from PDF
async function extractTextFromPDF(pdfPath) {
    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    } catch (error) {
        console.error("Error extracting PDF text:", error);
        throw error;
    }
}

// Function to read file content based on type
async function readFileContent(filePath) {
    const fileExtension = path.extname(filePath).toLowerCase();

    if (fileExtension === '.pdf') {
        return await extractTextFromPDF(filePath);
    } else {
        // For text files, read directly
        return fs.readFileSync(filePath, "utf-8");
    }
}

// AI Chat Route
app.post("/ask", async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    try {
        const response = await axios.post(
            "https://api.together.xyz/v1/chat/completions",
            {
                model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
                messages: [{ role: "user", content: query }],
                max_tokens: 8192,
                stream: false,
                temperature: 0.7,
                top_k: 50,
                top_p: 0.95
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.TOGETHER_API_KEY?.trim()}`,
                    "Content-Type": "application/json"
                },
                timeout: 180000
            }
        );

        const responseContent = response.data.choices[0]?.message?.content || "No response";

        return res.json({ response: responseContent });
    } catch (error) {
        console.error("❌ Together AI API Error:", error.message);
        return res.status(500).json({ error: "Failed to fetch response from Together AI" });
    }
});

// File Upload Route (Summarization)
app.post("/upload", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
        // Read file content based on file type
        const fileContent = await readFileContent(req.file.path);

        // Truncate large files for processing
        const maxInputLength = 65000;
        let truncatedContent = fileContent.length > maxInputLength
            ? fileContent.substring(0, maxInputLength)
            : fileContent;

        console.log(`Processing file: ${req.file.originalname} (${truncatedContent.length} chars)`);

        const response = await axios.post(
            "https://api.together.xyz/v1/chat/completions",
            {
                model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
                messages: [{ role: "user", content: `Summarize this document in detail:\n\n${truncatedContent}` }],
                max_tokens: 8192,
                stream: false,
                temperature: 0.7,
                top_k: 50,
                top_p: 0.95
            },
            {
                headers: { "Authorization": `Bearer ${process.env.TOGETHER_API_KEY?.trim()}`, "Content-Type": "application/json" },
                timeout: 300000
            }
        );

        const summary = response.data.choices[0]?.message?.content || "No summary available";

        fs.unlinkSync(req.file.path); // Delete original file after processing

        return res.json({ summary });
    } catch (error) {
        console.error("❌ Error processing file:", error.message);
        return res.status(500).json({ error: "Failed to process file", details: error.message });
    }
});

// Start the server
app.listen(port, () => console.log(`🚀 Server running on http://localhost:${port}`));
