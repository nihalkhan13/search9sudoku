import { cleanUsername, db, readBody, ready, send, userFromRequest } from './_lib/db.js';

export default async function handler(req, res) {
  if (!ready()) return send(res, 503, { error: 'Online friends are not configured yet' });
  const user = userFromRequest(req);
  if (!user) return send(res, 401, { error: 'Sign in to manage friends' });
  try {
    if (req.method === 'GET') {
      const links = await db(`friendships?select=friend_id&user_id=eq.${user.id}`);
      const ids = (links ?? []).map((row) => row.friend_id);
      if (!ids.length) return send(res, 200, { friends: [] });
      const friends = await db(`users?select=id,username&id=in.(${ids.join(',')})`);
      return send(res, 200, { friends: friends ?? [] });
    }
    if (req.method === 'POST') {
      const { action, username: rawUsername } = await readBody(req);
      if (action !== 'add') return send(res, 400, { error: 'Unknown friends action' });
      const username = cleanUsername(rawUsername);
      if (!username) return send(res, 400, { error: 'Invalid username' });
      const rows = await db(`users?select=id,username&username=ilike.${encodeURIComponent(username)}&limit=1`);
      const friend = rows?.[0];
      if (!friend || friend.id === user.id) return send(res, 404, { error: 'Player not found' });
      await db('friendships', { method: 'POST', body: [{ user_id: user.id, friend_id: friend.id }], headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
      return send(res, 200, { friend });
    }
    return send(res, 405, { error: 'GET or POST required' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}
