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

// Proxy vertrauen, damit rate-limit X-Forwarded-For korrekt auswerten kann
app.set('trust proxy', 1);

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
  },
  'PCL-5': {
    name: 'PTSD Checklist for DSM-5',
    type: 'trauma',
    questions: [
      'Wiederholte, störende und ungewollte Erinnerungen an das belastende Ereignis',
      'Wiederholte, störende Träume über das belastende Ereignis',
      'Plötzliches Verhalten oder Gefühl, als ob das belastende Ereignis erneut geschieht',
      'Sehr starke belastende Gefühle bei Erinnerung an das Ereignis',
      'Starke körperliche Reaktionen bei Erinnerung an das Ereignis',
      'Vermeidung von Erinnerungen, Gedanken oder Gefühlen bezüglich des Ereignisses',
      'Vermeidung von äußeren Erinnerungen (Menschen, Orte, Gespräche, etc.)',
      'Probleme, sich an wichtige Teile des belastenden Ereignisses zu erinnern',
      'Starke negative Überzeugungen über sich selbst, andere oder die Welt',
      'Andere oder sich selbst für das Ereignis oder die Folgen verantwortlich machen',
      'Starke negative Gefühle (Angst, Wut, Schuld, Scham)',
      'Deutlich vermindertes Interesse an Aktivitäten',
      'Gefühl der Entfremdung oder Distanziertheit von anderen',
      'Anhaltende Unfähigkeit positive Gefühle zu empfinden',
      'Reizbarkeit, Wutausbrüche oder Aggressivität',
      'Übermäßig risikoreiches oder selbstschädigendes Verhalten',
      'Übermäßige Wachsamkeit',
      'Übertriebene Schreckreaktionen',
      'Schwierigkeiten sich zu konzentrieren',
      'Schlafstörungen'
    ],
    scale: ['Überhaupt nicht', 'Ein wenig', 'Mäßig', 'Ziemlich', 'Extrem'],
    scoring: {
      minimal: [0, 32],
      mild: [33, 37],
      moderate: [38, 43],
      severe: [44, 80]
    },
    maxScore: 80
  },
  'OQ-45': {
    name: 'Outcome Questionnaire-45',
    type: 'general',
    questions: [
      'Ich komme mit anderen Menschen gut aus',
      'Ich werde müde ohne besonderen Grund',
      'Ich bin unglücklich in meiner Ehe/Partnerschaft',
      'Ich habe Gedanken, mir selbst das Leben zu nehmen',
      'Ich fühle mich schwach',
      'Meine Arbeit/Schule leidet',
      'Ich bin eine glückliche Person',
      'Ich habe Probleme bei der Arbeit/Schule wegen Drogen- oder Alkoholkonsums'
      // Vereinfachte Version - das echte OQ-45 hat 45 Fragen
    ],
    scale: ['Nie', 'Selten', 'Manchmal', 'Häufig', 'Fast immer'],
    scoring: {
      normal: [0, 63],
      mild: [64, 83],
      moderate: [84, 103],
      severe: [104, 180]
    },
    maxScore: 180
  }
};

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

// --- ASSESSMENT HELPER FUNCTIONS --- //

