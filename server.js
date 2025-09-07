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
app.use(express.static(path.join(__dirname, "public")));

// --- Database Import mit zusätzlichen Helper-Funktionen --- //
const Database = require("better-sqlite3");
const crypto = require("crypto");

// Ensure data directory exists
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("📁 Data directory created");
}

// Database path
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, "praxida.db");
console.log("📍 Database path:", dbPath);

// Initialize database connection
let db;
try {
    db = new Database(dbPath);
    console.log("✅ Database connection established");
    
    // Optimize SQLite settings
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 1000000');
    db.pragma('temp_store = memory');
    db.pragma('mmap_size = 268435456'); // 256MB
    db.pragma('foreign_keys = ON');
    
    console.log("⚙️ Database optimizations applied");
    
} catch (error) {
    console.error("❌ Database connection failed:", error);
    process.exit(1);
}

// Erweiterte Database Helper Functions
function getUserByEmail(email) {
  try {
    const stmt = db.prepare(`
      SELECT u.*, p.name as praxis_name 
      FROM users u 
      LEFT JOIN praxis p ON u.praxis_id = p.id 
      WHERE u.email = ? AND u.is_active = 1
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
      WHERE u.id = ? AND u.is_active = 1
    `);
    return stmt.get(id);
  } catch (error) {
    console.error('❌ Fehler beim Abrufen des Benutzers:', error);
    return null;
  }
}

function getPraxisByName(name) {
  try {
    const stmt = db.prepare("SELECT * FROM praxis WHERE name = ? AND is_active = 1");
    return stmt.get(name);
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Praxis:', error);
    return null;
  }
}

