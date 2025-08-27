const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Datenbank-Datei (wird automatisch angelegt, falls nicht vorhanden)
const dbPath = path.join(__dirname, "clients.db");
const db = new sqlite3.Database(dbPath);

// Tabelle anlegen, falls nicht vorhanden
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      initials TEXT NOT NULL,
      diagnosis TEXT,
      therapy TEXT,
      sessions INTEGER DEFAULT 0,
      lastSession TEXT
    )
  `);
});

module.exports = db;
