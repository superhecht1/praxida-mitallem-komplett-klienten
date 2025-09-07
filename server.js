const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const session = require('express-session');
const bcrypt = require('bcryptjs');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const app = express();

// === IMPROVED OPENAI API KEY DETECTION FOR RENDER === //

function getOpenAIApiKey() {
    // Try multiple possible environment variable names
    const possibleKeys = [
        process.env.OPENAI_API_KEY,
        process.env.OPENAI_KEY,
        process.env.OPENAI_SECRET,
        process.env.OPEN_AI_KEY,
        process.env.API_KEY_OPENAI,
        process.env.RENDER_OPENAI_KEY,
        process.env.OPENAI_TOKEN
    ];
    
    // Find first valid key
    for (const key of possibleKeys) {
        if (key && typeof key === 'string' && key.trim().length > 0) {
            console.log(`🔍 OpenAI API Key gefunden: ${key.substring(0, 7)}...`);
            return key.trim();
        }
    }
    
    return null;
}

// Get API Key with improved detection
const OPENAI_API_KEY = getOpenAIApiKey();

// Proxy vertrauen, damit rate-limit X-Forwarded-For korrekt auswerten kann
app.set('trust proxy', 1);

// Enhanced Debug Info for Render Environment
console.log("🔍 RENDER ENVIRONMENT DEBUG:");
console.log("Node ENV:", process.env.NODE_ENV);
console.log("Port:", process.env.PORT);
console.log("Available Environment Variables:");

// Log all env vars that might contain OpenAI key (safely)
Object.keys(process.env).forEach(key => {
    if (key.toLowerCase().includes('openai') || key.toLowerCase().includes('api')) {
        const value = process.env[key];
        if (value) {
            console.log(`  ${key}: ${value.substring(0, 7)}...`);
        } else {
            console.log(`  ${key}: (empty)`);
        }
    }
});

console.log("OpenAI API Key Status:", OPENAI_API_KEY ? "✅ GEFUNDEN" : "❌ NICHT GEFUNDEN");
if (OPENAI_API_KEY) {
    console.log("Key Format:", OPENAI_API_KEY.startsWith('sk-') ? "✅ KORREKT" : "⚠️ UNGEWÖHNLICH");
    console.log("Key Length:", OPENAI_API_KEY.length);
}

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
  db,
  addClient,
  getClients,
  getClientById,
  deleteClient,
  updateClient,
  addSession,
  getSessionsByClient,
  getSessionById,
  addDocument,
  getDocumentsByClient,
  getDocumentById,
  addAudioTranscription,
  getAudioTranscriptionsByClient,
  addChatMessage,
  getChatHistory,
  getRecentChatHistory,
  addTreatmentGoal,
  getTreatmentGoalsByClient,
  updateTreatmentGoal,
  addAssessment,
  getAssessmentsByClient,
  searchClients,
  searchSessions,
  getSetting,
  setSetting,
  getStatistics,
  addAnamnese,
  getAnamnesesByClient,
  addInvoice,
  addInvoiceItem,
  getInvoicesByClient,
  getInvoiceItems,
  addPraxis,
  addUser,
  getUsersByPraxis,
  vacuum,
  getDataStats,
  backupDatabase
} = require("./db");

// --- STANDARDIZED ASSESSMENT INSTRUMENTS --- //
const ASSESSMENTS = {
  'PHQ-9': {
    name: 'Patient Health Questionnaire-9',
    type: 'depression',
    questions: [
      'Wenig Interesse oder Freude an Tätigkeiten',
      'Niedergeschlagenheit, Schwermut oder Hoffnungslosigkeit',
      'Schwierigkeiten beim Ein- oder Durchschlafen oder vermehrter Schlaf',
      'Müdigkeit oder Gefühl, keine Energie zu haben',
      'Verminderter Appetit oder übermäßiges Bedürfnis zu essen',
      'Schlechte Meinung von sich selbst; Gefühl ein Versager zu sein',
      'Schwierigkeiten sich zu konzentrieren',
      'Langsame Bewegungen oder Sprache, oder Unruhe',
      'Gedanken, dass Sie besser tot wären oder sich Leid zufügen möchten'
    ],
    scale: ['Überhaupt nicht', 'An einzelnen Tagen', 'An mehr als der Hälfte der Tage', 'Beinahe jeden Tag'],
    scoring: {
      minimal: [0, 4],
      mild: [5, 9],
      moderate: [10, 14],
      moderateSevere: [15, 19],
      severe: [20, 27]
    },
    maxScore: 27
  },
  'GAD-7': {
    name: 'Generalized Anxiety Disorder 7-item',
    type: 'anxiety',
    questions: [
      'Nervosität, Ängstlichkeit oder Anspannung',
      'Nicht in der Lage sein, Sorgen zu stoppen oder zu kontrollieren',
      'Zu viele Sorgen bezüglich verschiedener Angelegenheiten',
      'Schwierigkeiten zu entspannen',
      'Unruhe, sodass Stillsitzen schwer fällt',
      'Schnelle Verärgerung oder Gereiztheit',
      'Angst, dass etwas Schlimmes passieren könnte'
    ],
    scale: ['Überhaupt nicht', 'An einzelnen Tagen', 'An mehr als der Hälfte der Tage', 'Beinahe jeden Tag'],
    scoring: {
      minimal: [0, 4],
      mild: [5, 9],
      moderate: [10, 14],
      severe: [15, 21]
    },
    maxScore: 21
  }
};

