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

// Enhanced Multer Configuration for Audio & Files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = req.path.includes('audio') ? 'uploads/audio/' : 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
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
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for audio files
    fileFilter: (req, file, cb) => {
        if (req.path.includes('audio')) {
            // Audio files for Whisper
            const audioTypes = /mp3|wav|m4a|ogg|flac|webm|mp4/;
            const extname = audioTypes.test(path.extname(file.originalname).toLowerCase());
            const mimetype = file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/');
            
            if (mimetype && extname) {
                return cb(null, true);
            } else {
                cb(new Error('Nur Audio-Dateien erlaubt (MP3, WAV, M4A, OGG, FLAC)'));
            }
        } else {
            // Regular files
            const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|txt/;
            const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
            const mimetype = allowedTypes.test(file.mimetype);
            
            if (mimetype && extname) {
                return cb(null, true);
            } else {
                cb(new Error('Nicht unterstützter Dateityp'));
            }
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

// --- ENHANCED AI FUNCTIONS --- //

async function callOpenAI(messages, model = "gpt-3.5-turbo") {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API Key nicht konfiguriert');
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 2000,
                temperature: 0.7,
                presence_penalty: 0.1,
                frequency_penalty: 0.1
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `OpenAI API Fehler: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('❌ OpenAI API Fehler:', error);
        throw error;
    }
}

async function transcribeAudio(audioFilePath) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API Key nicht konfiguriert');
    }

    try {
        const FormData = require('form-data');
        const form = new FormData();
        
        form.append('file', fs.createReadStream(audioFilePath));
        form.append('model', 'whisper-1');
        form.append('language', 'de'); // German
        form.append('response_format', 'json');
        form.append('temperature', '0');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                ...form.getHeaders()
            },
            body: form
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `Whisper API Fehler: ${response.status}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error('❌ Whisper API Fehler:', error);
        throw error;
    }
}

async function analyzeTherapyText(text, analysisType = 'general') {
    const systemPrompts = {
        general: `Du bist ein erfahrener Psychotherapeut und Supervisor. Analysiere den folgenden Therapie-Text und erstelle eine strukturierte Zusammenfassung.

Fokussiere auf:
- Hauptthemen und Problembereiche
- Emotionale Zustände und Stimmung
- Fortschritte oder Rückschritte
- Therapeutische Interventionen
- Empfehlungen für weitere Sitzungen

Antworte professionell und wissenschaftlich fundiert.`,

        protocol: `Du bist ein Experte für Therapieprotokoll-Erstellung. Erstelle aus dem folgenden Therapie-Gespräch ein strukturiertes Sitzungsprotokoll.

Format:
**Datum:** [Datum der Sitzung]
**Dauer:** [Sitzungsdauer]
**Hauptthemen:**
- Thema 1
- Thema 2

**Beobachtungen:**
- Stimmung und Affekt
- Verhalten und Interaktion

**Interventionen:**
- Angewandte Techniken
- Therapeutische Maßnahmen

**Hausaufgaben/Vereinbarungen:**
- Konkrete Aufgaben

**Nächste Schritte:**
- Planung der Folgesitzung`,

        progress: `Du bist ein Therapeut, der Therapieverläufe bewertet. Analysiere den Text auf Fortschritte und erstelle eine Fortschrittsbewertung.

Bewerte:
- Symptomveränderungen
- Funktionsverbesserungen
- Therapeutische Allianz
- Zielerreichung
- Empfehlungen für Anpassungen`
    };

    const systemPrompt = systemPrompts[analysisType] || systemPrompts.general;

    return await callOpenAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
    ]);
}

// --- CLIENTS API ROUTES --- //

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

