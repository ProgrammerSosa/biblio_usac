import { createContext, useCallback, useEffect, useState } from 'react';
import { setUnauthorizedHandler } from '../shared/api/axiosClient';
import { STORAGE_KEYS } from '../shared/authStorage';

export const AuthContext = createContext(null);

function readStoredUser() {
  const raw = localStorage.getItem(STORAGE_KEYS.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEYS.token));
  const [user, setUser] = useState(readStoredUser);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.user);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  const login = useCallback((tokenValue, userValue) => {
    localStorage.setItem(STORAGE_KEYS.token, tokenValue);
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(userValue));
    setToken(tokenValue);
    setUser(userValue);
  }, []);

  const value = { token, user, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
