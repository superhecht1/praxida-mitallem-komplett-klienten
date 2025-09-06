// db.js - Praxida 2.0 SQLite Database Layer
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Stelle sicher, dass der data Ordner existiert
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log("📁 Data-Ordner erstellt");
}

// SQLite Datei im data Ordner
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, "praxida.db");
console.log("📍 Datenbank-Pfad:", dbPath);

let db;
try {
  db = new Database(dbPath);
  console.log("✅ Datenbank erfolgreich verbunden");
  
  // WAL Mode für bessere Performance und Concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 1000000');
  db.pragma('temp_store = memory');
  
  // Initialisiere Tabellen
  initializeTables();
  console.log("✅ Tabellen initialisiert");
  
} catch (error) {
  console.error("❌ Datenbank-Fehler:", error);
  process.exit(1);
}

function initializeTables() {
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Clients/Patienten Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      birth_date TEXT,
      address TEXT,
      diagnosis TEXT,
      notes TEXT,
      sessions INTEGER DEFAULT 0,
      last_session TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Sitzungen/Sessions Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      duration INTEGER DEFAULT 50,
      type TEXT DEFAULT 'Einzeltherapie',
      notes TEXT,
      private_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `).run();

  // Dokumente Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      session_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT,
      file_path TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();

  // Chat-Verlauf Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      session_id INTEGER,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();

  // Audio-Transkriptionen Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS audio_transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      session_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT,
      file_path TEXT NOT NULL,
      transcription TEXT,
      analysis TEXT,
      duration INTEGER,
      file_size INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();

  // Notizen/Bemerkungen Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      session_id INTEGER,
      title TEXT,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      is_private BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();

  // Behandlungsziele Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS treatment_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_date TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `).run();

  // Termine Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      date_time TEXT NOT NULL,
      duration INTEGER DEFAULT 50,
      type TEXT DEFAULT 'therapy',
      status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
      notes TEXT,
      reminder_sent BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `).run();

  // System-Einstellungen Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      description TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Erstelle Indizes für bessere Performance
  createIndexes();

  // Demo-Daten einfügen wenn Datenbank leer ist
  const clientCount = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
  if (clientCount === 0) {
    insertDemoData();
  }

  // Initialisiere System-Einstellungen
  initializeSettings();
}

function createIndexes() {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)",
    "CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_chat_history_client_id ON chat_history(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp ON chat_history(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_audio_transcriptions_client_id ON audio_transcriptions(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_notes_client_id ON notes(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_treatment_goals_client_id ON treatment_goals(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_date_time ON appointments(date_time)"
  ];

  indexes.forEach(indexSQL => {
    try {
      db.prepare(indexSQL).run();
    } catch (error) {
      console.warn("Index bereits vorhanden:", indexSQL);
    }
  });
}

function initializeSettings() {
  const defaultSettings = [
    { key: 'app_version', value: '2.0.0', description: 'Anwendungsversion' },
    { key: 'db_version', value: '1.0', description: 'Datenbankschema Version' },
    { key: 'session_duration_default', value: '50', description: 'Standard-Sitzungsdauer in Minuten' },
    { key: 'backup_enabled', value: 'true', description: 'Automatische Backups aktiviert' },
    { key: 'data_retention_days', value: '2555', description: 'Datenaufbewahrung in Tagen (7 Jahre)' }
  ];

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, description, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `);

  defaultSettings.forEach(setting => {
    insertSetting.run(setting.key, setting.value, setting.description);
  });
}