app.put("/api/clients/:id", (req, res) => {
  try {
    const updates = req.body;
    delete updates.id;
    
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

// --- ENHANCED AUDIO ROUTES --- //

app.post("/api/audio/upload", upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Keine Audio-Datei hochgeladen" });
        }

        console.log(`🎤 Audio-Datei hochgeladen: ${req.file.originalname}`);
        
        const audioFilePath = req.file.path;
        const clientId = req.body.client_id || null;
        const analysisType = req.body.analysis_type || 'protocol';

        // Transkription mit Whisper
        console.log('🔄 Starte Whisper-Transkription...');
        const transcription = await transcribeAudio(audioFilePath);
        console.log('✅ Transkription abgeschlossen');

        // KI-Analyse des Transkripts
        console.log('🔄 Starte KI-Analyse...');
        const analysis = await analyzeTherapyText(transcription, analysisType);
        console.log('✅ KI-Analyse abgeschlossen');

        // Speichere Dokument in Datenbank
        const docData = {
            client_id: clientId,
            filename: req.file.filename,
            original_name: req.file.originalname,
            file_path: req.file.path,
            file_type: req.file.mimetype,
            file_size: req.file.size
        };
        
        const docResult = addDocument(docData);

        // Speichere Session falls Client ID vorhanden
        if (clientId) {
            const sessionData = {
                client_id: clientId,
                date: new Date().toISOString().split('T')[0],
                duration: Math.ceil(req.file.size / 1000000), // Rough estimate
                type: 'Audio-Sitzung',
                notes: analysis,
                private_notes: `Transkript:\n\n${transcription}`
            };
            
            addSession(sessionData);
        }

        res.json({
            success: true,
            transcription: transcription,
            analysis: analysis,
            document_id: docResult.lastInsertRowid,
            file: {
                name: req.file.originalname,
                size: req.file.size,
                type: req.file.mimetype
            }
        });

    } catch (error) {
        console.error("❌ Fehler bei Audio-Verarbeitung:", error);
        
        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ 
            error: "Fehler bei Audio-Verarbeitung: " + error.message,
            details: error.message.includes('API Key') ? 'OpenAI API Key nicht konfiguriert' : 'Technischer Fehler'
        });
    }
});

app.post("/api/audio/analyze", async (req, res) => {
    try {
        const { text, analysis_type, client_id } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: "Text für Analyse erforderlich" });
        }

        console.log('🔄 Starte Text-Analyse...');
        const analysis = await analyzeTherapyText(text, analysis_type);
        console.log('✅ Text-Analyse abgeschlossen');

        // Speichere Chat-Nachricht falls Client ID vorhanden
        if (client_id) {
            addChatMessage({
                client_id: client_id,
                role: 'user',
                content: `Analyse-Anfrage: ${text.substring(0, 100)}...`
            });
            
            addChatMessage({
                client_id: client_id,
                role: 'assistant',
                content: analysis
            });
        }

        res.json({
            success: true,
            analysis: analysis,
            analysis_type: analysis_type
        });

    } catch (error) {
        console.error("❌ Fehler bei Text-Analyse:", error);
        res.status(500).json({ 
            error: "Fehler bei Text-Analyse: " + error.message 
        });
    }
});

// --- ENHANCED CHAT ROUTES --- //

