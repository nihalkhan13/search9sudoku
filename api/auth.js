import { cleanUsername, db, hashPassword, issueToken, readBody, ready, send, verifyPassword } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  if (!ready()) return send(res, 503, { error: 'Online accounts are not configured yet' });
  try {
    const { action, username: rawUsername, password } = await readBody(req);
    const username = cleanUsername(rawUsername);
    if (!username || String(password ?? '').length < 6) return send(res, 400, { error: 'Use a 3-24 character username and a password of at least 6 characters' });

    if (action === 'register') {
      const existing = await db(`users?select=id&username=ilike.${encodeURIComponent(username)}`);
      if (existing?.length) return send(res, 409, { error: 'That username is already taken' });
      const rows = await db('users', { method: 'POST', body: [{ username, password_hash: hashPassword(password) }], headers: { Prefer: 'return=representation' } });
      const user = { id: rows[0].id, username: rows[0].username, guest: false };
      return send(res, 201, { user, token: issueToken(user) });
    }

    if (action === 'login') {
      const rows = await db(`users?select=id,username,password_hash&username=ilike.${encodeURIComponent(username)}&limit=1`);
      const record = rows?.[0];
      if (!record || !verifyPassword(password, record.password_hash)) return send(res, 401, { error: 'Username or password not recognised' });
      const user = { id: record.id, username: record.username, guest: false };
      return send(res, 200, { user, token: issueToken(user) });
    }
    return send(res, 400, { error: 'Unknown auth action' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}