function insertDemoData() {
  console.log("📋 Füge Demo-Daten hinzu...");
  
  try {
    const insertClient = db.prepare(`
      INSERT INTO clients (name, email, phone, diagnosis, notes, sessions, last_session, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const client1 = insertClient.run(
      'A.M.',
      'patient1@demo.com',
      '+49 123 456 789',
      'F32.1 Depression',
      'Verhaltenstherapie. Patient zeigt gute Compliance und Motivation zur Veränderung.',
      8,
      '2024-08-25',
      '2024-08-01'
    );

    const client2 = insertClient.run(
      'B.S.',
      'patient2@demo.com',
      '+49 987 654 321',
      'F41.1 Angststörung',
      'Tiefenpsychologie. Schwerpunkt auf Bearbeitung von Kindheitstrauma.',
      12,
      '2024-08-28',
      '2024-07-15'
    );

    // Demo-Sessions hinzufügen
    const insertSession = db.prepare(`
      INSERT INTO sessions (client_id, date, duration, type, notes, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    insertSession.run(client1.lastInsertRowid, '2024-08-25', 50, 'Einzeltherapie', 
      'Bearbeitung der aktuellen depressiven Symptomatik. Patient berichtet von leichter Verbesserung der Stimmung.');
    
    insertSession.run(client2.lastInsertRowid, '2024-08-28', 50, 'Einzeltherapie', 
      'Fortsetzung der Traumabearbeitung. Stabilisierung steht im Vordergrund.');

    // Demo-Behandlungsziele
    const insertGoal = db.prepare(`
      INSERT INTO treatment_goals (client_id, title, description, target_date, status, priority, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertGoal.run(client1.lastInsertRowid, 'Stimmungsverbesserung', 
      'Reduktion der depressiven Symptomatik um mindestens 50%', 
      '2024-12-31', 'active', 'high', 30);

    insertGoal.run(client2.lastInsertRowid, 'Angstreduktion', 
      'Bewältigung von sozialen Situationen ohne starke Angstreaktionen', 
      '2024-11-30', 'active', 'high', 45);

    console.log("✅ Demo-Daten eingefügt:", client1.lastInsertRowid, client2.lastInsertRowid);
  } catch (error) {
    console.error("❌ Fehler beim Einfügen der Demo-Daten:", error);
  }
}

// --- CLIENT FUNKTIONEN --- //
function addClient(clientData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO clients (name, email, phone, birth_date, address, diagnosis, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    
    const result = stmt.run(
      clientData.name || clientData.initials,
      clientData.email || null,
      clientData.phone || null,
      clientData.birth_date || null,
      clientData.address || null,
      clientData.diagnosis || null,
      clientData.notes || null
    );
    
    console.log("✅ Client hinzugefügt:", clientData.name, "ID:", result.lastInsertRowid);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen des Clients:", error);
    throw error;
  }
}

function getClients() {
  try {
    const stmt = db.prepare(`
      SELECT 
        c.*,
        COUNT(s.id) as total_sessions,
        MAX(s.date) as latest_session
      FROM clients c
      LEFT JOIN sessions s ON c.id = s.client_id
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    const clients = stmt.all();
    
    // Aktualisiere sessions count falls nötig
    clients.forEach(client => {
      if (client.sessions !== client.total_sessions) {
        db.prepare("UPDATE clients SET sessions = ? WHERE id = ?")
          .run(client.total_sessions, client.id);
        client.sessions = client.total_sessions;
      }
      if (client.latest_session && client.last_session !== client.latest_session) {
        db.prepare("UPDATE clients SET last_session = ? WHERE id = ?")
          .run(client.latest_session, client.id);
        client.last_session = client.latest_session;
      }
    });
    
    console.log("📋 Clients abgerufen:", clients.length);
    return clients;
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Clients:", error);
    return [];
  }
}

function getClientById(id) {
  try {
    const stmt = db.prepare(`
      SELECT 
        c.*,
        COUNT(s.id) as total_sessions,
        COUNT(CASE WHEN s.date >= date('now', '-30 days') THEN 1 END) as sessions_last_month
      FROM clients c
      LEFT JOIN sessions s ON c.id = s.client_id
      WHERE c.id = ?
      GROUP BY c.id
    `);
    return stmt.get(id);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen des Clients:", error);
    return null;
  }
}

function updateClient(id, updates) {
  try {
    const allowedFields = ['name', 'email', 'phone', 'birth_date', 'address', 'diagnosis', 'notes'];
    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    
    if (fields.length === 0) {
      throw new Error('Keine gültigen Felder zum Aktualisieren gefunden');
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
    console.log("✅ Client aktualisiert, ID:", id);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Aktualisieren des Clients:", error);
    throw error;
  }
}

function deleteClient(id) {
  try {
    // Start transaction für CASCADE delete
    const transaction = db.transaction(() => {
      // Lösche zugehörige Dateien (optional - physische Dateien)
      const documents = db.prepare("SELECT file_path FROM documents WHERE client_id = ?").all(id);
      documents.forEach(doc => {
        try {
          if (fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
          }
        } catch (error) {
          console.warn("Datei konnte nicht gelöscht werden:", doc.file_path);
        }
      });
      
      // Client löschen (CASCADE löscht automatisch abhängige Datensätze)
      const result = db.prepare("DELETE FROM clients WHERE id = ?").run(id);
      return result;
    });
    
    const result = transaction();
    console.log("🗑️ Client gelöscht, ID:", id);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Löschen des Clients:", error);
    throw error;
  }
}

// --- SESSION FUNKTIONEN --- //
function addSession(sessionData) {
  try {
    const transaction = db.transaction(() => {
      // Session hinzufügen
      const stmt = db.prepare(`
        INSERT INTO sessions (client_id, date, duration, type, notes, private_notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      const result = stmt.run(
        sessionData.client_id,
        sessionData.date || new Date().toISOString().split('T')[0],
        sessionData.duration || 50,
        sessionData.type || 'Einzeltherapie',
        sessionData.notes || null,
        sessionData.private_notes || null
      );
      
      // Update client's session count and last session
      db.prepare(`
        UPDATE clients 
        SET sessions = sessions + 1, 
            last_session = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionData.date || new Date().toISOString().split('T')[0], sessionData.client_id);
      
      return result;
    });
    
    const result = transaction();
    console.log("✅ Session hinzugefügt für Client:", sessionData.client_id);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen der Session:", error);
    throw error;
  }
}

function getSessionsByClient(clientId, limit = 50) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM sessions 
      WHERE client_id = ? 
      ORDER BY date DESC, created_at DESC
      LIMIT ?
    `);
    return stmt.all(clientId, limit);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Sessions:", error);
    return [];
  }
}

function getSessionById(id) {
  try {
    const stmt = db.prepare(`
      SELECT s.*, c.name as client_name 
      FROM sessions s
      LEFT JOIN clients c ON s.client_id = c.id
      WHERE s.id = ?
    `);
    return stmt.get(id);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Session:", error);
    return null;
  }
}

// --- DOCUMENT FUNKTIONEN --- //
function addDocument(docData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO documents (client_id, session_id, filename, original_name, file_path, file_type, file_size, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    const result = stmt.run(
      docData.client_id || null,
      docData.session_id || null,
      docData.filename,
      docData.original_name,
      docData.file_path,
      docData.file_type,
      docData.file_size
    );
    
    console.log("📎 Dokument hinzugefügt:", docData.original_name);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen des Dokuments:", error);
    throw error;
  }
}

function getDocumentsByClient(clientId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM documents 
      WHERE client_id = ? 
      ORDER BY uploaded_at DESC
    `);
    return stmt.all(clientId);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Dokumente:", error);
    return [];
  }
}

function getDocumentById(id) {
  try {
    const stmt = db.prepare("SELECT * FROM documents WHERE id = ?");
    return stmt.get(id);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen des Dokuments:", error);
    return null;
  }
}

// --- AUDIO TRANSKRIPTION FUNKTIONEN --- //
function addAudioTranscription(audioData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audio_transcriptions 
      (client_id, session_id, filename, original_name, file_path, transcription, analysis, duration, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    const result = stmt.run(
      audioData.client_id || null,
      audioData.session_id || null,
      audioData.filename,
      audioData.original_name,
      audioData.file_path,
      audioData.transcription || null,
      audioData.analysis || null,
      audioData.duration || null,
      audioData.file_size
    );
    
    console.log("🎤 Audio-Transkription hinzugefügt:", audioData.original_name);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen der Audio-Transkription:", error);
    throw error;
  }
}

function getAudioTranscriptionsByClient(clientId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM audio_transcriptions 
      WHERE client_id = ? 
      ORDER BY created_at DESC
    `);
    return stmt.all(clientId);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Audio-Transkriptionen:", error);
    return [];
  }
}

// --- CHAT HISTORY FUNKTIONEN --- //
function addChatMessage(messageData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO chat_history (client_id, session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    const result = stmt.run(
      messageData.client_id || null,
      messageData.session_id || null,
      messageData.role,
      messageData.content
    );
    
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen der Chat-Nachricht:", error);
    throw error;
  }
}

function getChatHistory(clientId, limit = 50) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM chat_history 
      WHERE client_id = ? OR client_id IS NULL
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    return stmt.all(clientId, limit).reverse();
  } catch (error) {
    console.error("❌ Fehler beim Abrufen des Chat-Verlaufs:", error);
    return [];
  }
}

function getRecentChatHistory(limit = 20) {
  try {
    const stmt = db.prepare(`
      SELECT ch.*, c.name as client_name 
      FROM chat_history ch
      LEFT JOIN clients c ON ch.client_id = c.id
      ORDER BY ch.timestamp DESC 
      LIMIT ?
    `);
    return stmt.all(limit);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen des Chat-Verlaufs:", error);
    return [];
  }
}

// --- TREATMENT GOALS FUNKTIONEN --- //
function addTreatmentGoal(goalData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO treatment_goals (client_id, title, description, target_date, status, priority, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      goalData.client_id,
      goalData.title,
      goalData.description || null,
      goalData.target_date || null,
      goalData.status || 'active',
      goalData.priority || 'medium',
      goalData.progress || 0
    );
    
    console.log("🎯 Behandlungsziel hinzugefügt:", goalData.title);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen des Behandlungsziels:", error);
    throw error;
  }
}

function getTreatmentGoalsByClient(clientId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM treatment_goals 
      WHERE client_id = ? 
      ORDER BY 
        CASE status 
          WHEN 'active' THEN 1
          WHEN 'paused' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'cancelled' THEN 4
        END,
        priority DESC,
        created_at ASC
    `);
    return stmt.all(clientId);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Behandlungsziele:", error);
    return [];
  }
}

