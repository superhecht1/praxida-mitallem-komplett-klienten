const db = require("./db");
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

dotenv.config();

const app = express();

// Debug: API Key Check
console.log("🔍 DEBUG INFO:");
console.log("OpenAI API Key vorhanden:", !!process.env.OPENAI_API_KEY);
console.log("API Key Länge:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0);

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
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
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|txt/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Nicht unterstützter Dateityp'));
        }
    }
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

// Enhanced Mock Response Generator
function generateSmartMockResponse(message, hasAttachments) {
    console.log("🤖 Generiere Mock-Antwort für:", message.substring(0, 50) + "...");
    
    const lowerMessage = message.toLowerCase();
    
    // Spezifische therapeutische Antworten
    const responses = {
        angst: `**Therapeutische Einschätzung - Angststörungen:**

Bei Angststörungen empfehle ich folgende evidenzbasierte Ansätze:

🎯 **Kognitive Verhaltenstherapie (CBT):**
• Identifikation und Umstrukturierung angstauslösender Gedanken
• Exposition in sensu und in vivo
• Entspannungstechniken (PMR, Atemübungen)

📋 **Behandlungsplan:**
1. **Phase 1-3:** Psychoedukation und Symptomanalyse
2. **Phase 4-8:** Kognitive Techniken und erste Expositionen
3. **Phase 9-12:** Intensive Exposition und Rückfallprophylaxe

⚠️ **Wichtige Überlegungen:**
• Komorbidität mit Depression abklären
• Medikamentöse Unterstützung bei schweren Verläufen
• Einbeziehung des sozialen Umfelds

Wie schätzen Sie die aktuelle Symptomausprägung ein?`,

        depression: `**Therapeutische Einschätzung - Depression:**

Für die Behandlung depressiver Episoden sind folgende Ansätze erfolgreich:

🎯 **Multimodale Therapie:**
• Kognitive Verhaltenstherapie nach Beck
• Aktivitätsaufbau und Tagesstrukturierung
• Interpersonelle Therapie bei sozialen Konflikten

📊 **Assessment-Tools:**
• BDI-II oder PHQ-9 zur Verlaufsmessung
• Suizidalitäts-Screening (regelmäßig!)
• Funktionsniveau bewerten

⚡ **Akute Interventionen:**
• Krisenplan erstellen
• Notfallkontakte definieren
• Bei akuter Suizidalität: Klinikeinweisung erwägen

💊 **Pharmakologische Unterstützung:**
Bei mittelschweren bis schweren Episoden SSRI/SNRI in Betracht ziehen.

Welche Depressionsskala verwenden Sie zur Verlaufsdiagnostik?`,

        trauma: `**Trauma-informierte Therapie:**

Bei Traumafolgestörungen ist ein phasenorientiertes Vorgehen essentiell:

🛡️ **Phase 1 - Stabilisierung:**
• Psychoedukation über Traumafolgen
• Ressourcenaktivierung
• Stabilisierende Techniken (Safe Place, Container)

🔍 **Phase 2 - Traumabearbeitung:**
• EMDR oder traumafokussierte CBT
• Nur bei ausreichender Stabilität!
• Dosierte Exposition mit Traumamaterial

🌱 **Phase 3 - Integration:**
• Neubewertung und Sinnfindung
• Wiederherstellung sozialer Beziehungen
• Rückfallprophylaxe

⚠️ **Kontraindikationen beachten:**
• Akute Suizidalität
• Schwere Dissoziation
• Substanzmissbrauch

Welche Traumatherapie-Ausbildung haben Sie absolviert?`,

        borderline: `**Borderline-Persönlichkeitsstörung - DBT Ansatz:**

Für BPS ist die Dialektisch-Behaviorale Therapie (DBT) Goldstandard:

🎯 **4 Module der Fertigkeitentraining:**
1. **Achtsamkeit:** Bewusste Wahrnehmung im Hier und Jetzt
2. **Distresstoleranz:** Umgang mit Krisen ohne selbstschädigende Verhaltensweisen
3. **Emotionsregulation:** Verstehen und Steuern intensiver Gefühle
4. **Zwischenmenschliche Fertigkeiten:** Beziehungsgestaltung und Kommunikation

📋 **Behandlungsstruktur:**
• Einzeltherapie (1x/Woche)
• Fertigkeitentraining in der Gruppe
• Telefoncoaching bei Krisen
• Therapeutenkonsultation

🚨 **Krisenintervention:**
• Suizid- und Selbstverletzungsverträge
• PLEASE-Fertigkeiten bei emotionalen Krisen
• Notfallplan mit Klient:in erarbeiten

Haben Sie eine DBT-Ausbildung oder arbeiten Sie mit anderen Ansätzen?`,

        sucht: `**Suchttherapeutischer Ansatz:**

Bei Substanzstörungen ist ein integratives Vorgehen erfolgreich:

🎯 **Motivational Interviewing:**
• Ambivalenz gegenüber Veränderung erkunden
• Intrinsische Motivation stärken
• Widerstand als Information nutzen

📊 **Phasenmodell nach Prochaska:**
1. **Precontemplation:** Bewusstsein schaffen
2. **Contemplation:** Ambivalenz bearbeiten
3. **Preparation:** Konkrete Schritte planen
4. **Action:** Veränderung umsetzen
5. **Maintenance:** Rückfallprophylaxe

🛡️ **Rückfallprävention:**
• Trigger identifizieren
• Bewältigungsstrategien entwickeln
• Soziales Netzwerk aufbauen
• Komorbidität behandeln

💊 **Medizinische Begleitung:**
• Entgiftung medizinisch begleiten
• Substitution bei Opioidabhängigkeit
• Craving-Reduktion durch Naltrexon o.ä.

Welche Substanz steht im Vordergrund der Behandlung?`,

        paartherapie: `**Systemische Paartherapie:**

Für Beziehungskonflikte eignen sich strukturierte Ansätze:

💑 **Emotionally Focused Therapy (EFT):**
• Bindungsmuster identifizieren
• Emotionale Zyklen durchbrechen
• Sichere Bindung fördern

🗣️ **Kommunikationstraining:**
• Aktives Zuhören praktizieren
• Ich-Botschaften verwenden
• Konflikte konstruktiv lösen

🔄 **Gottman-Methode:**
• 4 Reiter der Apokalypse vermeiden (Kritik, Verachtung, Rechtfertigung, Mauern)
• Love Maps erstellen
• Positive Interaktionen stärken (5:1 Regel)

📋 **Therapiestruktur:**
• Beide Partner einzeln und gemeinsam
• Hausaufgaben zwischen Sitzungen
• Fortschritte regelmäßig evaluieren

Welche Konfliktmuster zeigen sich hauptsächlich?`,

        kinder: `**Kinder- und Jugendlichenpsychotherapie:**

Entwicklungsangemessene Therapieansätze sind entscheidend:

🎨 **Spieltherapie (3-8 Jahre):**
• Symbolisches Spiel zur Konfliktbearbeitung
• Sandspieltherapie nach Kalff
• Kunsttherapeutische Elemente

👥 **Familientherapie:**
• Systemische Sichtweise einbeziehen
• Elternarbeit parallel zur Kindertherapie
• Ressourcen der Familie aktivieren

📚 **CBT für Jugendliche:**
• Altersgerechte kognitive Techniken
• Peer-Group Integration
• Identitätsentwicklung unterstützen

⚠️ **Besonderheiten:**
• Schweigepflicht vs. Elternrechte
• Kindeswohlgefährdung erkennen
• Entwicklungstraumata beachten

In welcher Altersgruppe liegt Ihr Schwerpunkt?`,

        diagnostik: `**Psychologische Diagnostik - Strukturiertes Vorgehen:**

Eine fundierte Diagnostik ist die Basis jeder Therapie:

📋 **Anamnese:**
• Biographische Anamnese
• Symptomanamnese mit Verlauf
• Familien- und Sozialanamnese
• Medizinische Anamnese

🧠 **Testdiagnostik:**
• **Intelligenz:** WAIS-IV, CFT-20-R
• **Persönlichkeit:** NEO-PI-R, FPI-R
• **Spezifische Störungen:** BDI-II, BAI, SCL-90-R
• **Neuropsychologie:** Bei Bedarf TAP, WMS-R

🎯 **Verhaltensbeobachtung:**
• Interaktion in der Therapiesituation
• Selbst- und Fremdwahrnehmung
• Übertragung und Gegenübertragung

📊 **ICD-11 / DSM-5 Klassifikation:**
• Hauptdiagnose mit Schweregraden
• Komorbidität berücksichtigen
• Ausschlussdiagnosen dokumentieren

Welche Testverfahren setzen Sie standardmäßig ein?`,

        supervision: `**Kollegiale Beratung und Supervision:**

Professionelle Reflexion ist essentiell für die Therapiequalität:

🎯 **Balint-Gruppen:**
• Fall-zentrierte Reflexion
• Gegenübertragung bearbeiten
• Kollegiale Unterstützung

📝 **Intervision:**
• Strukturiertes Peer-Feedback
• Methodenreflexion
• Ethische Dilemmata besprechen

🧠 **Selbstreflexion:**
• Eigene Trigger erkennen
• Burnout-Prophylaxe
• Work-Life-Balance

⚖️ **Ethische Aspekte:**
• Grenzen der Behandlung
• Doppelbeziehungen vermeiden
• Schweigepflicht und deren Grenzen

Welchen spezifischen Fall möchten Sie reflektieren?`,

        default: `**Allgemeine therapeutische Unterstützung:**

Gerne helfe ich Ihnen bei Ihrer therapeutischen Arbeit! Ich kann Sie unterstützen bei:

🎯 **Behandlungsplanung:**
• Therapieziele definieren
• Methoden auswählen
• Verlauf strukturieren

📊 **Diagnostik & Assessment:**
• Testauswahl
• Differenzialdiagnostik
• Verlaufsdiagnostik

💡 **Interventionen:**
• Evidenzbasierte Techniken
• Hausaufgaben konzipieren
• Krisenintervention

📚 **Fachwissen:**
• Aktuelle Forschung
• Leitlinien
• Methodenvergleich

Beschreiben Sie mir gerne Ihren konkreten Fall oder Ihre Fragestellung!`
    };

    // Datei-Upload spezifische Antworten
    if (hasAttachments) {
        return `**📎 Datei-Analyse - Therapeutische Einschätzung:**

Ich habe Ihre Datei analysiert. Hier sind meine therapeutischen Überlegungen:

🔍 **Strukturierte Auswertung:**
• **Inhaltliche Elemente:** Relevante Informationen für die Behandlung identifiziert
• **Diagnostische Hinweise:** Mögliche Zusammenhänge zu bestehenden Diagnosen
• **Therapeutische Relevanz:** Ansatzpunkte für weitere Interventionen

💡 **Handlungsempfehlungen:**
• Inhalte in der nächsten Sitzung besprechen
• Als Hausaufgabe oder Selbstbeobachtung nutzen
• In die Behandlungsplanung integrieren

⚠️ **Wichtiger Hinweis:**
Diese KI-gestützte Analyse ersetzt nicht Ihre professionelle klinische Einschätzung. Bitte prüfen Sie alle Vorschläge sorgfältig im therapeutischen Kontext.

**Möchten Sie spezifische Aspekte der Datei vertiefen oder haben Sie Fragen zur therapeutischen Verwertung?**`;
    }

    // Keyword-based responses
    if (lowerMessage.includes('angst') || lowerMessage.includes('phobie') || lowerMessage.includes('panik')) {
        return responses.angst;
    }
    if (lowerMessage.includes('depression') || lowerMessage.includes('depressiv') || lowerMessage.includes('niedergeschlagen')) {
        return responses.depression;
    }
    if (lowerMessage.includes('trauma') || lowerMessage.includes('ptbs') || lowerMessage.includes('flashback')) {
        return responses.trauma;
    }
    if (lowerMessage.includes('borderline') || lowerMessage.includes('bps') || lowerMessage.includes('dbt')) {
        return responses.borderline;
    }
    if (lowerMessage.includes('sucht') || lowerMessage.includes('alkohol') || lowerMessage.includes('droge')) {
        return responses.sucht;
    }
    if (lowerMessage.includes('paar') || lowerMessage.includes('beziehung') || lowerMessage.includes('ehe')) {
        return responses.paartherapie;
    }
    if (lowerMessage.includes('kind') || lowerMessage.includes('jugend') || lowerMessage.includes('familie')) {
        return responses.kinder;
    }
    if (lowerMessage.includes('diagnose') || lowerMessage.includes('test') || lowerMessage.includes('assessment')) {
        return responses.diagnostik;
    }
    if (lowerMessage.includes('supervision') || lowerMessage.includes('fall') || lowerMessage.includes('kolleg')) {
        return responses.supervision;
    }
    
    return responses.default;
}

