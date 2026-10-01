// CLEAR headshot delivery API (Cloudflare Pages Functions)
// Routes:
//   Admin (X-Auth-Token required, CORS open):
//     GET    /api/headshots/admin/ping
//     POST   /api/headshots/admin/read-badge        body: base64 JPEG (text/plain)
//     PUT    /api/headshots/admin/object?key=...    body: image bytes
//     POST   /api/headshots/admin/people            body: { people: [...] } (max 25)
//     DELETE /api/headshots/admin/person/:token
//   Public (token is the access control):
//     GET    /api/headshots/p/:token                person + photo list
//     GET    /api/headshots/p/:token/:i?v=preview|full&dl=1
//
// Bindings: HEADSHOTS_BUCKET (R2), HEADSHOTS_KV (KV)
// Secrets:  HEADSHOT_ADMIN_TOKEN, ANTHROPIC_API_KEY
// Optional: BADGE_MODEL (defaults to Claude Haiku 4.5)

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const KEY_RE = /^[A-Za-z0-9_-]{22}\/(full|preview)\/[A-Za-z0-9._-]{1,120}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
  'Access-Control-Max-Age': '86400'
};

const BADGE_PROMPT =
  'This photo is from a conference headshot session. For each attendee, the photographer first takes one photo of the person ' +
  'HOLDING their name badge up in their hand next to their face, then several plain headshots. ' +
  'Decide whether this is the badge photo: a badge held up by hand near the face. ' +
  'A badge hanging on a lanyard or clipped to clothing does NOT count. ' +
  'Reply with only a JSON object and no other text: ' +
  '{"badge": true or false, "first": "", "last": "", "confidence": "high" or "medium" or "low"}. ' +
  'If badge is true, copy the first and last name as printed on the badge, in normal capitalization (not all caps). ' +
  'If the badge shows a nickname and a full name, use the name printed largest as first. ' +
  'If badge is false, leave first and last empty. Confidence describes how sure you are of the name spelling.';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];

  if (parts[0] === 'admin') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    let res;
    try {
      res = await handleAdmin(parts.slice(1), request, env);
    } catch (e) {
      res = json({ error: e && e.message ? e.message : String(e) }, 500);
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  }

  if (parts[0] === 'p') {
    try {
      return await handlePublic(parts.slice(1), request, env);
    } catch (e) {
      return json({ error: 'server_error' }, 500);
    }
  }

  return json({ error: 'not_found' }, 404);
}

/* ---------------- Admin ---------------- */