function updateTreatmentGoal(id, updates) {
  try {
    const allowedFields = ['title', 'description', 'target_date', 'status', 'priority', 'progress'];
    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    
    if (fields.length === 0) {
      throw new Error('Keine gültigen Felder zum Aktualisieren gefunden');
    }
    
    const setClause = fields.map(key => `${key} = ?`).join(', ');
    const values = fields.map(key => updates[key]);
    values.push(id);
    
    const stmt = db.prepare(`
      UPDATE treatment_goals 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    return stmt.run(...values);
  } catch (error) {
    console.error("❌ Fehler beim Aktualisieren des Behandlungsziels:", error);
    throw error;
  }
}

// --- STATISTIK FUNKTIONEN --- //
function getStatistics() {
  try {
    const stats = {};
    
    // Basis-Statistiken
    stats.totalClients = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
    stats.totalSessions = db.prepare("SELECT SUM(sessions) as count FROM clients").get().count || 0;
    stats.totalDocuments = db.prepare("SELECT COUNT(*) as count FROM documents").get().count;
    stats.totalAudioFiles = db.prepare("SELECT COUNT(*) as count FROM audio_transcriptions").get().count;
    
    // Zeitbasierte Statistiken
    stats.sessionsThisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM sessions 
      WHERE date >= date('now', 'start of month')
    `).get().count;
    
    stats.sessionsThisWeek = db.prepare(`
      SELECT COUNT(*) as count FROM sessions 
      WHERE date >= date('now', 'weekday 0', '-6 days')
    `).get().count;
    
    stats.newClientsThisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM clients 
      WHERE created_at >= date('now', 'start of month')
    `).get().count;
    
    // Behandlungsziele
    const goalStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        AVG(progress) as avg_progress
      FROM treatment_goals
    `).get();
    
    stats.activePlans = goalStats.active || 0;
    stats.completedGoals = goalStats.completed || 0;
    stats.averageProgress = Math.round(goalStats.avg_progress || 0);
    
    // Pendende To-Dos (für Kompatibilität)
    stats.pendingTodos = Math.max(0, stats.activePlans - Math.floor(stats.activePlans * 0.7));
    
    // Chat-Aktivität
    stats.chatMessages = db.prepare(`
      SELECT COUNT(*) as count FROM chat_history 
      WHERE timestamp >= date('now', '-7 days')
    `).get().count;
    
    // Top-Diagnosen
    stats.topDiagnoses = db.prepare(`
      SELECT diagnosis, COUNT(*) as count 
      FROM clients 
      WHERE diagnosis IS NOT NULL AND diagnosis != ''
      GROUP BY diagnosis 
      ORDER BY count DESC 
      LIMIT 5
    `).all();
    
    console.log("📊 Statistiken abgerufen:", {
      clients: stats.totalClients,
      sessions: stats.totalSessions,
      activePlans: stats.activePlans
    });
    
    return stats;
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Statistiken:", error);
    return {
      totalClients: 0,
      totalSessions: 0,
      pendingTodos: 0,
      activePlans: 0,
      sessionsThisMonth: 0,
      newClientsThisMonth: 0
    };
  }
}

