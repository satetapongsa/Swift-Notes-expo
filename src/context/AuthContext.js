import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.get('auth/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const { user: me } = await api.post('auth/login', { email, password });
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const { user: me } = await api.post('auth/register', { name, email, password });
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const updateProfile = useCallback(async ({ name }) => {
    const { user: me } = await api.patch('auth/me', { name });
    setUser(me);
    return me;
  }, []);

  // `data` is base64 without the data: prefix.
  const uploadAvatar = useCallback(async (type, data) => {
    const { user: me } = await api.post('auth/me/avatar', { type, data });
    setUser(me);
    return me;
  }, []);

  const removeAvatar = useCallback(async () => {
    const { user: me } = await api.del('auth/me/avatar');
    setUser(me);
    return me;
  }, []);

  return (
    <AuthContext.Provider value={{ user, checking, refresh, login, register, logout, updateProfile, uploadAvatar, removeAvatar }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