function addPraxis(praxisData) {
    try {
        const stmt = db.prepare(`
            INSERT INTO praxis (name, email, telefon, adresse, website, created_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const result = stmt.run(
            praxisData.name,
            praxisData.email || null,
            praxisData.telefon || null,
            praxisData.adresse || null,
            praxisData.website || null
        );
        
        console.log("✅ Praxis created:", praxisData.name);
        return result;
    } catch (error) {
        console.error("❌ Error creating praxis:", error);
        throw error;
    }
}

function addUser(userData) {
    try {
        const stmt = db.prepare(`
            INSERT INTO users (
                praxis_id, name, email, password_hash, role, 
                permissions, access_expires, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const result = stmt.run(
            userData.praxis_id,
            userData.name,
            userData.email,
            userData.password_hash,
            userData.role || 'therapeut',
            userData.permissions || '{}',
            userData.access_expires || null
        );
        
        console.log("✅ User created:", userData.name);
        return result;
    } catch (error) {
        console.error("❌ Error creating user:", error);
        throw error;
    }
}

function getUsersByPraxis(praxisId) {
    try {
        const stmt = db.prepare(`
            SELECT id, name, email, role, is_active, last_login, created_at
            FROM users
            WHERE praxis_id = ? AND is_active = 1
            ORDER BY name ASC
        `);
        return stmt.all(praxisId);
    } catch (error) {
        console.error("❌ Error fetching users by praxis:", error);
        return [];
    }
}

function addClient(clientData) {
    try {
        const clientNumber = generateClientNumber();
        
        const stmt = db.prepare(`
            INSERT INTO clients (
                praxis_id, client_number, name, full_name, email, phone, 
                birth_date, address, diagnosis_primary, therapy_type, 
                sessions_approved, start_date, notes, risk_level,
                consent_data_processing, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const result = stmt.run(
            clientData.praxis_id,
            clientNumber,
            clientData.name,
            clientData.full_name || null,
            clientData.email || null,
            clientData.phone || null,
            clientData.birth_date || null,
            clientData.address || null,
            clientData.diagnosis || null,
            clientData.therapy_type || 'VT',
            clientData.sessions_approved || 25,
            clientData.start_date || new Date().toISOString().split('T')[0],
            clientData.notes || null,
            clientData.risk_level || 'niedrig',
            clientData.consent_data_processing || 1,
            clientData.created_by || null
        );
        
        console.log("✅ Client created:", clientData.name);
        return result;
    } catch (error) {
        console.error("❌ Error creating client:", error);
        throw error;
    }
}

function getClients(praxisId) {
    try {
        const stmt = db.prepare(`
            SELECT 
                c.*,
                COUNT(s.id) as total_sessions,
                MAX(s.date) as latest_session,
                COUNT(CASE WHEN s.status = 'nicht_erschienen' THEN 1 END) as no_show_count,
                AVG(s.mood_after - s.mood_before) as avg_mood_improvement
            FROM clients c
            LEFT JOIN sessions s ON c.id = s.client_id
            WHERE c.praxis_id = ? AND c.is_archived = 0
            GROUP BY c.id
            ORDER BY c.name ASC
        `);
        return stmt.all(praxisId);
    } catch (error) {
        console.error("❌ Error fetching clients:", error);
        return [];
    }
}

function getClientById(id, userPraxisId = null) {
    try {
        const stmt = db.prepare(`
            SELECT 
                c.*,
                COUNT(s.id) as total_sessions,
                COUNT(CASE WHEN s.date >= date('now', '-30 days') THEN 1 END) as sessions_last_month,
                MAX(s.date) as latest_session,
                MIN(s.date) as first_session,
                AVG(s.mood_after - s.mood_before) as avg_mood_improvement,
                COUNT(tg.id) as active_goals
            FROM clients c
            LEFT JOIN sessions s ON c.id = s.client_id
            LEFT JOIN treatment_goals tg ON c.id = tg.client_id AND tg.status = 'active'
            WHERE c.id = ? AND c.is_archived = 0
            GROUP BY c.id
        `);
        
        const client = stmt.get(id);
        
        if (client && userPraxisId && client.praxis_id !== userPraxisId) {
            return null; // Access denied
        }
        
        return client;
    } catch (error) {
        console.error("❌ Error fetching client:", error);
        return null;
    }
}

function updateClient(id, updates, userPraxisId = null, userId = null) {
    try {
        const client = getClientById(id, userPraxisId);
        if (!client) {
            throw new Error('Client not found or access denied');
        }
        
        const allowedFields = [
            'name', 'full_name', 'email', 'phone', 'birth_date', 'address',
            'diagnosis_primary', 'diagnosis_secondary', 'therapy_type', 'therapy_status',
            'sessions_approved', 'session_frequency', 'notes', 'risk_level', 'risk_assessment'
        ];
        
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
        
        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }
        
        const setClause = fields.map(key => `${key} = ?`).join(', ');
        const values = fields.map(key => updates[key]);
        values.push(id);
        
        const stmt = db.prepare(`
            UPDATE clients 
            SET ${setClause}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        
        const result = stmt.run(...values);
        console.log("✅ Client updated:", id);
        return result;
    } catch (error) {
        console.error("❌ Error updating client:", error);
        throw error;
    }
}

function deleteClient(id, userPraxisId = null, userId = null) {
    try {
        const client = getClientById(id, userPraxisId);
        if (!client) {
            throw new Error('Client not found or access denied');
        }
        
        const stmt = db.prepare(`
            UPDATE clients 
            SET is_archived = 1, archived_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        
        const result = stmt.run(id);
        console.log("✅ Client archived:", id);
        return result;
    } catch (error) {
        console.error("❌ Error deleting client:", error);
        throw error;
    }
}

function addSession(sessionData) {
    try {
        const sessionNumberStmt = db.prepare(`
            SELECT COALESCE(MAX(session_number), 0) + 1 as next_number
            FROM sessions WHERE client_id = ?
        `);
        const nextNumber = sessionNumberStmt.get(sessionData.client_id).next_number;
        
        const stmt = db.prepare(`
            INSERT INTO sessions (
                client_id, session_number, date, duration, type, location,
                status, notes, private_notes, homework_given, mood_before, 
                mood_after, therapeutic_focus, interventions_used, 
                billing_code, billing_points, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const result = stmt.run(
            sessionData.client_id,
            nextNumber,
            sessionData.date || new Date().toISOString().split('T')[0],
            sessionData.duration || 50,
            sessionData.type || 'Einzeltherapie',
            sessionData.location || 'Praxis',
            sessionData.status || 'geplant',
            sessionData.notes || null,
            sessionData.private_notes || null,
            sessionData.homework_given || null,
            sessionData.mood_before || null,
            sessionData.mood_after || null,
            sessionData.therapeutic_focus || null,
            sessionData.interventions_used || null,
            sessionData.billing_code || null,
            sessionData.billing_points || null,
            sessionData.created_by || null
        );
        
        console.log("✅ Session created for client:", sessionData.client_id);
        return result;
    } catch (error) {
        console.error("❌ Error creating session:", error);
        throw error;
    }
}

function getSessionsByClient(clientId, limit = 50, userPraxisId = null) {
    try {
        const client = getClientById(clientId, userPraxisId);
        if (!client) {
            throw new Error('Client not found or access denied');
        }
        
        const stmt = db.prepare(`
            SELECT 
                s.*,
                c.name as client_name,
                u.name as created_by_name
            FROM sessions s
            LEFT JOIN clients c ON s.client_id = c.id
            LEFT JOIN users u ON s.created_by = u.id
            WHERE s.client_id = ?
            ORDER BY s.session_number DESC, s.date DESC
            LIMIT ?
        `);
        return stmt.all(clientId, limit);
    } catch (error) {
        console.error("❌ Error fetching sessions:", error);
        return [];
    }
}

function getSessionById(id, userPraxisId = null) {
    try {
        const stmt = db.prepare(`
            SELECT 
                s.*,
                c.name as client_name,
                c.praxis_id,
                u.name as created_by_name
            FROM sessions s
            LEFT JOIN clients c ON s.client_id = c.id
            LEFT JOIN users u ON s.created_by = u.id
            WHERE s.id = ?
        `);
        
        const session = stmt.get(id);
        
        if (session && userPraxisId && session.praxis_id !== userPraxisId) {
            return null; // Access denied
        }
        
        return session;
    } catch (error) {
        console.error("❌ Error fetching session:", error);
        return null;
    }
}

function addDocument(docData) {
    try {
        const stmt = db.prepare(`
            INSERT INTO documents (
                client_id, session_id, category, title, filename, original_name,
                file_path, file_type, file_size, description, uploaded_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const result = stmt.run(
            docData.client_id || null,
            docData.session_id || null,
            docData.category || 'sonstiges',
            docData.title || docData.original_name,
            docData.filename,
            docData.original_name,
            docData.file_path,
            docData.file_type,
            docData.file_size,
            docData.description || null,
            docData.uploaded_by || null
        );
        
        return result;
    } catch (error) {
        console.error("❌ Error adding document:", error);
        throw error;
    }
}

function getDocumentsByClient(clientId) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM documents 
            WHERE client_id = ? 
            ORDER BY created_at DESC
        `);
        return stmt.all(clientId);
    } catch (error) {
        console.error("❌ Error fetching documents:", error);
        return [];
    }
}

function getDocumentById(id) {
    try {
        const stmt = db.prepare("SELECT * FROM documents WHERE id = ?");
        return stmt.get(id);
    } catch (error) {
        console.error("❌ Error fetching document:", error);
        return null;
    }
}

function addChatMessage(messageData) {
    try {
        const stmt = db.prepare(`
            INSERT INTO chat_history (
                client_id, session_id, conversation_id, role, content,
                attachments, tokens_used, model_used, created_by, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const result = stmt.run(
            messageData.client_id || null,
            messageData.session_id || null,
            messageData.conversation_id || uuidv4(),
            messageData.role,
            messageData.content,
            messageData.attachments ? JSON.stringify(messageData.attachments) : null,
            messageData.tokens_used || null,
            messageData.model_used || 'gpt-3.5-turbo',
            messageData.created_by || null
        );
        
        return result;
    } catch (error) {
        console.error("❌ Error adding chat message:", error);
        throw error;
    }
}

function getChatHistory(clientId, limit = 50) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM chat_history 
            WHERE client_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `);
        return stmt.all(clientId, limit);
    } catch (error) {
        console.error("❌ Error fetching chat history:", error);
        return [];
    }
}

function getRecentChatHistory(limit = 20) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM chat_history 
            ORDER BY timestamp DESC 
            LIMIT ?
        `);
        return stmt.all(limit);
    } catch (error) {
        console.error("❌ Error fetching recent chat history:", error);
        return [];
    }
}

function getStatistics(praxisId = null) {
    try {
        const stats = {};
        
        let whereClause = praxisId ? 'WHERE c.praxis_id = ?' : '';
        let params = praxisId ? [praxisId] : [];
        
        // Basic counts
        stats.totalClients = db.prepare(`
            SELECT COUNT(*) as count FROM clients c
            ${whereClause} AND c.is_archived = 0
        `).get(...params).count;
        
        stats.totalSessions = db.prepare(`
            SELECT COUNT(*) as count FROM sessions s
            JOIN clients c ON s.client_id = c.id
            ${whereClause}
        `).get(...params).count;
        
        stats.completedSessions = db.prepare(`
            SELECT COUNT(*) as count FROM sessions s
            JOIN clients c ON s.client_id = c.id
            ${whereClause} AND s.status = 'durchgeführt'
        `).get(...params).count;
        
        stats.pendingTodos = 5; // Placeholder
        stats.activePlans = 3; // Placeholder
        
        return stats;
    } catch (error) {
        console.error("❌ Error calculating statistics:", error);
        return {
            totalClients: 0,
            totalSessions: 0,
            pendingTodos: 0,
            activePlans: 0
        };
    }
}

function generateClientNumber() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `CL-${timestamp}-${random}`.toUpperCase();
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

// Initialize Database Tables if they don't exist
function initializeDatabase() {
    console.log("🔧 Initializing database schema...");
    
    // Create all necessary tables
    db.prepare(`
        CREATE TABLE IF NOT EXISTS praxis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            email TEXT,
            telefon TEXT,
            adresse TEXT,
            website TEXT,
            logo_url TEXT,
            settings TEXT DEFAULT '{}',
            subscription_plan TEXT DEFAULT 'basic',
            subscription_expires TEXT,
            is_active BOOLEAN DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            praxis_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT CHECK (role IN ('admin','therapeut','assistenz','praktikant','extern')) DEFAULT 'therapeut',
            permissions TEXT DEFAULT '{}',
            is_active BOOLEAN DEFAULT 1,
            last_login TEXT,
            login_count INTEGER DEFAULT 0,
            two_factor_secret TEXT,
            two_factor_enabled BOOLEAN DEFAULT 0,
            session_token TEXT,
            password_reset_token TEXT,
            password_reset_expires TEXT,
            access_expires TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (praxis_id) REFERENCES praxis(id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            praxis_id INTEGER NOT NULL,
            client_number TEXT UNIQUE,
            name TEXT NOT NULL,
            full_name TEXT,
            email TEXT,
            phone TEXT,
            birth_date TEXT,
            address TEXT,
            insurance_number TEXT,
            insurance_type TEXT CHECK (insurance_type IN ('gesetzlich','privat','selbstzahler')),
            emergency_contact TEXT,
            referring_doctor TEXT,
            diagnosis_primary TEXT,
            diagnosis_secondary TEXT,
            therapy_type TEXT CHECK (therapy_type IN ('VT','TP','PA','ST','Gruppe')),
            therapy_status TEXT CHECK (therapy_status IN ('aktiv','beendet','pausiert','warteliste')) DEFAULT 'aktiv',
            sessions_approved INTEGER DEFAULT 0,
            sessions_used INTEGER DEFAULT 0,
            session_frequency TEXT DEFAULT 'wöchentlich',
            start_date TEXT,
            end_date TEXT,
            notes TEXT,
            risk_assessment TEXT,
            risk_level TEXT CHECK (risk_level IN ('niedrig','mittel','hoch','kritisch')) DEFAULT 'niedrig',
            consent_data_processing BOOLEAN DEFAULT 0,
            consent_photo_video BOOLEAN DEFAULT 0,
            consent_research BOOLEAN DEFAULT 0,
            is_archived BOOLEAN DEFAULT 0,
            archived_at TEXT,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (praxis_id) REFERENCES praxis(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            session_number INTEGER,
            date TEXT NOT NULL,
            duration INTEGER DEFAULT 50,
            type TEXT DEFAULT 'Einzeltherapie',
            location TEXT DEFAULT 'Praxis',
            status TEXT CHECK (status IN ('geplant','durchgeführt','abgesagt','nicht_erschienen')) DEFAULT 'geplant',
            notes TEXT,
            private_notes TEXT,
            homework_given TEXT,
            homework_completed BOOLEAN,
            mood_before INTEGER CHECK (mood_before >= 1 AND mood_before <= 10),
            mood_after INTEGER CHECK (mood_after >= 1 AND mood_after <= 10),
            therapeutic_focus TEXT,
            interventions_used TEXT,
            breakthrough BOOLEAN DEFAULT 0,
            crisis_intervention BOOLEAN DEFAULT 0,
            next_session_planned TEXT,
            billing_code TEXT,
            billing_points REAL,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            session_id INTEGER,
            category TEXT CHECK (category IN ('protokoll','bericht','formular','bild','audio','video','sonstiges')) DEFAULT 'sonstiges',
            title TEXT,
            filename TEXT NOT NULL,
            original_name TEXT,
            file_path TEXT NOT NULL,
            file_type TEXT,
            file_size INTEGER,
            file_hash TEXT,
            description TEXT,
            tags TEXT,
            is_confidential BOOLEAN DEFAULT 1,
            access_level TEXT CHECK (access_level IN ('public','restricted','confidential','secret')) DEFAULT 'confidential',
            encryption_key TEXT,
            ocr_text TEXT,
            analysis_result TEXT,
            retention_until TEXT,
            uploaded_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            session_id INTEGER,
            conversation_id TEXT,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            attachments TEXT,
            tokens_used INTEGER,
            model_used TEXT DEFAULT 'gpt-3.5-turbo',
            context_window TEXT,
            response_time INTEGER,
            user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
            is_sensitive BOOLEAN DEFAULT 0,
            created_by INTEGER,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS treatment_goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT CHECK (category IN ('symptom','behavior','cognitive','emotional','social','relational')) DEFAULT 'symptom',
            priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
            status TEXT CHECK (status IN ('active', 'completed', 'paused', 'cancelled', 'revised')) DEFAULT 'active',
            target_date TEXT,
            completion_date TEXT,
            progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
            measurement_method TEXT,
            baseline_value TEXT,
            current_value TEXT,
            target_value TEXT,
            milestones TEXT,
            interventions TEXT,
            obstacles TEXT,
            resources TEXT,
            review_frequency TEXT DEFAULT 'weekly',
            last_reviewed TEXT,
            notes TEXT,
            is_smart_goal BOOLEAN DEFAULT 0,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            success BOOLEAN NOT NULL,
            failure_reason TEXT,
            two_factor_used BOOLEAN DEFAULT 0,
            session_id TEXT,
            geolocation TEXT,
            attempted_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Create indexes
    db.prepare("CREATE INDEX IF NOT EXISTS idx_users_praxis_id ON users(praxis_id)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_clients_praxis_id ON clients(praxis_id)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents(client_id)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_chat_client_id ON chat_history(client_id)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email)").run();

    console.log("✅ Database schema initialized");
    
    // Create demo data if database is empty
    const clientCount = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
    if (clientCount === 0) {
        createDemoData();
    }
}

function createDemoData() {
    console.log("📋 Creating demo data...");
    
    try {
        // Create demo praxis
        const praxisId = createDemoPraxis();
        
        // Create demo users
        createDemoUsers(praxisId);
        
        // Create demo clients
        const clientIds = createDemoClients(praxisId);
        
        // Create demo sessions
        createDemoSessions(clientIds);
        
        console.log("✅ Demo data created successfully");
    } catch (error) {
        console.error("❌ Error creating demo data:", error);
    }
}

function createDemoPraxis() {
    const praxisData = {
        name: 'Demo Praxis Muster',
        email: 'info@demo-praxis.de',
        telefon: '+49 221 123456',
        adresse: 'Musterstraße 123, 50667 Köln'
    };
    
    const result = addPraxis(praxisData);
    return result.lastInsertRowid;
}

async function createDemoUsers(praxisId) {
    const demoUsers = [
        {
            name: 'Dr. Demo User',
            email: 'demo@praxida.de',
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
        try {
            const hashedPassword = await bcrypt.hash(demoUser.password, 12);
            
            const userData = {
                praxis_id: praxisId,
                name: demoUser.name,
                email: demoUser.email,
                password_hash: hashedPassword,
                role: demoUser.role
            };

            addUser(userData);
        } catch (error) {
            console.error('Error creating demo user:', error);
        }
    }
}

function createDemoClients(praxisId) {
    const clients = [
        {
            name: 'A.M.',
            diagnosis_primary: 'F41.1 Generalisierte Angststörung',
            therapy_type: 'VT',
            therapy_status: 'aktiv',
            sessions_approved: 25,
            start_date: '2024-08-01',
            notes: 'Verhaltenstherapie bei Angststörung. Patient zeigt gute Compliance.'
        },
        {
            name: 'B.S.',
            diagnosis_primary: 'F32.1 Mittelgradige depressive Episode',
            therapy_type: 'TP',
            therapy_status: 'aktiv',
            sessions_approved: 60,
            start_date: '2024-07-15',
            notes: 'Tiefenpsychologische Therapie. Schwerpunkt auf Bindungsmustern.'
        }
    ];
    
    const clientIds = [];
    clients.forEach(clientData => {
        clientData.praxis_id = praxisId;
        const result = addClient(clientData);
        clientIds.push(result.lastInsertRowid);
    });
    
    return clientIds;
}

function createDemoSessions(clientIds) {
    clientIds.forEach((clientId, index) => {
        const sessionCount = [8, 12][index]; // Different session counts
        
        for (let i = 1; i <= sessionCount; i++) {
            const sessionDate = new Date();
            sessionDate.setDate(sessionDate.getDate() - (sessionCount - i) * 7); // Weekly sessions
            
            const sessionData = {
                client_id: clientId,
                session_number: i,
                date: sessionDate.toISOString().split('T')[0],
                duration: 50,
                type: 'Einzeltherapie',
                status: 'durchgeführt',
                notes: `Sitzung ${i}: Positive Entwicklung erkennbar.`,
                private_notes: `Interne Notiz für Sitzung ${i}`,
                mood_before: Math.floor(Math.random() * 4) + 4, // 4-7
                mood_after: Math.floor(Math.random() * 3) + 6   // 6-8
            };
            
            addSession(sessionData);
        }
    });
}

// Initialize database on startup
initializeDatabase();

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
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  },
  rolling: true
}));

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

// === PROTECT EXISTING API ROUTES === //
app.use('/api/clients', requireAuth, requirePraxis);
app.use('/api/sessions', requireAuth, requirePraxis);
app.use('/api/upload', requireAuth);
app.use('/api/audio', requireAuth);
app.use('/api/chat', requireAuth);

// --- CLIENTS API ROUTES --- //

app.get("/api/clients", requireAuth, requirePraxis, (req, res) => {
  try {
    const clients = getClients(req.user.praxis_id);
    console.log(`✅ Loaded ${clients.length} clients for praxis ${req.user.praxis_id}`);
    res.json(clients);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Clients:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Clients" });
  }
});

app.get("/api/clients/:id", requireAuth, requirePraxis, (req, res) => {
  try {
    const client = getClientById(req.params.id, req.user.praxis_id);
    if (!client) return res.status(404).json({ error: "Client nicht gefunden" });
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
    const updates = req.body;
    delete updates.id;
    delete updates.praxis_id;
    
    const result = updateClient(req.params.id, updates, req.user.praxis_id);
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
    const result = deleteClient(req.params.id, req.user.praxis_id);
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
                duration: Math.ceil(req.file.size / 1000000),
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

// --- STATISTICS ROUTE --- //
app.get("/api/stats", requireAuth, requirePraxis, (req, res) => {
  try {
    const stats = getStatistics(req.user.praxis_id);
    res.json(stats);
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
    const client = getClientById(req.body.client_id, req.user.praxis_id);
    if (!client) {
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
    const sessions = getSessionsByClient(req.params.id, 50, req.user.praxis_id);
    res.json(sessions);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Sessions:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Sessions" });
  }
});

app.get("/api/clients/:id/chat", requireAuth, requirePraxis, (req, res) => {
  try {
    // Check if client belongs to user's praxis
    const client = getClientById(req.params.id, req.user.praxis_id);
    if (!client) {
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
  console.log('💾 SQLite Datenbank: ' + dbPath);
  console.log('🔒 Session Store: SQLite');
  console.log('⚡ Performance: WAL Mode aktiviert');
  console.log('📈 Multi-Tenant: AKTIV');
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