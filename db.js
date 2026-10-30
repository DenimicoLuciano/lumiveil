// Database: SQLite via libsql — Turso cloud when TURSO_DATABASE_URL is set
// (accounts and stories persist across deploys), local file otherwise.
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'lumiveil.db');

const Database = require('libsql');
const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
let db;
if (TURSO_URL) {
  db = new Database(TURSO_URL, { authToken: process.env.TURSO_AUTH_TOKEN || '' });
  console.log('🗄️ Lumiveil DB: Turso cloud (persistent)');
} else {
  db = new Database(DB_PATH);
  try { db.pragma('journal_mode = WAL'); } catch (e) {}
  console.log('🗄️ Lumiveil DB: local file (ephemeral)');
}
try { db.pragma('foreign_keys = ON'); } catch (e) { /* best-effort on remote */ }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  -- Player identity: chosen in-app, used by every character in every reply.
  player_name TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',              -- female | male | nonbinary | other
  about TEXT NOT NULL DEFAULT '',
  -- 18+ age gate: ONLY this confirmed-adult flag is stored. No date of birth, ever.
  adult_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS custom_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age TEXT NOT NULL DEFAULT '25',
  pronouns TEXT NOT NULL DEFAULT 'they/them',
  tagline TEXT NOT NULL,
  genre TEXT NOT NULL,
  description TEXT NOT NULL,
  interests TEXT NOT NULL DEFAULT '[]',          -- JSON array
  persona TEXT NOT NULL,
  scenario TEXT NOT NULL,
  greeting TEXT NOT NULL,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, character_key)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                            -- user | character
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memory_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  fact TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_facts_conv ON memory_facts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_user ON custom_characters(user_id);
`;
db.exec(SCHEMA);

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
module.exports.DB_PATH = DB_PATH;