// --- ANAMNESE FUNKTIONEN --- //
function addAnamnese(data) {
  try {
    const stmt = db.prepare(`
      INSERT INTO anamneses (client_id, created_by, data, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(data.client_id, data.created_by || null, JSON.stringify(data.data));
    console.log("📝 Anamnese gespeichert für Client:", data.client_id);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen der Anamnese:", error);
    throw error;
  }
}

function getAnamnesesByClient(clientId) {
  try {
    const stmt = db.prepare(`
      SELECT a.*, u.name as created_by_name
      FROM anamneses a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.client_id = ?
      ORDER BY a.created_at DESC
    `);
    return stmt.all(clientId).map(r => ({
      ...r,
      data: JSON.parse(r.data)
    }));
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Anamnesen:", error);
    return [];
  }
}

// --- INVOICE FUNKTIONEN --- //
function addInvoice(invoiceData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO invoices (praxis_id, client_id, created_by, invoice_number, date, due_date, amount, status, pdf_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      invoiceData.praxis_id,
      invoiceData.client_id,
      invoiceData.created_by || null,
      invoiceData.invoice_number,
      invoiceData.date,
      invoiceData.due_date || null,
      invoiceData.amount,
      invoiceData.status || 'open',
      invoiceData.pdf_path || null
    );
    console.log("💰 Rechnung erstellt:", invoiceData.invoice_number);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Erstellen der Rechnung:", error);
    throw error;
  }
}

function addInvoiceItem(itemData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(
      itemData.invoice_id,
      itemData.description,
      itemData.quantity || 1,
      itemData.unit_price
    );
    console.log("➕ Rechnungsposition hinzugefügt:", itemData.description);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen der Rechnungsposition:", error);
    throw error;
  }
}

function getInvoicesByClient(clientId) {
  try {
    const stmt = db.prepare(`
      SELECT i.*, u.name as created_by_name
      FROM invoices i
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.client_id = ?
      ORDER BY i.date DESC
    `);
    return stmt.all(clientId);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Rechnungen:", error);
    return [];
  }
}

function getInvoiceItems(invoiceId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM invoice_items WHERE invoice_id = ?
    `);
    return stmt.all(invoiceId);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Rechnungspositionen:", error);
    return [];
  }
}

