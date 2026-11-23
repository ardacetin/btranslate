/**
 * REST client for the BTranslate API. The JWT lives in localStorage under the
 * same keys the previous panel used, so existing sessions survive the update.
 */

export const TOKEN_KEY = 'bt_token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
}
export function clearSession() {
  try {
    ['bt_token', 'bt_role', 'bt_user', 'bt_event_code', 'bt_event_name'].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/** Server error codes → Turkish messages (falls back to the server text). */
export const ERR_TR: Record<string, string> = {
  invalid_username: 'Geçersiz kullanıcı adı (3-64 karakter: harf, rakam, . _ -)',
  password_too_short: 'Parola en az 8 karakter olmalı',
  password_too_long: 'Parola çok uzun (en fazla 72 bayt)',
  password_equals_username: 'Parola kullanıcı adıyla aynı olamaz',
  username_taken: 'Bu kullanıcı adı zaten kayıtlı',
  not_found: 'Kullanıcı bulunamadı',
  invalid_id: 'Geçersiz kayıt',
  invalid_role: 'Geçersiz rol',
  invalid_status: 'Geçersiz durum',
  self_role: 'Kendi rolünüzü değiştiremezsiniz',
  self_disable: 'Kendi hesabınızı devre dışı bırakamazsınız',
  self_delete: 'Kendinizi silemezsiniz',
  last_admin: 'En az bir aktif yönetici kalmalı',
  wrong_current_password: 'Mevcut parola hatalı',
  password_unchanged: 'Yeni parola mevcut paroladan farklı olmalı',
  account_disabled: 'Bu hesap devre dışı bırakılmış. Bir yöneticiye başvurun.',
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Called when the server rejects our token (401) — the app signs out. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError('Oturum sona erdi', 401);
  }
  return res;
}

/** Fetch + JSON with a real status check (failures never look like success). */
export async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const code = typeof data.code === 'string' ? data.code : undefined;
    const msg = (code && ERR_TR[code]) || (typeof data.error === 'string' ? data.error : '') ||
      (res.status === 429 ? 'Çok fazla istek. Biraz sonra tekrar deneyin.' : 'İşlem başarısız');
    throw new ApiError(msg, res.status, code);
  }
  return data as T;
}

export function jsonBody(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Authenticated file download (keeps the Authorization header; no token in URLs). */
export async function download(path: string) {
  const res = await api(path);
  if (!res.ok) throw new ApiError('İndirilemedi', res.status);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^"]+)"?/);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ── Types shared by views ───────────────────────────────────────────────
export interface Me { id: number; username: string; display_name: string; role: 'admin' | 'user'; }
export interface User {
  id: number; username: string; display_name: string; role: 'admin' | 'user';
  is_active: boolean; last_login_at: string | null; created_at: string | null;
}
export interface DayCount { day: string; count: number; }
export interface HistoryRow { time: string; original: string; translation: string; source: string; target: string; }
export interface LogRow { id: number; level: string; message: string; created_at: string; }
export interface Settings {
  voice_engine: 'deepl' | 'openai';
  flush_on_punctuation: boolean;
  max_words: number;
  silence_ms: number;
}
export interface Direction { id: string; source: string; target: string; label: string; }
