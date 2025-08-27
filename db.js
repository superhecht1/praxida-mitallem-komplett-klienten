const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const Database = sqlite3.Database;

const dbPath = path.join(__dirname, "data.db");

const db = new Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Fehler beim Öffnen der Datenbank:", err.message);
  } else {
    console.log("✅ SQLite Datenbank verbunden:", dbPath);
  }
});

// Tabelle Clients erstellen, falls sie nicht existiert
db.run(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    initials TEXT,
    diagnosis TEXT,
    therapy TEXT,
    sessions INTEGER DEFAULT 0,
    lastSession TEXT
  )
`);

module.exports = db;
