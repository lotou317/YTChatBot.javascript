import Database from "better-sqlite3";
import { spawn } from "child_process";

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

    async updateSummary(streamId, newTranscript) {
        const oldSummary = this.getLongTermSummary(streamId);

        const updatedSummary = await this.generateLongTermSummary(
            oldSummary,
            newTranscript
        );

        this.db.prepare(`
            UPDATE streams SET long_summary = ? WHERE stream_id = ?
        `).run(updatedSummary, streamId);
    }

    async generateLongTermSummary(oldSummary, newTranscript) {
        const prompt = `
You maintain a concise summary of a livestream.

Current summary:
"${oldSummary}"

New event:
"${newTranscript}"

Update the summary. Keep it short, around 5–10 sentences.
Do NOT rewrite the whole summary. Only refine it with the new information.
Return ONLY the updated summary.
`;

        return new Promise((resolve, reject) => {
            const ollama = spawn("ollama", ["run", "llama3.1:8b"]);

            let output = "";
            let errorOutput = "";

            ollama.stdout.on("data", (d) => (output += d.toString()));
            ollama.stderr.on("data", (d) => (errorOutput += d.toString()));

            ollama.stdin.write(prompt);
            ollama.stdin.end();

            ollama.on("close", (code) => {
                if (code !== 0) reject(errorOutput);
                else resolve(output.trim());
            });
        });
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
