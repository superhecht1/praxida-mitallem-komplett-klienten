const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "data.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Fehler beim Öffnen der Datenbank:", err.message);
  } else {
    console.log("✅ SQLite Datenbank verbunden:", dbPath);
  }
});

// Tabelle Clients erstellen, falls sie nicht existiert
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
  `, (err) => {
    if (err) {
      console.error("❌ Fehler beim Erstellen der Tabelle:", err.message);
    } else {
      console.log("✅ Tabelle 'clients' bereit");
    }
  });

  // Beispiel-Daten einfügen, falls Tabelle leer ist
  db.get("SELECT COUNT(*) as count FROM clients", (err, row) => {
    if (!err && row.count === 0) {
      console.log("📝 Füge Beispiel-Clients hinzu...");
      
      const insertStmt = db.prepare(`
        INSERT INTO clients (initials, diagnosis, therapy, sessions, lastSession) 
        VALUES (?, ?, ?, ?, ?)
      `);
      
      insertStmt.run("A.M.", "Angststörung", "VT", 12, "18.08.2025");
      insertStmt.run("B.S.", "Depression", "TP", 8, "20.08.2025");
      insertStmt.finalize();
      
      console.log("✅ Beispiel-Clients hinzugefügt");
    }
  });
});

module.exports = db;