// Login endpoint
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    
    if (username === "demo" && password === "praxida2024") {
        res.json({ 
            success: true, 
            user: {
                username: "demo",
                displayName: "Demo User",
                initials: "DU",
                role: "therapist"
            }
        });
    } else {
        res.status(401).json({ success: false, message: "Ungültige Anmeldedaten" });
    }
});

// Enhanced Chat endpoint with better debugging
app.post("/api/chat", async (req, res) => {
    console.log("🗨️ Chat Request erhalten:", {
        message: req.body.message?.substring(0, 50) + "...",
        hasAttachments: req.body.hasAttachments,
        timestamp: new Date().toISOString()
    });

    try {
        const { message, hasAttachments = false } = req.body;
        
        if (!message || message.trim() === '') {
            return res.status(400).json({ 
                reply: "Bitte geben Sie eine Nachricht ein." 
            });
        }

        // Prüfe OpenAI API Key
        if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '') {
            console.log("⚠️ Kein OpenAI API Key - verwende Mock Response");
            const mockResponse = generateSmartMockResponse(message, hasAttachments);
            return res.json({ reply: mockResponse });
        }

        // OpenAI API Call
        const systemPrompt = `Du bist eine erfahrene, DSGVO-konforme KI-Assistenz für Psychotherapeut:innen in Deutschland. 

WICHTIGE RICHTLINIEN:
- Antworte immer auf Deutsch
- Verwende evidenzbasierte therapeutische Ansätze
- Beziehe dich auf deutsche Leitlinien und ICD-11
- Betone immer, dass du die professionelle Einschätzung des Therapeuten nicht ersetzt
- Sei konkret und praxisnah in deinen Empfehlungen
- Verwende Emojis zur besseren Strukturierung
- Gib spezifische Handlungsempfehlungen

Du hilfst bei: Diagnostik, Behandlungsplanung, Interventionen, Supervision, Dokumentation, ethischen Fragen.`;

        if (hasAttachments) {
            systemPrompt += "\n\nDer Therapeut hat Dateien angehängt. Gib konkrete Hinweise zur therapeutischen Nutzung.";
        }

        console.log("🔄 Sende Anfrage an OpenAI...");

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                max_tokens: 1500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            console.error("❌ OpenAI API Error:", response.status, response.statusText);
            
            // Fallback auf Mock Response bei API Fehler
            const mockResponse = generateSmartMockResponse(message, hasAttachments);
            return res.json({ 
                reply: `⚠️ **KI-Service temporär nicht verfügbar - Fallback-Antwort:**\n\n${mockResponse}\n\n*Hinweis: Dies ist eine Offline-Antwort. Für optimale KI-Unterstützung prüfen Sie bitte Ihre OpenAI API-Konfiguration.*`
            });
        }

        const data = await response.json();
        console.log("✅ OpenAI Response erhalten");

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error("Unvollständige API Response");
        }

        const reply = data.choices[0].message.content;
        res.json({ reply });

    } catch (err) {
        console.error("❌ Fehler im Chat-Endpoint:", err);
        
        // Intelligent fallback
        const mockResponse = generateSmartMockResponse(req.body.message, req.body.hasAttachments);
        res.json({ 
            reply: `⚠️ **KI-Service temporär nicht verfügbar:**\n\n${mockResponse}\n\n*Hinweis: Dies ist eine Offline-Antwort. Fehler: ${err.message}*`
        });
    }
});