// === ENHANCED AI FUNCTIONS WITH BETTER ERROR HANDLING === //

async function validateOpenAIKey() {
    if (!OPENAI_API_KEY) {
        console.log("⚠️  Kein OpenAI API Key gefunden");
        return false;
    }

    // Validate API Key Format
    if (!OPENAI_API_KEY.startsWith('sk-')) {
        console.log("❌ OpenAI API Key hat falsches Format (sollte mit 'sk-' beginnen)");
        return false;
    }

    try {
        // Test API Key with simple request
        const response = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'User-Agent': 'Praxida/2.0'
            }
        });

        if (response.ok) {
            console.log("✅ OpenAI API Key ist gültig");
            return true;
        } else {
            const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
            console.log("❌ OpenAI API Key ungültig:", error.error?.message);
            return false;
        }
    } catch (error) {
        console.log("❌ Fehler beim Testen des OpenAI API Keys:", error.message);
        return false;
    }
}

async function callOpenAI(messages, model = "gpt-3.5-turbo") {
    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API Key nicht konfiguriert');
    }

    console.log(`🤖 OpenAI Anfrage: ${model} mit ${messages.length} Nachrichten`);

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'User-Agent': 'Praxida/2.0'
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

        console.log(`📡 OpenAI Response Status: ${response.status}`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: 'Unbekannter API-Fehler' } }));
            console.error('❌ OpenAI API Fehler Response:', error);
            throw new Error(error.error?.message || `OpenAI API Fehler: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('❌ Unerwartete OpenAI Response-Struktur:', data);
            throw new Error('Unerwartete API-Antwort von OpenAI');
        }

        console.log(`✅ OpenAI Antwort erhalten (${data.usage?.total_tokens || 'N/A'} tokens)`);
        return data.choices[0].message.content;

    } catch (error) {
        console.error('❌ OpenAI API Fehler:', error.message);
        throw error;
    }
}

async function transcribeAudio(audioFilePath) {
    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API Key nicht konfiguriert für Whisper');
    }

    console.log(`🎤 Starte Whisper-Transkription für: ${audioFilePath}`);

    try {
        // Check if file exists
        if (!fs.existsSync(audioFilePath)) {
            throw new Error(`Audio-Datei nicht gefunden: ${audioFilePath}`);
        }

        const fileStats = fs.statSync(audioFilePath);
        console.log(`📄 Audio-Datei: ${fileStats.size} bytes`);

        // Check file size (Whisper limit: 25MB)
        if (fileStats.size > 25 * 1024 * 1024) {
            throw new Error('Audio-Datei zu groß für Whisper API (max. 25MB)');
        }

        const FormData = require('form-data');
        const form = new FormData();
        
        form.append('file', fs.createReadStream(audioFilePath));
        form.append('model', 'whisper-1');
        form.append('language', 'de'); 
        form.append('response_format', 'json');
        form.append('temperature', '0');

        console.log('📤 Sende Audio an Whisper API...');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'User-Agent': 'Praxida/2.0',
                ...form.getHeaders()
            },
            body: form
        });

        console.log(`📡 Whisper Response Status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Whisper API Fehler Response:', errorText);
            
            let error;
            try {
                error = JSON.parse(errorText);
            } catch (e) {
                throw new Error(`Whisper API Fehler: ${response.status} ${response.statusText}`);
            }
            
            throw new Error(error.error?.message || `Whisper API Fehler: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.text) {
            console.error('❌ Keine Transkription in Response:', data);
            throw new Error('Keine Transkription erhalten');
        }

        console.log(`✅ Transkription erfolgreich (${data.text.length} Zeichen)`);
        return data.text;

    } catch (error) {
        console.error('❌ Whisper API Fehler:', error.message);
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

// --- ASSESSMENT HELPER FUNCTIONS --- //

function calculateAssessmentScore(assessmentType, responses) {
    const assessment = ASSESSMENTS[assessmentType];
    if (!assessment) throw new Error('Unbekannter Assessment-Typ');
    
    const totalScore = responses.reduce((sum, response) => sum + response, 0);
    
    // Determine severity level
    let severityLevel = 'unknown';
    for (const [level, range] of Object.entries(assessment.scoring)) {
        if (totalScore >= range[0] && totalScore <= range[1]) {
            severityLevel = level;
            break;
        }
    }
    
    return {
        totalScore,
        severityLevel,
        maxScore: assessment.maxScore,
        percentage: Math.round((totalScore / assessment.maxScore) * 100)
    };
}

// === FIXED SECURITY MIDDLEWARE === //
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.openai.com"]
    }
  }
}));

// Rate Limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Zu viele Login-Versuche. Bitte warten Sie 15 Minuten.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 requests per window
  message: { error: 'Zu viele Anfragen. Bitte verlangsamen Sie.' }
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/', generalLimiter);

// === FIXED SESSION CONFIGURATION === //
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './data',
    table: 'sessions',
    concurrentDB: true
  }),
  secret: process.env.SESSION_SECRET || 'praxida-2024-demo-secret-key',
  resave: false,
  saveUninitialized: false,
  name: 'praxida.sid',
  cookie: {
    secure: false, // Wichtig: auf false für Development
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  },
  rolling: true
}));

// === FIXED DATABASE HELPER FUNCTIONS === //

function getUserByEmail(email) {
  try {
    console.log(`🔍 Suche Benutzer: ${email}`);
    
    const stmt = db.prepare(`
      SELECT u.*, p.name as praxis_name 
      FROM users u 
      LEFT JOIN praxis p ON u.praxis_id = p.id 
      WHERE LOWER(u.email) = LOWER(?) AND u.is_active = 1
    `);
    
    const user = stmt.get(email);
    
    if (user) {
      console.log(`✅ Benutzer gefunden: ${user.name} (${user.role}) - Praxis: ${user.praxis_name}`);
    } else {
      console.log(`❌ Kein Benutzer gefunden für: ${email}`);
    }
    
    return user;
  } catch (error) {
    console.error('❌ Datenbankfehler bei getUserByEmail:', error);
    return null;
  }
}

function getUserById(id) {
  try {
    const stmt = db.prepare(`
      SELECT u.*, p.name as praxis_name 
      FROM users u 
      LEFT JOIN praxis p ON u.praxis_id = p.id 
      WHERE u.id = ?
    `);
    return stmt.get(id);
  } catch (error) {
    console.error('❌ Fehler beim Abrufen des Benutzers:', error);
    return null;
  }
}

function getPraxisByName(name) {
  try {
    const stmt = db.prepare("SELECT * FROM praxis WHERE name = ?");
    return stmt.get(name);
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Praxis:', error);
    return null;
  }
}

function createLoginAttempt(email, success, ip, userAgent) {
  try {
    const stmt = db.prepare(`
      INSERT INTO login_attempts (email, success, ip_address, user_agent, attempted_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    return stmt.run(email, success ? 1 : 0, ip, userAgent);
  } catch (error) {
    console.warn('Fehler beim Speichern des Login-Versuchs:', error);
  }
}

function getRecentLoginAttempts(email, windowMinutes = 15) {
  try {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count 
      FROM login_attempts 
      WHERE email = ? AND success = 0 AND attempted_at > datetime('now', '-${windowMinutes} minutes')
    `);
    return stmt.get(email)?.count || 0;
  } catch (error) {
    console.warn('Fehler beim Abrufen der Login-Versuche:', error);
    return 0;
  }
}

// Create login_attempts table if not exists
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      attempted_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  
  db.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON login_attempts(attempted_at)").run();
} catch (error) {
  console.warn('Login attempts table bereits vorhanden oder Fehler:', error);
}

// === FIXED DEMO ACCOUNT CREATION === //
let demoAccountsCreated = false;

async function createStableDemoAccounts() {
  if (demoAccountsCreated) {
    console.log('⏭️ Demo-Accounts bereits erstellt, überspringe...');
    return;
  }

  try {
    console.log('🔧 Erstelle stabile Demo-Accounts...');
    
    // Praxis erstellen/finden
    let praxis;
    try {
      const checkPraxis = db.prepare("SELECT * FROM praxis WHERE name = ?").get('Demo Praxis Köln');
      if (checkPraxis) {
        praxis = checkPraxis;
        console.log('✅ Demo Praxis gefunden:', praxis.id);
      } else {
        const praxisStmt = db.prepare(`
          INSERT INTO praxis (name, email, telefon, adresse, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        const result = praxisStmt.run('Demo Praxis Köln', 'info@demo-praxis.de', '+49 221 123456', 'Musterstraße 123, 50667 Köln');
        praxis = { id: result.lastInsertRowid, name: 'Demo Praxis Köln' };
        console.log('✅ Demo Praxis erstellt:', praxis.id);
      }
    } catch (error) {
      console.error('❌ Praxis-Fehler:', error);
      return;
    }
    
    // Alle alten Demo-Benutzer löschen
    try {
      const deleteResult = db.prepare("DELETE FROM users WHERE email LIKE '%@demo-praxis.de' OR email = 'emergency@admin.local'").run();
      console.log(`🗑️ ${deleteResult.changes} alte Demo-Accounts gelöscht`);
    } catch (error) {
      console.warn('⚠️ Warnung beim Löschen alter Accounts:', error.message);
    }
    
    // Einheitliches Passwort hashen
    const demoPassword = 'demo123456';
    const hashedPassword = await bcrypt.hash(demoPassword, 12);
    console.log('🔐 Passwort gehasht für:', demoPassword);
    
    // Demo-Accounts definieren
    const demoAccounts = [
      { name: 'Dr. Demo Administrator', email: 'admin@demo-praxis.de', role: 'admin' },
      { name: 'Dr. Sarah Therapeutin', email: 'therapeut@demo-praxis.de', role: 'therapeut' },
      { name: 'Lisa Assistenz', email: 'assistenz@demo-praxis.de', role: 'assistenz' },
      { name: 'Tom Praktikant', email: 'praktikant@demo-praxis.de', role: 'praktikant' },
      { name: 'Emergency Admin', email: 'emergency@admin.local', role: 'admin' } // Notfall-Account
    ];
    
    // Accounts einzeln erstellen
    const userStmt = db.prepare(`
      INSERT INTO users (praxis_id, name, email, password_hash, role, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `);
    
    const createdAccounts = [];
    for (const account of demoAccounts) {
      try {
        const result = userStmt.run(praxis.id, account.name, account.email, hashedPassword, account.role);
        createdAccounts.push({
          id: result.lastInsertRowid,
          email: account.email,
          role: account.role,
          name: account.name
        });
        console.log(`✅ Account erstellt: ${account.email} (${account.role})`);
      } catch (error) {
        console.error(`❌ Fehler bei ${account.email}:`, error.message);
      }
    }
    
    // Erfolgsmeldung
    console.log('\n🎉 DEMO-ACCOUNTS ERFOLGREICH ERSTELLT:');
    console.log('📧 Verfügbare Logins:');
    createdAccounts.forEach(acc => {
      console.log(`   ${acc.email} (${acc.role})`);
    });
    console.log('🔑 Passwort für alle Accounts: demo123456');
    console.log('🏥 Praxis: Demo Praxis Köln (optional beim Login)');
    
    demoAccountsCreated = true;
    
  } catch (error) {
    console.error('❌ Schwerwiegender Fehler bei Demo-Account-Erstellung:', error);
  }
}

