// Lumiveil — Express backend + API. Serves the SPA and all JSON APIs.
// Adults-only (18+) AI character roleplay with unlimited memory and no ads.
//
// Memory model: every message ever exchanged is stored. After each exchange,
// an extraction pass adds durable facts about the player and the shared story
// to a permanent per-conversation memory ledger. Every reply carries the FULL
// ledger plus up to the last 300 messages of history — so characters remember
// everything, across sessions, indefinitely.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const db = require('./db');
const { CHARACTERS, findCharacter } = require('./characters');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------- AI ----------
const AI_CONFIGURED = () => !!process.env.OPENAI_API_KEY;
const AI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AI_BASE_URL = () => process.env.AI_BASE_URL || 'https://api.openai.com/v1';

async function callAI(messages, { maxTokens = 900, temperature = 0.9 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = ['Bearer', apiKey].join(' ');
  const res = await fetch(AI_BASE_URL() + '/chat/completions', {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({ model: AI_MODEL(), messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI provider error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ---------- users & auth (mirrors Luminous) ----------
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, email: u.email, display_name: u.display_name,
    player_name: u.player_name, gender: u.gender, about: u.about,
    adult_verified: !!u.adult_verified, created_at: u.created_at,
  };
}
function accountComplete(u) {
  return !!(u && u.player_name && u.player_name.trim().length > 0 && GENDERS[u.gender]);
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!s) return res.status(401).json({ error: 'INVALID_TOKEN' });
  const user = getUserById.get(s.user_id);
  if (!user) return res.status(401).json({ error: 'INVALID_TOKEN' });
  req.user = user;
  next();
}
// The 18+ gate, enforced server-side: nothing character-related unlocks
// until the account carries the confirmed-adult flag.
function adultRequired(req, res, next) {
  if (req.user.adult_verified !== 1)
    return res.status(403).json({ error: 'AGE_VERIFICATION_REQUIRED', message: 'Lumiveil is 18+ only. Confirm you are an adult first.' });
  next();
}
function accountRequired(req, res, next) {
  if (!accountComplete(req.user))
    return res.status(403).json({ error: 'ACCOUNT_REQUIRED', message: 'Create your player profile first.' });
  next();
}

app.get('/api/config', (req, res) => {
  res.json({ aiConfigured: AI_CONFIGURED(), appName: 'Lumiveil' });
});

app.post('/api/auth/register', (req, res) => {
  const { email, password, username, display_name } = req.body || {};
  if (!email || !password || !username)
    return res.status(400).json({ error: 'Missing required fields' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const cleanEmail = String(email).trim().toLowerCase();
  if (getUserByEmail.get(cleanEmail) || db.prepare('SELECT 1 FROM users WHERE username = ?').get(String(username).toLowerCase()))
    return res.status(409).json({ error: 'Email or username already taken' });
  const clean = String(username).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'user';
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(clean))
    return res.status(409).json({ error: 'Username already taken' });
  const hash = bcrypt.hashSync(String(password), 10);
  const r = db.prepare(`INSERT INTO users (email, password_hash, username, display_name)
    VALUES (?,?,?,?)`).run(cleanEmail, hash, clean, String(display_name || username).slice(0, 60));
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, r.lastInsertRowid);
  res.json({ token, user: publicUser(getUserById.get(r.lastInsertRowid)) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = email && getUserByEmail.get(String(email).trim().toLowerCase());
  if (!u || !u.password_hash || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.id);
  res.json({ token, user: publicUser(getUserById.get(u.id)) });
});

app.post('/api/auth/logout', authRequired, (req, res) => {
  const h = req.headers.authorization;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(h.slice(7));
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ user: publicUser(getUserById.get(req.user.id)), aiConfigured: AI_CONFIGURED() });
});

// ---------- player profile & the 18+ gate ----------
// Player identity: chosen in-app, used by every character in every reply —
// name for address, gender + pronouns for reference.
const GENDERS = {
  female: { label: 'Woman', noun: 'a woman', pronouns: 'she/her', possessive: 'her' },
  male: { label: 'Man', noun: 'a man', pronouns: 'he/him', possessive: 'his' },
  nonbinary: { label: 'Non-binary', noun: 'a non-binary person', pronouns: 'they/them', possessive: 'their' },
  other: { label: 'Other', noun: 'an adult', pronouns: 'they/them', possessive: 'their' },
};

app.get('/api/profile', authRequired, (req, res) => {
  const u = req.user;
  res.json({
    profile: { player_name: u.player_name, gender: u.gender, about: u.about },
    adult_verified: !!u.adult_verified,
    accountComplete: accountComplete(u),
    genders: Object.entries(GENDERS).map(([key, g]) => ({ key, label: g.label, pronouns: g.pronouns })),
  });
});

// The gate itself: the player confirms they are an adult. ONLY the flag is
// stored — no date of birth is ever asked for or kept.
app.post('/api/profile/verify-age', authRequired, (req, res) => {
  if (!(req.body && req.body.confirmAdult === true))
    return res.status(400).json({ error: 'Please confirm you are 18 or older.' });
  db.prepare('UPDATE users SET adult_verified = 1 WHERE id = ?').run(req.user.id);
  res.json({ ok: true, adult_verified: true });
});

app.post('/api/profile', authRequired, adultRequired, (req, res) => {
  const { player_name, gender, about } = req.body || {};
  const name = String(player_name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Your player name is required' });
  if (!GENDERS[gender]) return res.status(400).json({ error: 'Pick the identity that fits you' });
  db.prepare('UPDATE users SET player_name = ?, gender = ?, about = ? WHERE id = ?')
    .run(name, gender, String(about || '').trim().slice(0, 500), req.user.id);
  res.json({ ok: true, user: publicUser(getUserById.get(req.user.id)) });
});

function playerIdentityBlock(u) {
  const g = GENDERS[u.gender];
  const name = (u.player_name || '').trim();
  if (!g || !name) return '';
  return `\nTHE PLAYER — WHO YOU ARE TALKING TO:
- Their name is ${name}. Address them by name naturally and often, the way a real scene partner would.
- ${name} is ${g.noun} and uses ${g.pronouns} pronouns. ALWAYS refer to ${name} with ${g.pronouns} pronouns and gender them correctly — never misgender them, never use a different name.
- Let who ${name} is shape the scene the way it would with a real person: how you look at them, what draws you to them, the dynamic between you, what you call them and how you touch the story around them — respond to ${name} as ${g.noun}, in character, always.`;
}

// ---------- characters ----------
function customToDef(row) {
  let interests = [];
  try { interests = JSON.parse(row.interests || '[]'); } catch { interests = []; }
  return {
    key: `custom-${row.id}`, owner_id: row.user_id,
    name: row.name, age: row.age, pronouns: row.pronouns, genre: row.genre,
    tagline: row.tagline, description: row.description, interests,
    persona: row.persona, scenario: row.scenario, greeting: row.greeting,
    emoji: row.emoji, color: row.color,
  };
}
function resolveCharacter(userId, key) {
  const builtin = findCharacter(key);
  if (builtin) return builtin;
  if (typeof key === 'string' && key.startsWith('custom-')) {
    const id = Number(key.slice('custom-'.length));
    if (!Number.isFinite(id)) return null;
    const row = db.prepare('SELECT * FROM custom_characters WHERE id = ? AND user_id = ?').get(id, userId);
    return row ? customToDef(row) : null;
  }
  return null;
}
function allCharacters(userId) {
  const customs = db.prepare('SELECT * FROM custom_characters WHERE user_id = ? ORDER BY id DESC').all(userId);
  return [...CHARACTERS, ...customs.map(customToDef)];
}
function characterOut(userId, def) {
  const convo = db.prepare('SELECT * FROM conversations WHERE user_id = ? AND character_key = ?')
    .get(userId, def.key);
  const base = {
    key: def.key, name: def.name, age: def.age, pronouns: def.pronouns,
    genre: def.genre, tagline: def.tagline, description: def.description,
    interests: def.interests, scenario: def.scenario, emoji: def.emoji,
    color: def.color, isCustom: def.key.startsWith('custom-'),
  };
  if (!convo) return { ...base, hasConversation: false, messageCount: 0, memoryCount: 0, lastMessageAt: null, lastMessagePreview: '' };
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM messages WHERE conversation_id = ?) AS mc,
    (SELECT COUNT(*) FROM memory_facts WHERE conversation_id = ?) AS fc`).get(convo.id, convo.id);
  const last = db.prepare('SELECT text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(convo.id);
  return {
    ...base, hasConversation: true,
    messageCount: counts.mc, memoryCount: counts.fc,
    lastMessageAt: convo.last_message_at,
    lastMessagePreview: last ? last.text.slice(0, 140) : '',
  };
}

app.get('/api/characters', authRequired, adultRequired, accountRequired, (req, res) => {
  const defs = allCharacters(req.user.id);
  res.json({
    characters: defs.map(d => characterOut(req.user.id, d)),
    genres: Array.from(new Set(defs.map(d => d.genre))),
    aiConfigured: AI_CONFIGURED(),
  });
});

app.post('/api/characters', authRequired, adultRequired, accountRequired, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 40);
  const age = parseInt(b.age, 10);
  const tagline = String(b.tagline || '').trim().slice(0, 120);
  const genre = String(b.genre || '').trim().slice(0, 30);
  const description = String(b.description || '').trim().slice(0, 800);
  const persona = String(b.persona || '').trim().slice(0, 1500);
  const scenario = String(b.scenario || '').trim().slice(0, 800);
  const greeting = String(b.greeting || '').trim().slice(0, 1500);
  const emoji = String(b.emoji || '✨').trim().slice(0, 8) || '✨';
  const color = /^#[0-9a-fA-F]{3,8}$/.test(String(b.color || '')) ? String(b.color) : '#7a4a8e';
  const pronouns = String(b.pronouns || 'they/them').trim().slice(0, 20);
  const interests = Array.isArray(b.interests)
    ? b.interests.map(i => String(i).trim().slice(0, 30)).filter(Boolean).slice(0, 5) : [];
  if (!name || !tagline || !genre || !description || !persona || !scenario || !greeting)
    return res.status(400).json({ error: 'Every field tells part of the story — fill them all in' });
  if (!Number.isFinite(age) || age < 18 || age > 999)
    return res.status(400).json({ error: 'Characters must be adults (18+)' });
  const r = db.prepare(`INSERT INTO custom_characters
    (user_id, name, age, pronouns, tagline, genre, description, interests, persona, scenario, greeting, emoji, color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, name, String(age), pronouns, tagline, genre, description,
      JSON.stringify(interests), persona, scenario, greeting, emoji, color);
  res.json({ ok: true, key: `custom-${r.lastInsertRowid}` });
});

app.delete('/api/characters/:key', authRequired, adultRequired, (req, res) => {
  const key = req.params.key;
  if (!key.startsWith('custom-')) return res.status(400).json({ error: 'Only your own characters can be deleted' });
  const id = Number(key.slice('custom-'.length));
  const row = db.prepare('SELECT * FROM custom_characters WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  const convo = db.prepare('SELECT id FROM conversations WHERE user_id = ? AND character_key = ?').get(req.user.id, key);
  if (convo) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM memory_facts WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convo.id);
  }
  db.prepare('DELETE FROM custom_characters WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- conversations & chat ----------
function getOrCreateConversation(userId, def) {
  const existing = db.prepare('SELECT * FROM conversations WHERE user_id = ? AND character_key = ?')
    .get(userId, def.key);
  if (existing) return existing;
  const r = db.prepare('INSERT INTO conversations (user_id, character_key) VALUES (?,?)')
    .run(userId, def.key);
  db.prepare('INSERT INTO messages (conversation_id, role, text) VALUES (?,?,?)')
    .run(r.lastInsertRowid, 'character', def.greeting);
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(r.lastInsertRowid);
}
function loadFacts(conversationId) {
  return db.prepare('SELECT fact FROM memory_facts WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversationId).map(r => r.fact);
}
function loadMessages(conversationId) {
  return db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversationId);
}

const RULES = `HOW YOU PLAY:
- Stay in character at all times. Never say you are an AI or a language model.
- Write like a living scene partner: dialogue in "quotes", physical actions and narration wrapped in *asterisks*. Write 2-5 short paragraphs; if the user writes short, match their energy.
- Everyone in this story is an adult (18+). This is consensual adult roleplay between adults. Follow the user's lead on tone, romance, desire and intensity — and respect any limit, boundary, or stop the user states, instantly, in character, without argument.
- THE USER STEERS THE STORY. The scenario was only the starting point. Follow the user's direction wherever they take the story; never drag the plot back to the scenario.
- Use the things you remember about the user naturally — their name, their desires, your shared history. Don't list your memories; live them.`;

function buildSystemPrompt(def, user, facts) {
  const name = (user.player_name || '').trim() || 'the user';
  const memoryBlock = facts.length > 0
    ? `WHAT YOU REMEMBER ABOUT ${name.toUpperCase()} AND YOUR SHARED STORY (permanent — you never forget these):\n${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    : `You have just met ${name}; you will remember everything from this conversation onward, forever.`;
  const aboutBlock = (user.about || '').trim()
    ? `\nWHAT ${name.toUpperCase()} WANTS YOU TO KNOW ABOUT THEM: ${user.about.trim()}` : '';
  return `${def.persona}
${playerIdentityBlock(user)}
THE STORY'S STARTING POINT: ${def.scenario}${aboutBlock}

${memoryBlock}

${RULES}`;
}

async function generateReply(def, user, facts, history) {
  const system = buildSystemPrompt(def, user, facts);
  const messages = history.slice(-300).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));
  const reply = await callAI([{ role: 'system', content: system }, ...messages], { maxTokens: 900, temperature: 0.9 });
  return reply ? reply.slice(0, 4000) : null;
}

async function extractFacts(def, conversationId, userText, replyText) {
  try {
    const existing = loadFacts(conversationId);
    const prompt = `Read this exchange from an adult roleplay story and extract durable facts worth remembering FOREVER about the user and the shared story: the user's name and identity, their preferences, desires and kinks, their limits and boundaries, their appearance, their life (job, home, relationships, pets), promises made by either side, and important story events or decisions. Write each fact as one short standalone sentence, third person, about the user or the story (e.g. "The user's name is Alex." / "The user loves foot worship and asked Delilah to go barefoot."). Only include facts clearly stated or strongly implied in THIS exchange. Do not repeat facts already known. Return at most 6 new facts; return an empty list if nothing durable was revealed.

ALREADY KNOWN:
${existing.length > 0 ? existing.map(f => `- ${f}`).join('\n') : '(nothing yet)'}

THE EXCHANGE:
User: ${userText}
${def.name}: ${replyText}

Reply with ONLY a JSON object: {"facts": ["...", "..."]}`;
    const raw = await callAI([{ role: 'user', content: prompt }], { maxTokens: 500, temperature: 0.2 });
    if (!raw) return [];
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const list = Array.isArray(parsed.facts) ? parsed.facts : [];
    const fresh = list.map(f => String(f).trim().slice(0, 240))
      .filter(f => f.length > 3)
      .filter(f => !existing.some(e => e.toLowerCase() === f.toLowerCase()))
      .slice(0, 6);
    const ins = db.prepare('INSERT INTO memory_facts (conversation_id, fact) VALUES (?,?)');
    for (const fact of fresh) ins.run(conversationId, fact);
    return fresh;
  } catch { return []; }
}

app.get('/api/chat/:key', authRequired, adultRequired, accountRequired, (req, res) => {
  const def = resolveCharacter(req.user.id, req.params.key);
  if (!def) return res.status(404).json({ error: 'Unknown character' });
  const convo = getOrCreateConversation(req.user.id, def);
  const rows = loadMessages(convo.id);
  res.json({
    conversationId: convo.id,
    character: characterOut(req.user.id, def),
    messages: rows.map(r => ({ id: r.id, role: r.role, text: r.text, createdAt: r.created_at })),
    memoryFacts: loadFacts(convo.id),
    aiConfigured: AI_CONFIGURED(),
  });
});

app.post('/api/chat/:key/message', authRequired, adultRequired, accountRequired, async (req, res) => {
  const def = resolveCharacter(req.user.id, req.params.key);
  if (!def) return res.status(404).json({ error: 'Unknown character' });
  const text = String((req.body || {}).text || '').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'Empty message' });
  const convo = getOrCreateConversation(req.user.id, def);
  db.prepare('INSERT INTO messages (conversation_id, role, text) VALUES (?,?,?)')
    .run(convo.id, 'user', text);
  db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?").run(convo.id);

  // Honest unconfigured state: the message is saved to the permanent story,
  // but no character reply is fabricated.
  if (!AI_CONFIGURED()) {
    return res.json({
      aiConfigured: false, reply: null,
      message: 'AI is not configured on this server yet — the server owner needs to set an OPENAI_API_KEY environment variable. Your message is saved to the story and will be part of its memory.',
    });
  }

  const facts = loadFacts(convo.id);
  const history = loadMessages(convo.id).map(m => ({ role: m.role, text: m.text }));
  let reply = null;
  try { reply = await generateReply(def, req.user, facts, history); }
  catch (e) { console.error('AI provider error:', e && e.message); return res.status(502).json({ error: 'The AI could not reply just now — try again in a moment.', detail: String((e && e.message) || e).slice(0, 300) }); }
  if (!reply) return res.status(502).json({ error: 'The AI could not reply just now — try again in a moment.' });

  db.prepare('INSERT INTO messages (conversation_id, role, text) VALUES (?,?,?)')
    .run(convo.id, 'character', reply);
  db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?").run(convo.id);
  const newFacts = await extractFacts(def, convo.id, text, reply);
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM messages WHERE conversation_id = ?) AS mc,
    (SELECT COUNT(*) FROM memory_facts WHERE conversation_id = ?) AS fc`).get(convo.id, convo.id);
  res.json({
    aiConfigured: true, reply,
    messageCount: counts.mc, memoryCount: counts.fc, newFacts,
  });
});

app.post('/api/chat/:key/regenerate', authRequired, adultRequired, accountRequired, async (req, res) => {
  const def = resolveCharacter(req.user.id, req.params.key);
  if (!def) return res.status(404).json({ error: 'Unknown character' });
  if (!AI_CONFIGURED())
    return res.json({ aiConfigured: false, reply: null, message: 'AI is not configured on this server yet' });
  const convo = getOrCreateConversation(req.user.id, def);
  const all = loadMessages(convo.id);
  const last = all[all.length - 1];
  if (!last || last.role !== 'character' || all.length < 2)
    return res.status(400).json({ error: 'Nothing to regenerate yet' });
  db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);
  const facts = loadFacts(convo.id);
  const history = all.slice(0, -1).map(m => ({ role: m.role, text: m.text }));
  let reply = null;
  try { reply = await generateReply(def, req.user, facts, history); }
  catch (e) { /* fall through */ }
  if (!reply) {
    // Restore the deleted reply rather than losing story content.
    db.prepare('INSERT INTO messages (conversation_id, role, text) VALUES (?,?,?)')
      .run(convo.id, 'character', last.text);
    return res.status(502).json({ error: 'The AI could not reply just now — your original reply was kept.' });
  }
  db.prepare('INSERT INTO messages (conversation_id, role, text) VALUES (?,?,?)')
    .run(convo.id, 'character', reply);
  db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?").run(convo.id);
  res.json({ aiConfigured: true, reply });
});

app.post('/api/chat/:key/restart', authRequired, adultRequired, (req, res) => {
  const def = resolveCharacter(req.user.id, req.params.key);
  if (!def) return res.status(404).json({ error: 'Unknown character' });
  const convo = db.prepare('SELECT id FROM conversations WHERE user_id = ? AND character_key = ?')
    .get(req.user.id, def.key);
  if (convo) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM memory_facts WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convo.id);
  }
  res.json({ ok: true });
});

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- error handler ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'SERVER_ERROR' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🌙 Lumiveil running on port ${PORT} (AI ${AI_CONFIGURED() ? 'configured' : 'NOT configured'})`);
  });
}
module.exports = app;
