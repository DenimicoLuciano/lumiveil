// Lumiveil SPA — an adults-only world of character stories with unlimited memory.
const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
// Story text: actions live between *asterisks* — render them in gold italics.
function rich(s) {
  return esc(s).split(/\n{2,}/).map(p =>
    `<p>${p.replace(/\*([^*\n]+)\*/g, '<em class="act">*$1*</em>').replace(/\n/g, '<br>')}</p>`).join('');
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3800);
}
const GENDER_OPTS = [
  ['female', 'Woman — she/her'],
  ['male', 'Man — he/him'],
  ['nonbinary', 'Non-binary — they/them'],
  ['other', 'Other — they/them'],
];
const aiNotice = () => `<div class="notice">🌙 <b>AI is not configured on this server yet.</b><br>
  <span class="muted" style="color:inherit">The server owner needs to set an <code>OPENAI_API_KEY</code> environment variable and redeploy. Stories open and your messages are saved to their memory — characters will reply once AI is switched on.</span></div>`;

const App = {
  user: null,
  aiConfigured: false,
  characters: [],
  _genre: 'All',

  accountComplete() {
    const u = this.user;
    return !!(u && (u.player_name || '').trim().length > 0 && GENDER_OPTS.some(([k]) => k === u.gender));
  },

  async init() {
    try { const cfg = await API.get('/config'); this.aiConfigured = !!cfg.aiConfigured; } catch (e) {}
    if (API.token) {
      try { const { user } = await API.get('/auth/me'); this.user = user; }
      catch (e) { API.setToken(null); }
    }
    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  async refreshUser() {
    const { user } = await API.get('/auth/me');
    this.user = user;
    this.renderAuthArea();
  },

  renderAuthArea() {
    const area = document.getElementById('authArea');
    if (this.user) {
      area.innerHTML = `<button class="icon-btn" id="meBtn" title="Your profile">👤</button>`;
      document.getElementById('meBtn').onclick = () => location.hash = '#/profile';
    } else area.innerHTML = '';
  },

  route() {
    const el = document.getElementById('app');
    const hash = location.hash || '#/';
    this.renderAuthArea();
    window.scrollTo(0, 0);
    if (!this.user) return Views.auth(el);
    if (!this.user.adult_verified) return Views.gate(el);
    if (!this.accountComplete()) return Views.setup(el);
    if (hash === '#/' || hash === '#') Views.gallery(el);
    else if (hash.startsWith('#/character/')) Views.detail(el, decodeURIComponent(hash.slice('#/character/'.length)));
    else if (hash.startsWith('#/chat/')) Views.chat(el, decodeURIComponent(hash.slice('#/chat/'.length)));
    else if (hash === '#/create') Views.create(el);
    else if (hash === '#/profile') Views.profile(el);
    else Views.gallery(el);
  },
};

const Views = {
  /* ---------------- AUTH ---------------- */
  auth(el, mode = 'login') {
    el.innerHTML = `
      <div class="card center" style="margin-top:5vh">
        <div class="moon">🌙</div>
        <h2 class="hero-title">Lumiveil</h2>
        <p class="muted" style="margin:0 0 4px">Interactive stories with fictional adult characters who remember everything.<br>No ads. Your stories, yours alone.</p>
        <p class="muted">🔞 Adults only — every character is fictional and 18+.</p>
      </div>
      <div class="card">
        <div class="tabs">
          <button class="${mode === 'login' ? 'active' : ''}" id="tabLogin">Log in</button>
          <button class="${mode === 'register' ? 'active' : ''}" id="tabRegister">Sign up</button>
        </div>
        <div class="form-grid">
          ${mode === 'register' ? `
            <label class="f">Username <input id="aUsername" maxlength="24" autocomplete="username" placeholder="yourname"></label>
            <label class="f">Display name <input id="aDisplay" maxlength="60" placeholder="What the app calls you"></label>` : ''}
          <label class="f">Email <input id="aEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
          <label class="f">Password <input id="aPassword" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" placeholder="At least 6 characters"></label>
          <label class="check-row"><input type="checkbox" id="aRemember" checked> <span>Keep me signed in on this device</span></label>
          <button class="btn gold" id="aGo">${mode === 'register' ? 'Create my account' : 'Enter Lumiveil'}</button>
          <div class="muted center" id="aErr"></div>
        </div>
      </div>`;
    document.getElementById('tabLogin').onclick = () => Views.auth(el, 'login');
    document.getElementById('tabRegister').onclick = () => Views.auth(el, 'register');
    document.getElementById('aGo').onclick = async () => {
      const email = document.getElementById('aEmail').value.trim();
      const password = document.getElementById('aPassword').value;
      const remember = document.getElementById('aRemember').checked;
      const err = document.getElementById('aErr');
      try {
        let data;
        if (mode === 'register') {
          const username = document.getElementById('aUsername').value.trim();
          const display_name = document.getElementById('aDisplay').value.trim() || username;
          if (!username) { err.textContent = 'Pick a username'; return; }
          data = await API.post('/auth/register', { email, password, username, display_name });
        } else {
          data = await API.post('/auth/login', { email, password });
        }
        API.setToken(data.token, remember);
        App.user = data.user;
        App.route();
      } catch (e) { err.textContent = (e.data && e.data.error) || 'Something went wrong — try again'; }
    };
  },

  /* ---------------- 18+ GATE ---------------- */
  gate(el) {
    el.innerHTML = `
      <div class="card center" style="margin-top:5vh">
        <div class="moon">🌙</div>
        <h2 class="hero-title">Adults Only</h2>
        <p>Lumiveil is a world of mature, romantic, and kinky interactive stories. Every character is a fictional adult, and every player must be one too.</p>
        <p class="muted">Before the veil lifts, confirm you are of age. Only your confirmation is stored — never a date of birth.</p>
        <label class="check-row" style="text-align:left;max-width:340px;margin:14px auto">
          <input type="checkbox" id="gConfirm"> <span>I confirm that I am <b>18 years or older</b> and I want to enter Lumiveil.</span>
        </label>
        <button class="btn gold" id="gGo" disabled>Lift the veil</button>
        <div class="mt"><button class="btn ghost small" id="gOut">Log out</button></div>
      </div>`;
    const box = document.getElementById('gConfirm');
    const btn = document.getElementById('gGo');
    box.onchange = () => btn.disabled = !box.checked;
    btn.onclick = async () => {
      try {
        await API.post('/profile/verify-age', { confirmAdult: true });
        await App.refreshUser();
        toast('Welcome to Lumiveil 🌙');
        App.route();
      } catch (e) { toast((e.data && e.data.error) || 'Could not verify — try again'); }
    };
    document.getElementById('gOut').onclick = () => Views.logout();
  },

  async logout() {
    try { await API.post('/auth/logout', {}); } catch (e) {}
    API.setToken(null);
    App.user = null;
    location.hash = '#/';
    App.route();
  },

  /* ---------------- PLAYER SETUP ---------------- */
  setup(el) {
    el.innerHTML = `
      <div class="card">
        <h3 class="serif gold-text" style="margin-top:0">Who are you in the story?</h3>
        <p class="muted">Every character will know you by this name, and speak to you as you. It lives on your account — change it anytime in your profile.</p>
        <div class="form-grid">
          <label class="f">Your name <input id="sName" maxlength="40" placeholder="e.g. Denim"></label>
          <label class="f">You are… <select id="sGender">
            ${GENDER_OPTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
          </select></label>
          <label class="f">Anything characters should know about you? (optional)
            <textarea id="sAbout" maxlength="500" placeholder="Your vibe, your desires, your limits — the characters will hold onto this."></textarea></label>
          <button class="btn gold" id="sGo">Begin</button>
          <div class="muted center" id="sErr"></div>
        </div>
      </div>`;
    document.getElementById('sGo').onclick = async () => {
      const player_name = document.getElementById('sName').value.trim();
      const gender = document.getElementById('sGender').value;
      const about = document.getElementById('sAbout').value.trim();
      const err = document.getElementById('sErr');
      if (!player_name) { err.textContent = 'Give the characters a name to know you by'; return; }
      try {
        await API.post('/profile', { player_name, gender, about });
        await App.refreshUser();
        App.route();
      } catch (e) { err.textContent = (e.data && e.data.error) || 'Could not save — try again'; }
    };
  },

  /* ---------------- GALLERY ---------------- */
  async gallery(el) {
    el.innerHTML = `<div class="card center"><div class="muted">Lifting the veil…</div></div>`;
    try {
      const { characters, genres, aiConfigured } = await API.get('/characters');
      App.characters = characters;
      App.aiConfigured = !!aiConfigured;
      const genreList = ['All', ...genres];
      if (!genreList.includes(App._genre)) App._genre = 'All';
      const list = characters.filter(c => App._genre === 'All' || c.genre === App._genre);
      el.innerHTML = `
        ${App.aiConfigured ? '' : aiNotice()}
        <div class="chip-row">${genreList.map(g =>
          `<span class="chip ${g === App._genre ? 'sel' : ''}" data-g="${esc(g)}">${esc(g)}</span>`).join('')}</div>
        ${list.map(c => `
          <div class="card char-card" data-k="${esc(c.key)}">
            <div class="char-ava" style="background:${esc(c.color)}33">${esc(c.emoji)}</div>
            <div class="grow">
              <div class="char-name">${esc(c.name)} <span class="muted" style="font-weight:400">${esc(c.age)}</span></div>
              <div class="muted">${esc(c.genre)} · ${esc(c.pronouns)}${c.isCustom ? ' · <span class="gold-text">yours</span>' : ''}</div>
              <div class="tagline">“${esc(c.tagline)}”</div>
              ${c.hasConversation ? `<div class="preview">${esc(c.lastMessagePreview)}</div>
                <div class="mt" style="margin-top:6px"><span class="chip static">💬 ${c.messageCount} messages</span> <span class="chip static memory">🧠 ${c.memoryCount} memories</span></div>` : ''}
            </div>
            <div style="color:var(--gold);font-size:20px">›</div>
          </div>`).join('') || '<div class="card center muted">No characters in this genre yet.</div>'}
        <div class="card center">
          <div class="serif" style="font-size:17px">Someone missing from the veil?</div>
          <div class="muted">Create your own character — their story starts the moment you do.</div>
          <div class="mt"><a class="btn" href="#/create">＋ Create a character</a></div>
        </div>
        <p class="muted center">All characters are fictional adults (18+). Stories remember everything — the veil never forgets.</p>`;
      el.querySelectorAll('.chip[data-g]').forEach(ch => ch.onclick = () => { App._genre = ch.dataset.g; Views.gallery(el); });
      el.querySelectorAll('.char-card').forEach(card => card.onclick = () => location.hash = '#/character/' + encodeURIComponent(card.dataset.k));
    } catch (e) {
      el.innerHTML = `<div class="card center">Couldn't load the characters. <div class="mt"><button class="btn small" onclick="App.route()">Try again</button></div></div>`;
    }
  },

  /* ---------------- CHARACTER DETAIL ---------------- */
  detail(el, key) {
    const c = App.characters.find(x => x.key === key);
    if (!c) { location.hash = '#/'; return; }
    el.innerHTML = `
      <button class="btn ghost small" id="dBack">← All characters</button>
      <div class="card" style="margin-top:12px">
        <div class="center">
          <div class="char-ava lg" style="background:${esc(c.color)}33">${esc(c.emoji)}</div>
          <h2 class="serif" style="margin:10px 0 2px">${esc(c.name)}</h2>
          <div class="muted">${esc(c.age)} · ${esc(c.pronouns)} · ${esc(c.genre)}</div>
          <div class="tagline" style="font-size:15px;margin-top:6px">“${esc(c.tagline)}”</div>
        </div>
        <p style="line-height:1.6">${esc(c.description)}</p>
        <div class="interests">${c.interests.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>
        <h4 class="gold-text" style="margin-bottom:6px">Where the story begins</h4>
        <div class="scenario">${esc(c.scenario)}</div>
        <button class="btn gold" id="dGo" style="width:100%;margin-top:14px">${c.hasConversation ? 'Continue the story' : 'Begin the story'}</button>
        ${c.hasConversation ? `<div class="row mt"><span class="muted grow">💬 ${c.messageCount} messages · 🧠 ${c.memoryCount} memories they keep of you</span>
          <button class="btn small ghost" id="dRestart">↺ Restart story</button></div>` : ''}
        ${c.isCustom ? `<div class="mt"><button class="btn small ghost" id="dDelete">🗑 Delete this character</button></div>` : ''}
      </div>`;
    document.getElementById('dBack').onclick = () => location.hash = '#/';
    document.getElementById('dGo').onclick = () => location.hash = '#/chat/' + encodeURIComponent(key);
    const rs = document.getElementById('dRestart');
    if (rs) rs.onclick = async () => {
      if (!confirm('Restart this story from the very beginning? Every message and memory will be erased.')) return;
      try { await API.post(`/chat/${encodeURIComponent(key)}/restart`, {}); toast('A fresh story awaits'); location.hash = '#/chat/' + encodeURIComponent(key); }
      catch (e) { toast('Could not restart — try again'); }
    };
    const del = document.getElementById('dDelete');
    if (del) del.onclick = async () => {
      if (!confirm('Delete this character and their story for good?')) return;
      try { await API.del(`/characters/${encodeURIComponent(key)}`); toast('Character deleted'); location.hash = '#/'; }
      catch (e) { toast((e.data && e.data.error) || 'Could not delete'); }
    };
  },

  /* ---------------- CHAT ---------------- */
  async chat(el, key) {
    el.innerHTML = `<div class="card center"><div class="muted">Opening the story…</div></div>`;
    let data;
    try { data = await API.get(`/chat/${encodeURIComponent(key)}`); }
    catch (e) { el.innerHTML = `<div class="card center">Couldn't open this story. <div class="mt"><a class="btn small" href="#/">← Characters</a></div></div>`; return; }
    const c = data.character;
    App.aiConfigured = !!data.aiConfigured;
    el.innerHTML = `
      ${App.aiConfigured ? '' : aiNotice()}
      <div class="chat-head">
        <button class="icon-btn" id="cBack">←</button>
        <div class="char-ava" style="background:${esc(c.color)}33;width:44px;height:44px;font-size:22px">${esc(c.emoji)}</div>
        <div class="grow">
          <div class="char-name" style="font-size:16px">${esc(c.name)}</div>
          <div class="muted">${esc(c.genre)} · 🧠 <span id="cMem">${data.memoryFacts.length}</span> memories kept</div>
        </div>
        <button class="icon-btn" id="cRegen" title="Regenerate the last reply">⟳</button>
        <button class="icon-btn" id="cRestart" title="Restart this story">↺</button>
      </div>
      <div class="card" style="padding:14px">
        <div class="chat-box" id="cBox"></div>
        <div class="chat-input-row">
          <input id="cInput" placeholder="Say something… or *do something*" maxlength="4000">
          <button class="btn gold" id="cSend">➤</button>
        </div>
        <div class="muted center" style="margin-top:8px">Actions and narration live between *asterisks* — write *like this* and the story answers in kind.</div>
      </div>`;
    const box = document.getElementById('cBox');
    const input = document.getElementById('cInput');
    const sendBtn = document.getElementById('cSend');
    const addMsg = (m) => {
      const d = document.createElement('div');
      if (m.role === 'sys') { d.className = 'msg sys'; d.textContent = m.text; }
      else if (m.role === 'user') { d.className = 'msg user'; d.textContent = m.text; }
      else { d.className = 'msg char'; d.innerHTML = rich(m.text); }
      box.appendChild(d);
      box.scrollTop = box.scrollHeight;
      return d;
    };
    data.messages.forEach(addMsg);
    box.scrollTop = box.scrollHeight;

    document.getElementById('cBack').onclick = () => location.hash = '#/character/' + encodeURIComponent(key);
    document.getElementById('cRestart').onclick = async () => {
      if (!confirm('Restart this story from the very beginning? Every message and memory will be erased.')) return;
      try { await API.post(`/chat/${encodeURIComponent(key)}/restart`, {}); Views.chat(el, key); }
      catch (e) { toast('Could not restart — try again'); }
    };
    document.getElementById('cRegen').onclick = async () => {
      try {
        const r = await API.post(`/chat/${encodeURIComponent(key)}/regenerate`, {});
        if (r.reply) {
          const chars = box.querySelectorAll('.msg.char');
          const lastEl = chars[chars.length - 1];
          if (lastEl) lastEl.innerHTML = rich(r.reply);
          box.scrollTop = box.scrollHeight;
        } else toast(r.message || 'AI is not configured on this server yet');
      } catch (e) { toast((e.data && e.data.error) || 'Nothing to regenerate yet'); }
    };

    let sending = false;
    const send = async () => {
      const text = input.value.trim();
      if (!text || sending) return;
      input.value = '';
      addMsg({ role: 'user', text });
      sending = true; sendBtn.disabled = true;
      const typing = document.createElement('div');
      typing.className = 'typing'; typing.textContent = `${c.name} is writing…`;
      box.appendChild(typing); box.scrollTop = box.scrollHeight;
      try {
        const r = await API.post(`/chat/${encodeURIComponent(key)}/message`, { text });
        typing.remove();
        if (r.aiConfigured === false) {
          addMsg({ role: 'sys', text: '🌙 ' + (r.message || 'AI is not configured on this server yet — your message is saved to the story.') });
        } else if (r.reply) {
          addMsg({ role: 'character', text: r.reply });
          if (typeof r.memoryCount === 'number') document.getElementById('cMem').textContent = r.memoryCount;
          if (r.newFacts && r.newFacts.length) toast(`🧠 ${c.name.split(' ')[0]} will remember that`);
        }
      } catch (e) {
        typing.remove();
        addMsg({ role: 'sys', text: '⚠️ ' + ((e.data && e.data.error) || 'The reply didn\'t come through — your message is saved. Try again in a moment.') });
      }
      sending = false; sendBtn.disabled = false;
      input.focus();
    };
    sendBtn.onclick = send;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    input.focus();
  },

  /* ---------------- CREATE CHARACTER ---------------- */
  create(el) {
    el.innerHTML = `
      <button class="btn ghost small" onclick="location.hash='#/'">← All characters</button>
      <div class="card" style="margin-top:12px">
        <h3 class="serif gold-text" style="margin-top:0">Create a character</h3>
        <p class="muted">Every character is a fictional adult. Give them a voice, a world, and an opening moment — the story does the rest.</p>
        <div class="form-grid">
          <label class="f">Name <input id="nName" maxlength="40" placeholder="e.g. Lady Isolde"></label>
          <div class="row">
            <label class="f grow">Age (18+) <input id="nAge" type="number" min="18" max="999" value="28"></label>
            <label class="f grow">Pronouns <input id="nPronouns" maxlength="20" value="she/her"></label>
          </div>
          <div class="row">
            <label class="f grow">Genre <input id="nGenre" maxlength="30" placeholder="Romance, Fantasy…"></label>
            <label class="f" style="width:90px">Emoji <input id="nEmoji" maxlength="8" value="🌙"></label>
            <label class="f" style="width:110px">Color <input id="nColor" type="color" value="#7a4a8e" style="padding:4px;height:44px"></label>
          </div>
          <label class="f">Tagline <input id="nTagline" maxlength="120" placeholder="One line that hooks"></label>
          <label class="f">Description <textarea id="nDesc" maxlength="800" placeholder="Who they are, for the gallery"></textarea></label>
          <label class="f">Persona — how they speak, want, and behave <textarea id="nPersona" maxlength="1500" placeholder="You are…"></textarea></label>
          <label class="f">Scenario — where the story begins <textarea id="nScenario" maxlength="800"></textarea></label>
          <label class="f">Greeting — their opening message <textarea id="nGreeting" maxlength="1500" placeholder="*actions in asterisks*, dialogue in quotes"></textarea></label>
          <label class="f">Interests (comma-separated, up to 5) <input id="nInterests" maxlength="160" placeholder="Slow burn, Secrets, Devotion"></label>
          <button class="btn gold" id="nGo">Bring them to life</button>
          <div class="muted center" id="nErr"></div>
        </div>
      </div>`;
    document.getElementById('nGo').onclick = async () => {
      const err = document.getElementById('nErr');
      const body = {
        name: document.getElementById('nName').value.trim(),
        age: parseInt(document.getElementById('nAge').value, 10),
        pronouns: document.getElementById('nPronouns').value.trim(),
        genre: document.getElementById('nGenre').value.trim(),
        emoji: document.getElementById('nEmoji').value.trim(),
        color: document.getElementById('nColor').value,
        tagline: document.getElementById('nTagline').value.trim(),
        description: document.getElementById('nDesc').value.trim(),
        persona: document.getElementById('nPersona').value.trim(),
        scenario: document.getElementById('nScenario').value.trim(),
        greeting: document.getElementById('nGreeting').value.trim(),
        interests: document.getElementById('nInterests').value.split(',').map(s => s.trim()).filter(Boolean),
      };
      try {
        const r = await API.post('/characters', body);
        toast('Your character walks the veil 🌙');
        location.hash = '#/chat/' + encodeURIComponent(r.key);
      } catch (e) { err.textContent = (e.data && e.data.error) || 'Could not create — check the fields and try again'; }
    };
  },

  /* ---------------- PROFILE ---------------- */
  profile(el) {
    const u = App.user;
    el.innerHTML = `
      <div class="card">
        <h3 class="serif gold-text" style="margin-top:0">👤 Your player profile</h3>
        <p class="muted">Signed in as <b>@${esc(u.username)}</b> · ${esc(u.email)}</p>
        <div class="form-grid">
          <label class="f">Your name (characters know you by it) <input id="pName" maxlength="40" value="${esc(u.player_name || '')}"></label>
          <label class="f">You are… <select id="pGender">
            ${GENDER_OPTS.map(([k, l]) => `<option value="${k}" ${u.gender === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
          <label class="f">About you (characters hold onto this)
            <textarea id="pAbout" maxlength="500">${esc(u.about || '')}</textarea></label>
          <button class="btn gold" id="pSave">Save</button>
          <div class="muted center" id="pErr"></div>
        </div>
      </div>
      <div class="card center">
        <button class="btn ghost" id="pOut">Log out</button>
        <p class="muted">Your stories and every memory your characters keep live on this account — they survive redeploys and new devices.</p>
      </div>`;
    document.getElementById('pSave').onclick = async () => {
      const err = document.getElementById('pErr');
      try {
        await API.post('/profile', {
          player_name: document.getElementById('pName').value.trim(),
          gender: document.getElementById('pGender').value,
          about: document.getElementById('pAbout').value.trim(),
        });
        await App.refreshUser();
        toast('Saved — the veil remembers');
      } catch (e) { err.textContent = (e.data && e.data.error) || 'Could not save'; }
    };
    document.getElementById('pOut').onclick = () => Views.logout();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