// === AUTHENTICATION MIDDLEWARE === //

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ 
      error: 'Authentifizierung erforderlich',
      code: 'AUTH_REQUIRED' 
    });
  }
  
  // Check if user still exists in database
  const user = getUserById(req.session.user.id);
  if (!user) {
    req.session.destroy();
    return res.status(401).json({ 
      error: 'Benutzer nicht mehr vorhanden',
      code: 'USER_NOT_FOUND' 
    });
  }
  
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentifizierung erforderlich' 
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required_roles: roles,
        user_role: req.user.role
      });
    }
    
    next();
  };
}

function requirePraxis(req, res, next) {
  if (!req.user?.praxis_id) {
    return res.status(403).json({ 
      error: 'Praxis-Zuordnung erforderlich' 
    });
  }
  next();
}

// === ENHANCED TEST-ENDPOINT FOR OPENAI === //

app.post('/api/test-openai', requireAuth, async (req, res) => {
    try {
        console.log('🧪 Teste OpenAI Verbindung...');
        
        if (!OPENAI_API_KEY) {
            return res.status(400).json({ 
                success: false, 
                error: 'OpenAI API Key nicht konfiguriert',
                solution: 'Setzen Sie OPENAI_API_KEY in den Render Umgebungsvariablen',
                debug: {
                    searched_vars: ['OPENAI_API_KEY', 'OPENAI_KEY', 'OPENAI_SECRET'],
                    render_note: 'Prüfen Sie die Render Environment Variables'
                }
            });
        }

        // Test with simple request
        const testMessage = "Antworte nur mit 'KI-Test erfolgreich' wenn du mich verstehst.";
        
        const result = await callOpenAI([
            { role: "system", content: "Du bist ein Test-Assistent für Praxida. Antworte kurz und präzise." },
            { role: "user", content: testMessage }
        ]);

        console.log('✅ OpenAI Test erfolgreich');
        
        res.json({
            success: true,
            message: 'OpenAI API funktioniert perfekt!',
            response: result,
            apiKey: `${OPENAI_API_KEY.substring(0, 7)}...`,
            environment: process.env.NODE_ENV || 'development'
        });

    } catch (error) {
        console.error('❌ OpenAI Test fehlgeschlagen:', error);
        
        res.status(500).json({
            success: false,
            error: error.message,
            details: {
                type: error.message.includes('API Key') ? 'auth' : 'api',
                suggestion: error.message.includes('API Key') 
                    ? 'Prüfen Sie Ihren OpenAI API Key in den Render Environment Variables'
                    : 'Prüfen Sie Ihre Internetverbindung und API-Limits'
            }
        });
    }
});

