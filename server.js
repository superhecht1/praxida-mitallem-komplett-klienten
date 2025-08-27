const db = require("./db");
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();

// ======== OPENAI KEY DIREKT HIER ========
const OPENAI_API_KEY = "sk-XXXXXXXXXXXXXXXXXXXXXXXX"; // <-- DEIN PERSÖNLICHER KEY
// ========================================

if (!OPENAI_API_KEY || OPENAI_API_KEY.trim() === "") {
    console.error("❌ Kein OpenAI API Key definiert. Bitte Key einfügen.");
    process.exit(1);
}

// Multer Configuration
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

// ======= LOGIN =========
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (username === "demo" && password === "praxida2024") {
        res.json({ 
            success: true, 
            user: { username: "demo", displayName: "Demo User", initials: "DU", role: "therapist" }
        });
    } else res.status(401).json({ success: false, message: "Ungültige Anmeldedaten" });
});

// ======= CHAT ENDPOINT =========
app.post("/api/chat", async (req, res) => {
    try {
        const { message, hasAttachments = false } = req.body;
        if (!message || message.trim() === '') return res.status(400).json({ reply: "Bitte geben Sie eine Nachricht ein." });

        const systemPrompt = `Du bist eine erfahrene, DSGVO-konforme KI-Assistenz für Psychotherapeut:innen in Deutschland. 
- Antworte immer auf Deutsch
- Verwende evidenzbasierte therapeutische Ansätze
- Beziehe dich auf deutsche Leitlinien und ICD-11
- Betone, dass du die professionelle Einschätzung des Therapeuten nicht ersetzt
- Sei praxisnah
- Nutze Emojis zur Strukturierung
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

// ======= FILE UPLOAD ENDPOINT =========
app.post("/api/upload", upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });

    const file = req.file;
    const filePath = file.path;

    let analysisPrompt = "";

    if (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt')) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            analysisPrompt = `Analysiere diesen Text aus therapeutischer Sicht:\n${fileContent.substring(0, 3000)}`;
        } catch {
            analysisPrompt = `Textdatei "${file.originalname}" konnte nicht gelesen werden.`;
        }
    } else {
        analysisPrompt = `Datei "${file.originalname}" (${file.mimetype}) hochgeladen. Gib therapeutische Hinweise.`;
    }

    let analysis = "";

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Du bist ein KI-Assistent für Psychotherapeut:innen. Analysiere Inhalte strukturiert auf Deutsch." },
                    { role: "user", content: analysisPrompt }
                ],
                max_tokens: 1200,
                temperature: 0.6
            })
        });

        const aiData = await response.json();
        analysis = aiData.choices[0]?.message?.content || "Keine Analyse erhalten.";

    } catch (err) {
        console.warn("⚠️ Datei-Analyse Fehler:", err.message);
        analysis = "Fehler bei der Analyse durch OpenAI.";
    }

    // Cleanup
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
        success: true,
        filename: file.originalname,
        analysis,
        fileType: file.mimetype,
        size: file.size
    });
});

// ======= CLIENT ENDPOINTS =========
// Alle Clients abrufen
app.get("/api/clients", (req, res) => {
  try { res.json(db.prepare("SELECT * FROM clients").all()); } 
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Neuen Client anlegen
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

// Client bearbeiten
app.put("/api/clients/:id", (req, res) => {
  try {
    const { initials, diagnosis, therapy, sessions, lastSession } = req.body;
    const info = db.prepare(`
      UPDATE clients SET initials=?, diagnosis=?, therapy=?, sessions=?, lastSession=? WHERE id=?
    `).run(initials, diagnosis, therapy, sessions, lastSession, req.params.id);
    res.json({ updated: info.changes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Client löschen
app.delete("/api/clients/:id", (req, res) => {
  try {
    const info = db.prepare("DELETE FROM clients WHERE id=?").run(req.params.id);
    res.json({ deleted: info.changes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======= HEALTH CHECK =========
app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        services: { openai: true, uploads: fs.existsSync('uploads'), static: fs.existsSync('public') },
        mode: "AI-powered"
    });
});

// ======= SERVER START =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server gestartet auf http://localhost:${PORT}`);
    if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
});
