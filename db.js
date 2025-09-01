// db.js - Korrigierte Version
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
const dbPath = path.join(dataDir, "praxida.db");
console.log("📍 Datenbank-Pfad:", dbPath);

let db;
try {
  db = new Database(dbPath);
  console.log("✅ Datenbank erfolgreich verbunden");
  
  // WAL Mode für bessere Performance
  db.pragma('journal_mode = WAL');
  
  // Initialisiere Tabellen
  initializeTables();
  console.log("✅ Tabellen initialisiert");
  
} catch (error) {
  console.error("❌ Datenbank-Fehler:", error);
  process.exit(1);
}

function initializeTables() {
  // To-Dos Tabelle
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
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `).run();

  // Demo-Daten einfügen wenn Datenbank leer ist
  const clientCount = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
  if (clientCount === 0) {
    insertDemoData();
  }
}

function insertDemoData() {
  console.log("📋 Füge Demo-Daten hinzu...");
  
  try {
    const insertClient = db.prepare(`
      INSERT INTO clients (name, email, diagnosis, notes, sessions, last_session, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const client1 = insertClient.run(
      'A.M.',
      'patient1@demo.com',
      'F32.1 Depression',
      'Verhaltenstherapie',
      8,
      '2024-08-25',
      '2024-08-01'
    );

    const client2 = insertClient.run(
      'B.S.',
      'patient2@demo.com',
      'F41.1 Angststörung',
      'Tiefenpsychologie',
      12,
      '2024-08-28',
      '2024-07-15'
    );

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
    const stmt = db.prepare("SELECT * FROM clients ORDER BY name ASC");
    const clients = stmt.all();
    console.log("📋 Clients abgerufen:", clients.length);
    return clients;
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Clients:", error);
    return [];
  }
}

function getClientById(id) {
  try {
    const stmt = db.prepare("SELECT * FROM clients WHERE id = ?");
    return stmt.get(id);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen des Clients:", error);
    return null;
  }
}

function updateClient(id, updates) {
  try {
    const fields = Object.keys(updates).filter(key => key !== 'id');
    const setClause = fields.map(key => `${key} = ?`).join(', ');
    const values = fields.map(key => updates[key]);
    values.push(id);
    
    const stmt = db.prepare(`
      UPDATE clients 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    return stmt.run(...values);
  } catch (error) {
    console.error("❌ Fehler beim Aktualisieren des Clients:", error);
    throw error;
  }
}

function deleteClient(id) {
  try {
    const stmt = db.prepare("DELETE FROM clients WHERE id = ?");
    const result = stmt.run(id);
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
    
    // Update client's session count
    db.prepare(`
      UPDATE clients 
      SET sessions = sessions + 1, 
          last_session = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionData.date || new Date().toISOString().split('T')[0], sessionData.client_id);
    
    console.log("✅ Session hinzugefügt für Client:", sessionData.client_id);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen der Session:", error);
    throw error;
  }
}