// === FIXED AUTHENTICATION ROUTES === //

// Register new praxis (initial setup)
app.post('/api/auth/register-praxis', async (req, res) => {
  try {
    const { 
      praxis_name, 
      praxis_email, 
      praxis_telefon, 
      praxis_adresse,
      admin_name, 
      admin_email, 
      admin_password 
    } = req.body;

    // Validation
    if (!praxis_name || !admin_name || !admin_email || !admin_password) {
      return res.status(400).json({ 
        error: 'Alle Pflichtfelder müssen ausgefüllt werden' 
      });
    }

    if (admin_password.length < 8) {
      return res.status(400).json({ 
        error: 'Passwort muss mindestens 8 Zeichen lang sein' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(admin_email)) {
      return res.status(400).json({ 
        error: 'Ungültige E-Mail-Adresse' 
      });
    }

    // Check if praxis or admin already exists
    const existingPraxis = getPraxisByName(praxis_name);
    if (existingPraxis) {
      return res.status(400).json({ 
        error: 'Praxis-Name bereits vergeben' 
      });
    }

    const existingUser = getUserByEmail(admin_email);
    if (existingUser) {
      return res.status(400).json({ 
        error: 'E-Mail-Adresse bereits registriert' 
      });
    }

    // Create praxis
    const praxisData = {
      name: praxis_name,
      email: praxis_email,
      telefon: praxis_telefon,
      adresse: praxis_adresse
    };
    
    const praxisResult = addPraxis(praxisData);
    const praxisId = praxisResult.lastInsertRowid;

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(admin_password, saltRounds);

    // Create admin user
    const userData = {
      praxis_id: praxisId,
      name: admin_name,
      email: admin_email,
      password_hash: hashedPassword,
      role: 'admin'
    };

    const userResult = addUser(userData);

    console.log(`✅ Neue Praxis registriert: ${praxis_name} mit Admin: ${admin_name}`);

    res.json({ 
      success: true, 
      message: 'Praxis erfolgreich registriert',
      praxis_id: praxisId,
      user_id: userResult.lastInsertRowid
    });

  } catch (error) {
    console.error('❌ Fehler bei Praxis-Registrierung:', error);
    res.status(500).json({ 
      error: 'Fehler bei der Registrierung: ' + error.message 
    });
  }
});

// === FIXED USER LOGIN === //
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, praxis_name } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    console.log(`\n🔐 LOGIN-VERSUCH: ${email}`);
    console.log(`🌐 IP: ${ip}`);
    console.log(`🏥 Praxis: ${praxis_name || 'nicht angegeben'}`);

    // Basis-Validierung
    if (!email || !password) {
      console.log('❌ Email oder Passwort fehlt');
      return res.status(400).json({ 
        error: 'E-Mail und Passwort sind erforderlich' 
      });
    }

    // Rate Limiting Check
    const recentAttempts = getRecentLoginAttempts(email);
    if (recentAttempts >= 5) {
      console.log(`🚫 Rate Limit für ${email}: ${recentAttempts} Versuche`);
      createLoginAttempt(email, false, ip, userAgent);
      return res.status(429).json({ 
        error: 'Account temporär gesperrt. Zu viele fehlgeschlagene Login-Versuche.' 
      });
    }

    // Benutzer suchen
    const user = getUserByEmail(email);
    if (!user) {
      console.log(`❌ Benutzer nicht gefunden: ${email}`);
      createLoginAttempt(email, false, ip, userAgent);
      return res.status(401).json({ 
        error: 'Ungültige Anmeldedaten' 
      });
    }

    // Passwort prüfen
    console.log('🔐 Prüfe Passwort...');
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      console.log(`❌ Ungültiges Passwort für: ${email}`);
      createLoginAttempt(email, false, ip, userAgent);
      return res.status(401).json({ 
        error: 'Ungültige Anmeldedaten' 
      });
    }

    // Praxis-Check (nur wenn angegeben und nicht leer)
    if (praxis_name && praxis_name.trim() !== '' && user.praxis_name) {
      const normalizedPraxisName = praxis_name.trim().toLowerCase();
      const normalizedUserPraxis = user.praxis_name.trim().toLowerCase();
      
      if (normalizedUserPraxis !== normalizedPraxisName) {
        console.log(`❌ Praxis-Mismatch: ${normalizedUserPraxis} vs ${normalizedPraxisName}`);
        createLoginAttempt(email, false, ip, userAgent);
        return res.status(401).json({ 
          error: 'Benutzer gehört nicht zu der angegebenen Praxis' 
        });
      }
    }

    // Erfolgreicher Login
    console.log(`✅ Login erfolgreich: ${user.name}`);
    createLoginAttempt(email, true, ip, userAgent);

    // Session erstellen
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      praxis_id: user.praxis_id,
      praxis_name: user.praxis_name
    };

    req.session.login_time = new Date().toISOString();
    req.session.ip = ip;

    // Session speichern und Antwort senden
    req.session.save((err) => {
      if (err) {
        console.error('❌ Session-Speicher-Fehler:', err);
        return res.status(500).json({ error: 'Fehler beim Erstellen der Sitzung' });
      }

      console.log(`✅ Session erstellt für: ${user.name}`);
      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          praxis_name: user.praxis_name
        },
        message: 'Erfolgreich angemeldet'
      });
    });

  } catch (error) {
    console.error('❌ LOGIN-FEHLER:', error);
    res.status(500).json({ 
      error: 'Fehler beim Anmelden: ' + error.message 
    });
  }
});

