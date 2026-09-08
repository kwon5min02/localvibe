import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { googleLogout } from '@react-oauth/google';
import { readStoredUser } from './storedUser';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(readStoredUser);

  useEffect(() => {
    const sync = () => setCurrentUser(readStoredUser());
    window.addEventListener('lv-auth-changed', sync);
    return () => window.removeEventListener('lv-auth-changed', sync);
  }, []);

  const logout = useCallback(() => {
    googleLogout();
    localStorage.removeItem('lv_access_token');
    localStorage.removeItem('lv_user');
    window.dispatchEvent(new Event('lv-auth-changed'));
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
