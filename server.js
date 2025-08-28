const db = require("./db");
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

dotenv.config();

const app = express();

// Debug: API Key Check
console.log("🔍 DEBUG INFO:");
console.log("OpenAI API Key vorhanden:", !!process.env.OPENAI_API_KEY);
console.log("API Key Länge:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0);

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
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
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Nicht unterstützter Dateityp'));
        }
    }
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

// --- Clients API Routes --- //
const {
  addClient,
  getClients,
  getClientById,
  deleteClient,
  updateClientSessions
} = require("./db");

// Alle Clients abrufen
app.get("/api/clients", (req, res) => {
  try {
    const clients = getClients();
    res.json(clients);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Clients:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Clients" });
  }
});

// Einzelnen Client abrufen
app.get("/api/clients/:id", (req, res) => {
  try {
    const client = getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: "Client nicht gefunden" });
    res.json(client);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen eines Clients:", err);
    res.status(500).json({ error: "Fehler beim Abrufen des Clients" });
  }
});

// Neuen Client hinzufügen
app.post("/api/clients", (req, res) => {
  try {
    const { name, diagnosis, sessions = 0, last_session = null } = req.body;
    if (!name) return res.status(400).json({ error: "Name ist erforderlich" });

    const result = addClient(name, diagnosis, sessions, last_session);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("❌ Fehler beim Hinzufügen eines Clients:", err);
    res.status(500).json({ error: "Fehler beim Hinzufügen des Clients" });
  }
});

// Client löschen
app.delete("/api/clients/:id", (req, res) => {
  try {
    const result = deleteClient(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Löschen eines Clients:", err);
    res.status(500).json({ error: "Fehler beim Löschen des Clients" });
  }
});

// Client-Sitzungen aktualisieren
app.put("/api/clients/:id/sessions", (req, res) => {
  try {
    const { sessions, last_session } = req.body;
    const result = updateClientSessions(req.params.id, sessions, last_session);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Aktualisieren der Sessions:", err);
    res.status(500).json({ error: "Fehler beim Aktualisieren der Sessions" });
  }
});

// --- Bestehende Endpunkte (Login, Chat, Upload) bleiben wie sie sind --- //
// TODO: hier dein bisheriger Chat-/Upload-Code einfügen

// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