// User Logout
app.post('/api/auth/logout', (req, res) => {
  if (req.session?.user) {
    const userName = req.session.user.name;
    req.session.destroy((err) => {
      if (err) {
        console.error('❌ Logout-Fehler:', err);
        return res.status(500).json({ error: 'Fehler beim Abmelden' });
      }
      
      console.log(`👋 Benutzer abgemeldet: ${userName}`);
      res.json({ success: true, message: 'Erfolgreich abgemeldet' });
    });
  } else {
    res.json({ success: true, message: 'Bereits abgemeldet' });
  }
});

// Get current user info
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      praxis_name: req.user.praxis_name,
      praxis_id: req.user.praxis_id
    },
    session_info: {
      login_time: req.session.login_time,
      expires: new Date(Date.now() + req.session.cookie.maxAge).toISOString()
    }
  });
});

// === FIXED DEBUG ENDPOINTS === //
app.get('/api/debug/accounts', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, p.name as praxis_name
      FROM users u
      LEFT JOIN praxis p ON u.praxis_id = p.id
      ORDER BY u.created_at DESC
    `).all();
    
    const praxis = db.prepare("SELECT * FROM praxis").all();
    
    res.json({
      total_users: users.length,
      total_praxis: praxis.length,
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: !!u.is_active,
        praxis: u.praxis_name
      })),
      praxis: praxis
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/debug/test-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }
    
    const user = getUserByEmail(email);
    if (!user) {
      return res.json({ 
        found: false, 
        message: 'Benutzer nicht gefunden' 
      });
    }
    
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    
    res.json({
      found: true,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        praxis: user.praxis_name
      },
      password_valid: passwordValid,
      hash_preview: user.password_hash.substring(0, 20) + '...'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/create-accounts-now', async (req, res) => {
  try {
    demoAccountsCreated = false; // Reset Flag
    await createStableDemoAccounts();
    
    const users = db.prepare(`
      SELECT email, role, name 
      FROM users 
      WHERE email LIKE '%@demo-praxis.de' OR email = 'emergency@admin.local'
      ORDER BY role
    `).all();
    
    res.json({
      success: true,
      message: 'Demo-Accounts neu erstellt!',
      accounts: users,
      password: 'demo123456',
      login_hint: 'Verwenden Sie eine der E-Mail-Adressen mit dem Passwort "demo123456"'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === PROTECT EXISTING API ROUTES === //

// Middleware to apply authentication to existing routes
app.use('/api/clients', requireAuth, requirePraxis);
app.use('/api/sessions', requireAuth, requirePraxis);
app.use('/api/upload', requireAuth);
app.use('/api/audio', requireAuth);
app.use('/api/chat', requireAuth);
app.use('/api/assessments', requireAuth, requirePraxis);

// --- CLIENTS API ROUTES --- //

app.get("/api/clients", requireAuth, requirePraxis, (req, res) => {
  try {
    // Get all clients but filter by praxis_id
    const stmt = db.prepare(`
      SELECT 
        c.*,
        COUNT(s.id) as total_sessions,
        MAX(s.date) as latest_session
      FROM clients c
      LEFT JOIN sessions s ON c.id = s.client_id
      WHERE c.praxis_id = ? OR c.praxis_id IS NULL
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    
    const clients = stmt.all(req.user.praxis_id);
    
    // Update any clients without praxis_id
    const updateStmt = db.prepare("UPDATE clients SET praxis_id = ? WHERE praxis_id IS NULL");
    updateStmt.run(req.user.praxis_id);
    
    console.log(`✅ Loaded ${clients.length} clients for praxis ${req.user.praxis_id}`);
    res.json(clients);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Clients:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Clients" });
  }
});