async function handleAdmin(parts, request, env) {
  if (!env.HEADSHOT_ADMIN_TOKEN) return json({ error: 'HEADSHOT_ADMIN_TOKEN secret is not set on the Pages project' }, 500);
  if (!safeEqual(request.headers.get('X-Auth-Token') || '', env.HEADSHOT_ADMIN_TOKEN)) {
    return json({ error: 'Admin token is incorrect' }, 401);
  }
  const route = parts[0];
  const m = request.method;

  if (route === 'ping' && m === 'GET') {
    return json({
      ok: true,
      r2: !!env.HEADSHOTS_BUCKET,
      kv: !!env.HEADSHOTS_KV,
      ai: !!env.ANTHROPIC_API_KEY,
      model: env.BADGE_MODEL || DEFAULT_MODEL
    });
  }

  if (route === 'read-badge' && m === 'POST') return readBadge(request, env);

  if (route === 'object' && m === 'PUT') {
    if (!env.HEADSHOTS_BUCKET) return json({ error: 'HEADSHOTS_BUCKET binding is missing' }, 500);
    const key = new URL(request.url).searchParams.get('key') || '';
    if (!KEY_RE.test(key)) return json({ error: 'Invalid object key' }, 400);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return json({ error: 'Empty upload' }, 400);
    await env.HEADSHOTS_BUCKET.put(key, buf, {
      httpMetadata: { contentType: request.headers.get('Content-Type') || 'image/jpeg' }
    });
    return json({ ok: true, key, size: buf.byteLength });
  }

  if (route === 'people' && m === 'POST') {
    if (!env.HEADSHOTS_KV) return json({ error: 'HEADSHOTS_KV binding is missing' }, 500);
    const body = await request.json();
    const list = Array.isArray(body.people) ? body.people : [];
    if (!list.length) return json({ error: 'No people in request' }, 400);
    if (list.length > 25) return json({ error: 'Send at most 25 people per request' }, 400);

    const records = [];
    for (const p of list) {
      if (!TOKEN_RE.test(p.token || '')) return json({ error: 'Invalid token' }, 400);
      const photos = Array.isArray(p.photos) ? p.photos : [];
      if (!photos.length || photos.length > 50) return json({ error: 'Each person needs 1 to 50 photos' }, 400);
      for (const ph of photos) {
        if (!KEY_RE.test(ph.full || '') || !KEY_RE.test(ph.preview || '') || !NAME_RE.test(ph.name || '')) {
          return json({ error: 'Invalid photo entry for token ' + p.token }, 400);
        }
        if (!ph.full.startsWith(p.token + '/') || !ph.preview.startsWith(p.token + '/')) {
          return json({ error: 'Photo key does not belong to token ' + p.token }, 400);
        }
      }
      const expires = p.expires && !isNaN(Date.parse(p.expires)) ? new Date(p.expires).toISOString() : null;
      records.push({
        token: p.token,
        rec: {
          first: String(p.first || '').slice(0, 100),
          last: String(p.last || '').slice(0, 100),
          photos: photos.map(ph => ({ full: ph.full, preview: ph.preview, name: ph.name })),
          expires,
          updated: new Date().toISOString()
        }
      });
    }
    await Promise.all(records.map(r => env.HEADSHOTS_KV.put('p:' + r.token, JSON.stringify(r.rec))));
    return json({ ok: true, saved: records.length });
  }

  if (route === 'person' && parts[1] && m === 'DELETE') {
    const token = parts[1];
    if (!TOKEN_RE.test(token)) return json({ error: 'Invalid token' }, 400);
    await env.HEADSHOTS_KV.delete('p:' + token);
    let cursor;
    let deleted = 0;
    do {
      const l = await env.HEADSHOTS_BUCKET.list({ prefix: token + '/', cursor });
      const keys = l.objects.map(o => o.key);
      if (keys.length) {
        await env.HEADSHOTS_BUCKET.delete(keys);
        deleted += keys.length;
      }
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    return json({ ok: true, deleted });
  }

  return json({ error: 'not_found' }, 404);
}

async function readBadge(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY secret is not set' }, 500);
  const b64 = (await request.text()).trim();
  if (!b64 || b64.length > 6000000 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) {
    return json({ error: 'Body must be base64 JPEG data' }, 400);
  }
  // Built by concatenation so the large base64 string is never parsed/re-serialized (keeps CPU low on the free plan)
  const payload =
    '{"model":' + JSON.stringify(env.BADGE_MODEL || DEFAULT_MODEL) +
    ',"max_tokens":150,"messages":[{"role":"user","content":[' +
    '{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"' + b64 + '"}},' +
    '{"type":"text","text":' + JSON.stringify(BADGE_PROMPT) + '}]}]}';

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: payload
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const retry = r.status === 429 || r.status === 529 || r.status >= 500;
    return json(
      { error: (data && data.error && data.error.message) || 'Anthropic API error ' + r.status, retryable: retry },
      retry ? 503 : 502
    );
  }
  const text = ((data && data.content) || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  let out;
  try {
    out = JSON.parse(match[0]);
  } catch (e) {
    return json({ error: 'Could not read the model reply', raw: text.slice(0, 300) }, 502);
  }
  return json({
    badge: out.badge === true || out.badge === 'true',
    first: String(out.first || '').trim(),
    last: String(out.last || '').trim(),
    confidence: ['high', 'medium', 'low'].includes(out.confidence) ? out.confidence : 'low',
    usage: data.usage || null
  });
}

/* ---------------- Public ---------------- */

async function handlePublic(parts, request, env) {
  const token = parts[0] || '';
  if (request.method !== 'GET' || !TOKEN_RE.test(token)) return json({ error: 'not_found' }, 404);

  const rec = await env.HEADSHOTS_KV.get('p:' + token, 'json');
  if (!rec) return json({ error: 'not_found' }, 404);
  if (rec.expires && Date.now() > Date.parse(rec.expires)) return json({ error: 'expired' }, 410);

  if (parts.length === 1) {
    return json({
      first: rec.first,
      last: rec.last,
      expires: rec.expires,
      photos: rec.photos.map((p, i) => ({ i, name: p.name }))
    });
  }

  const i = Number.parseInt(parts[1], 10);
  const ph = Number.isInteger(i) ? rec.photos[i] : null;
  if (!ph) return json({ error: 'not_found' }, 404);

  const url = new URL(request.url);
  const variant = url.searchParams.get('v') === 'preview' ? 'preview' : 'full';
  const obj = await env.HEADSHOTS_BUCKET.get(variant === 'preview' ? ph.preview : ph.full);
  if (!obj) return json({ error: 'not_found' }, 404);

  const fname = variant === 'preview' ? ph.name.replace(/\.[^.]+$/, '') + '-preview.jpg' : ph.name;
  const h = new Headers();
  h.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg');
  h.set('Content-Length', String(obj.size));
  h.set('Cache-Control', 'private, max-age=3600');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Content-Disposition', (url.searchParams.get('dl') === '1' ? 'attachment' : 'inline') + '; filename="' + fname + '"');
  return new Response(obj.body, { headers: h });
}
