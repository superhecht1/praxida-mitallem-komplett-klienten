// db.js - Saubere, vollständige Version
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// --- Data-Ordner sicherstellen ---
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log("📁 Data-Ordner erstellt");
}

// --- SQLite Datenbank ---
const dbPath = path.join(dataDir, "praxida.db");
console.log("📍 Datenbank-Pfad:", dbPath);

let db;
try {
  db = new Database(dbPath);
  console.log("✅ Datenbank erfolgreich verbunden");

  // WAL Mode für bessere Performance
  db.pragma("journal_mode = WAL");

  // Tabellen initialisieren
  initializeTables();
  console.log("✅ Tabellen initialisiert");
} catch (error) {
  console.error("❌ Datenbank-Fehler:", error);
  process.exit(1);
}

// --- Tabellen initialisieren ---
function initializeTables() {
  // Clients Tabelle
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

  // Sessions Tabelle
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

  // Documents Tabelle
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

  // Todos Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      priority TEXT DEFAULT 'Normal',
      completed INTEGER DEFAULT 0,
      reminder_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `).run();

  // Chat History Tabelle
  db.prepare(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      session_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();

  // Demo-Daten einfügen, falls leer
  const clientCount = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
  if (clientCount === 0) insertDemoData();
}

// --- Demo-Daten ---
function insertDemoData() {
  console.log("📋 Füge Demo-Daten hinzu...");
  try {
    const insertClient = db.prepare(`
      INSERT INTO clients (name, email, diagnosis, notes, sessions, last_session, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertClient.run('A.M.', 'patient1@demo.com', 'F32.1 Depression', 'Verhaltenstherapie', 8, '2024-08-25', '2024-08-01');
    insertClient.run('B.S.', 'patient2@demo.com', 'F41.1 Angststörung', 'Tiefenpsychologie', 12, '2024-08-28', '2024-07-15');

    console.log("✅ Demo-Daten eingefügt");
  } catch (error) {
    console.error("❌ Fehler beim Einfügen der Demo-Daten:", error);
  }
}

// --- CLIENT FUNKTIONEN ---
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
    console.log("✅ Client hinzugefügt:", clientData.name);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen des Clients:", error);
    throw error;
  }
}

function getClients() {
  try {
    return db.prepare("SELECT * FROM clients ORDER BY name ASC").all();
  } catch {
    return [];
  }
}

function getClientById(id) {
  try {
    return db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
  } catch {
    return null;
  }
}

