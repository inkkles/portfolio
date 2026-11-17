// The shared part of the site, running on Cloudflare (free plan).
// Every visitor holds one WebSocket to the single "World" object below, which
// relays drawings and messages between them and stores the graffiti.
//
// Secrets (set with `npx wrangler secret put NAME`, or in .dev.vars locally):
//   WIPE_PASSWORD   password for the terminal's `wipe` command
//   EMAIL_TO        where each spoken message is emailed
//   RESEND_API_KEY  key from resend.com that sends those emails
import { DurableObject } from 'cloudflare:workers';

const CHUNK = 100000; // graffiti is stored in rows of about this many characters

const validStroke = m => /^#[0-9a-f]{6}$/i.test(m.c) && m.w >= 1 && m.w <= 64 && Array.isArray(m.p) &&
  m.p.length >= 2 && m.p.length <= 1024 && m.p.length % 2 === 0 && m.p.every(v => Number.isFinite(v) && Math.abs(v) < 1e5);

async function email(env, text) {
  if (!env.RESEND_API_KEY || !env.EMAIL_TO) return console.log('[email not set up] ' + text);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM || 'onboarding@resend.dev', to: env.EMAIL_TO, subject: 'Someone spoke on your site', text }),
    });
    console.log(r.ok ? '[email sent]' : '[email failed]', r.status, await r.text());
  } catch (e) { console.log('[email failed]', e.message); }
}

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  }

  // A visitor connects: accept the socket and send them all existing graffiti.
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    for (const row of this.sql.exec('SELECT data FROM chunks ORDER BY id')) server.send(`{"t":"strokes","a":[${row.data}]}`);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg, except) {
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(msg); } catch {} }
  }

  // Allows an action at most once per `ms` for each visitor.
  throttled(ws, key, ms) {
    const a = ws.deserializeAttachment() || {}, now = Date.now();
    if (now - (a[key] || 0) < ms) return true;
    ws.serializeAttachment({ ...a, [key]: now });
    return false;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 20000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m) return;

    if (m.t === 'live' || m.t === 'save') { // live = show everyone now, save = keep it
      if (!validStroke(m)) return;
      const stroke = JSON.stringify({ c: m.c, w: m.w, p: m.p });
      if (m.t === 'live') return this.broadcast(`{"t":"stroke",${stroke.slice(1)}`, ws);
      const last = this.sql.exec('SELECT id, length(data) AS n FROM chunks ORDER BY id DESC LIMIT 1').toArray()[0];
      if (last && last.n < CHUNK) this.sql.exec("UPDATE chunks SET data = data || ',' || ? WHERE id = ?", stroke, last.id);
      else this.sql.exec('INSERT INTO chunks (data) VALUES (?)', stroke);
    } else if (m.t === 'hello') {          // spoken message: relayed and emailed, never stored
      const text = typeof m.text === 'string' ? m.text.trim() : '';
      if (!text || text.length > 255 || this.throttled(ws, 'hello', 3000)) return;
      this.broadcast(JSON.stringify({ t: 'hello', text }));
      this.ctx.waitUntil(email(this.env, text));
    } else if (m.t === 'clear') {          // wipe all graffiti, password protected
      if (this.throttled(ws, 'clear', 2000)) return;
      if (!this.env.WIPE_PASSWORD || m.pw !== this.env.WIPE_PASSWORD) return ws.send('{"t":"denied"}');
      this.sql.exec('DELETE FROM chunks');
      this.broadcast('{"t":"clear"}');
    }
  }

  webSocketClose(ws, code) { try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch {} }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      // Only pages from this site may connect.
      const origin = req.headers.get('Origin') || '';
      let host = '';
      try { host = new URL(origin).hostname; } catch {}
      const ok = host === 'localhost' || host === '127.0.0.1' || host === url.hostname || (env.ORIGINS || '').split(',').includes(origin);
      if (!ok) return new Response('forbidden', { status: 403 });
      return env.WORLD.get(env.WORLD.idFromName('world')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
