// db.js - Erweiterte Version
const Database = require("better-sqlite3");
const path = require("path");

// SQLite Datei im Projektordner
const dbPath = path.join(__dirname, process.env.DB_PATH || "database.sqlite");
const db = new Database(dbPath);

// WAL Mode für bessere Performance bei gleichzeitigen Zugriffen
db.pragma('journal_mode = WAL');

// --- TABELLEN ERSTELLEN --- //

// Clients/Patienten Tabelle
db.prepare(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    birth_date DATE,
    address TEXT,
    diagnosis TEXT,
    notes TEXT,
    sessions INTEGER DEFAULT 0,
    last_session DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Sitzungen/Sessions Tabelle
db.prepare(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    date DATE NOT NULL,
    duration INTEGER, -- in Minuten
    type TEXT, -- z.B. 'Einzeltherapie', 'Gruppensitzung'
    notes TEXT,
    private_notes TEXT, -- nur für Therapeuten
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`).run();

// Chat-Verlauf Tabelle (für KI-Interaktionen)
db.prepare(`
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    session_id INTEGER,
    role TEXT NOT NULL, -- 'user' oder 'assistant'
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`).run();

// Termine Tabelle
db.prepare(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    duration INTEGER DEFAULT 50, -- Standard 50 Minuten
    type TEXT,
    status TEXT DEFAULT 'geplant', -- 'geplant', 'abgeschlossen', 'abgesagt'
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )
`).run();

// --- CLIENT FUNKTIONEN --- //
function addClient(clientData) {
  const stmt = db.prepare(`
    INSERT INTO clients (name, email, phone, birth_date, address, diagnosis, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    clientData.name,
    clientData.email || null,
    clientData.phone || null,
    clientData.birth_date || null,
    clientData.address || null,
    clientData.diagnosis || null,
    clientData.notes || null
  );
}

function getClients() {
  const stmt = db.prepare("SELECT * FROM clients ORDER BY name ASC");
  return stmt.all();
}

function getClientById(id) {
  const stmt = db.prepare("SELECT * FROM clients WHERE id = ?");
  return stmt.get(id);
}

function updateClient(id, updates) {
  const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = Object.values(updates);
  values.push(id);
  
  const stmt = db.prepare(`
    UPDATE clients 
    SET ${fields}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run(...values);
}

function deleteClient(id) {
  const stmt = db.prepare("DELETE FROM clients WHERE id = ?");
  return stmt.run(id);
}

// --- SESSION FUNKTIONEN --- //
function addSession(sessionData) {
  const stmt = db.prepare(`
    INSERT INTO sessions (client_id, date, duration, type, notes, private_notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    sessionData.client_id,
    sessionData.date,
    sessionData.duration || 50,
    sessionData.type || 'Einzeltherapie',
    sessionData.notes || null,
    sessionData.private_notes || null
  );
  
  // Update client's session count
  db.prepare(`
    UPDATE clients 
    SET sessions = sessions + 1, 
        last_session = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sessionData.date, sessionData.client_id);
  
  return result;
}

function getSessionsByClient(clientId) {
  const stmt = db.prepare(`
    SELECT * FROM sessions 
    WHERE client_id = ? 
    ORDER BY date DESC
  `);
  return stmt.all(clientId);
}

function getSessionById(id) {
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  return stmt.get(id);
}

// --- DOCUMENT FUNKTIONEN --- //
function addDocument(docData) {
  const stmt = db.prepare(`
    INSERT INTO documents (client_id, session_id, filename, original_name, file_path, file_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    docData.client_id || null,
    docData.session_id || null,
    docData.filename,
    docData.original_name,
    docData.file_path,
    docData.file_type,
    docData.file_size
  );
}

function getDocumentsByClient(clientId) {
  const stmt = db.prepare(`
    SELECT * FROM documents 
    WHERE client_id = ? 
    ORDER BY uploaded_at DESC
  `);
  return stmt.all(clientId);
}

// --- CHAT HISTORY FUNKTIONEN --- //
function addChatMessage(messageData) {
  const stmt = db.prepare(`
    INSERT INTO chat_history (client_id, session_id, role, content)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(
    messageData.client_id || null,
    messageData.session_id || null,
    messageData.role,
    messageData.content
  );
}

function getChatHistory(clientId, limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM chat_history 
    WHERE client_id = ? 
    ORDER BY timestamp DESC 
    LIMIT ?
  `);
  return stmt.all(clientId, limit).reverse();
}

// --- APPOINTMENT FUNKTIONEN --- //
function addAppointment(appointmentData) {
  const stmt = db.prepare(`
    INSERT INTO appointments (client_id, date, time, duration, type, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    appointmentData.client_id,
    appointmentData.date,
    appointmentData.time,
    appointmentData.duration || 50,
    appointmentData.type || 'Therapiesitzung',
    appointmentData.status || 'geplant',
    appointmentData.notes || null
  );
}

function getUpcomingAppointments(days = 30) {
  const stmt = db.prepare(`
    SELECT a.*, c.name as client_name 
    FROM appointments a
    JOIN clients c ON a.client_id = c.id
    WHERE a.date >= date('now') 
      AND a.date <= date('now', '+' || ? || ' days')
      AND a.status = 'geplant'
    ORDER BY a.date ASC, a.time ASC
  `);
  return stmt.all(days);
}

function getAppointmentsByClient(clientId) {
  const stmt = db.prepare(`
    SELECT * FROM appointments 
    WHERE client_id = ? 
    ORDER BY date DESC, time DESC
  `);
  return stmt.all(clientId);
}

// --- STATISTIK FUNKTIONEN --- //
function getStatistics() {
  const stats = {};
  
  stats.totalClients = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
  stats.totalSessions = db.prepare("SELECT COUNT(*) as count FROM sessions").get().count;
  stats.upcomingAppointments = db.prepare(`
    SELECT COUNT(*) as count FROM appointments 
    WHERE date >= date('now') AND status = 'geplant'
  `).get().count;
  
  stats.sessionsThisMonth = db.prepare(`
    SELECT COUNT(*) as count FROM sessions 
    WHERE date >= date('now', 'start of month')
  `).get().count;
  
  stats.recentActivity = db.prepare(`
    SELECT c.name, s.date, s.type 
    FROM sessions s
    JOIN clients c ON s.client_id = c.id
    ORDER BY s.date DESC
    LIMIT 5
  `).all();
  
  return stats;
}

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
  // Chat functions
  addChatMessage,
  getChatHistory,
  // Appointment functions
  addAppointment,
  getUpcomingAppointments,
  getAppointmentsByClient,
  // Statistics
  getStatistics
};
