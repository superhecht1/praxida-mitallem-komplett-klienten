
// db.js
const Database = require("better-sqlite3");
const path = require("path");

// SQLite Datei im Projektordner
const dbPath = path.join(__dirname, "database.sqlite");
const db = new Database(dbPath);

// Beispiel: Tabelle anlegen, falls nicht existiert
db.prepare(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    diagnosis TEXT,
    sessions INTEGER DEFAULT 0,
    last_session DATE
  )
`).run();

// Beispiel-Funktionen
function addClient(name, diagnosis, sessions = 0, lastSession = null) {
  const stmt = db.prepare(`
    INSERT INTO clients (name, diagnosis, sessions, last_session)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(name, diagnosis, sessions, lastSession);
}

function getClients() {
  const stmt = db.prepare("SELECT * FROM clients ORDER BY id DESC");
  return stmt.all();
}

function getClientById(id) {
  const stmt = db.prepare("SELECT * FROM clients WHERE id = ?");
  return stmt.get(id);
}

function deleteClient(id) {
  const stmt = db.prepare("DELETE FROM clients WHERE id = ?");
  return stmt.run(id);
}

function updateClientSessions(id, sessions, lastSession = null) {
  const stmt = db.prepare(`
    UPDATE clients
    SET sessions = ?, last_session = ?
    WHERE id = ?
  `);
  return stmt.run(sessions, lastSession, id);
}

module.exports = {
  db,
  addClient,
  getClients,
  getClientById,
  deleteClient,
  updateClientSessions
};