app.post("/api/chat", async (req, res) => {
  try {
    const { message, client_id, context, analysis_request } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Nachricht ist erforderlich" });
    }

    console.log(`💬 Enhanced Chat-Anfrage: ${message.substring(0, 50)}...`);
    
    // Speichere User-Nachricht
    if (client_id) {
      addChatMessage({
        client_id: client_id,
        role: 'user',
        content: message
      });
    }

    let reply = '';
    
    if (process.env.OPENAI_API_KEY) {
      try {
        // Erweiterte Kontext-Integration
        let systemPrompt = `Du bist ein erfahrener Psychotherapeut und KI-Assistent für therapeutische Praxis. 

Du hilfst bei:
- Therapieplanung und -methoden
- Diagnostischen Überlegungen  
- Behandlungsansätzen
- Supervision und Fallbesprechung
- Dokumentation und Protokollerstellung
- Fortschrittsbewertung

Antworte immer:
- Professionell und wissenschaftlich fundiert
- Empathisch und ethisch verantwortlich
- Mit konkreten, praxisorientierten Empfehlungen
- Unter Berücksichtigung der DSGVO und Schweigepflicht

Wichtig: Du ersetzt keine professionelle Supervision oder Ausbildung, sondern ergänzt diese.`;

        // Füge Kontext hinzu falls vorhanden
        if (context) {
          systemPrompt += `\n\nAktueller Kontext: ${context}`;
        }

        if (analysis_request) {
          systemPrompt += `\n\nSpezielle Analyse-Anfrage: ${analysis_request}`;
        }

        const messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ];

        // Hole Chat-Historie für besseren Kontext
        if (client_id) {
          const history = getChatHistory(client_id, 5); // Letzte 5 Nachrichten
          history.forEach(msg => {
            if (msg.role === 'user' || msg.role === 'assistant') {
              messages.splice(-1, 0, { role: msg.role, content: msg.content });
            }
          });
        }

        reply = await callOpenAI(messages);

      } catch (apiError) {
        console.error("❌ OpenAI API Fehler:", apiError);
        reply = generateEnhancedFallbackResponse(message, apiError.message);
      }
    } else {
      reply = generateEnhancedFallbackResponse(message, 'API Key fehlt');
    }

    // Speichere KI-Antwort
    if (client_id) {
      addChatMessage({
        client_id: client_id,
        role: 'assistant',
        content: reply
      });
    }

    res.json({ reply: reply });

  } catch (err) {
    console.error("❌ Fehler im Enhanced Chat:", err);
    res.status(500).json({ 
      reply: "Entschuldigung, es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es später erneut." 
    });
  }
});

