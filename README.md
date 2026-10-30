# Lumiveil 🌙

An adults-only (18+) interactive character roleplay app with **unlimited memory**
and **no ads**. Players create an account, step through an 18+ gate, set up a
player identity (name + pronouns the characters use), and step into stories with
fictional adult characters who remember everything — every message is stored,
and a memory-fact ledger per conversation is carried into every reply.

This is the standalone deployable build (the official app), mirroring the
Luminous deployment pattern: one Node/Express container, a Turso cloud
database for persistence, and a static SPA frontend with no build step.

## Features

- **Accounts** — register/login/logout, bcrypt-hashed passwords, session tokens.
- **18+ gate** — enforced server-side. Only a confirmed-adult flag is stored;
  no date of birth is ever asked for or kept.
- **10 built-in characters** (`characters.js`) — each with a persona, a defined
  starting scenario, and an opening greeting. Stories are steered by the player.
- **Custom characters** — players can create their own (adults only), scoped to
  their account.
- **Unlimited memory** — full message history (up to the last 300 messages go
  into each reply) plus a permanent per-conversation memory ledger extracted
  after every exchange.
- **AI replies via OpenAI** — `OPENAI_API_KEY` from the environment only. With
  no key set, chats open with greetings and sending returns an honest
  "AI is not configured on this server yet" state — replies are never faked.
- **Asterisk actions** — narration/actions written `*like this*` render in gold.

## Run locally

```bash
npm install
node server.js          # http://localhost:3000
```

Data lands in `./data/lumiveil.db` unless `TURSO_DATABASE_URL` /
`TURSO_AUTH_TOKEN` point at a Turso database.

## Deploy (Render)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo — `render.yaml` defines the
   free Docker web service (health check `/api/config`).
3. Create a free Turso database and set `TURSO_DATABASE_URL` +
   `TURSO_AUTH_TOKEN` in the service's environment.
4. Set `OPENAI_API_KEY` in the environment to switch on character replies.

The free tier sleeps when idle; the first load after sleep can take ~a minute.
