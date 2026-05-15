const TOKEN_KEY = "api_token";

export function getToken(): string | null {
  const t = localStorage.getItem(TOKEN_KEY);
  return t?.trim() ? t.trim() : null;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function onUnauthorized(): void {
  clearToken();
  window.location.reload();
}
