const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

dotenv.config();
const app = express();

app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, "public")));

// --- Multer Konfiguration für Uploads --- //
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf|doc|docx|txt|mp3|wav|m4a|ogg/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Nicht unterstützter Dateityp'));
  }
});

// --- AUDIO UPLOAD ROUTE --- //
app.post("/api/audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });

    console.log(`🎤 Audio hochgeladen: ${req.file.originalname}`);

    let transcription = "⚠️ Keine Transkription möglich (kein API Key gesetzt).";
    if (process.env.OPENAI_API_KEY) {
      const FormData = (await import('form-data')).default;
      const fileStream = fs.createReadStream(req.file.path);
      const form = new FormData();
      form.append("file", fileStream);
      form.append("model", "whisper-1");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Fehler bei OpenAI Whisper");
      }

      const data = await response.json();
      transcription = data.text;
    }

    res.json({
      success: true,
      file: {
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size
      },
      transcription
    });

  } catch (err) {
    console.error("❌ Fehler beim Audio-Upload:", err);
    res.status(500).json({ error: "Fehler: " + err.message });
  }
});

// --- SERVER START --- //
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