function updateClient(id, updates) {
  try {
    const fields = Object.keys(updates).filter(k => k !== 'id');
    const setClause = fields.map(k => `${k} = ?`).join(', ');
    const values = fields.map(k => updates[k]);
    values.push(id);

    return db.prepare(`
      UPDATE clients SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(...values);
  } catch (error) {
    throw error;
  }
}

function deleteClient(id) {
  try {
    return db.prepare("DELETE FROM clients WHERE id = ?").run(id);
  } catch (error) {
    throw error;
  }
}

// --- SESSION FUNKTIONEN ---
function addSession(sessionData) {
  try {
    const result = db.prepare(`
      INSERT INTO sessions (client_id, date, duration, type, notes, private_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      sessionData.client_id,
      sessionData.date || new Date().toISOString().split('T')[0],
      sessionData.duration || 50,
      sessionData.type || 'Einzeltherapie',
      sessionData.notes || null,
      sessionData.private_notes || null
    );

    db.prepare(`
      UPDATE clients SET sessions = sessions + 1, last_session = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(sessionData.date || new Date().toISOString().split('T')[0], sessionData.client_id);

    return result;
  } catch (error) {
    throw error;
  }
}

function getSessionsByClient(clientId) {
  try {
    return db.prepare("SELECT * FROM sessions WHERE client_id = ? ORDER BY date DESC").all(clientId);
  } catch {
    return [];
  }
}

function getSessionById(id) {
  try {
    return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  } catch {
    return null;
  }
}

// --- DOCUMENT FUNKTIONEN ---
function addDocument(docData) {
  try {
    return db.prepare(`
      INSERT INTO documents (client_id, session_id, filename, original_name, file_path, file_type, file_size, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      docData.client_id || null,
      docData.session_id || null,
      docData.filename,
      docData.original_name,
      docData.file_path,
      docData.file_type,
      docData.file_size
    );
  } catch (error) {
    throw error;
  }
}

function getDocumentsByClient(clientId) {
  try {
    return db.prepare("SELECT * FROM documents WHERE client_id = ? ORDER BY uploaded_at DESC").all(clientId);
  } catch {
    return [];
  }
}

// --- CHAT HISTORY FUNKTIONEN ---
function addChatMessage(messageData) {
  try {
    return db.prepare(`
      INSERT INTO chat_history (client_id, session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      messageData.client_id || null,
      messageData.session_id || null,
      messageData.role,
      messageData.content
    );
  } catch (error) {
    throw error;
  }
}

function getChatHistory(clientId, limit = 50) {
  try {
    return db.prepare(`
      SELECT * FROM chat_history WHERE client_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(clientId, limit).reverse();
  } catch {
    return [];
  }
}

// --- TODO FUNKTIONEN ---
function addTodo(todoData) {
  try {
    return db.prepare(`
      INSERT INTO todos (client_id, title, description, due_date, priority, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      todoData.client_id || null,
      todoData.title,
      todoData.description || null,
      todoData.due_date || null,
      todoData.priority || 'Normal'
    );
  } catch (error) {
    throw error;
  }
}

function getTodos(clientId = null) {
  try {
    if (clientId) {
      return db.prepare(`
        SELECT t.*, c.name as client_name 
        FROM todos t LEFT JOIN clients c ON t.client_id = c.id 
        WHERE t.client_id = ? ORDER BY t.due_date ASC, t.priority DESC, t.created_at DESC
      `).all(clientId);
    } else {
      return db.prepare(`
        SELECT t.*, c.name as client_name 
        FROM todos t LEFT JOIN clients c ON t.client_id = c.id 
        ORDER BY t.completed ASC, t.due_date ASC, t.priority DESC, t.created_at DESC
      `).all();
    }
  } catch {
    return [];
  }
}

function updateTodo(id, updates) {
  try {
    const fields = Object.keys(updates).filter(k => k !== 'id');
    const setClause = fields.map(k => `${k} = ?`).join(', ');
    const values = fields.map(k => updates[k]);
    values.push(id);

    return db.prepare(`UPDATE todos SET ${setClause} WHERE id = ?`).run(...values);
  } catch (error) {
    throw error;
  }
}

function deleteTodo(id) {
  try {
    return db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  } catch (error) {
    throw error;
  }
}

function completeTodo(id) {
  try {
    return db.prepare("UPDATE todos SET completed = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  } catch (error) {
    throw error;
  }
}

function getTodosStats() {
  try {
    const pending = db.prepare("SELECT COUNT(*) as count FROM todos WHERE completed = 0").get().count;
    const overdue = db.prepare("SELECT COUNT(*) as count FROM todos WHERE completed = 0 AND due_date < date('now')").get().count;
    const today = db.prepare("SELECT COUNT(*) as count FROM todos WHERE due_date = date('now')").get().count;
    return { pending, overdue, today };
  } catch {
    return { pending: 0, overdue: 0, today: 0 };
  }
}

// --- STATISTIK FUNKTIONEN ---
function getStatistics() {
  try {
    const totalClients = db.prepare("SELECT COUNT(*) AS count FROM clients").get().count;
    const totalSessions = db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count;
    const sessionsThisMonth = db.prepare(`
      SELECT COUNT(*) AS count FROM sessions WHERE strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
    `).get().count;
    return { totalClients, totalSessions, sessionsThisMonth };
  } catch {
    return { totalClients: 0, totalSessions: 0, sessionsThisMonth: 0 };
  }
}

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
  console.log("\n🛑 Server wird beendet...");
  if (db) db.close();
  console.log("✅ Datenbank-Verbindung geschlossen");
  process.exit(0);
});

// --- EINZIGER EXPORT ---
module.exports = {
  db,
  // Clients
  addClient, getClients, getClientById, updateClient, deleteClient,
  // Sessions
  addSession, getSessionsByClient, getSessionById,
  // Documents
  addDocument, getDocumentsByClient,
  // Chat
  addChatMessage, getChatHistory,
  // Todos
  addTodo, getTodos, updateTodo, deleteTodo, completeTodo, getTodosStats,
  // Statistics
  getStatistics
};
