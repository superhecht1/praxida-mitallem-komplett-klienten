const db = require("./db");
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

// Zusätzliche Packages für Datei-Analyse
const pdfParse = require('pdf-parse');
const docxParser = require('docx-parser'); // alternativ mammoth

const app = express();

// ======== OPENAI KEY DIREKT HIER ========
const OPENAI_API_KEY = "sk-XXXXXXXXXXXXXXXXXXXXXXXX"; // <-- DEIN PERSÖNLICHER KEY
// ========================================

if (!OPENAI_API_KEY || OPENAI_API_KEY.trim() === "") {
    console.error("❌ Kein OpenAI API Key definiert. Bitte Key einfügen.");
    process.exit(1);
}

// ===== Multer Configuration =====
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
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|txt/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        cb(mimetype && extname ? null : new Error('Nicht unterstützter Dateityp'));
    }
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

// ===== LOGIN =====
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (username === "demo" && password === "praxida2024") {
        res.json({ 
            success: true, 
            user: { username: "demo", displayName: "Demo User", initials: "DU", role: "therapist" }
        });
    } else res.status(401).json({ success: false, message: "Ungültige Anmeldedaten" });
});

// ===== CHAT ENDPOINT =====
app.post("/api/chat", async (req, res) => {
    try {
        const { message, hasAttachments = false } = req.body;
        if (!message || message.trim() === '') return res.status(400).json({ reply: "Bitte geben Sie eine Nachricht ein." });

        const systemPrompt = `Du bist eine erfahrene, DSGVO-konforme KI-Assistenz für Psychotherapeut:innen in Deutschland. 
- Antworte auf Deutsch
- Evidenzbasierte therapeutische Ansätze
- Beziehe dich auf deutsche Leitlinien und ICD-11
- Betone, dass du die professionelle Einschätzung des Therapeuten nicht ersetzt
- Sei praxisnah
- Nutze Emojis
- Gib konkrete Handlungsempfehlungen`;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                max_tokens: 1500,
                temperature: 0.7
            })
        });

        if (!response.ok) throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`);
        const data = await response.json();
        const reply = data.choices[0]?.message?.content || "Keine Antwort von OpenAI erhalten.";
        res.json({ reply });

    } catch (err) {
        console.error("❌ Chat Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ===== FILE UPLOAD ENDPOINT (Text, PDF, Word, Bilder) =====
app.post("/api/upload", upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });

    const file = req.file;
    const filePath = file.path;
    let analysisPrompt = "";

    try {
        if (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt')) {
            const content = fs.readFileSync(filePath, 'utf8');
            analysisPrompt = `Analysiere diesen Text aus therapeutischer Sicht und gib praxisnahe Empfehlungen:\n${content.substring(0, 3000)}`;
        }
        else if (file.mimetype === 'application/pdf') {
            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);
            analysisPrompt = `Analysiere diesen PDF-Inhalt aus therapeutischer Sicht:\n${data.text.substring(0, 3000)}`;
        }
        else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                 file.mimetype === 'application/msword') {
            const text = await new Promise((resolve, reject) => {
                docxParser.parseDocx(filePath, (data) => resolve(data), (err) => reject(err));
            });
            analysisPrompt = `Analysiere diesen Word-Dokument Inhalt aus therapeutischer Sicht:\n${text.substring(0, 3000)}`;
        }
        else if (file.mimetype.startsWith('image/')) {
            analysisPrompt = `Ein Bild "${file.originalname}" wurde hochgeladen. Gib therapeutische Hinweise, wie es in Sitzungen genutzt werden kann, auf Deutsch, strukturiert nach:
1. Mögliche Relevanz
2. Beobachtbare Elemente
3. Integration in Therapie
4. Dokumentation & Datenschutz`;
        }
        else {
            analysisPrompt = `Eine Datei "${file.originalname}" (${file.mimetype}) wurde hochgeladen. Gib therapeutische Hinweise, wie man sie nutzen könnte.`;
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Du bist ein KI-Assistent für Psychotherapeut:innen. Analysiere Inhalte strukturiert auf Deutsch und gib praxisnahe Empfehlungen." },
                    { role: "user", content: analysisPrompt }
                ],
                max_tokens: 1500,
                temperature: 0.6
            })
        });

        const aiData = await response.json();
        const analysis = aiData.choices[0]?.message?.content || "Keine Analyse erhalten.";

        try { fs.unlinkSync(filePath); } catch {}

        res.json({
            success: true,
            filename: file.originalname,
            fileType: file.mimetype,
            size: file.size,
            analysis
        });

    } catch (err) {
        console.error("❌ Upload / Analyse Error:", err);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ error: "Fehler bei der Datei-Analyse: " + err.message });
    }
});

// ===== CLIENT ENDPOINTS =====
app.get("/api/clients", (req, res) => {
  try { res.json(db.prepare("SELECT * FROM clients").all()); } 
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/clients", (req, res) => {
  try {
    const { initials, diagnosis, therapy, sessions, lastSession } = req.body;
    const info = db.prepare(`
      INSERT INTO clients (initials, diagnosis, therapy, sessions, lastSession)
      VALUES (?, ?, ?, ?, ?)
    `).run(initials, diagnosis, therapy, sessions || 0, lastSession || new Date().toISOString().split("T")[0]);
    res.json({ id: info.lastInsertRowid, initials, diagnosis, therapy, sessions, lastSession });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/clients/:id", (req, res) => {
  try {
    const { initials, diagnosis, therapy, sessions, lastSession } = req.body;
    const info = db.prepare(`
      UPDATE clients SET initials=?, diagnosis=?, therapy=?, sessions=?, lastSession=? WHERE id=?
    `).run(initials, diagnosis, therapy, sessions, lastSession, req.params.id);
    res.json({ updated: info.changes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/clients/:id", (req, res) => {
  try {
    const info = db.prepare(`DELETE FROM clients WHERE id=?`).run(req.params.id);
    res.json({ deleted: info.changes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== HEALTH CHECK =====
app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        services: { openai: !!OPENAI_API_KEY, uploads: fs.existsSync('uploads'), static: fs.existsSync('public') },
        mode: "AI-powered"
    });
});

// ===== ERROR HANDLING =====
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') 
        return res.status(400).json({ error: 'Datei zu groß (max. 10MB)' });
    console.error('Server Error:', error);
    res.status(500).json({ error: error.message });
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint nicht gefunden' }));

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 PRAXIDA 2.0 SERVER GESTARTET auf Port ${PORT}`);
    if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
});