function calculateAssessmentScore(assessmentType, responses) {
    const assessment = ASSESSMENTS[assessmentType];
    if (!assessment) throw new Error('Unbekannter Assessment-Typ');
    
    const totalScore = responses.reduce((sum, response) => sum + response, 0);
    
    // Bestimme Schweregrad
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

async function generateOutcomeAnalysis(clientId, assessmentType = null) {
    try {
        const assessments = getAssessmentsByClient(clientId, assessmentType);
        
        if (assessments.length < 2) {
            return {
                analysis: 'Nicht genügend Daten für Verlaufsanalyse. Mindestens 2 Assessments erforderlich.',
                trend: 'insufficient_data',
                recommendations: ['Regelmäßige Assessments durchführen für bessere Verlaufsdokumentation']
            };
        }
        
        // Trend-Analyse
        const latest = assessments[0];
        const previous = assessments[1];
        const scoreDifference = latest.total_score - previous.total_score;
        const percentageChange = Math.round(((scoreDifference) / previous.total_score) * 100);
        
        let trend = 'stable';
        let trendDescription = '';
        
        if (scoreDifference < -2) {
            trend = 'improving';
            trendDescription = `Verbesserung um ${Math.abs(scoreDifference)} Punkte (${Math.abs(percentageChange)}%)`;
        } else if (scoreDifference > 2) {
            trend = 'worsening';
            trendDescription = `Verschlechterung um ${scoreDifference} Punkte (${percentageChange}%)`;
        } else {
            trend = 'stable';
            trendDescription = `Stabiler Verlauf (${scoreDifference >= 0 ? '+' : ''}${scoreDifference} Punkte)`;
        }
        
        // KI-gestützte Analyse falls OpenAI verfügbar
        let detailedAnalysis = '';
        if (process.env.OPENAI_API_KEY) {
            const assessmentData = assessments.slice(0, 5).map(a => ({
                date: a.completed_at.split('T')[0],
                score: a.total_score,
                severity: a.severity_level
            }));
            
            const prompt = `Als Therapeut analysiere folgenden ${assessmentType} Verlauf:
            
${assessmentData.map(d => `${d.date}: ${d.score} Punkte (${d.severity})`).join('\n')}

Erstelle eine professionelle Interpretation mit:
1. Klinische Bedeutung der Veränderungen
2. Prognose-Einschätzung  
3. Konkrete Therapie-Empfehlungen
4. Warnsignale (falls vorhanden)

Antworte strukturiert und wissenschaftlich fundiert.`;

            try {
                detailedAnalysis = await callOpenAI([
                    { role: "system", content: "Du bist ein erfahrener Psychotherapeut und Supervisor mit Expertise in Outcome-Messung." },
                    { role: "user", content: prompt }
                ]);
            } catch (error) {
                console.error('KI-Analyse Fehler:', error);
                detailedAnalysis = 'KI-Analyse momentan nicht verfügbar.';
            }
        }
        
        return {
            analysis: detailedAnalysis || generateBasicAnalysis(latest, previous, trend, trendDescription),
            trend: trend,
            scoreChange: scoreDifference,
            percentageChange: percentageChange,
            currentScore: latest.total_score,
            currentSeverity: latest.severity_level,
            assessmentCount: assessments.length,
            recommendations: generateRecommendations(trend, latest.severity_level, assessmentType)
        };
        
    } catch (error) {
        console.error('❌ Fehler bei Outcome-Analyse:', error);
        throw error;
    }
}

function generateBasicAnalysis(latest, previous, trend, trendDescription) {
    const assessment = ASSESSMENTS[latest.assessment_type];
    
    return `
        <div style="background: #f8f9ff; padding: 20px; border-radius: 12px; border-left: 4px solid #667eea;">
            <h4 style="color: #667eea; margin-bottom: 15px;">📊 Verlaufsanalyse ${assessment.name}</h4>
            
            <p><strong>Aktueller Status:</strong><br>
            Score: ${latest.total_score}/${assessment.maxScore} Punkte<br>
            Schweregrad: ${latest.severity_level}<br>
            ${trendDescription}</p>
            
            <p><strong>Klinische Interpretation:</strong><br>
            ${trend === 'improving' ? 
                '✅ Der Patient zeigt eine positive Entwicklung. Die Symptombelastung hat sich messbar reduziert.' :
                trend === 'worsening' ?
                '⚠️ Verschlechterung erkennbar. Therapieplan sollte überprüft und angepasst werden.' :
                '➡️ Stabiler Verlauf. Aktuelle Interventionen scheinen angemessen zu sein.'
            }</p>
            
            <p><strong>Empfehlung:</strong><br>
            ${trend === 'improving' ? 
                'Aktuelle Therapiestrategie beibehalten. Nächstes Assessment in 4 Wochen.' :
                trend === 'worsening' ?
                'Supervision erwägen. Therapiefrequenz erhöhen. Krisenintervention prüfen.' :
                'Regelmäßige Assessments fortführen. Therapieziele überprüfen.'
            }</p>
        </div>
    `;
}

function generateRecommendations(trend, severity, assessmentType) {
    const recommendations = [];
    
    if (trend === 'improving') {
        recommendations.push('Aktuelle Therapiestrategie beibehalten');
        recommendations.push('Fortschritte mit Patient besprechen und verstärken');
        recommendations.push('Nächstes Assessment in 4 Wochen');
    } else if (trend === 'worsening') {
        recommendations.push('Therapieplan überprüfen und anpassen');
        recommendations.push('Supervision oder Intervision in Anspruch nehmen');
        recommendations.push('Häufigere Termine erwägen');
        if (severity === 'severe') {
            recommendations.push('⚠️ Krisenintervention und Sicherheitsplan prüfen');
        }
    } else {
        recommendations.push('Regelmäßige Assessments fortführen');
        recommendations.push('Therapieziele und -methoden evaluieren');
        recommendations.push('Motivation und Therapieadhärenz stärken');
    }
    
    return recommendations;
}

// Security Middleware
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

// Session Configuration
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './data',
    table: 'sessions'
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'praxida.sid',
  cookie: {
    secure: false, // ✅ FALSE für localhost! In production auf true setzen
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  },
  rolling: true
}));

