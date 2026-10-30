// Lumiveil API client
const API = {
  token: localStorage.getItem('lumiveil_token') || sessionStorage.getItem('lumiveil_token') || null,

  async req(method, path, body) {
    const headers = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    let payload;
    if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch('/api' + path, { method, headers, body: payload });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  },
  get: (p) => API.req('GET', p),
  post: (p, b) => API.req('POST', p, b),
  del: (p) => API.req('DELETE', p),

  setToken(t, remember = true) {
    this.token = t;
    sessionStorage.removeItem('lumiveil_token');
    localStorage.removeItem('lumiveil_token');
    if (t) (remember ? localStorage : sessionStorage).setItem('lumiveil_token', t);
  },
};
