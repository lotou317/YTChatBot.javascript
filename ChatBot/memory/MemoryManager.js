import Database from "better-sqlite3";

export default class MemoryManager {
    constructor(dbPath = "stream_memory.db") {
        this.db = new Database(dbPath);
        this.streamId = null;
        this.SHORT_TERM_LIMIT = 10;

        this.initTables();
    }

    initTables() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stream_id TEXT,
                timestamp REAL,
                content TEXT
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS streams (
                stream_id TEXT PRIMARY KEY,
                title TEXT,
                start_time REAL,
                end_time REAL,
                long_summary TEXT
            );
        `);
    }

    startStream(streamVideoId, title = "") {
        this.streamId = streamVideoId;

        const exists = this.db.prepare(`
            SELECT stream_id FROM streams WHERE stream_id = ?
        `).get(streamVideoId);

        if (!exists) {
            this.db.prepare(`
                INSERT INTO streams (stream_id, title, start_time)
                VALUES (?, ?, ?)
            `).run(streamVideoId, title, Date.now());
        }

        return this.streamId;
    }

    endStream() {
        if (!this.streamId) return;

        this.db.prepare(`
            UPDATE streams SET end_time = ? WHERE stream_id = ?
        `).run(Date.now(), this.streamId);
    }

    saveTranscript(streamId, text) {
        this.db.prepare(`
            INSERT INTO logs (stream_id, timestamp, content)
            VALUES (?, ?, ?)
        `).run(streamId, Date.now(), text);
    }

    getShortTermMemory(streamId, limit = this.SHORT_TERM_LIMIT) {
        const rows = this.db.prepare(`
            SELECT content FROM logs
            WHERE stream_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(streamId, limit);

        return rows.reverse();
    }

    getLongTermSummary(streamId) {
        const row = this.db.prepare(`
            SELECT long_summary FROM streams
            WHERE stream_id = ?
        `).get(streamId);

        return row?.long_summary || "";
    }

    updateSummary(streamId, newTranscript) {
        let summary = this.getLongTermSummary(streamId);
        summary += `\n- ${newTranscript}`;

        this.db.prepare(`
            UPDATE streams SET long_summary = ? WHERE stream_id = ?
        `).run(summary, streamId);
    }

    getFullStreamLog(streamId) {
        const rows = this.db.prepare(`
            SELECT content FROM logs
            WHERE stream_id = ?
            ORDER BY timestamp ASC
        `).all(streamId);

        return rows.map(r => r.content).join("\n");
    }
}