// === DATABASE HELPER FUNCTIONS === //

function getUserByEmail(email) {
  try {
    const stmt = db.prepare(`
      SELECT u.*, p.name as praxis_name 
      FROM users u 
      LEFT JOIN praxis p ON u.praxis_id = p.id 
      WHERE u.email = ?
    `);
    return stmt.get(email);
  } catch (error) {
    console.error('❌ Fehler beim Abrufen des Benutzers:', error);
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

// === ROUTING - MUSS VOR express.static() KOMMEN === //

// Landing Page als Root (öffentlich)
app.get('/', (req, res) => {
  console.log('🎯 Landing Page Route aufgerufen');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Dashboard/App (mit Authentication)
app.get('/app', requireAuth, (req, res) => {
  console.log('🎯 Dashboard Route aufgerufen für:', req.user.name);
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Legacy Support für index.html
app.get('/index.html', requireAuth, (req, res) => {
  console.log('🎯 Legacy index.html Route aufgerufen');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Static Files NACH den Routes, mit index: false
app.use(express.static(path.join(__dirname, "public"), {
  index: false // ✅ Verhindert automatisches Serving von index.html
}));

// === AUTHENTICATION ROUTES === //

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

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, praxis_name } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    console.log('🔐 Login-Versuch:', email);

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'E-Mail und Passwort sind erforderlich' 
      });
    }

    // Check for recent failed attempts
    const recentAttempts = getRecentLoginAttempts(email);
    if (recentAttempts >= 5) {
      createLoginAttempt(email, false, ip, userAgent);
      return res.status(429).json({ 
        error: 'Account temporär gesperrt. Zu viele fehlgeschlagene Login-Versuche.' 
      });
    }

    // Get user
    const user = getUserByEmail(email);
    if (!user) {
      createLoginAttempt(email, false, ip, userAgent);
      return res.status(401).json({ 
        error: 'Ungültige Anmeldedaten' 
      });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      createLoginAttempt(email, false, ip, userAgent);
      return res.status(401).json({ 
        error: 'Ungültige Anmeldedaten' 
      });
    }

    // Check praxis match if provided
    if (praxis_name && user.praxis_name !== praxis_name) {
      createLoginAttempt(email, false, ip, userAgent);
      return res.status(401).json({ 
        error: 'Benutzer gehört nicht zu der angegebenen Praxis' 
      });
    }

    // Successful login
    createLoginAttempt(email, true, ip, userAgent);

    // Create session
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

    console.log('🔍 Session vor dem Speichern:', req.session.user);
    console.log('🔍 Session ID:', req.sessionID);

    // ✅ SESSION EXPLIZIT SPEICHERN!
    req.session.save((err) => {
      if (err) {
        console.error('❌ Session-Speicher-Fehler:', err);
        return res.status(500).json({ error: 'Fehler beim Speichern der Session' });
      }

      console.log('✅ Session erfolgreich gespeichert:', req.sessionID);
      console.log('🍪 Session User:', req.session.user);
      console.log(`✅ Erfolgreicher Login: ${user.name} (${user.email}) - Rolle: ${user.role}`);

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
    console.error('❌ Login-Fehler:', error);
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
  console.log('🔍 /api/auth/me aufgerufen für:', req.user.name);
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

// Add user to existing praxis (admin only)
app.post('/api/auth/add-user', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ 
        error: 'Alle Felder sind erforderlich' 
      });
    }

    if (!['admin', 'therapeut', 'assistenz'].includes(role)) {
      return res.status(400).json({ 
        error: 'Ungültige Rolle' 
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ 
        error: 'Passwort muss mindestens 8 Zeichen lang sein' 
      });
    }

    // Check if user already exists
    const existingUser = getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ 
        error: 'E-Mail-Adresse bereits registriert' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user in same praxis as admin
    const userData = {
      praxis_id: req.user.praxis_id,
      name: name,
      email: email,
      password_hash: hashedPassword,
      role: role
    };

    const result = addUser(userData);

    console.log(`✅ Neuer Benutzer hinzugefügt: ${name} (${role}) von Admin: ${req.user.name}`);

    res.json({ 
      success: true, 
      message: 'Benutzer erfolgreich hinzugefügt',
      user_id: result.lastInsertRowid
    });

  } catch (error) {
    console.error('❌ Fehler beim Hinzufügen des Benutzers:', error);
    res.status(500).json({ 
      error: 'Fehler beim Hinzufügen des Benutzers: ' + error.message 
    });
  }
});

// Get users in same praxis (admin and therapeut)
app.get('/api/auth/users', requireAuth, requireRole('admin', 'therapeut'), (req, res) => {
  try {
    const users = getUsersByPraxis(req.user.praxis_id);
    
    // Remove sensitive data
    const safeUsers = users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.created_at
    }));

    res.json(safeUsers);
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Benutzer:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Benutzer' });
  }
});