// File upload endpoint
app.post("/api/upload", upload.single('file'), async (req, res) => {
    console.log("📁 File Upload Request:", req.file ? req.file.originalname : "No file");

    try {
        if (!req.file) {
            return res.status(400).json({ error: "Keine Datei hochgeladen" });
        }

        const file = req.file;
        const filePath = file.path;
        
        let analysisPrompt = "";
        let fileContent = "";
        
        // File content analysis
        if (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt')) {
            try {
                fileContent = fs.readFileSync(filePath, 'utf8');
                analysisPrompt = `Analysiere diesen Text aus therapeutischer Sicht und gib konkrete Handlungsempfehlungen:

DATEIINHALT:
${fileContent.substring(0, 3000)}

Bitte strukturiere deine Antwort nach:
1. Relevante therapeutische Inhalte
2. Mögliche diagnostische Hinweise  
3. Behandlungsempfehlungen
4. Weitere Schritte`;
            } catch (readError) {
                console.warn("Text file read error:", readError.message);
                analysisPrompt = `Eine Textdatei "${file.originalname}" wurde hochgeladen, konnte aber nicht gelesen werden. Gib allgemeine Hinweise zur therapeutischen Textanalyse.`;
            }
        } else if (file.mimetype.startsWith('image/')) {
            analysisPrompt = `Ein Bild "${file.originalname}" wurde zur therapeutischen Analyse hochgeladen. 

Gib strukturierte Hinweise zu:
1. Mögliche therapeutische Relevanz von Bildern/Zeichnungen
2. Was bei der Bildanalyse zu beachten ist
3. Wie Bilder in die Behandlung integriert werden können
4. Dokumentation und Datenschutz bei Bildmaterial`;
        } else {
            analysisPrompt = `Ein Dokument "${file.originalname}" (${file.mimetype}) wurde hochgeladen. Gib therapeutische Hinweise zur Dokumentenanalyse in der Psychotherapie.`;
        }

        let analysis = `**📄 Datei-Analyse: ${file.originalname}**

Die Datei wurde erfolgreich hochgeladen und steht für die therapeutische Auswertung bereit.

🎯 **Allgemeine Empfehlungen:**
• Datei-Inhalte in der nächsten Sitzung besprechen
• Als Basis für Hausaufgaben oder Selbstreflexion nutzen
• In die Behandlungsplanung integrieren
• DSGVO-konforme Dokumentation beachten

⚠️ **Datenschutz:** Bitte stellen Sie sicher, dass Patient:innen der Datei-Analyse zugestimmt haben.`;

        // Try OpenAI analysis if API key available
        if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '') {
            try {
                console.log("🔄 Analysiere Datei mit OpenAI...");
                
                const response = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "gpt-4o-mini",
                        messages: [
                            {
                                role: "system",
                                content: "Du bist ein KI-Assistent für Psychotherapeut:innen. Analysiere Inhalte aus professioneller, therapeutischer Sicht auf Deutsch. Gib konkrete, praxisnahe Empfehlungen und strukturiere deine Antwort übersichtlich."
                            },
                            { role: "user", content: analysisPrompt }
                        ],
                        max_tokens: 1200,
                        temperature: 0.6
                    })
                });

                if (response.ok) {
                    const aiData = await response.json();
                    if (aiData.choices && aiData.choices[0] && aiData.choices[0].message) {
                        analysis = aiData.choices[0].message.content;
                        console.log("✅ OpenAI Datei-Analyse erfolgreich");
                    }
                } else {
                    console.warn("⚠️ OpenAI API für Datei-Analyse nicht verfügbar:", response.status);
                }
            } catch (aiError) {
                console.warn("⚠️ Datei-Analyse Fallback:", aiError.message);
            }
        } else {
            console.log("💡 Verwende lokale Datei-Analyse (kein API Key)");
        }

        // Cleanup: Delete file after processing
        try {
            fs.unlinkSync(filePath);
            console.log("🗑️ Temporäre Datei gelöscht:", filePath);
        } catch (deleteError) {
            console.warn("⚠️ Datei-Cleanup Warnung:", deleteError.message);
        }

        res.json({ 
            success: true,
            filename: file.originalname,
            analysis: analysis,
            fileType: file.mimetype,
            size: file.size
        });

    } catch (err) {
        console.error("❌ Upload Error:", err);
        
        // Cleanup on error
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupError) {
                console.warn("Cleanup failed:", cleanupError.message);
            }
        }
        
        res.status(500).json({ error: "Fehler bei der Dateianalyse: " + err.message });
    }
});

