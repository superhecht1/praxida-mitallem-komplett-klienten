// db.js - Praxida 2.0 Complete Database Layer
// Multi-tenant therapy practice management system with SQLite

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// === DATABASE INITIALIZATION === //

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

// === SCHEMA DEFINITION AND MIGRATION === //

function initializeDatabase() {
    console.log("🔧 Initializing database schema...");
    
    // Create all tables
    createPraxisTable();
    createUsersTable();
    createClientsTable();
    createSessionsTable();
    createDocumentsTable();
    createAudioTranscriptionsTable();
    createChatHistoryTable();
    createTreatmentGoalsTable();
    createAssessmentsTable();
    createAppointmentsTable();
    createInvoicesTable();
    createInvoiceItemsTable();
    createAnamnesesTable();
    createNotesTable();
    createSettingsTable();
    createLoginAttemptsTable();
    createAuditLogTable();
    
    // Create indexes for performance
    createIndexes();
    
    // Initialize default settings
    initializeSettings();
    
    // Create demo data if database is empty
    const clientCount = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
    if (clientCount === 0) {
        createDemoData();
    }
    
    console.log("✅ Database schema initialized");
}

function createPraxisTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS praxis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            email TEXT,
            telefon TEXT,
            adresse TEXT,
            website TEXT,
            logo_url TEXT,
            settings TEXT DEFAULT '{}', -- JSON for praxis-specific settings
            subscription_plan TEXT DEFAULT 'basic',
            subscription_expires TEXT,
            is_active BOOLEAN DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

function createUsersTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            praxis_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT CHECK (role IN ('admin','therapeut','assistenz','praktikant','extern')) DEFAULT 'therapeut',
            permissions TEXT DEFAULT '{}', -- JSON for granular permissions
            is_active BOOLEAN DEFAULT 1,
            last_login TEXT,
            login_count INTEGER DEFAULT 0,
            two_factor_secret TEXT,
            two_factor_enabled BOOLEAN DEFAULT 0,
            session_token TEXT,
            password_reset_token TEXT,
            password_reset_expires TEXT,
            access_expires TEXT, -- For temporary access (praktikant)
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (praxis_id) REFERENCES praxis(id) ON DELETE CASCADE
        )
    `).run();
}

function createClientsTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            praxis_id INTEGER NOT NULL,
            client_number TEXT UNIQUE, -- Auto-generated client ID
            name TEXT NOT NULL, -- Initials or pseudonym for GDPR
            full_name TEXT, -- Encrypted real name
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
}

function createSessionsTable() {
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
            notes TEXT, -- Session notes visible to client
            private_notes TEXT, -- Internal therapist notes
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
}

function createDocumentsTable() {
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
            file_hash TEXT, -- SHA-256 for integrity verification
            description TEXT,
            tags TEXT, -- JSON array for searchable tags
            is_confidential BOOLEAN DEFAULT 1,
            access_level TEXT CHECK (access_level IN ('public','restricted','confidential','secret')) DEFAULT 'confidential',
            encryption_key TEXT, -- For encrypted files
            ocr_text TEXT, -- Extracted text from images/PDFs
            analysis_result TEXT, -- AI analysis results
            retention_until TEXT, -- Auto-deletion date
            uploaded_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createAudioTranscriptionsTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS audio_transcriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            session_id INTEGER,
            filename TEXT NOT NULL,
            original_name TEXT,
            file_path TEXT NOT NULL,
            duration INTEGER, -- seconds
            file_size INTEGER,
            transcription TEXT, -- Whisper output
            transcription_confidence REAL, -- 0.0 - 1.0
            language_detected TEXT DEFAULT 'de',
            speaker_count INTEGER DEFAULT 1,
            analysis TEXT, -- AI analysis of content
            summary TEXT, -- Condensed summary
            key_topics TEXT, -- JSON array of identified topics
            emotional_tone TEXT, -- Detected emotional state
            processing_status TEXT CHECK (processing_status IN ('pending','processing','completed','failed')) DEFAULT 'pending',
            processing_error TEXT,
            is_sensitive BOOLEAN DEFAULT 1,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createChatHistoryTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            session_id INTEGER,
            conversation_id TEXT, -- UUID for grouping related messages
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            attachments TEXT, -- JSON array of file references
            tokens_used INTEGER,
            model_used TEXT DEFAULT 'gpt-3.5-turbo',
            context_window TEXT, -- Additional context provided
            response_time INTEGER, -- milliseconds
            user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
            is_sensitive BOOLEAN DEFAULT 0,
            created_by INTEGER,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createTreatmentGoalsTable() {
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
            measurement_method TEXT, -- How progress is measured
            baseline_value TEXT, -- Starting point measurement
            current_value TEXT, -- Current measurement
            target_value TEXT, -- Goal measurement
            milestones TEXT, -- JSON array of milestone objects
            interventions TEXT, -- JSON array of planned interventions
            obstacles TEXT, -- Identified obstacles
            resources TEXT, -- Available resources/strengths
            review_frequency TEXT DEFAULT 'weekly',
            last_reviewed TEXT,
            notes TEXT,
            is_smart_goal BOOLEAN DEFAULT 0, -- Specific, Measurable, Achievable, Relevant, Time-bound
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createAssessmentsTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            session_id INTEGER,
            assessment_type TEXT NOT NULL, -- PHQ-9, GAD-7, etc.
            version TEXT DEFAULT '1.0',
            questions TEXT NOT NULL, -- JSON array of questions
            responses TEXT NOT NULL, -- JSON array of responses
            total_score INTEGER NOT NULL,
            subscale_scores TEXT, -- JSON object with subscale names and scores
            severity_level TEXT,
            percentile REAL,
            interpretation TEXT,
            recommendations TEXT,
            comparison_previous TEXT, -- Comparison with previous assessment
            is_baseline BOOLEAN DEFAULT 0,
            is_follow_up BOOLEAN DEFAULT 0,
            administration_method TEXT CHECK (administration_method IN ('self_report','interview','observation')) DEFAULT 'self_report',
            administrator INTEGER, -- User who administered
            duration_minutes INTEGER,
            notes TEXT,
            reliability_score REAL, -- Consistency check
            validity_concerns TEXT,
            completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (administrator) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createAppointmentsTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            location TEXT DEFAULT 'Praxis',
            type TEXT CHECK (type IN ('therapy','intake','assessment','group','supervision','other')) DEFAULT 'therapy',
            status TEXT CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show','rescheduled')) DEFAULT 'scheduled',
            recurrence_pattern TEXT, -- JSON for recurring appointments
            reminder_settings TEXT, -- JSON for reminder preferences
            google_event_id TEXT,
            outlook_event_id TEXT,
            zoom_meeting_id TEXT,
            preparation_notes TEXT,
            follow_up_required BOOLEAN DEFAULT 0,
            billing_eligible BOOLEAN DEFAULT 1,
            cancellation_reason TEXT,
            cancelled_by INTEGER,
            cancelled_at TEXT,
            no_show_fee REAL,
            notes TEXT,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createInvoicesTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            praxis_id INTEGER NOT NULL,
            client_id INTEGER NOT NULL,
            invoice_number TEXT UNIQUE NOT NULL,
            quarter TEXT, -- e.g., "2025Q1"
            invoice_type TEXT CHECK (invoice_type IN ('quarterly','individual','group','special')) DEFAULT 'quarterly',
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            amount_gross REAL NOT NULL,
            amount_net REAL NOT NULL,
            tax_amount REAL DEFAULT 0,
            tax_rate REAL DEFAULT 0,
            currency TEXT DEFAULT 'EUR',
            status TEXT CHECK (status IN ('draft','sent','paid','overdue','cancelled','disputed')) DEFAULT 'draft',
            payment_method TEXT,
            payment_reference TEXT,
            payment_date TEXT,
            due_date TEXT,
            reminder_count INTEGER DEFAULT 0,
            last_reminder_sent TEXT,
            kv_transmission_id TEXT, -- For KV submissions
            kv_status TEXT,
            kv_response TEXT,
            pdf_path TEXT,
            xml_path TEXT, -- For electronic transmission
            notes TEXT,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (praxis_id) REFERENCES praxis(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createInvoiceItemsTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            session_id INTEGER,
            item_type TEXT CHECK (item_type IN ('session','assessment','report','consultation','travel')) DEFAULT 'session',
            billing_code TEXT NOT NULL, -- GOP/EBM code
            description TEXT NOT NULL,
            date_service TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            unit_price REAL NOT NULL,
            total_price REAL GENERATED ALWAYS AS (quantity * unit_price) VIRTUAL,
            factor REAL DEFAULT 1.0, -- Multiplier for private billing
            points INTEGER, -- For point-based billing systems
            is_billable BOOLEAN DEFAULT 1,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        )
    `).run();
}

function createAnamnesesTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS anamneses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            type TEXT CHECK (type IN ('biographical','medical','psychological','social','family')) DEFAULT 'psychological',
            version TEXT DEFAULT '1.0',
            data TEXT NOT NULL, -- JSON structure with questions and answers
            completion_status TEXT CHECK (completion_status IN ('draft','partial','complete','reviewed')) DEFAULT 'draft',
            completion_percentage INTEGER DEFAULT 0,
            risk_factors TEXT, -- JSON array of identified risk factors
            protective_factors TEXT, -- JSON array of protective factors
            differential_diagnosis TEXT,
            treatment_recommendations TEXT,
            urgency_level TEXT CHECK (urgency_level IN ('routine','urgent','immediate')) DEFAULT 'routine',
            review_required BOOLEAN DEFAULT 0,
            reviewed_by INTEGER,
            reviewed_at TEXT,
            validity_check TEXT, -- Consistency and validity notes
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createNotesTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            session_id INTEGER,
            title TEXT,
            content TEXT NOT NULL,
            note_type TEXT CHECK (note_type IN ('session','observation','reminder','todo','supervision','research')) DEFAULT 'session',
            category TEXT,
            priority TEXT CHECK (priority IN ('low','medium','high','urgent')) DEFAULT 'medium',
            tags TEXT, -- JSON array of tags
            is_private BOOLEAN DEFAULT 1,
            is_archived BOOLEAN DEFAULT 0,
            due_date TEXT,
            reminder_date TEXT,
            assigned_to INTEGER,
            status TEXT CHECK (status IN ('draft','active','completed','archived')) DEFAULT 'active',
            visibility TEXT CHECK (visibility IN ('private','team','supervisor','all')) DEFAULT 'private',
            linked_goals TEXT, -- JSON array of related treatment goal IDs
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createSettingsTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            praxis_id INTEGER, -- NULL for global settings
            category TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            value_type TEXT CHECK (value_type IN ('string','number','boolean','json')) DEFAULT 'string',
            description TEXT,
            is_system BOOLEAN DEFAULT 0, -- System settings cannot be deleted
            is_encrypted BOOLEAN DEFAULT 0,
            validation_rule TEXT, -- Regex or JSON schema for validation
            default_value TEXT,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (praxis_id) REFERENCES praxis(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE(praxis_id, category, key)
        )
    `).run();
}

function createLoginAttemptsTable() {
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
            geolocation TEXT, -- JSON with location data
            attempted_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

function createAuditLogTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            praxis_id INTEGER,
            user_id INTEGER,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL, -- client, session, document, etc.
            entity_id INTEGER,
            old_values TEXT, -- JSON of previous values
            new_values TEXT, -- JSON of new values
            ip_address TEXT,
            user_agent TEXT,
            session_id TEXT,
            description TEXT,
            severity TEXT CHECK (severity IN ('low','medium','high','critical')) DEFAULT 'medium',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (praxis_id) REFERENCES praxis(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    `).run();
}