// Update user password
app.put('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ 
        error: 'Aktuelles und neues Passwort erforderlich' 
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ 
        error: 'Neues Passwort muss mindestens 8 Zeichen lang sein' 
      });
    }

    // Verify current password
    const user = getUserById(req.user.id);
    const passwordValid = await bcrypt.compare(current_password, user.password_hash);
    
    if (!passwordValid) {
      return res.status(401).json({ 
        error: 'Aktuelles Passwort ist falsch' 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    const stmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    stmt.run(hashedPassword, req.user.id);

    console.log(`🔑 Passwort geändert für Benutzer: ${req.user.name}`);

    res.json({ 
      success: true, 
      message: 'Passwort erfolgreich geändert' 
    });

  } catch (error) {
    console.error('❌ Fehler beim Passwort-Wechsel:', error);
    res.status(500).json({ 
      error: 'Fehler beim Ändern des Passworts: ' + error.message 
    });
  }
});

// Delete user (admin only, cannot delete self)
app.delete('/api/auth/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (userId === req.user.id) {
      return res.status(400).json({ 
        error: 'Sie können sich nicht selbst löschen' 
      });
    }

    // Check if user belongs to same praxis
    const targetUser = getUserById(userId);
    if (!targetUser || targetUser.praxis_id !== req.user.praxis_id) {
      return res.status(404).json({ 
        error: 'Benutzer nicht gefunden oder gehört zu anderer Praxis' 
      });
    }

    // Delete user
    const stmt = db.prepare("DELETE FROM users WHERE id = ?");
    const result = stmt.run(userId);

    if (result.changes === 0) {
      return res.status(404).json({ 
        error: 'Benutzer nicht gefunden' 
      });
    }

    console.log(`🗑️ Benutzer gelöscht: ${targetUser.name} von Admin: ${req.user.name}`);

    res.json({ 
      success: true, 
      message: 'Benutzer erfolgreich gelöscht' 
    });

  } catch (error) {
    console.error('❌ Fehler beim Löschen des Benutzers:', error);
    res.status(500).json({ 
      error: 'Fehler beim Löschen des Benutzers: ' + error.message 
    });
  }
});

