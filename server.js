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

// --- Database Import --- //
const {
  addClient,
  getClients,
  getClientById,
  deleteClient,
  updateClient,
  addSession,
  getSessionsByClient,
  addDocument,
  getDocumentsByClient,
  addChatMessage,
  getChatHistory,
  getStatistics
} = require("./db");

// --- CLIENTS API ROUTES --- //

// Get all clients
app.get("/api/clients", (req, res) => {
  try {
    const clients = getClients();
    console.log(`✅ Loaded ${clients.length} clients`);
    res.json(clients);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Clients:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Clients" });
  }
});

// Get single client
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

// Add new client
app.post("/api/clients", (req, res) => {
  try {
    const clientData = {
      name: req.body.initials || req.body.name, // Accept both 'initials' and 'name'
      email: req.body.email,
      phone: req.body.phone,
      birth_date: req.body.birth_date,
      address: req.body.address,
      diagnosis: req.body.diagnosis,
      notes: req.body.notes || `Therapie: ${req.body.therapy || 'Nicht angegeben'}`
    };

    if (!clientData.name) {
      return res.status(400).json({ error: "Initialen/Name ist erforderlich" });
    }

    const result = addClient(clientData);
    console.log(`✅ Client hinzugefügt: ${clientData.name}`);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("❌ Fehler beim Hinzufügen eines Clients:", err);
    res.status(500).json({ error: "Fehler beim Hinzufügen des Clients" });
  }
});

// Update client
app.put("/api/clients/:id", (req, res) => {
  try {
    const updates = req.body;
    delete updates.id; // Remove ID from updates
    
    const result = updateClient(req.params.id, updates);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Aktualisieren des Clients:", err);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Clients" });
  }
});

// Delete client
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

// --- SESSIONS API ROUTES --- //

// Add session for client
app.post("/api/sessions", (req, res) => {
  try {
    const sessionData = {
      client_id: req.body.client_id,
      date: req.body.date || new Date().toISOString().split('T')[0],
      duration: req.body.duration || 50,
      type: req.body.type || 'Einzeltherapie',
      notes: req.body.notes,
      private_notes: req.body.private_notes
    };

    const result = addSession(sessionData);
    console.log(`✅ Session hinzugefügt für Client ${sessionData.client_id}`);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("❌ Fehler beim Hinzufügen einer Session:", err);
    res.status(500).json({ error: "Fehler beim Hinzufügen der Session" });
  }
});

// Get sessions by client
app.get("/api/clients/:id/sessions", (req, res) => {
  try {
    const sessions = getSessionsByClient(req.params.id);
    res.json(sessions);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Sessions:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Sessions" });
  }
});

// --- STATISTICS ROUTE --- //
app.get("/api/stats", (req, res) => {
  try {
    const stats = getStatistics();
    
    // Add some default values if needed
    const completeStats = {
      totalClients: stats.totalClients || 0,
      totalSessions: stats.totalSessions || 0,
      pendingTodos: 0, // TODO: Implement todos table
      activePlans: stats.sessionsThisMonth > 0 ? Math.min(3, stats.totalClients) : 0
    };
    
    res.json(completeStats);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Statistiken:", err);
    res.status(500).json({ 
      totalClients: 0,
      totalSessions: 0,
      pendingTodos: 0,
      activePlans: 0
    });
  }
});

// --- FILE UPLOAD ROUTES --- //

