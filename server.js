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

// Uploads directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log("📁 Upload-Ordner erstellt");
}

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
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
      name: req.body.initials || req.body.name,
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
    delete updates.id;
    
    const result = updateClient(req.params.id, updates);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    console.log(`✅ Client aktualisiert: ID ${req.params.id}`);
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
    console.log(`✅ Client gelöscht: ID ${req.params.id}`);
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
    
    const completeStats = {
      totalClients: stats.totalClients || 0,
      totalSessions: stats.totalSessions || 0,
      pendingTodos: 0, // TODO: Implement todos table
      activePlans: stats.sessionsThisMonth > 0 ? Math.min(3, stats.totalClients) : 0
    };
    
    console.log("📊 Statistiken abgerufen:", completeStats);
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

    console.log(`📁 Datei hochgeladen: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);
    
    let fileContent = '';
    const filePath = req.file.path;
    
    // Extract text based on file type
    try {
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
        fileContent = `[Bild-Datei: ${req.file.originalname}] - Bilderkennung verfügbar mit OpenAI Vision API.`;
      }
    } catch (extractError) {
      console.error("❌ Fehler beim Extrahieren des Dateiinhalts:", extractError);
      fileContent = `Fehler beim Lesen der Datei: ${extractError.message}`;
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
    
    try {
      addDocument(docData);
      console.log("✅ Dokument in Datenbank gespeichert");
    } catch (dbError) {
      console.error("❌ Fehler beim Speichern in Datenbank:", dbError);
    }
    
    // Analyze with AI if API key is available
    let analysis = '';
    if (process.env.OPENAI_API_KEY && fileContent.trim()) {
      analysis = await analyzeWithAI(fileContent, req.file.mimetype);
    } else {
      analysis = generateFileAnalysisFallback(req.file, fileContent);
    }

    res.json({ 
      success: true, 
      analysis: analysis,
      file: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        content: fileContent.substring(0, 1000) + (fileContent.length > 1000 ? '...' : '')
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

    console.log(`💬 Chat-Anfrage erhalten: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
    
    // Save to chat history if client_id provided
    if (client_id) {
      try {
        addChatMessage({
          client_id: client_id,
          role: 'user',
          content: message
        });
      } catch (dbError) {
        console.error("❌ Fehler beim Speichern der User-Nachricht:", dbError);
      }
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
                content: "Du bist ein hilfreicher KI-Assistent für Therapeuten. Du unterstützt bei der Analyse von Therapiesitzungen, Behandlungsplanung und fachlichen Fragen. Antworte professionell, empathisch und wissenschaftlich fundiert. Halte dich an die deutschen Therapierichtlinien und DSGVO-Bestimmungen."
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
          throw new Error(error.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        reply = data.choices[0].message.content;
        console.log("✅ OpenAI Antwort erhalten");

      } catch (apiError) {
        console.error("❌ OpenAI API Fehler:", apiError.message);
        reply = generateFallbackResponse(message);
      }
    } else {
      // Fallback response when no API key
      reply = generateFallbackResponse(message);
    }

    // Save AI response to history if client_id provided
    if (client_id) {
      try {
        addChatMessage({
          client_id: client_id,
          role: 'assistant',
          content: reply
        });
      } catch (dbError) {
        console.error("❌ Fehler beim Speichern der AI-Antwort:", dbError);
      }
    }

    res.json({ reply: reply });

  } catch (err) {
    console.error("❌ Fehler im Chat:", err);
    res.status(500).json({ 
      reply: "Entschuldigung, es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es in einem Moment erneut." 
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

// Get documents for a client
app.get("/api/clients/:id/documents", (req, res) => {
  try {
    const documents = getDocumentsByClient(req.params.id);
    res.json(documents);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Dokumente:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Dokumente" });
  }
});

// --- HELPER FUNCTIONS --- //

// AI Analysis function
async function analyzeWithAI(content, fileType) {
  if (!process.env.OPENAI_API_KEY) {
    return generateFileAnalysisFallback(null, content);
  }

  try {
    let prompt = '';
    if (fileType.startsWith('image/')) {
      prompt = `Als therapeutischer Assistent, analysiere bitte dieses Bild aus klinischer Perspektive. Was könnten relevante therapeutische Beobachtungen sein? Hinweis: ${content}`;
    } else {
      prompt = `Bitte analysiere den folgenden Text aus therapeutischer und klinischer Perspektive:

${content.substring(0, 3000)}

Gib eine strukturierte Analyse mit folgenden Punkten:
- Hauptthemen und Inhalte
- Mögliche therapeutische Relevanz
- Empfehlungen für die weitere Bearbeitung
- Wichtige Aspekte für die Dokumentation`;
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
            content: "Du bist ein therapeutischer Assistent, der Dokumente und Bilder für Therapeuten analysiert. Sei professionell, empathisch und halte dich an therapeutische Standards."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 800,
        temperature: 0.6
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API Error: ${response.status}`);
    }

    const data = await response.json();
    return `<div class="ai-analysis">
              <h4>🤖 KI-Analyse</h4>
              ${data.choices[0].message.content.replace(/\n/g, '<br>')}
            </div>`;
  } catch (error) {
    console.error('❌ AI Analysis error:', error);
    return `<div class="analysis-error">
              <h4>⚠️ KI-Analyse nicht verfügbar</h4>
              <p>Fehler: ${error.message}</p>
              <p>Die Datei wurde dennoch erfolgreich hochgeladen und gespeichert.</p>
            </div>`;
  }
}

// Generate fallback response for file analysis
function generateFileAnalysisFallback(file, content) {
  return `<div class="file-analysis-fallback">
            <h4>📁 Datei erfolgreich verarbeitet</h4>
            ${file ? `
            <p><strong>Dateiname:</strong> ${file.originalname}<br>
            <strong>Größe:</strong> ${(file.size / 1024).toFixed(2)} KB<br>
            <strong>Typ:</strong> ${file.mimetype}</p>
            ` : ''}
            
            <h5>📄 Extrahierter Inhalt:</h5>
            <div style="background: #f8f9ff; padding: 15px; border-radius: 8px; border-left: 4px solid #667eea; max-height: 200px; overflow-y: auto;">
              <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${content.substring(0, 1000)}${content.length > 1000 ? '\n\n... (Inhalt gekürzt)' : ''}</pre>
            </div>
            
            <div style="background: #fff3cd; padding: 12px; border-radius: 8px; margin-top: 15px; border: 1px solid #ffeaa7;">
              <strong>💡 Hinweis:</strong> Für KI-gestützte Analyse fügen Sie einen OpenAI API Key in die .env Datei ein:<br>
              <code>OPENAI_API_KEY=sk-...</code>
            </div>
          </div>`;
}

// Generate fallback response when no API key
function generateFallbackResponse(message) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('hallo') || lowerMessage.includes('hi')) {
    return `<div class="chat-response">
              <h4>👋 Hallo!</h4>
              <p>Ich bin Ihre KI-Assistenz für therapeutische Unterstützung.</p>
              
              <div class="feature-info">
                <strong>✅ Verfügbare Funktionen:</strong>
                <ul>
                  <li>📊 Klient:innen-Verwaltung</li>
                  <li>📁 Datei-Upload und -Organisation</li>
                  <li>📝 Sitzungsdokumentation</li>
                  <li>📈 Statistiken und Berichte</li>
                </ul>
              </div>
              
              <div class="api-info">
                <strong>🤖 KI-Funktionen:</strong> Derzeit eingeschränkt verfügbar<br>
                <small>Für erweiterte KI-Analyse fügen Sie einen OpenAI API Key hinzu</small>
              </div>
            </div>`;
  }
  
  if (lowerMessage.includes('therapie') || lowerMessage.includes('behandlung')) {
    return `<div class="chat-response">
              <h4>🎯 Therapeutische Unterstützung</h4>
              <p>Gerne helfe ich Ihnen bei therapeutischen Fragen und der Praxisorganisation.</p>
              
              <strong>Verfügbare Bereiche:</strong>
              <ul>
                <li><strong>Dokumentation:</strong> Strukturierte Erfassung von Sitzungen</li>
                <li><strong>Klient:innen-Verwaltung:</strong> Übersicht und Verlaufsdokumentation</li>
                <li><strong>Datei-Analyse:</strong> Upload und Organisation von Dokumenten</li>
                <li><strong>Statistiken:</strong> Auswertungen Ihrer Praxistätigkeit</li>
              </ul>
              
              <div class="upgrade-hint">
                💡 <strong>Tipp:</strong> Mit OpenAI API Key erhalten Sie erweiterte KI-Funktionen wie:
                <ul>
                  <li>Intelligente Textanalyse</li>
                  <li>Therapieplan-Vorschläge</li>
                  <li>Automatische Zusammenfassungen</li>
                </ul>
              </div>
            </div>`;
  }
  
  if (lowerMessage.includes('hilfe') || lowerMessage.includes('help')) {
    return `<div class="chat-response">
              <h4>🆘 Hilfe & Übersicht</h4>
              
              <div class="help-sections">
                <div class="help-section">
                  <strong>📊 Dashboard:</strong> Übersicht Ihrer Praxisstatistiken und aktuelle Zahlen
                </div>
                <div class="help-section">
                  <strong>👥 Klient:innen:</strong> Verwaltung Ihrer Patient:innen mit Verlaufsdokumentation
                </div>
                <div class="help-section">
                  <strong>📁 Datei-Analyse:</strong> Upload und Verarbeitung von Dokumenten, Bildern, PDFs
                </div>
                <div class="help-section">
                  <strong>💬 KI-Chat:</strong> Intelligente Unterstützung (erweitert mit API Key)
                </div>
                <div class="help-section">
                  <strong>🔗 Integration:</strong> Anbindung an Praxisverwaltung und andere Systeme
                </div>
              </div>
              
              <div class="quick-tips">
                <strong>🚀 Schnellstart:</strong>
                <ol>
                  <li>Fügen Sie Ihre ersten Klient:innen hinzu</li>
                  <li>Laden Sie Dokumente hoch zur Organisation</li>
                  <li>Nutzen Sie den Chat für Fragen</li>
                  <li>Prüfen Sie die Statistiken im Dashboard</li>
                </ol>
              </div>
            </div>`;
  }
  
  // Default response
  return `<div class="chat-response">
            <h4>💬 Nachricht erhalten</h4>
            <p>Vielen Dank für Ihre Nachricht. Ich stehe Ihnen gerne zur Verfügung!</p>
            
            <div class="current-status">
              <strong>🔧 Aktueller Status:</strong>
              <ul>
                <li>✅ Klient:innen-Verwaltung aktiv</li>
                <li>✅ Datei-Upload funktionsfähig</li>
                <li>✅ Datenbank-Integration läuft</li>
                <li>⏳ KI-Analyse eingeschränkt (kein API Key)</li>
              </ul>
            </div>
            
            <div class="suggestions">
              <strong>💡 Vorschläge:</strong>
              <ul>
                <li>Verwalten Sie Ihre Klient:innen im entsprechenden Bereich</li>
                <li>Laden Sie Dokumente zur Analyse hoch</li>
                <li>Erkunden Sie die verschiedenen Funktionsbereiche</li>
              </ul>
            </div>
            
            <p><small>Ihre Nachricht wurde gespeichert und kann bei Bedarf später ausgewertet werden.</small></p>
          </div>`;
}

// --- ERROR HANDLERS --- //

// Handle multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Datei zu groß (max. 10MB)' });
    }
  }
  if (error.message === 'Nicht unterstützter Dateityp') {
    return res.status(400).json({ error: 'Nicht unterstützter Dateityp' });
  }
  next(error);
});

// General error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Fehler:', err);
  res.status(500).json({ error: 'Interner Server-Fehler' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint nicht gefunden' });
});

// --- SERVER START --- //
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Praxida 2.0 Server gestartet`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📊 Umgebung: ${process.env.NODE_ENV || 'development'}`);
  
  if (!process.env.OPENAI_API_KEY) {
    console.log(`\n⚠️  WARNUNG: Kein OpenAI API Key gefunden!`);
    console.log(`   KI-Funktionen sind eingeschränkt verfügbar.`);
    console.log(`   Fügen Sie OPENAI_API_KEY=sk-... in die .env Datei ein.`);
  } else {
    console.log(`✅ OpenAI API Key gefunden - Vollständige KI-Funktionen aktiv!`);
  }
  
  console.log(`\n📁 Uploads: ${uploadDir}`);
  console.log(`💾 Datenbank: SQLite (siehe db.js)`);
  console.log(`\n🎯 Bereit für Anfragen!\n`);
});