// Get login attempts (admin only)
app.get('/api/auth/login-attempts', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT email, success, ip_address, attempted_at 
      FROM login_attempts 
      WHERE attempted_at > datetime('now', '-7 days')
      ORDER BY attempted_at DESC 
      LIMIT 100
    `);
    
    const attempts = stmt.all();
    res.json(attempts);
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Login-Versuche:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Login-Versuche' });
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

app.get("/api/clients/:id", requireAuth, requirePraxis, (req, res) => {
  try {
    const client = getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: "Client nicht gefunden" });
    
    // Check if client belongs to user's praxis
    if (client.praxis_id && client.praxis_id !== req.user.praxis_id) {
      return res.status(403).json({ error: "Zugriff verweigert" });
    }
    
    res.json(client);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen eines Clients:", err);
    res.status(500).json({ error: "Fehler beim Abrufen des Clients" });
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

app.put("/api/clients/:id", requireAuth, requirePraxis, (req, res) => {
  try {
    // Check if client belongs to user's praxis
    const client = getClientById(req.params.id);
    if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    
    const updates = req.body;
    delete updates.id;
    delete updates.praxis_id; // Prevent praxis_id changes
    
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

app.delete("/api/clients/:id", requireAuth, requirePraxis, (req, res) => {
  try {
    // Check if client belongs to user's praxis
    const client = getClientById(req.params.id);
    if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    
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

app.post("/api/audio/upload", requireAuth, upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Keine Audio-Datei hochgeladen" });
        }

        console.log(`🎤 Audio-Datei hochgeladen: ${req.file.originalname}`);
        
        const audioFilePath = req.file.path;
        const clientId = req.body.client_id || null;
        const analysisType = req.body.analysis_type || 'protocol';

        // Transkription mit Whisper
        console.log('📄 Starte Whisper-Transkription...');
        const transcription = await transcribeAudio(audioFilePath);
        console.log('✅ Transkription abgeschlossen');

        // KI-Analyse des Transkripts
        console.log('📄 Starte KI-Analyse...');
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

app.post("/api/audio/analyze", requireAuth, async (req, res) => {
    try {
        const { text, analysis_type, client_id } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: "Text für Analyse erforderlich" });
        }

        console.log('📄 Starte Text-Analyse...');
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

app.post("/api/chat", requireAuth, async (req, res) => {
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

app.post("/api/upload", requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    console.log(`📄 Datei hochgeladen: ${req.file.originalname}`);
    
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

// --- ASSESSMENT API ROUTES --- //

// Verfügbare Assessments abrufen
app.get("/api/assessments/types", requireAuth, (req, res) => {
    try {
        const types = Object.keys(ASSESSMENTS).map(key => ({
            key: key,
            name: ASSESSMENTS[key].name,
            type: ASSESSMENTS[key].type,
            questionCount: ASSESSMENTS[key].questions.length
        }));
        res.json(types);
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Assessment-Typen" });
    }
});

// Spezifisches Assessment-Template abrufen
app.get("/api/assessments/template/:type", requireAuth, (req, res) => {
    try {
        const assessment = ASSESSMENTS[req.params.type];
        if (!assessment) {
            return res.status(404).json({ error: "Assessment-Typ nicht gefunden" });
        }
        res.json(assessment);
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen des Assessment-Templates" });
    }
});

// Assessment einreichen und bewerten
app.post("/api/assessments", requireAuth, requirePraxis, (req, res) => {
    try {
        const { client_id, session_id, assessment_type, responses, notes } = req.body;
        
        if (!client_id || !assessment_type || !responses) {
            return res.status(400).json({ error: "Pflichtfelder fehlen" });
        }
        
        // Check if client belongs to user's praxis
        const client = getClientById(client_id);
        if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
            return res.status(404).json({ error: "Client nicht gefunden" });
        }
        
        // Score berechnen
        const scoreResult = calculateAssessmentScore(assessment_type, responses);
        
        // Assessment speichern
        const assessmentData = {
            client_id,
            session_id,
            assessment_type,
            responses,
            total_score: scoreResult.totalScore,
            severity_level: scoreResult.severityLevel,
            notes
        };
        
        const result = addAssessment(assessmentData);
        
        res.json({
            success: true,
            id: result.lastInsertRowid,
            score: scoreResult
        });
        
    } catch (error) {
        console.error("❌ Fehler beim Verarbeiten des Assessments:", error);
        res.status(500).json({ error: "Fehler beim Verarbeiten des Assessments" });
    }
});

// Assessments für einen Client abrufen
app.get("/api/clients/:id/assessments", requireAuth, requirePraxis, (req, res) => {
    try {
        // Check if client belongs to user's praxis
        const client = getClientById(req.params.id);
        if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
            return res.status(404).json({ error: "Client nicht gefunden" });
        }
        
        const assessments = getAssessmentsByClient(req.params.id);
        res.json(assessments);
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Assessments" });
    }
});

// Outcome-Analyse generieren
app.get("/api/clients/:id/outcome-analysis", requireAuth, requirePraxis, async (req, res) => {
    try {
        const clientId = req.params.id;
        const assessmentType = req.query.type || null;
        
        // Check if client belongs to user's praxis
        const client = getClientById(clientId);
        if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
            return res.status(404).json({ error: "Client nicht gefunden" });
        }
        
        const analysis = await generateOutcomeAnalysis(clientId, assessmentType);
        res.json(analysis);
        
    } catch (error) {
        console.error("❌ Fehler bei Outcome-Analyse:", error);
        res.status(500).json({ error: "Fehler bei der Outcome-Analyse" });
    }
});

// Assessment-Verlauf für Visualisierung
app.get("/api/clients/:id/assessment-history/:type", requireAuth, requirePraxis, (req, res) => {
    try {
        // Check if client belongs to user's praxis
        const client = getClientById(req.params.id);
        if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
            return res.status(404).json({ error: "Client nicht gefunden" });
        }
        
        const assessments = getAssessmentsByClient(req.params.id, req.params.type);
        
        const history = assessments.reverse().map(a => ({
            date: a.completed_at.split('T')[0],
            score: a.total_score,
            severity: a.severity_level,
            sessionId: a.session_id
        }));
        
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Assessment-Historie" });
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

// --- SESSION ROUTES --- //
app.post("/api/sessions", requireAuth, requirePraxis, (req, res) => {
  try {
    // Check if client belongs to user's praxis
    const client = getClientById(req.body.client_id);
    if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    
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

app.get("/api/clients/:id/sessions", requireAuth, requirePraxis, (req, res) => {
  try {
    // Check if client belongs to user's praxis
    const client = getClientById(req.params.id);
    if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    
    const sessions = getSessionsByClient(req.params.id);
    res.json(sessions);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Sessions:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Sessions" });
  }
});

app.get("/api/clients/:id/chat", requireAuth, requirePraxis, (req, res) => {
  try {
    // Check if client belongs to user's praxis
    const client = getClientById(req.params.id);
    if (!client || (client.praxis_id && client.praxis_id !== req.user.praxis_id)) {
      return res.status(404).json({ error: "Client nicht gefunden" });
    }
    
    const history = getChatHistory(req.params.id);
    res.json(history);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen des Chat-Verlaufs:", err);
    res.status(500).json({ error: "Fehler beim Abrufen des Chat-Verlaufs" });
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

// === SESSION MANAGEMENT === //

// Clean expired sessions (run periodically)
function cleanExpiredSessions() {
  try {
    const stmt = db.prepare(`
      DELETE FROM sessions 
      WHERE datetime(expired) < datetime('now')
    `);
    const result = stmt.run();
    if (result.changes > 0) {
      console.log(`🧹 ${result.changes} abgelaufene Sessions gelöscht`);
    }
  } catch (error) {
    console.warn('Fehler beim Löschen abgelaufener Sessions:', error);
  }
}

// Clean sessions every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

// === DEMO DATA FOR MULTI-TENANT === //

async function createDemoAccounts() {
  try {
    // Check if demo praxis already exists
    const existingPraxis = getPraxisByName('Demo Praxis Köln');
    if (existingPraxis) {
      console.log('📋 Demo-Praxis bereits vorhanden');
      return;
    }

    // Create demo praxis
    const praxisData = {
      name: 'Demo Praxis Köln',
      email: 'info@demo-praxis.de',
      telefon: '+49 221 123456',
      adresse: 'Musterstraße 123, 50667 Köln'
    };
    
    const praxisResult = addPraxis(praxisData);
    const praxisId = praxisResult.lastInsertRowid;

    // Create demo users
    const demoUsers = [
      {
        name: 'Dr. Demo Admin',
        email: 'admin@demo-praxis.de',
        password: 'demo123456',
        role: 'admin'
      },
      {
        name: 'Dr. Sarah Therapeutin',
        email: 'therapeut@demo-praxis.de',
        password: 'demo123456',
        role: 'therapeut'
      },
      {
        name: 'Lisa Assistenz',
        email: 'assistenz@demo-praxis.de',
        password: 'demo123456',
        role: 'assistenz'
      }
    ];

    for (const demoUser of demoUsers) {
      const hashedPassword = await bcrypt.hash(demoUser.password, 12);
      
      const userData = {
        praxis_id: praxisId,
        name: demoUser.name,
        email: demoUser.email,
        password_hash: hashedPassword,
        role: demoUser.role
      };

      addUser(userData);
    }

    console.log('✅ Demo-Accounts erstellt:');
    console.log('   📧 admin@demo-praxis.de / demo123456 (Admin)');
    console.log('   📧 therapeut@demo-praxis.de / demo123456 (Therapeut)');
    console.log('   📧 assistenz@demo-praxis.de / demo123456 (Assistenz)');

  } catch (error) {
    console.error('❌ Fehler beim Erstellen der Demo-Accounts:', error);
  }
}

// Create demo accounts on startup
setTimeout(createDemoAccounts, 1000);

// === MAINTENANCE ROUTES === //

// Database maintenance (admin only)
app.post('/api/maintenance/vacuum', requireAuth, requireRole('admin'), (req, res) => {
  try {
    vacuum();
    res.json({ success: true, message: 'Datenbank-Wartung abgeschlossen' });
  } catch (error) {
    res.status(500).json({ error: 'Fehler bei Datenbank-Wartung' });
  }
});

// Database backup (admin only)
app.post('/api/maintenance/backup', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const backupPath = path.join(__dirname, 'data', `backup_${Date.now()}.db`);
    const success = backupDatabase(backupPath);
    
    if (success) {
      res.json({ success: true, message: 'Backup erstellt', path: backupPath });
    } else {
      res.status(500).json({ error: 'Backup fehlgeschlagen' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Backup' });
  }
});

// System stats (admin only)
app.get('/api/maintenance/stats', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const stats = getDataStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der System-Stats' });
  }
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

// 404 handler - muss NACH allen anderen Routes kommen
app.use((req, res) => {
  console.log('❌ 404 für:', req.url);
  res.status(404).json({ error: 'Endpoint nicht gefunden' });
});

console.log('🔐 Multi-Tenant Authentication System aktiviert!');
console.log('📝 Registrierung: POST /api/auth/register-praxis');
console.log('🔑 Login: POST /api/auth/login');
console.log('👤 Benutzer hinzufügen: POST /api/auth/add-user');
console.log('🛡️ Alle API-Routen sind jetzt authentifiziert');

// --- SERVER START --- //
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Praxida 2.0 Server läuft auf Port ${PORT}`);
  console.log(`🌍 Öffnen Sie: http://localhost:${PORT}`);
  
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
  
  console.log('✅ Outcome-Tracking Backend geladen!');
  console.log('💾 SQLite Datenbank: ' + db.name);
  console.log('🔒 Session Store: SQLite');
  console.log('⚡ Performance: WAL Mode aktiviert');
  console.log('📈 Multi-Tenant: AKTIV');
  console.log('🎯 Assessment Tools: PHQ-9, GAD-7, PCL-5, OQ-45');
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

module.exports = app;