// Handle file upload and analysis
app.post("/api/upload", upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    console.log(`📁 Datei hochgeladen: ${req.file.originalname}`);
    
    let fileContent = '';
    const filePath = req.file.path;
    
    // Extract text based on file type
    if (req.file.mimetype.startsWith('text/') || req.file.originalname.endsWith('.txt')) {
      fileContent = fs.readFileSync(filePath, 'utf8');
    } else if (req.file.originalname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: filePath });
      fileContent = result.value;
    } else if (req.file.mimetype === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      fileContent = pdfData.text;
    } else if (req.file.mimetype.startsWith('image/')) {
      fileContent = `[Bild-Datei: ${req.file.originalname}] - Bitte beschreiben Sie, was auf dem Bild zu sehen ist, damit ich es analysieren kann.`;
    }

    // Save document info to database
    const docData = {
      client_id: req.body.client_id || null,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_path: req.file.path,
      file_type: req.file.mimetype,
      file_size: req.file.size
    };
    
    addDocument(docData);
    
    // If OpenAI API key exists, analyze with AI
    let analysis = '';
    if (process.env.OPENAI_API_KEY) {
      analysis = await analyzeWithAI(fileContent, req.file.mimetype);
    } else {
      analysis = `<strong>Datei erfolgreich hochgeladen:</strong><br>
                  Name: ${req.file.originalname}<br>
                  Größe: ${(req.file.size / 1024).toFixed(2)} KB<br>
                  Typ: ${req.file.mimetype}<br><br>
                  <em>KI-Analyse nicht verfügbar (OpenAI API Key fehlt)</em><br><br>
                  Dateiinhalt (Vorschau):<br>
                  <pre>${fileContent.substring(0, 500)}${fileContent.length > 500 ? '...' : ''}</pre>`;
    }

    res.json({ 
      success: true, 
      analysis: analysis,
      file: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      }
    });

  } catch (err) {
    console.error("❌ Fehler beim Verarbeiten der Datei:", err);
    res.status(500).json({ error: "Fehler beim Verarbeiten der Datei: " + err.message });
  }
});

// --- CHAT ROUTES --- //

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, client_id, hasAttachments } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Nachricht ist erforderlich" });
    }

    console.log(`💬 Chat-Anfrage erhalten: ${message.substring(0, 50)}...`);
    
    // Save to chat history if client_id provided
    if (client_id) {
      addChatMessage({
        client_id: client_id,
        role: 'user',
        content: message
      });
    }

    let reply = '';
    
    if (process.env.OPENAI_API_KEY) {
      // Call OpenAI API
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content: "Du bist ein hilfreicher KI-Assistent für Therapeuten. Du unterstützt bei der Analyse von Therapiesitzungen, Behandlungsplanung und fachlichen Fragen. Antworte professionell, empathisch und wissenschaftlich fundiert."
              },
              {
                role: "user",
                content: message
              }
            ],
            max_tokens: 1000,
            temperature: 0.7
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || 'OpenAI API Fehler');
        }

        const data = await response.json();
        reply = data.choices[0].message.content;

      } catch (apiError) {
        console.error("❌ OpenAI API Fehler:", apiError);
        reply = generateFallbackResponse(message);
      }
    } else {
      // Fallback response when no API key
      reply = generateFallbackResponse(message);
    }

    // Save AI response to history if client_id provided
    if (client_id) {
      addChatMessage({
        client_id: client_id,
        role: 'assistant',
        content: reply
      });
    }

    res.json({ reply: reply });

  } catch (err) {
    console.error("❌ Fehler im Chat:", err);
    res.status(500).json({ 
      reply: "Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut." 
    });
  }
});

// Get chat history for a client
app.get("/api/clients/:id/chat", (req, res) => {
  try {
    const history = getChatHistory(req.params.id);
    res.json(history);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen des Chat-Verlaufs:", err);
    res.status(500).json({ error: "Fehler beim Abrufen des Chat-Verlaufs" });
  }
});

// --- HELPER FUNCTIONS --- //