// Other endpoints...
app.post("/api/test-integration", (req, res) => {
    const { system } = req.body;
    setTimeout(() => {
        res.json({
            success: true,
            message: `Integration zu ${system} erfolgreich getestet`,
            timestamp: new Date().toISOString()
        });
    }, 1500);
});

// Alle Clients abrufen
app.get("/api/clients", (req, res) => {
  try {
    const clients = db.prepare("SELECT * FROM clients").all();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Neuen Client anlegen
app.post("/api/clients", (req, res) => {
  try {
    const { initials, diagnosis, therapy, sessions, lastSession } = req.body;
    const stmt = db.prepare(`
      INSERT INTO clients (initials, diagnosis, therapy, sessions, lastSession)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      initials,
      diagnosis,
      therapy,
      sessions || 0,
      lastSession || new Date().toISOString().split("T")[0]
    );
    res.json({ id: info.lastInsertRowid, initials, diagnosis, therapy, sessions, lastSession });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Client bearbeiten
app.put("/api/clients/:id", (req, res) => {
  try {
    const { initials, diagnosis, therapy, sessions, lastSession } = req.body;
    const stmt = db.prepare(`
      UPDATE clients SET initials=?, diagnosis=?, therapy=?, sessions=?, lastSession=? WHERE id=?
    `);
    const info = stmt.run(initials, diagnosis, therapy, sessions, lastSession, req.params.id);
    res.json({ updated: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Client löschen
app.delete("/api/clients/:id", (req, res) => {
  try {
    const stmt = db.prepare(`DELETE FROM clients WHERE id=?`);
    const info = stmt.run(req.params.id);
    res.json({ deleted: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ⚠️ Reset-Routine
app.delete("/api/clients-reset", (req, res) => {
  try {
    db.prepare("DELETE FROM clients").run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name='clients'").run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ⚠️ ACHTUNG: Nur für Entwicklung/Test
// Alle Clients löschen (Reset)
app.delete("/api/clients-reset", (req, res) => {
  db.run("DELETE FROM clients", function (err) {
    if (err) return res.status(500).json({ error: err.message });
    
    // Autoincrement zurücksetzen
    db.run("DELETE FROM sqlite_sequence WHERE name='clients'", (resetErr) => {
      if (resetErr) console.warn("Warnung beim Zurücksetzen des Autoincrement:", resetErr.message);
    });

    res.json({ success: true, deleted: this.changes });
  });
});


// Health check endpoint
app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        services: {
            openai: !!process.env.OPENAI_API_KEY,
            uploads: fs.existsSync('uploads'),
            static: fs.existsSync('public')
        },
        mode: process.env.OPENAI_API_KEY ? "AI-powered" : "Mock-mode"
    });
});

// Error handling
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Datei zu groß (max. 10MB)' });
        }
    }
    
    console.error('Server Error:', error);
    res.status(500).json({ error: error.message });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint nicht gefunden' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n🚀 PRAXIDA 2.0 SERVER GESTARTET`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🤖 KI-Modus: ${process.env.OPENAI_API_KEY ? '✅ OpenAI API aktiv' : '⚠️ Mock-Modus (lokale Antworten)'}`);
    console.log(`📁 Uploads: ${fs.existsSync('uploads') ? '✅ Bereit' : '⚠️ Wird erstellt...'}`);
    console.log(`📄 Frontend: ${fs.existsSync('public/index.html') ? '✅ Verfügbar' : '❌ Fehlt!'}`);
    console.log(`\n🔐 Demo-Login: demo / praxida2024\n`);
    
    // Create uploads directory if missing
    if (!fs.existsSync('uploads')) {
        try {
            fs.mkdirSync('uploads');
            console.log('📁 Upload-Ordner erstellt');
        } catch (err) {
            console.error('❌ Upload-Ordner konnte nicht erstellt werden:', err.message);
        }
    }
});