// --- USER & PRAXIS FUNKTIONEN --- //
function addPraxis(praxisData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO praxis (name, adresse, telefon, email, logo_url, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      praxisData.name,
      praxisData.adresse || null,
      praxisData.telefon || null,
      praxisData.email || null,
      praxisData.logo_url || null
    );
    console.log("🏢 Praxis erstellt:", praxisData.name);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Erstellen der Praxis:", error);
    throw error;
  }
}

function addUser(userData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO users (praxis_id, name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      userData.praxis_id,
      userData.name,
      userData.email,
      userData.password_hash,
      userData.role || 'therapeut'
    );
    console.log("👤 Benutzer hinzugefügt:", userData.name);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen des Benutzers:", error);
    throw error;
  }
}

function getUsersByPraxis(praxisId) {
  try {
    const stmt = db.prepare(`
      SELECT id, name, email, role, created_at
      FROM users
      WHERE praxis_id = ?
      ORDER BY name ASC
    `);
    return stmt.all(praxisId);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Benutzer:", error);
    return [];
  }
}

// --- SEARCH FUNKTIONEN --- //
function searchClients(query) {
  try {
    const searchTerm = `%${query}%`;
    const stmt = db.prepare(`
      SELECT * FROM clients 
      WHERE name LIKE ? OR diagnosis LIKE ? OR notes LIKE ?
      ORDER BY name ASC
    `);
    return stmt.all(searchTerm, searchTerm, searchTerm);
  } catch (error) {
    console.error("❌ Fehler bei Client-Suche:", error);
    return [];
  }
}