function createIndexes() {
    console.log("🔍 Creating database indexes...");
    
    const indexes = [
        // Users
        "CREATE INDEX IF NOT EXISTS idx_users_praxis_id ON users(praxis_id)",
        "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
        "CREATE INDEX IF NOT EXISTS idx_users_session_token ON users(session_token)",
        
        // Clients
        "CREATE INDEX IF NOT EXISTS idx_clients_praxis_id ON clients(praxis_id)",
        "CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)",
        "CREATE INDEX IF NOT EXISTS idx_clients_client_number ON clients(client_number)",
        "CREATE INDEX IF NOT EXISTS idx_clients_therapy_status ON clients(therapy_status)",
        "CREATE INDEX IF NOT EXISTS idx_clients_risk_level ON clients(risk_level)",
        
        // Sessions
        "CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_session_number ON sessions(session_number)",
        
        // Documents
        "CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_documents_session_id ON documents(session_id)",
        "CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category)",
        "CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash)",
        
        // Audio Transcriptions
        "CREATE INDEX IF NOT EXISTS idx_audio_client_id ON audio_transcriptions(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_audio_processing_status ON audio_transcriptions(processing_status)",
        
        // Chat History
        "CREATE INDEX IF NOT EXISTS idx_chat_client_id ON chat_history(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_chat_conversation_id ON chat_history(conversation_id)",
        "CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_history(timestamp)",
        
        // Treatment Goals
        "CREATE INDEX IF NOT EXISTS idx_goals_client_id ON treatment_goals(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_goals_status ON treatment_goals(status)",
        "CREATE INDEX IF NOT EXISTS idx_goals_priority ON treatment_goals(priority)",
        
        // Assessments
        "CREATE INDEX IF NOT EXISTS idx_assessments_client_id ON assessments(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_assessments_type ON assessments(assessment_type)",
        "CREATE INDEX IF NOT EXISTS idx_assessments_completed_at ON assessments(completed_at)",
        
        // Appointments
        "CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)",
        
        // Invoices
        "CREATE INDEX IF NOT EXISTS idx_invoices_praxis_id ON invoices(praxis_id)",
        "CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_invoices_quarter ON invoices(quarter)",
        "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)",
        
        // Notes
        "CREATE INDEX IF NOT EXISTS idx_notes_client_id ON notes(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type)",
        "CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status)",
        
        // Settings
        "CREATE INDEX IF NOT EXISTS idx_settings_praxis_category_key ON settings(praxis_id, category, key)",
        
        // Login Attempts
        "CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email)",
        "CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address)",
        "CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON login_attempts(attempted_at)",
        
        // Audit Log
        "CREATE INDEX IF NOT EXISTS idx_audit_praxis_id ON audit_log(praxis_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at)"
    ];

    indexes.forEach(indexSQL => {
        try {
            db.prepare(indexSQL).run();
        } catch (error) {
            console.warn("Index creation skipped (already exists):", indexSQL.split(' ')[5]);
        }
    });
    
    console.log("✅ Database indexes created");
}