app.post("/api/clients", requireAuth, requirePraxis, (req, res) => {
  try {
    const clientData = {
      praxis_id: req.user.praxis_id,
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
    console.log(`✅ Client hinzugefügt: ${clientData.name} für Praxis: ${req.user.praxis_id}`);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("❌ Fehler beim Hinzufügen eines Clients:", err);
    res.status(500).json({ error: "Fehler beim Hinzufügen des Clients" });
  }
});

// --- ENHANCED AUDIO ROUTES --- //

app.post("/api/audio/upload", requireAuth, upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Keine Audio-Datei hochgeladen" });
        }

        console.log(`🎤 Audio-Datei hochgeladen: ${req.file.originalname}`);
        
        const audioFilePath = req.file.path;
        const clientId = req.body.client_id || null;
        const analysisType = req.body.analysis_type || 'protocol';

        let transcription = '';
        let analysis = '';

        // Try Whisper transcription if API key available
        if (OPENAI_API_KEY) {
            try {
                console.log('📄 Starte Whisper-Transkription...');
                transcription = await transcribeAudio(audioFilePath);
                console.log('✅ Transkription abgeschlossen');

                // AI analysis of transcript
                console.log('📄 Starte KI-Analyse...');
                analysis = await analyzeTherapyText(transcription, analysisType);
                console.log('✅ KI-Analyse abgeschlossen');
            } catch (apiError) {
                console.error('❌ API Fehler:', apiError);
                transcription = `[Automatische Transkription nicht verfügbar: ${apiError.message}]`;
                analysis = generateAdvancedFallbackAnalysis(req.file, 'audio');
            }
        } else {
            transcription = '[Whisper-Transkription nicht verfügbar - OpenAI API Key erforderlich]';
            analysis = generateAdvancedFallbackAnalysis(req.file, 'audio');
        }

        // Save document to database
        const docData = {
            client_id: clientId,
            filename: req.file.filename,
            original_name: req.file.originalname,
            file_path: req.file.path,
            file_type: req.file.mimetype,
            file_size: req.file.size
        };
        
        const docResult = addDocument(docData);

        // Save session if client ID provided
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
            },
            ai_available: !!OPENAI_API_KEY
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

// --- ENHANCED CHAT ROUTES --- //

app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    const { message, client_id, context, analysis_request } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Nachricht ist erforderlich" });
    }

    console.log(`💬 Chat-Anfrage von ${req.user.name}: ${message.substring(0, 50)}...`);
    
    // Save user message
    if (client_id) {
      addChatMessage({
        client_id: client_id,
        role: 'user',
        content: message
      });
    }

    let reply = '';
    
    if (OPENAI_API_KEY) {
      try {
        console.log('🤖 Verarbeite mit OpenAI...');
        
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

        // Get chat history for better context
        if (client_id) {
          const history = getChatHistory(client_id, 3); // Reduce to 3 for better performance
          history.reverse().forEach(msg => {
            if (msg.role === 'user' || msg.role === 'assistant') {
              messages.splice(-1, 0, { role: msg.role, content: msg.content.substring(0, 500) }); // Shorten long messages
            }
          });
        }

        reply = await callOpenAI(messages);
        console.log('✅ OpenAI Antwort erhalten');

      } catch (apiError) {
        console.error("❌ OpenAI API Fehler:", apiError);
        reply = generateEnhancedFallbackResponse(message, apiError.message);
      }
    } else {
      console.log('⚠️ Fallback-Modus: Kein API Key');
      reply = generateEnhancedFallbackResponse(message, 'API Key fehlt');
    }

    // Save AI response
    if (client_id) {
      addChatMessage({
        client_id: client_id,
        role: 'assistant',
        content: reply
      });
    }

    res.json({ 
      reply: reply,
      ai_available: !!OPENAI_API_KEY
    });

  } catch (err) {
    console.error("❌ Fehler im Chat:", err);
    res.status(500).json({ 
      reply: "Entschuldigung, es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es später erneut.",
      error: err.message
    });
  }
});

// --- FILE UPLOAD ROUTES --- //

