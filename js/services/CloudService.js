/**
 * Online account and leaderboard seam.
 *
 * The browser talks to same-origin Vercel functions. If the API is not
 * configured yet, calls return null and main.js uses the local-first fallback.
 */

import { storage } from './StorageService.js';
import { normalizeLocation } from '../core/locations.js';

export const API_BASE = '/api';
async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 7000);
  const session = storage.loadSession();
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    if (!res.ok) {
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
      let message = `HTTP ${res.status}`;
      try { message = (await res.json()).error ?? message; } catch { /* plain response */ }
      return { _error: message, status: res.status };
    }
    return await res.json();
  } catch (err) {
    console.warn(`[CloudService] ${path} unavailable:`, err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function persistSession(payload) {
  if (payload?.token && payload?.user) storage.saveSession({ token: payload.token, user: payload.user });
  return payload?.user ?? null;
}

export function currentUser() { return storage.loadSession()?.user ?? null; }

export async function login(username, password) {
  const remote = await request('/auth', { method: 'POST', body: JSON.stringify({ action: 'login', username, password }) });
  if (remote?._error && remote.status !== 503) throw new Error(remote._error);
  if (remote?.user) return persistSession(remote);
  return storage.localLogin(username, password);
}

export async function register(username, password, location = {}) {
  const normalized = normalizeLocation(location.country, location.state);
  if (!normalized) throw new Error('Choose a country, plus a US state when applicable');
  const remote = await request('/auth', { method: 'POST', body: JSON.stringify({ action: 'register', username, password, ...normalized }) });
  if (remote?._error && remote.status !== 503) throw new Error(remote._error);
  if (remote?.user) return persistSession(remote);
  return storage.localRegister(username, password, normalized);
}

export async function updateProfile(location = {}) {
  const normalized = normalizeLocation(location.country, location.state);
  if (!normalized) throw new Error('Choose a country, plus a US state when applicable');
  const remote = await request('/profile', { method: 'PATCH', body: JSON.stringify(normalized) });
  if (remote?._error && remote.status !== 503) throw new Error(remote._error);
  if (remote?.user) {
    const session = storage.loadSession();
    storage.saveSession({ ...session, user: remote.user });
    return remote.user;
  }
  const user = currentUser();
  if (user?.local) return storage.updateLocalProfile(user.id, normalized);
  return null;
}

export async function playAsGuest() {
  const user = storage.guestSession();
  storage.saveSession({ user });
  return user;
}

export async function logout() {
  storage.clearSession();
  return true;
}

export async function submitScore(entry) {
  const remote = await request('/scores', { method: 'POST', body: JSON.stringify(entry) });
  if (remote) return remote;
  return { accepted: true, offline: true };
}

export async function fetchLeaderboard({ puzzleId, difficulty, mode = 'daily', scope = 'global', limit = 50 } = {}) {
  const params = new URLSearchParams({ scope, mode, limit: String(limit) });
  if (puzzleId) params.set('puzzleId', puzzleId);
  if (difficulty) params.set('difficulty', difficulty);
  const remote = await request(`/leaderboard?${params}`);
  if (remote?.entries) return remote;
  return {
    entries: storage.getLocalScores(puzzleId, scope, currentUser()?.id, { mode, difficulty }).slice(0, limit),
    offline: true,
  };
}

export async function addFriend(username) {
  const remote = await request('/friends', { method: 'POST', body: JSON.stringify({ action: 'add', username }) });
  if (remote?.friend) return remote;
  const local = storage.findLocalUser(username);
  if (local) return { friend: local, offline: true };
  return null;
}

export async function removeScore({ scoreId, puzzleId, userId } = {}) {
  const params = new URLSearchParams();
  if (scoreId) params.set('scoreId', scoreId);
  if (puzzleId) params.set('puzzleId', puzzleId);
  const remote = await request(`/scores?${params}`, { method: 'DELETE' });
  if (remote) return remote;
  return storage.removeLocalScore({ scoreId, puzzleId, userId });
}

export async function fetchFriends() {
  const remote = await request('/friends');
  return remote?.friends ?? storage.getLocalFriends();
}