function searchSessions(query, clientId = null) {
  try {
    const searchTerm = `%${query}%`;
    let sql = `
      SELECT s.*, c.name as client_name 
      FROM sessions s
      LEFT JOIN clients c ON s.client_id = c.id
      WHERE (s.notes LIKE ? OR s.private_notes LIKE ?)
    `;
    
    const params = [searchTerm, searchTerm];
    
    if (clientId) {
      sql += " AND s.client_id = ?";
      params.push(clientId);
    }
    
    sql += " ORDER BY s.date DESC LIMIT 50";
    
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  } catch (error) {
    console.error("❌ Fehler bei Session-Suche:", error);
    return [];
  }
}

// --- SETTINGS FUNKTIONEN --- //
function getSetting(key) {
  try {
    const stmt = db.prepare("SELECT value FROM settings WHERE key = ?");
    const result = stmt.get(key);
    return result ? result.value : null;
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Einstellung:", error);
    return null;
  }
}

function setSetting(key, value, description = null) {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, description, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    return stmt.run(key, value, description);
  } catch (error) {
    console.error("❌ Fehler beim Setzen der Einstellung:", error);
    throw error;
  }
}

// --- MAINTENANCE FUNKTIONEN --- //
function vacuum() {
  try {
    console.log("🧹 Starte Datenbank-Wartung...");
    db.pragma('wal_checkpoint(FULL)');
    db.exec('VACUUM');
    console.log("✅ Datenbank-Wartung abgeschlossen");
  } catch (error) {
    console.error("❌ Fehler bei Datenbank-Wartung:", error);
  }
}

function getDataStats() {
  try {
    const stats = {
      database_size: fs.statSync(dbPath).size,
      tables: {},
      indexes: []
    };
    
    // Tabellen-Statistiken
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    tables.forEach(table => {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get().count;
      stats.tables[table.name] = count;
    });
    
    // Index-Informationen
    stats.indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
    
    return stats;
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Datenstatistiken:", error);
    return {};
  }
}

// --- BACKUP HELPER --- //
function backupDatabase(backupPath) {
  try {
    console.log("💾 Erstelle Datenbank-Backup...");
    db.backup(backupPath);
    console.log("✅ Backup erstellt:", backupPath);
    return true;
  } catch (error) {
    console.error("❌ Backup-Fehler:", error);
    return false;
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log("\n🛑 Beende Datenbank-Verbindung...");
  if (db) {
    // WAL Checkpoint vor dem Schließen
    try {
      db.pragma('wal_checkpoint(FULL)');
      db.close();
      console.log("✅ Datenbank-Verbindung sauber geschlossen");
    } catch (error) {
      console.error("❌ Fehler beim Schließen der Datenbank:", error);
    }
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log("\n🛑 SIGTERM empfangen, schließe Datenbank...");
  if (db) {
    try {
      db.pragma('wal_checkpoint(FULL)');
      db.close();
      console.log("✅ Datenbank geschlossen");
    } catch (error) {
      console.error("❌ Fehler beim Schließen:", error);
    }
  }
  process.exit(0);
});

// Export aller Funktionen
module.exports = {
  db,
  
  // Client functions
  addClient,
  getClients,
  getClientById,
  updateClient,
  deleteClient,
  
  // Session functions
  addSession,
  getSessionsByClient,
  getSessionById,
  
  // Document functions
  addDocument,
  getDocumentsByClient,
  getDocumentById,
  
  // Audio transcription functions
  addAudioTranscription,
  getAudioTranscriptionsByClient,
  
  // Chat functions
  addChatMessage,
  getChatHistory,
  getRecentChatHistory,
  
  // Treatment goals functions
  addTreatmentGoal,
  getTreatmentGoalsByClient,
  updateTreatmentGoal,
  
  // Search functions
  searchClients,
  searchSessions,
  
  // Settings functions
  getSetting,
  setSetting,
  
  // Statistics
  getStatistics,
  
  // Maintenance functions
  vacuum,
  getDataStats,
  backupDatabase

    // Anamnese
  addAnamnese,
  getAnamnesesByClient,

  // Invoices
  addInvoice,
  addInvoiceItem,
  getInvoicesByClient,
  getInvoiceItems,

  // Praxis & User
  addPraxis,
  addUser,
  getUsersByPraxis,
};
