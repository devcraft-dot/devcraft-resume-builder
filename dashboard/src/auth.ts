const TOKEN_KEY = "api_token";

/** Match server token_util: trim + strip wrapping quotes from Vercel/UI paste. */
export function normalizeStoredToken(raw: string): string {
  let s = raw.trim().replace(/^\ufeff/, "");
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

export function getToken(): string | null {
  const t = localStorage.getItem(TOKEN_KEY);
  if (!t?.trim()) return null;
  const n = normalizeStoredToken(t);
  return n || null;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, normalizeStoredToken(token));
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Clear token after 401. Avoid reload so login form can show an error message. */
export function onUnauthorized(): void {
  clearToken();
}
