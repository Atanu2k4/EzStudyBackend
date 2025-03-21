import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import Groq from "groq-sdk";

dotenv.config();
const app = express();
const port = 5000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(cors());

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "/uploads"),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// Store chat history per session
const chatHistory = {};

// Function to extract text from PDFs
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

// Read file content based on extension
async function readFileContent(filePath) {
  const fileExtension = path.extname(filePath).toLowerCase();
  return fileExtension === ".pdf"
    ? await extractTextFromPDF(filePath)
    : fs.readFileSync(filePath, "utf-8");
}

// 🔹 AI Chat Route (Handles both normal chat and file-related queries)
app.post("/ask", async (req, res) => {
  const { query, sessionId } = req.body;
  if (!query) return res.status(400).json({ error: "Query is required" });

  // Retrieve chat history
  chatHistory[sessionId] = chatHistory[sessionId] || [];
  chatHistory[sessionId].push({ role: "user", content: query });

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are a helpful AI assistant." },
        ...chatHistory[sessionId], // Maintain context across queries
      ],
    });

    const responseContent =
      response.choices[0]?.message?.content || "No response";
    chatHistory[sessionId].push({
      role: "assistant",
      content: responseContent,
    });

    return res.json({ response: responseContent });
  } catch (error) {
    console.error("❌ Groq AI API Error:", error.message);
    return res
      .status(500)
      .json({ error: "Failed to fetch response from Groq AI" });
  }
});

// 🔹 File Upload Route (Summarization + File Memory)
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const sessionId = req.body.sessionId || "default";
  try {
    const fileContent = await readFileContent(req.file.path);
    const truncatedContent = fileContent.substring(0, 65000); // Limit input size

    console.log(
      `Processing file: ${req.file.originalname} (${truncatedContent.length} chars)`
    );

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are an AI that summarizes documents." },
        {
          role: "user",
          content: `Summarize this document:\n\n${truncatedContent}`,
        },
      ],
    });

    const summary =
      response.choices[0]?.message?.content || "No summary available";

    // Store file content in chat history
    chatHistory[sessionId] = chatHistory[sessionId] || [];
    chatHistory[sessionId].push({
      role: "system",
      content: `User uploaded a file: ${req.file.originalname}. Content:\n\n${truncatedContent}`,
    });

    fs.unlinkSync(req.file.path); // Delete file after processing

    return res.json({ summary });
  } catch (error) {
    console.error("❌ Error processing file:", error.message);
    return res
      .status(500)
      .json({ error: "Failed to process file", details: error.message });
  }
});

// Start Server
app.listen(port, () =>
  console.log(`🚀 Server running on http://localhost:${port}`)
);