// AI Analysis function
async function analyzeWithAI(content, fileType) {
  if (!process.env.OPENAI_API_KEY) {
    return `Dateiinhalt erkannt. KI-Analyse nicht verfügbar (API Key fehlt).`;
  }

  try {
    let prompt = '';
    if (fileType.startsWith('image/')) {
      prompt = `Als therapeutischer Assistent, was könnten relevante Beobachtungen zu diesem Bild sein? Hinweis: ${content}`;
    } else {
      prompt = `Bitte analysiere den folgenden Text aus therapeutischer Perspektive und gib eine strukturierte Zusammenfassung:\n\n${content.substring(0, 2000)}`;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "Du bist ein therapeutischer Assistent, der Dokumente und Bilder für Therapeuten analysiert."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.choices[0].message.content;
    } else {
      throw new Error('API Anfrage fehlgeschlagen');
    }
  } catch (error) {
    console.error('AI Analysis error:', error);
    return `Analyse konnte nicht durchgeführt werden. Fehler: ${error.message}`;
  }
}

// Generate fallback response when no API key
function generateFallbackResponse(message) {
  const lowerMessage = message.toLowerCase();
  
  // Simple keyword-based responses
  if (lowerMessage.includes('hallo') || lowerMessage.includes('hi')) {
    return `Hallo! Ich bin Ihre KI-Assistenz für therapeutische Unterstützung. 
            <br><br>
            <strong>Hinweis:</strong> Die KI-Funktionalität ist derzeit eingeschränkt, da kein OpenAI API Key konfiguriert ist. 
            <br><br>
            Trotzdem kann ich Ihnen helfen bei:
            <ul>
              <li>Verwaltung Ihrer Klient:innen</li>
              <li>Dokumentation von Sitzungen</li>
              <li>Organisation von Dateien</li>
              <li>Strukturierung Ihrer Praxisabläufe</li>
            </ul>`;
  }
  
  if (lowerMessage.includes('therapie') || lowerMessage.includes('behandlung')) {
    return `Für therapeutische Fragen stehe ich Ihnen zur Verfügung. 
            <br><br>
            Um die volle KI-Unterstützung zu aktivieren, fügen Sie bitte einen OpenAI API Key in der .env Datei hinzu.
            <br><br>
            Aktuell können Sie:
            <ul>
              <li>Klient:innen-Daten verwalten</li>
              <li>Sitzungen dokumentieren</li>
              <li>Dateien hochladen und organisieren</li>
            </ul>`;
  }
  
  if (lowerMessage.includes('hilfe') || lowerMessage.includes('help')) {
    return `<strong>Verfügbare Funktionen:</strong>
            <br><br>
            📊 <strong>Dashboard:</strong> Übersicht Ihrer Praxisstatistiken<br>
            👥 <strong>Klient:innen:</strong> Verwaltung Ihrer Patient:innen<br>
            📎 <strong>Datei-Analyse:</strong> Upload und Organisation von Dokumenten<br>
            💬 <strong>KI-Chat:</strong> Dieser Chat (eingeschränkt ohne API Key)<br>
            🔗 <strong>Integration:</strong> Verbindung zu anderen Systemen<br>
            <br>
            <em>Tipp: Fügen Sie einen OpenAI API Key hinzu für erweiterte KI-Funktionen!</em>`;
  }
  
  // Default response
  return `Vielen Dank für Ihre Nachricht. 
          <br><br>
          Die KI-Analyse ist momentan nicht verfügbar (OpenAI API Key fehlt). 
          <br><br>
          Sie können jedoch weiterhin:
          <ul>
            <li>Ihre Klient:innen-Datenbank pflegen</li>
            <li>Dokumente hochladen und verwalten</li>
            <li>Sitzungen protokollieren</li>
          </ul>
          <br>
          Ihre Nachricht wurde gespeichert und kann später analysiert werden.`;
}

// --- SERVER START --- //
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
  console.log(`📍 Öffnen Sie: http://localhost:${PORT}`);
  
  if (!process.env.OPENAI_API_KEY) {
    console.log(`⚠️  WARNUNG: Kein OpenAI API Key gefunden!`);
    console.log(`   Fügen Sie OPENAI_API_KEY in die .env Datei ein für KI-Funktionen.`);
  } else {
    console.log(`✅ OpenAI API Key gefunden - KI-Funktionen aktiv!`);
  }
});
