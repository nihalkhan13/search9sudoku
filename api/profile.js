import { normalizeLocation } from '../js/core/locations.js';
import { db, readBody, ready, send, userFromRequest } from './_lib/db.js';

function publicUser(row) {
  return { id: row.id, username: row.username, country: row.country ?? 'US', state: row.state ?? null, guest: false };
}

export default async function handler(req, res) {
  if (!ready()) return send(res, 503, { error: 'Online profiles are not configured yet' });
  const user = userFromRequest(req);
  if (!user) return send(res, 401, { error: 'Sign in to edit your profile' });
  try {
    if (req.method === 'GET') {
      const rows = await db(`users?select=id,username,country,state&id=eq.${user.id}&limit=1`);
      return rows?.[0] ? send(res, 200, { user: publicUser(rows[0]) }) : send(res, 404, { error: 'Profile not found' });
    }
    if (req.method !== 'PATCH') return send(res, 405, { error: 'GET or PATCH required' });
    const body = await readBody(req);
    const location = normalizeLocation(body.country, body.state);
    if (!location) return send(res, 400, { error: 'Choose a country, plus a US state when applicable' });
    const rows = await db(`users?id=eq.${user.id}`, { method: 'PATCH', body: location, headers: { Prefer: 'return=representation' } });
    return rows?.[0] ? send(res, 200, { user: publicUser(rows[0]) }) : send(res, 404, { error: 'Profile not found' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}