// --- FILE UPLOAD ROUTES --- //

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
      fileContent = `[Bild-Datei: ${req.file.originalname}] - Bildanalyse mit OpenAI Vision API würde hier implementiert werden.`;
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
    
    // Enhanced AI Analysis
    let analysis = '';
    if (process.env.OPENAI_API_KEY && fileContent) {
      analysis = await analyzeTherapyText(fileContent, 'general');
    } else {
      analysis = `<strong>Datei erfolgreich hochgeladen:</strong><br>
                  Name: ${req.file.originalname}<br>
                  Größe: ${(req.file.size / 1024).toFixed(2)} KB<br>
                  Typ: ${req.file.mimetype}<br><br>
                  <em>KI-Analyse ${process.env.OPENAI_API_KEY ? 'konnte nicht durchgeführt werden' : 'nicht verfügbar (OpenAI API Key fehlt)'}</em><br><br>
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

// --- STATISTICS ROUTE --- //
app.get("/api/stats", (req, res) => {
  try {
    const stats = getStatistics();
    
    const completeStats = {
      totalClients: stats.totalClients || 0,
      totalSessions: stats.totalSessions || 0,
      pendingTodos: 0,
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

// --- ENHANCED HELPER FUNCTIONS --- //

function generateEnhancedFallbackResponse(message, errorDetails) {
  const lowerMessage = message.toLowerCase();
  
  let response = `<div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 10px 0;">
    <strong>⚠️ Eingeschränkter Modus</strong><br>
    Die vollständige KI-Analyse ist momentan nicht verfügbar`;
  
  if (errorDetails && errorDetails.includes('API Key')) {
    response += ` (OpenAI API Key nicht konfiguriert).`;
  } else {
    response += ` (Technischer Fehler).`;
  }
  
  response += `</div>`;
  
  // Intelligente Fallback-Antworten basierend auf Kontext
  if (lowerMessage.includes('whisper') || lowerMessage.includes('audio') || lowerMessage.includes('transkription')) {
    response += `
    <div style="margin-top: 15px;">
      <strong>🎤 Audio-Transkription:</strong><br>
      Um Whisper Speech-to-Text zu nutzen, fügen Sie Ihren OpenAI API Key in die .env Datei ein:<br>
      <code>OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code><br><br>
      
      <strong>Unterstützte Audio-Formate:</strong><br>
      • MP3, WAV, M4A, OGG, FLAC<br>
      • Bis zu 100MB Dateigröße<br>
      • Automatische deutsche Transkription<br>
      • KI-gestützte Therapieprotokoll-Erstellung
    </div>`;
  } else if (lowerMessage.includes('therapie') || lowerMessage.includes('behandlung') || lowerMessage.includes('diagnose')) {
    response += `
    <div style="margin-top: 15px;">
      <strong>🩺 Therapeutische Unterstützung:</strong><br>
      Mit aktivierter KI kann ich Ihnen helfen bei:<br>
      • Diagnose-Findung und Differentialdiagnostik<br>
      • Therapieplanung und Methodenauswahl<br>
      • Supervision und Fallbesprechung<br>
      • Fortschrittsbewertung und Dokumentation<br><br>
      
      <em>Basis-Funktionen wie Klient:innen-Verwaltung funktionieren weiterhin vollständig.</em>
    </div>`;
  } else if (lowerMessage.includes('analyse') || lowerMessage.includes('auswertung')) {
    response += `
    <div style="margin-top: 15px;">
      <strong>📊 KI-Analyse Features:</strong><br>
      Mit OpenAI API Key verfügbar:<br>
      • Automatische Sitzungsprotokoll-Erstellung<br>
      • Fortschritts- und Verlaufsanalyse<br>
      • Thematische Auswertung von Gesprächen<br>
      • Empfehlungen für Interventionen<br>
      • Strukturierte Dokumentation
    </div>`;
  } else {
    response += `
    <div style="margin-top: 15px;">
      <strong>💡 Verfügbare Funktionen:</strong><br>
      • ✅ Klient:innen-Verwaltung<br>
      • ✅ Sitzungs-Dokumentation<br>
      • ✅ Datei-Upload und -Organisation<br>
      • ✅ Chat-Interface (eingeschränkt)<br>
      • ⏳ KI-Analyse (benötigt API Key)<br>
      • ⏳ Whisper-Transkription (benötigt API Key)
    </div>`;
  }
  
  return response;
}

// --- SESSION ROUTES --- //
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

app.get("/api/clients/:id/sessions", (req, res) => {
  try {
    const sessions = getSessionsByClient(req.params.id);
    res.json(sessions);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Sessions:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Sessions" });
  }
});

app.get("/api/clients/:id/chat", (req, res) => {
  try {
    const history = getChatHistory(req.params.id);
    res.json(history);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen des Chat-Verlaufs:", err);
    res.status(500).json({ error: "Fehler beim Abrufen des Chat-Verlaufs" });
  }
});

// --- SERVER START --- //
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Praxida 2.0 Server läuft auf Port ${PORT}`);
  console.log(`📍 Öffnen Sie: http://localhost:${PORT}`);
  
  if (!process.env.OPENAI_API_KEY) {
    console.log(`⚠️  WARNUNG: Kein OpenAI API Key gefunden!`);
    console.log(`   Fügen Sie OPENAI_API_KEY in die .env Datei ein für:`);
    console.log(`   🎤 Whisper Speech-to-Text`);
    console.log(`   🤖 KI-Chat und Analyse`);
    console.log(`   📊 Automatische Protokollerstellung`);
  } else {
    console.log(`✅ OpenAI API Key gefunden!`);
    console.log(`🎤 Whisper Speech-to-Text: AKTIV`);
    console.log(`🤖 KI-Funktionen: AKTIV`);
    console.log(`📊 Intelligente Analyse: AKTIV`);
  }
  
  // Create upload directories
  ['uploads', 'uploads/audio'].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Ordner erstellt: ${dir}`);
    }
  });
});
