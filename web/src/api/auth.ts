const TOKEN_KEY = 'v2_app_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (err) {
    console.error('Erro ao ler token do localStorage:', err);
    return null;
  }
}

export function setToken(token: string): boolean {
  try {
    localStorage.setItem(TOKEN_KEY, token.trim());
    return true;
  } catch (err) {
    console.error('Erro ao salvar token no localStorage:', err);
    return false;
  }
}

export function removeToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    console.error('Erro ao remover token do localStorage:', err);
  }
}

export function hasToken(): boolean {
  return Boolean(getToken());
}