app.post("/api/upload", requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    console.log(`📄 Datei hochgeladen: ${req.file.originalname}`);
    
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
        fileContent = `[Bild-Datei: ${req.file.originalname}] - Bildanalyse mit OpenAI Vision API würde hier implementiert werden.`;
      }
    } catch (extractError) {
      console.warn('Datei-Extraktion fehlgeschlagen:', extractError);
      fileContent = `[Dateiinhalt konnte nicht extrahiert werden: ${extractError.message}]`;
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
    if (OPENAI_API_KEY && fileContent && fileContent.trim().length > 10) {
      try {
        analysis = await analyzeTherapyText(fileContent, 'general');
      } catch (apiError) {
        console.error('AI Analyse Fehler:', apiError);
        analysis = generateAdvancedFallbackAnalysis(req.file, 'document', fileContent);
      }
    } else {
      analysis = generateAdvancedFallbackAnalysis(req.file, 'document', fileContent);
    }

    res.json({ 
      success: true, 
      analysis: analysis,
      file: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      },
      ai_available: !!OPENAI_API_KEY,
      content_extracted: fileContent.length > 0
    });

  } catch (err) {
    console.error("❌ Fehler beim Verarbeiten der Datei:", err);
    res.status(500).json({ error: "Fehler beim Verarbeiten der Datei: " + err.message });
  }
});

