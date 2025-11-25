import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DATABASE_PATH = "stream_memory.db";

function init() {
  const db = new Database(DATABASE_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT,
      timestamp REAL,
      content TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS streams (
      stream_id TEXT PRIMARY KEY,
      title TEXT,
      start_time REAL,
      end_time REAL,
      long_summary TEXT
    );
  `);

  console.log("✅ Database initialized at", DATABASE_PATH);
  db.close();
}

init();