function initializeSettings() {
    console.log("⚙️ Initializing default settings...");
    
    const defaultSettings = [
        // Application settings
        { category: 'app', key: 'version', value: '2.0.0', description: 'Application version' },
        { category: 'app', key: 'name', value: 'Praxida 2.0', description: 'Application name' },
        { category: 'app', key: 'maintenance_mode', value: 'false', value_type: 'boolean', description: 'Maintenance mode status' },
        
        // Database settings
        { category: 'database', key: 'schema_version', value: '1.0', description: 'Database schema version' },
        { category: 'database', key: 'auto_backup', value: 'true', value_type: 'boolean', description: 'Enable automatic backups' },
        { category: 'database', key: 'backup_frequency', value: 'daily', description: 'Backup frequency' },
        { category: 'database', key: 'retention_days', value: '2555', value_type: 'number', description: 'Data retention in days (7 years)' },
        
        // Security settings
        { category: 'security', key: 'session_timeout', value: '1440', value_type: 'number', description: 'Session timeout in minutes' },
        { category: 'security', key: 'password_min_length', value: '8', value_type: 'number', description: 'Minimum password length' },
        { category: 'security', key: 'login_attempt_limit', value: '5', value_type: 'number', description: 'Max failed login attempts' },
        { category: 'security', key: 'lockout_duration', value: '15', value_type: 'number', description: 'Account lockout duration in minutes' },
        { category: 'security', key: 'two_factor_required', value: 'false', value_type: 'boolean', description: 'Require 2FA for all users' },
        
        // Therapy settings
        { category: 'therapy', key: 'default_session_duration', value: '50', value_type: 'number', description: 'Default session duration in minutes' },
        { category: 'therapy', key: 'session_reminder_hours', value: '24', value_type: 'number', description: 'Hours before session to send reminder' },
        { category: 'therapy', key: 'max_missed_sessions', value: '3', value_type: 'number', description: 'Max missed sessions before alert' },
        
        // AI settings
        { category: 'ai', key: 'enabled', value: 'true', value_type: 'boolean', description: 'Enable AI features' },
        { category: 'ai', key: 'model_default', value: 'gpt-3.5-turbo', description: 'Default AI model' },
        { category: 'ai', key: 'max_tokens', value: '2000', value_type: 'number', description: 'Maximum tokens per AI request' },
        { category: 'ai', key: 'temperature', value: '0.7', value_type: 'number', description: 'AI response creativity (0-1)' },
        
        // Privacy settings
        { category: 'privacy', key: 'data_anonymization', value: 'true', value_type: 'boolean', description: 'Enable data anonymization' },
        { category: 'privacy', key: 'audit_log_retention', value: '365', value_type: 'number', description: 'Audit log retention in days' },
        { category: 'privacy', key: 'auto_delete_archived', value: 'false', value_type: 'boolean', description: 'Auto-delete archived clients' },
        
        // Billing settings
        { category: 'billing', key: 'default_currency', value: 'EUR', description: 'Default currency' },
        { category: 'billing', key: 'tax_rate', value: '0.19', value_type: 'number', description: 'Default tax rate' },
        { category: 'billing', key: 'payment_reminder_days', value: '14', value_type: 'number', description: 'Days after due date to send reminder' },
        
        // Communication settings
        { category: 'communication', key: 'email_enabled', value: 'false', value_type: 'boolean', description: 'Enable email notifications' },
        { category: 'communication', key: 'sms_enabled', value: 'false', value_type: 'boolean', description: 'Enable SMS notifications' },
        { category: 'communication', key: 'appointment_reminders', value: 'true', value_type: 'boolean', description: 'Send appointment reminders' }
    ];

    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (praxis_id, category, key, value, value_type, description, is_system, created_at)
        VALUES (NULL, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `);

    defaultSettings.forEach(setting => {
        insertSetting.run(
            setting.category,
            setting.key,
            setting.value,
            setting.value_type || 'string',
            setting.description
        );
    });
    
    console.log("✅ Default settings initialized");
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
        
        // Create demo sessions and related data
        createDemoSessions(clientIds);
        
        console.log("✅ Demo data created successfully");
    } catch (error) {
        console.error("❌ Error creating demo data:", error);
    }
}

function createDemoClients(praxisId) {
    const clientStmt = db.prepare(`
        INSERT INTO clients (
            praxis_id, client_number, name, diagnosis_primary, 
            therapy_type, therapy_status, sessions_approved, 
            start_date, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    const clients = [
        [
            praxisId, generateClientNumber(), 'A.M.', 'F41.1 Generalisierte Angststörung',
            'VT', 'aktiv', 25, '2024-08-01',
            'Verhaltenstherapie bei Angststörung. Patient zeigt gute Compliance.'
        ],
        [
            praxisId, generateClientNumber(), 'B.S.', 'F32.1 Mittelgradige depressive Episode',
            'TP', 'aktiv', 60, '2024-07-15',
            'Tiefenpsychologische Therapie. Schwerpunkt auf Bindungsmustern.'
        ],
        [
            praxisId, generateClientNumber(), 'C.K.', 'F43.1 Posttraumatische Belastungsstörung',
            'VT', 'aktiv', 45, '2024-09-01',
            'Traumatherapie nach Verkehrsunfall. EMDR geplant.'
        ]
    ];
    
    const clientIds = [];
    clients.forEach(client => {
        const result = clientStmt.run(...client);
        clientIds.push(result.lastInsertRowid);
    });
    
    return clientIds;
}

function createDemoSessions(clientIds) {
    const sessionStmt = db.prepare(`
        INSERT INTO sessions (
            client_id, session_number, date, duration, type, status,
            notes, private_notes, mood_before, mood_after, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    // Create sessions for each client
    clientIds.forEach((clientId, index) => {
        const sessionCount = [8, 12, 4][index]; // Different session counts for variety
        
        for (let i = 1; i <= sessionCount; i++) {
            const sessionDate = new Date();
            sessionDate.setDate(sessionDate.getDate() - (sessionCount - i) * 7); // Weekly sessions
            
            sessionStmt.run(
                clientId,
                i,
                sessionDate.toISOString().split('T')[0],
                50,
                'Einzeltherapie',
                'durchgeführt',
                `Sitzung ${i}: Positive Entwicklung erkennbar.`,
                `Interne Notiz für Sitzung ${i}`,
                Math.floor(Math.random() * 4) + 4, // Mood before: 4-7
                Math.floor(Math.random() * 3) + 6  // Mood after: 6-8
            );
        }
    });
}

function generateClientNumber() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `CL-${timestamp}-${random}`.toUpperCase();
}

// === UTILITY FUNCTIONS === //

function logAction(praxisId, userId, action, entityType, entityId, oldValues, newValues, description) {
    try {
        const stmt = db.prepare(`
            INSERT INTO audit_log (
                praxis_id, user_id, action, entity_type, entity_id, 
                old_values, new_values, description, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        stmt.run(
            praxisId,
            userId,
            action,
            entityType,
            entityId,
            oldValues ? JSON.stringify(oldValues) : null,
            newValues ? JSON.stringify(newValues) : null,
            description
        );
    } catch (error) {
        console.error("❌ Failed to log action:", error);
    }
}

function generateSecureId() {
    return crypto.randomBytes(16).toString('hex');
}

function hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

function validatePraxisAccess(praxisId, userPraxisId) {
    if (praxisId && userPraxisId && praxisId !== userPraxisId) {
        throw new Error('Unauthorized access to different praxis data');
    }
}

// === PRAXIS MANAGEMENT === //

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

function getPraxisById(id) {
    try {
        const stmt = db.prepare("SELECT * FROM praxis WHERE id = ? AND is_active = 1");
        return stmt.get(id);
    } catch (error) {
        console.error("❌ Error fetching praxis:", error);
        return null;
    }
}

function updatePraxis(id, updates) {
    try {
        const allowedFields = ['name', 'email', 'telefon', 'adresse', 'website', 'settings'];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
        
        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }
        
        const setClause = fields.map(key => `${key} = ?`).join(', ');
        const values = fields.map(key => updates[key]);
        values.push(id);
        
        const stmt = db.prepare(`
            UPDATE praxis 
            SET ${setClause}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        
        return stmt.run(...values);
    } catch (error) {
        console.error("❌ Error updating praxis:", error);
        throw error;
    }
}

// === USER MANAGEMENT === //

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
        
        logAction(
            userData.praxis_id,
            null,
            'CREATE',
            'user',
            result.lastInsertRowid,
            null,
            userData,
            `User created: ${userData.name}`
        );
        
        console.log("✅ User created:", userData.name);
        return result;
    } catch (error) {
        console.error("❌ Error creating user:", error);
        throw error;
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
        console.error("❌ Error fetching user:", error);
        return null;
    }
}

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
        console.error("❌ Error fetching user by email:", error);
        return null;
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

function updateUserLogin(userId, sessionToken) {
    try {
        const stmt = db.prepare(`
            UPDATE users 
            SET last_login = CURRENT_TIMESTAMP, 
                login_count = login_count + 1,
                session_token = ?
            WHERE id = ?
        `);
        return stmt.run(sessionToken, userId);
    } catch (error) {
        console.error("❌ Error updating user login:", error);
        throw error;
    }
}

// === CLIENT MANAGEMENT === //

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
        
        logAction(
            clientData.praxis_id,
            clientData.created_by,
            'CREATE',
            'client',
            result.lastInsertRowid,
            null,
            clientData,
            `Client created: ${clientData.name}`
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
        
        if (client && userPraxisId) {
            validatePraxisAccess(client.praxis_id, userPraxisId);
        }
        
        return client;
    } catch (error) {
        console.error("❌ Error fetching client:", error);
        return null;
    }
}

function updateClient(id, updates, userPraxisId = null, userId = null) {
    try {
        // Verify access
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
        
        logAction(
            client.praxis_id,
            userId,
            'UPDATE',
            'client',
            id,
            client,
            updates,
            `Client updated: ${client.name}`
        );
        
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
        
        // Soft delete - mark as archived
        const stmt = db.prepare(`
            UPDATE clients 
            SET is_archived = 1, archived_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        
        const result = stmt.run(id);
        
        logAction(
            client.praxis_id,
            userId,
            'DELETE',
            'client',
            id,
            client,
            null,
            `Client archived: ${client.name}`
        );
        
        console.log("✅ Client archived:", id);
        return result;
    } catch (error) {
        console.error("❌ Error deleting client:", error);
        throw error;
    }
}

// === SESSION MANAGEMENT === //

function addSession(sessionData) {
    try {
        // Get next session number for this client
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
        
        // Update client's session count if session is completed
        if (sessionData.status === 'durchgeführt') {
            updateClientSessionCount(sessionData.client_id);
        }
        
        console.log("✅ Session created for client:", sessionData.client_id);
        return result;
    } catch (error) {
        console.error("❌ Error creating session:", error);
        throw error;
    }
}

function getSessionsByClient(clientId, limit = 50, userPraxisId = null) {
    try {
        // Verify client access
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
        
        if (session && userPraxisId) {
            validatePraxisAccess(session.praxis_id, userPraxisId);
        }
        
        return session;
    } catch (error) {
        console.error("❌ Error fetching session:", error);
        return null;
    }
}

function updateClientSessionCount(clientId) {
    try {
        const stmt = db.prepare(`
            UPDATE clients 
            SET sessions_used = (
                SELECT COUNT(*) FROM sessions 
                WHERE client_id = ? AND status = 'durchgeführt'
            )
            WHERE id = ?
        `);
        return stmt.run(clientId, clientId);
    } catch (error) {
        console.error("❌ Error updating client session count:", error);
    }
}

// === SEARCH FUNCTIONS === //

function searchClients(query, praxisId) {
    try {
        const searchTerm = `%${query}%`;
        const stmt = db.prepare(`
            SELECT 
                c.*,
                COUNT(s.id) as total_sessions,
                MAX(s.date) as latest_session
            FROM clients c
            LEFT JOIN sessions s ON c.id = s.client_id
            WHERE c.praxis_id = ? AND c.is_archived = 0
            AND (
                c.name LIKE ? OR 
                c.client_number LIKE ? OR
                c.diagnosis_primary LIKE ? OR 
                c.diagnosis_secondary LIKE ? OR
                c.notes LIKE ?
            )
            GROUP BY c.id
            ORDER BY c.name ASC
            LIMIT 50
        `);
        return stmt.all(praxisId, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    } catch (error) {
        console.error("❌ Error searching clients:", error);
        return [];
    }
}

function searchSessions(query, clientId = null, praxisId) {
    try {
        const searchTerm = `%${query}%`;
        let sql = `
            SELECT 
                s.*,
                c.name as client_name,
                c.client_number
            FROM sessions s
            JOIN clients c ON s.client_id = c.id
            WHERE c.praxis_id = ? AND (
                s.notes LIKE ? OR 
                s.private_notes LIKE ? OR
                s.therapeutic_focus LIKE ? OR
                s.interventions_used LIKE ?
            )
        `;
        
        const params = [praxisId, searchTerm, searchTerm, searchTerm, searchTerm];
        
        if (clientId) {
            sql += " AND s.client_id = ?";
            params.push(clientId);
        }
        
        sql += " ORDER BY s.date DESC LIMIT 100";
        
        const stmt = db.prepare(sql);
        return stmt.all(...params);
    } catch (error) {
        console.error("❌ Error searching sessions:", error);
        return [];
    }
}

// === STATISTICS AND REPORTING === //

function getStatistics(praxisId) {
    try {
        const stats = {};
        
        // Basic counts
        stats.totalClients = db.prepare(`
            SELECT COUNT(*) as count FROM clients 
            WHERE praxis_id = ? AND is_archived = 0
        `).get(praxisId).count;
        
        stats.totalSessions = db.prepare(`
            SELECT COUNT(*) as count FROM sessions s
            JOIN clients c ON s.client_id = c.id
            WHERE c.praxis_id = ?
        `).get(praxisId).count;
        
        stats.completedSessions = db.prepare(`
            SELECT COUNT(*) as count FROM sessions s
            JOIN clients c ON s.client_id = c.id
            WHERE c.praxis_id = ? AND s.status = 'durchgeführt'
        `).get(praxisId).count;
        
        // Active treatment goals
        stats.activePlans = db.prepare(`
            SELECT COUNT(*) as count FROM treatment_goals tg
            JOIN clients c ON tg.client_id = c.id
            WHERE c.praxis_id = ? AND tg.status = 'active'
        `).get(praxisId).count;
        
        // Pending todos (notes marked as reminders)
        stats.pendingTodos = db.prepare(`
            SELECT COUNT(*) as count FROM notes n
            JOIN clients c ON n.client_id = c.id
            WHERE c.praxis_id = ? AND n.note_type = 'todo' AND n.status = 'active'
        `).get(praxisId).count;
        
        // This month statistics
        stats.sessionsThisMonth = db.prepare(`
            SELECT COUNT(*) as count FROM sessions s
            JOIN clients c ON s.client_id = c.id
            WHERE c.praxis_id = ? AND s.date >= date('now', 'start of month')
        `).get(praxisId).count;
        
        stats.newClientsThisMonth = db.prepare(`
            SELECT COUNT(*) as count FROM clients 
            WHERE praxis_id = ? AND created_at >= date('now', 'start of month')
        `).get(praxisId).count;
        
        // Risk assessment summary
        const riskStats = db.prepare(`
            SELECT 
                risk_level,
                COUNT(*) as count
            FROM clients 
            WHERE praxis_id = ? AND is_archived = 0
            GROUP BY risk_level
        `).all(praxisId);
        
        stats.riskLevels = {};
        riskStats.forEach(row => {
            stats.riskLevels[row.risk_level] = row.count;
        });
        
        // Therapy types distribution
        const therapyStats = db.prepare(`
            SELECT 
                therapy_type,
                COUNT(*) as count
            FROM clients 
            WHERE praxis_id = ? AND is_archived = 0 AND therapy_type IS NOT NULL
            GROUP BY therapy_type
        `).all(praxisId);
        
        stats.therapyTypes = {};
        therapyStats.forEach(row => {
            stats.therapyTypes[row.therapy_type] = row.count;
        });
        
        // Average session mood improvement
        const moodImprovement = db.prepare(`
            SELECT AVG(mood_after - mood_before) as avg_improvement
            FROM sessions s
            JOIN clients c ON s.client_id = c.id
            WHERE c.praxis_id = ? AND s.mood_before IS NOT NULL AND s.mood_after IS NOT NULL
        `).get(praxisId);
        
        stats.avgMoodImprovement = Math.round((moodImprovement.avg_improvement || 0) * 100) / 100;
        
        console.log("📊 Statistics calculated for praxis:", praxisId);
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

// === ASSESSMENT FUNCTIONS === //

function addAssessment(assessmentData) {
    try {
        const stmt = db.prepare(`
            INSERT INTO assessments (
                client_id, session_id, assessment_type, version, questions,
                responses, total_score, subscale_scores, severity_level,
                interpretation, recommendations, is_baseline, is_follow_up,
                administration_method, administrator, duration_minutes, notes,
                completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const result = stmt.run(
            assessmentData.client_id,
            assessmentData.session_id || null,
            assessmentData.assessment_type,
            assessmentData.version || '1.0',
            JSON.stringify(assessmentData.questions || []),
            JSON.stringify(assessmentData.responses),
            assessmentData.total_score,
            JSON.stringify(assessmentData.subscale_scores || {}),
            assessmentData.severity_level,
            assessmentData.interpretation || null,
            assessmentData.recommendations || null,
            assessmentData.is_baseline || 0,
            assessmentData.is_follow_up || 0,
            assessmentData.administration_method || 'self_report',
            assessmentData.administrator || null,
            assessmentData.duration_minutes || null,
            assessmentData.notes || null
        );
        
        console.log("✅ Assessment created:", assessmentData.assessment_type);
        return result;
    } catch (error) {
        console.error("❌ Error creating assessment:", error);
        throw error;
    }
}

function getAssessmentsByClient(clientId, assessmentType = null, userPraxisId = null) {
    try {
        // Verify client access
        const client = getClientById(clientId, userPraxisId);
        if (!client) {
            throw new Error('Client not found or access denied');
        }
        
        let sql = `
            SELECT 
                a.*,
                u.name as administrator_name
            FROM assessments a
            LEFT JOIN users u ON a.administrator = u.id
            WHERE a.client_id = ?
        `;
        
        const params = [clientId];
        
        if (assessmentType) {
            sql += " AND a.assessment_type = ?";
            params.push(assessmentType);
        }
        
        sql += " ORDER BY a.completed_at DESC";
        
        const stmt = db.prepare(sql);
        return stmt.all(...params).map(assessment => ({
            ...assessment,
            questions: JSON.parse(assessment.questions),
            responses: JSON.parse(assessment.responses),
            subscale_scores: JSON.parse(assessment.subscale_scores)
        }));
    } catch (error) {
        console.error("❌ Error fetching assessments:", error);
        return [];
    }
}

// === SETTINGS MANAGEMENT === //

function getSetting(key, category = 'app', praxisId = null) {
    try {
        const stmt = db.prepare(`
            SELECT value, value_type FROM settings 
            WHERE category = ? AND key = ? AND praxis_id IS ?
        `);
        const result = stmt.get(category, key, praxisId);
        
        if (!result) return null;
        
        // Parse value based on type
        switch (result.value_type) {
            case 'boolean':
                return result.value === 'true';
            case 'number':
                return parseFloat(result.value);
            case 'json':
                return JSON.parse(result.value);
            default:
                return result.value;
        }
    } catch (error) {
        console.error("❌ Error fetching setting:", error);
        return null;
    }
}

function setSetting(key, value, category = 'app', description = null, praxisId = null, userId = null) {
    try {
        // Determine value type
        let valueType = 'string';
        let valueStr = value;
        
        if (typeof value === 'boolean') {
            valueType = 'boolean';
            valueStr = value.toString();
        } else if (typeof value === 'number') {
            valueType = 'number';
            valueStr = value.toString();
        } else if (typeof value === 'object') {
            valueType = 'json';
            valueStr = JSON.stringify(value);
        }
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO settings (
                praxis_id, category, key, value, value_type, description, created_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        return stmt.run(praxisId, category, key, valueStr, valueType, description, userId);
    } catch (error) {
        console.error("❌ Error setting value:", error);
        throw error;
    }
}

// === MAINTENANCE FUNCTIONS === //

function vacuum() {
    try {
        console.log("🧹 Starting database maintenance...");
        
        // WAL checkpoint
        db.pragma('wal_checkpoint(FULL)');
        
        // Vacuum database
        db.exec('VACUUM');
        
        // Update statistics
        db.exec('ANALYZE');
        
        console.log("✅ Database maintenance completed");
    } catch (error) {
        console.error("❌ Database maintenance failed:", error);
        throw error;
    }
}

function getDataStats() {
    try {
        const stats = {
            database_size: fs.statSync(dbPath).size,
            wal_size: 0,
            tables: {},
            indexes: []
        };
        
        // Check WAL file size
        const walPath = dbPath + '-wal';
        if (fs.existsSync(walPath)) {
            stats.wal_size = fs.statSync(walPath).size;
        }
        
        // Table statistics
        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).all();
        
        tables.forEach(table => {
            try {
                const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get().count;
                stats.tables[table.name] = count;
            } catch (error) {
                stats.tables[table.name] = 'Error';
            }
        });
        
        // Index information
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='index' AND name NOT LIKE 'sqlite_%'
        `).all();
        
        stats.indexes = indexes.map(idx => idx.name);
        
        return stats;
    } catch (error) {
        console.error("❌ Error getting data statistics:", error);
        return {};
    }
}

function backupDatabase(backupPath) {
    try {
        console.log("💾 Creating database backup...");
        
        // Ensure backup directory exists
        const backupDir = path.dirname(backupPath);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Create backup using SQLite backup API
        db.backup(backupPath);
        
        console.log("✅ Backup created:", backupPath);
        return true;
    } catch (error) {
        console.error("❌ Backup failed:", error);
        return false;
    }
}

function cleanupOldData() {
    try {
        console.log("🧹 Cleaning up old data...");
        
        const retentionDays = getSetting('retention_days', 'database') || 2555;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffStr = cutoffDate.toISOString();
        
        // Clean up old login attempts (keep only 90 days)
        const loginCleanup = db.prepare(`
            DELETE FROM login_attempts 
            WHERE attempted_at < date('now', '-90 days')
        `);
        const loginResult = loginCleanup.run();
        
        // Clean up old audit logs (configurable retention)
        const auditRetentionDays = getSetting('audit_log_retention', 'privacy') || 365;
        const auditCleanup = db.prepare(`
            DELETE FROM audit_log 
            WHERE created_at < date('now', '-${auditRetentionDays} days')
        `);
        const auditResult = auditCleanup.run();
        
        console.log(`✅ Cleanup completed: ${loginResult.changes} login attempts, ${auditResult.changes} audit logs removed`);
        
        return {
            loginAttempts: loginResult.changes,
            auditLogs: auditResult.changes
        };
    } catch (error) {
        console.error("❌ Cleanup failed:", error);
        return null;
    }
}

// === GRACEFUL SHUTDOWN === //

function closeDatabase() {
    try {
        console.log("🛑 Closing database connection...");
        
        // WAL checkpoint before closing
        db.pragma('wal_checkpoint(FULL)');
        
        // Close database
        db.close();
        
        console.log("✅ Database connection closed");
    } catch (error) {
        console.error("❌ Error closing database:", error);
    }
}

// Process shutdown handlers
process.on('SIGINT', () => {
    console.log("\n🛑 Received SIGINT, closing database...");
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log("\n🛑 Received SIGTERM, closing database...");
    closeDatabase();
    process.exit(0);
});

// Initialize database on load
initializeDatabase();

// Periodic maintenance (every 6 hours)
setInterval(() => {
    try {
        cleanupOldData();
        vacuum();
    } catch (error) {
        console.error("❌ Periodic maintenance failed:", error);
    }
}, 6 * 60 * 60 * 1000);

// === EXPORTS === //

module.exports = {
    db,
    
    // Core database functions
    closeDatabase,
    vacuum,
    getDataStats,
    backupDatabase,
    cleanupOldData,
    
    // Praxis management
    addPraxis,
    getPraxisById,
    updatePraxis,
    
    // User management
    addUser,
    getUserById,
    getUserByEmail,
    getUsersByPraxis,
    updateUserLogin,
    
    // Client management
    addClient,
    getClients,
    getClientById,
    updateClient,
    deleteClient,
    
    // Session management
    addSession,
    getSessionsByClient,
    getSessionById,
    
    // Document management (placeholders for compatibility)
    addDocument: (docData) => ({ lastInsertRowid: Date.now() }),
    getDocumentsByClient: (clientId) => [],
    getDocumentById: (id) => null,
    
    // Audio transcriptions (placeholders)
    addAudioTranscription: (audioData) => ({ lastInsertRowid: Date.now() }),
    getAudioTranscriptionsByClient: (clientId) => [],
    
    // Chat history (placeholders)
    addChatMessage: (messageData) => ({ lastInsertRowid: Date.now() }),
    getChatHistory: (clientId, limit) => [],
    getRecentChatHistory: (limit) => [],
    
    // Treatment goals (placeholders)
    addTreatmentGoal: (goalData) => ({ lastInsertRowid: Date.now() }),
    getTreatmentGoalsByClient: (clientId) => [],
    updateTreatmentGoal: (id, updates) => ({ changes: 1 }),
    
    // Assessment management
    addAssessment,
    getAssessmentsByClient,
    
    // Search functions
    searchClients,
    searchSessions,
    
    // Statistics
    getStatistics,
    
    // Settings management
    getSetting,
    setSetting,
    
    // Placeholders for additional features
    addAnamnese: (data) => ({ lastInsertRowid: Date.now() }),
    getAnamnesesByClient: (clientId) => [],
    addInvoice: (invoiceData) => ({ lastInsertRowid: Date.now() }),
    addInvoiceItem: (itemData) => ({ lastInsertRowid: Date.now() }),
    getInvoicesByClient: (clientId) => [],
    getInvoiceItems: (invoiceId) => [],
    
    // Utility functions
    logAction,
    generateSecureId,
    hashString,
    validatePraxisAccess
};