// --- STATISTICS ROUTE --- //
app.get("/api/stats", requireAuth, requirePraxis, (req, res) => {
  try {
    // Get global stats but filter by praxis for specific stats
    const stats = getStatistics();
    
    // Get praxis-specific client count
    const praxisStats = db.prepare(`
      SELECT COUNT(*) as client_count 
      FROM clients 
      WHERE praxis_id = ? OR praxis_id IS NULL
    `).get(req.user.praxis_id);
    
    const completeStats = {
      totalClients: praxisStats.client_count || 0,
      totalSessions: stats.totalSessions || 0,
      pendingTodos: stats.pendingTodos || 0,
      activePlans: stats.activePlans || 0
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
    response += ` (OpenAI API Key nicht in Render Environment Variables konfiguriert).`;
  } else {
    response += ` (Technischer Fehler).`;
  }
  
  response += `</div>`;
  
  // Intelligent fallback responses based on context
  if (lowerMessage.includes('whisper') || lowerMessage.includes('audio') || lowerMessage.includes('transkription')) {
    response += `
    <div style="margin-top: 15px;">
      <strong>🎤 Audio-Transkription:</strong><br>
      Um Whisper Speech-to-Text zu nutzen, konfigurieren Sie OPENAI_API_KEY in den Render Environment Variables:<br>
      <code>OPENAI_API_KEY = sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code><br><br>
      
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
  } else {
    response += `
    <div style="margin-top: 15px;">
      <strong>💡 Verfügbare Funktionen:</strong><br>
      • ✅ Klient:innen-Verwaltung<br>
      • ✅ Sitzungs-Dokumentation<br>
      • ✅ Datei-Upload und -Organisation<br>
      • ✅ Chat-Interface (eingeschränkt)<br>
      • ⏳ KI-Analyse (benötigt API Key)<br>
      • ⏳ Whisper-Transkription (benötigt API Key)<br><br>
      
      <strong>🔧 Render Setup:</strong><br>
      Fügen Sie OPENAI_API_KEY in den Environment Variables hinzu.
    </div>`;
  }
  
  return response;
}

function generateAdvancedFallbackAnalysis(fileInfo, type, content = '') {
  const timestamp = new Date().toLocaleDateString('de-DE');
  
  let analysis = `<div style="background: #f8f9ff; padding: 20px; border-radius: 12px; border-left: 4px solid #667eea;">
    <h4 style="color: #667eea; margin-bottom: 15px;">📄 ${type === 'audio' ? 'Audio-Datei' : 'Dokument'} hochgeladen</h4>
    
    <p><strong>Datei-Informationen:</strong><br>
    📁 Name: ${fileInfo.originalname}<br>
    📏 Größe: ${(fileInfo.size / 1024).toFixed(2)} KB<br>
    🔖 Typ: ${fileInfo.mimetype}<br>
    📅 Verarbeitet: ${timestamp}</p>`;

  if (type === 'audio') {
    const estimatedDuration = Math.ceil(fileInfo.size / 1000000);
    analysis += `
    <p><strong>🎤 Audio-Eigenschaften:</strong><br>
    ⏱️ Geschätzte Dauer: ~${estimatedDuration} Minuten<br>
    🔊 Format: ${fileInfo.mimetype}<br>
    📝 Status: Bereit für Transkription</p>
    
    <p><strong>💡 Verfügbare Aktionen:</strong><br>
    • Datei ist erfolgreich gespeichert<br>
    • Manuelle Transkription möglich<br>
    • KI-Transkription verfügbar nach API Key Konfiguration</p>`;
  } else if (content && content.length > 0) {
    const wordCount = content.split(' ').length;
    const preview = content.substring(0, 200);
    
    analysis += `
    <p><strong>📄 Inhalt extrahiert:</strong><br>
    📊 Wörter: ~${wordCount}<br>
    📝 Zeichen: ${content.length}<br>
    ✅ Status: Erfolgreich gelesen</p>
    
    <p><strong>🔍 Inhalt-Vorschau:</strong><br>
    <em style="background: #eef2ff; padding: 10px; border-radius: 6px; display: block; margin: 10px 0;">
    ${preview}${content.length > 200 ? '...' : ''}
    </em></p>
    
    <p><strong>💡 Verfügbare Aktionen:</strong><br>
    • Text erfolgreich extrahiert<br>
    • Manuelle Analyse möglich<br>
    • KI-Analyse verfügbar nach API Key Konfiguration</p>`;
  }

  analysis += `
  <div style="background: rgba(102, 126, 234, 0.1); padding: 15px; border-radius: 8px; margin-top: 15px;">
    <strong>🚀 KI-Features aktivieren:</strong><br>
    Um die vollständige KI-Analyse zu nutzen, fügen Sie Ihren OpenAI API Key in den Render Environment Variables hinzu:<br>
    <code style="background: white; padding: 5px; border-radius: 4px;">OPENAI_API_KEY = sk-proj-...</code>
  </div>
  </div>`;

  return analysis;
}

// === DEBUG ENDPOINTS FOR RENDER === //

app.get('/api/debug/env', (req, res) => {
  try {
    const envInfo = {
      node_env: process.env.NODE_ENV,
      port: process.env.PORT,
      has_openai_key: !!OPENAI_API_KEY,
      openai_key_preview: OPENAI_API_KEY ? `${OPENAI_API_KEY.substring(0, 7)}...` : null,
      openai_key_length: OPENAI_API_KEY ? OPENAI_API_KEY.length : 0,
      openai_key_format: OPENAI_API_KEY ? OPENAI_API_KEY.startsWith('sk-') : false,
      all_env_vars: Object.keys(process.env).filter(key => 
        key.toLowerCase().includes('openai') || 
        key.toLowerCase().includes('api') ||
        key.toLowerCase().includes('key')
      )
    };
    
    res.json(envInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/show-users', (req, res) => {
    const users = db.prepare(`
        SELECT u.email, u.role, p.name as praxis_name
        FROM users u
        LEFT JOIN praxis p ON u.praxis_id = p.id
        ORDER BY u.created_at DESC
    `).all();
    
    res.json({ total: users.length, users });
});

// === ERROR HANDLING === //

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unbehandelter Fehler:', err);
  
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Ein unerwarteter Fehler ist aufgetreten'
    : err.message;
    
  res.status(500).json({ error: message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint nicht gefunden' });
});

// Serve the main HTML file for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === STARTUP-VALIDIERUNG === //

// Validate OpenAI Key at startup
setTimeout(async () => {
    console.log('\n🔍 Validiere OpenAI Konfiguration...');
    const isValid = await validateOpenAIKey();
    
    if (isValid) {
        console.log('🎉 OpenAI API vollständig funktionsfähig!');
    } else {
        console.log('\n⚠️  OpenAI API nicht verfügbar!');
        console.log('💡 Um die KI-Features zu aktivieren:');
        if (process.env.NODE_ENV === 'production') {
            console.log('   📋 Render Environment Variables:');
            console.log('   1. Gehen Sie zu Ihrem Render Dashboard');
            console.log('   2. Wählen Sie Ihr Service');
            console.log('   3. Gehen Sie zu "Environment"');
            console.log('   4. Fügen Sie hinzu: OPENAI_API_KEY = sk-proj-...');
            console.log('   5. Service wird automatisch neu gestartet');
        } else {
            console.log('   1. Erstellen Sie einen Account bei https://platform.openai.com');
            console.log('   2. Erstellen Sie einen API Key');
            console.log('   3. Fügen Sie diesen in die .env Datei ein:');
            console.log('      OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
            console.log('   4. Starten Sie den Server neu');
        }
    }
}, 2000);

// --- SERVER START --- //
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Praxida 2.0 Server läuft auf Port ${PORT}`);
  console.log(`🌍 URL: ${process.env.NODE_ENV === 'production' ? 'Render-URL' : `http://localhost:${PORT}`}`);
  
  if (!OPENAI_API_KEY) {
    console.log(`⚠️  WARNUNG: Kein OpenAI API Key gefunden!`);
    console.log(`   ${process.env.NODE_ENV === 'production' ? 'Render Environment Variables' : '.env Datei'} konfigurieren für:`);
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
  
  console.log('✅ Multi-Tenant Backend geladen!');
  console.log('💾 SQLite Datenbank: ' + db.name);
  console.log('🔒 Session Store: SQLite');
  console.log('⚡ Performance: WAL Mode aktiviert');
  console.log('📈 Multi-Tenant: AKTIV');
  console.log('🎯 Assessment Tools: PHQ-9, GAD-7');
  console.log('🌐 Environment:', process.env.NODE_ENV || 'development');
  console.log('');
  console.log('🏁 Praxida 2.0 bereit für Anfragen!');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Fahre Server herunter...');
  
  // Close database connection
  try {
    if (db) {
      db.pragma('wal_checkpoint(FULL)');
      db.close();
      console.log('✅ Datenbank-Verbindung geschlossen');
    }
  } catch (error) {
    console.error('❌ Fehler beim Schließen der Datenbank:', error);
  }
  
  console.log('👋 Praxida 2.0 Server beendet');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM empfangen, beende Server...');
  
  try {
    if (db) {
      db.pragma('wal_checkpoint(FULL)');
      db.close();
      console.log('✅ Datenbank geschlossen');
    }
  } catch (error) {
    console.error('❌ Fehler beim Schließen:', error);
  }
  
  process.exit(0);
});

// === DEMO ACCOUNTS ERSTELLEN BEI SERVER-START === //
setTimeout(async () => {
  await createStableDemoAccounts();
}, 1000); // Nach 1 Sekunde statt mehrfach

console.log('🔧 LOGIN-FIX GELADEN - Demo-Accounts werden erstellt...');

module.exports = app;
