import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

export const ADMIN_USERNAME = 'thekhanartist';

export function ready() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY && SESSION_SECRET);
}

export function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export async function db(path, { method = 'GET', body, headers = {} } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase is not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(typeof data === 'object' ? data.message ?? `Database HTTP ${response.status}` : `Database HTTP ${response.status}`);
  return data;
}

function b64(value) { return Buffer.from(value).toString('base64url'); }
function unb64(value) { return Buffer.from(value, 'base64url').toString('utf8'); }

export function issueToken(user) {
  const payload = { sub: user.id, username: user.username, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 };
  const body = b64(JSON.stringify(payload));
  const signature = b64(crypto.createHmac('sha256', SESSION_SECRET ?? 'missing').update(body).digest());
  return `${body}.${signature}`;
}

export function userFromRequest(req) {
  const header = req.headers?.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [body, signature] = token.split('.');
  if (!body || !signature || !SESSION_SECRET) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(unb64(body));
    return payload.exp > Date.now() ? { id: payload.sub, username: payload.username } : null;
  } catch { return null; }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function cleanUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(username) ? username : null;
}