function getSessionsByClient(clientId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM sessions 
      WHERE client_id = ? 
      ORDER BY date DESC
    `);
    return stmt.all(clientId);
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Sessions:", error);
    return [];
  }
}

function getSessionById(id) {
  try {
    const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
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
      WHERE client_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    return stmt.all(clientId, limit).reverse();
  } catch (error) {
    console.error("❌ Fehler beim Abrufen des Chat-Verlaufs:", error);
    return [];
  }
}

// --- STATISTIK FUNKTIONEN --- //
function getStatistics() {
  try {
    const stats = {};
    
    stats.totalClients = db.prepare("SELECT COUNT(*) as count FROM clients").get().count;
    stats.totalSessions = db.prepare("SELECT SUM(sessions) as count FROM clients").get().count || 0;
    stats.pendingTodos = 0; // TODO: Implement todos table
    stats.activePlans = Math.min(3, stats.totalClients);
    
    stats.sessionsThisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM sessions 
      WHERE date >= date('now', 'start of month')
    `).get().count;
    
    console.log("📊 Statistiken abgerufen:", stats);
    return stats;
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Statistiken:", error);
    return {
      totalClients: 0,
      totalSessions: 0,
      pendingTodos: 0,
      activePlans: 0
    };
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log("\n🛑 Server wird beendet...");
  if (db) {
    db.close();
    console.log("✅ Datenbank-Verbindung geschlossen");
  }
  process.exit(0);
});
// --- TODO FUNKTIONEN --- //
function addTodo(todoData) {
  try {
    const stmt = db.prepare(`
      INSERT INTO todos (client_id, title, description, due_date, priority, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    const result = stmt.run(
      todoData.client_id || null,
      todoData.title,
      todoData.description || null,
      todoData.due_date || null,
      todoData.priority || 'Normal'
    );
    
    console.log("✅ Todo hinzugefügt:", todoData.title);
    return result;
  } catch (error) {
    console.error("❌ Fehler beim Hinzufügen des Todos:", error);
    throw error;
  }
}

function getTodos(clientId = null) {
  try {
    let stmt;
    if (clientId) {
      stmt = db.prepare(`
        SELECT t.*, c.name as client_name 
        FROM todos t 
        LEFT JOIN clients c ON t.client_id = c.id 
        WHERE t.client_id = ?
        ORDER BY t.due_date ASC, t.priority DESC, t.created_at DESC
      `);
      return stmt.all(clientId);
    } else {
      stmt = db.prepare(`
        SELECT t.*, c.name as client_name 
        FROM todos t 
        LEFT JOIN clients c ON t.client_id = c.id 
        ORDER BY t.completed ASC, t.due_date ASC, t.priority DESC, t.created_at DESC
      `);
      return stmt.all();
    }
  } catch (error) {
    console.error("❌ Fehler beim Abrufen der Todos:", error);
    return [];
  }
}

function updateTodo(id, updates) {
  try {
    const fields = Object.keys(updates).filter(key => key !== 'id');
    const setClause = fields.map(key => `${key} = ?`).join(', ');
    const values = fields.map(key => updates[key]);
    values.push(id);
    
    const stmt = db.prepare(`
      UPDATE todos 
      SET ${setClause}
      WHERE id = ?
    `);
    
    return stmt.run(...values);
  } catch (error) {
    console.error("❌ Fehler beim Aktualisieren des Todos:", error);
    throw error;
  }
}

function deleteTodo(id) {
  try {
    const stmt = db.prepare("DELETE FROM todos WHERE id = ?");
    return stmt.run(id);
  } catch (error) {
    console.error("❌ Fehler beim Löschen des Todos:", error);
    throw error;
  }
}

function completeTodo(id) {
  try {
    const stmt = db.prepare(`
      UPDATE todos 
      SET completed = 1, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(id);
  } catch (error) {
    console.error("❌ Fehler beim Abschließen des Todos:", error);
    throw error;
  }
}

function getTodosStats() {
  try {
    const pending = db.prepare("SELECT COUNT(*) as count FROM todos WHERE completed = 0").get().count;
    const overdue = db.prepare(`
      SELECT COUNT(*) as count FROM todos 
      WHERE completed = 0 AND due_date < date('now')
    `).get().count;
    const today = db.prepare(`
      SELECT COUNT(*) as count FROM todos 
      WHERE completed = 0 AND due_date = date('now')
    `).get().count;
    
    return { pending, overdue, today };
  } catch (error) {
    console.error("❌ Fehler bei Todo-Statistiken:", error);
    return { pending: 0, overdue: 0, today: 0 };
  }
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
  // Statistics
  getStatistics
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
  // Statistics
  getStatistics,
  // Todo functions
  addTodo,
  getTodos,
  updateTodo,
  deleteTodo,
  completeTodo,
  getTodosStats
};
// --- Ergänzungen --- //

// Statistik
function getStatistics() {
  const totalClients = db.prepare("SELECT COUNT(*) AS count FROM clients").get().count;
  const totalSessions = db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count;
  const sessionsThisMonth = db.prepare(`
    SELECT COUNT(*) AS count FROM sessions 
    WHERE strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
  `).get().count;

  return { totalClients, totalSessions, sessionsThisMonth };
}

// Todos
function getTodosStats() {
  const pending = db.prepare("SELECT COUNT(*) AS count FROM todos WHERE completed = 0").get().count;
  const overdue = db.prepare("SELECT COUNT(*) AS count FROM todos WHERE due_date < date('now') AND completed = 0").get().count;
  const today = db.prepare("SELECT COUNT(*) AS count FROM todos WHERE due_date = date('now')").get().count;
  return { pending, overdue, today };
}

// --- Export sicherstellen --- //
module.exports = {
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
  getStatistics,
  addTodo,
  getTodos,
  updateTodo,
  deleteTodo,
  completeTodo,
  getTodosStats
};

