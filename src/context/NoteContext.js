import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';

const NoteContext = createContext();

// How often the app asks the server for changes made by other people.
const SYNC_INTERVAL_MS = 3000;

const DEFAULT_FOLDER = {
  id: 'default',
  name: 'All Notes',
  iconName: 'folder',
  color: '#007AFF',
  modified: 'All your notes',
  hasStar: true,
};

const AVATAR_COLORS = ['#FF9500', '#5856D6', '#34C759', '#FF3B30', '#007AFF', '#AF52DE', '#FF2D55'];

function avatarColor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Adds the display fields the screens expect.
function decorateNote(n) {
  const text = (n.content || '').replace(/\s+/g, ' ').trim();
  return {
    ...n,
    snippet: text.slice(0, 140),
    date: formatDate(n.updatedAt),
    isPinned: n.pinned,
    isShared: n.access !== 'owner' || n.shareCount > 0 || Boolean(n.workspaceId),
  };
}

function decorateWorkspace(ws) {
  return {
    ...ws,
    role: capitalize(ws.role),
    members: (ws.members || []).map(m => ({ ...m, role: capitalize(m.role), avatar: avatarColor(m.id) })),
  };
}

export const NoteProvider = ({ children }) => {
  const { user } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [rawNotes, setRawNotes] = useState([]);
  const [rawFolders, setRawFolders] = useState([]);
  const [rawWorkspaces, setRawWorkspaces] = useState([]);
  const [passcode, setPasscode] = useState(null);
  const [passlockEnabled, setPasslockEnabled] = useState(false);
  const cursor = useRef(null);

  const applySync = useCallback(data => {
    if (data.unchanged) return;
    cursor.current = data.cursor;
    setRawNotes(data.notes);
    setRawFolders(data.folders);
    setRawWorkspaces(data.workspaces);
  }, []);

  const sync = useCallback(async () => {
    const q = cursor.current ? `?cursor=${cursor.current}` : '';
    const data = await api.get(`sync${q}`);
    applySync(data);
  }, [applySync]);

  // Load everything after sign-in, then keep polling while the app is open.
  useEffect(() => {
    cursor.current = null;
    setRawNotes([]);
    setRawFolders([]);
    setRawWorkspaces([]);
    if (!user) {
      setIsLoaded(true);
      return undefined;
    }

    let active = true;
    setIsLoaded(false);
    sync()
      .catch(err => console.warn('Sync failed:', err.message))
      .finally(() => active && setIsLoaded(true));

    const timer = setInterval(() => {
      if (AppState.currentState === 'active') sync().catch(() => {});
    }, SYNC_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, sync]);

  const replaceNote = useCallback(note => {
    setRawNotes(prev => {
      const exists = prev.some(n => n.id === note.id);
      return exists ? prev.map(n => (n.id === note.id ? note : n)) : [note, ...prev];
    });
  }, []);

  // --- notes ---

  const addNote = useCallback(async ({ title = '', content = '', folderId, workspaceId, tags, pinned } = {}) => {
    const { note } = await api.post('notes', {
      title,
      content,
      folderId: folderId && folderId !== 'default' ? folderId : null,
      workspaceId: workspaceId || null,
      tags,
      pinned,
    });
    replaceNote(note);
    return decorateNote(note);
  }, [replaceNote]);

  const updateNote = useCallback(async (id, updates) => {
    const { note } = await api.patch(`notes/${id}`, updates);
    replaceNote(note);
    return decorateNote(note);
  }, [replaceNote]);

  const getNote = useCallback(async id => {
    const { note } = await api.get(`notes/${id}`);
    replaceNote(note);
    return decorateNote(note);
  }, [replaceNote]);

  const deleteNote = useCallback(async id => {
    await api.del(`notes/${id}`);
    sync().catch(() => {});
  }, [sync]);

  const restoreFromTrash = useCallback(async id => {
    const { note } = await api.post(`notes/${id}/restore`);
    replaceNote(note);
  }, [replaceNote]);

  const deleteForever = useCallback(async id => {
    await api.del(`notes/${id}?permanent=1`);
    setRawNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  const emptyTrash = useCallback(async () => {
    await api.del('trash');
    setRawNotes(prev => prev.filter(n => !n.deletedAt));
  }, []);

  // --- sharing ---

  const listNoteShares = useCallback(async noteId => (await api.get(`notes/${noteId}/shares`)).shares, []);

  const shareNote = useCallback(async (noteId, email, role = 'editor') => {
    const { share } = await api.post(`notes/${noteId}/shares`, { email, role });
    sync().catch(() => {});
    return share;
  }, [sync]);

  const unshareNote = useCallback(async (noteId, userId) => {
    await api.del(`notes/${noteId}/shares/${userId}`);
    sync().catch(() => {});
  }, [sync]);

  // --- folders ---

  const addFolder = useCallback(async folder => {
    const payload = typeof folder === 'string' ? { name: folder } : folder;
    const { folder: created } = await api.post('folders', payload);
    setRawFolders(prev => [...prev, created]);
    return created;
  }, []);

  const deleteFolder = useCallback(async id => {
    if (id === 'default') return;
    await api.del(`folders/${id}`);
    setRawFolders(prev => prev.filter(f => f.id !== id));
  }, []);

  // --- workspaces ---

  const replaceWorkspace = useCallback(ws => {
    setRawWorkspaces(prev => {
      const exists = prev.some(w => w.id === ws.id);
      return exists ? prev.map(w => (w.id === ws.id ? ws : w)) : [ws, ...prev];
    });
  }, []);

  const addWorkspace = useCallback(async ({ name, iconName, color }) => {
    const { workspace } = await api.post('workspaces', { name, iconName, color });
    replaceWorkspace(workspace);
    return decorateWorkspace(workspace);
  }, [replaceWorkspace]);

  const updateWorkspace = useCallback(async (id, fields) => {
    const allowed = {};
    ['name', 'iconName', 'color'].forEach(k => {
      if (fields[k] !== undefined) allowed[k] = fields[k];
    });
    if (!Object.keys(allowed).length) return null;
    const { workspace } = await api.patch(`workspaces/${id}`, allowed);
    replaceWorkspace(workspace);
    return decorateWorkspace(workspace);
  }, [replaceWorkspace]);

  const deleteWorkspace = useCallback(async id => {
    await api.del(`workspaces/${id}`);
    setRawWorkspaces(prev => prev.filter(w => w.id !== id));
    sync().catch(() => {});
  }, [sync]);

  const addMemberToWorkspace = useCallback(async (id, email, role = 'editor') => {
    const { workspace } = await api.post(`workspaces/${id}/members`, { email, role });
    replaceWorkspace(workspace);
    return decorateWorkspace(workspace);
  }, [replaceWorkspace]);

  const removeMemberFromWorkspace = useCallback(async (id, userId) => {
    await api.del(`workspaces/${id}/members/${userId}`);
    sync().catch(() => {});
  }, [sync]);

  // --- derived data for the screens ---

  const notes = useMemo(() => rawNotes.filter(n => !n.deletedAt).map(decorateNote), [rawNotes]);
  const trash = useMemo(
    () => ({ workspaces: [], notes: rawNotes.filter(n => n.deletedAt).map(decorateNote) }),
    [rawNotes],
  );
  const folders = useMemo(() => [DEFAULT_FOLDER, ...rawFolders], [rawFolders]);
  const workspaces = useMemo(() => rawWorkspaces.map(decorateWorkspace), [rawWorkspaces]);

  const getNoteCount = useCallback(
    folderId => (folderId === 'default' ? notes.length : notes.filter(n => n.folderId === folderId).length),
    [notes],
  );

  return (
    <NoteContext.Provider
      value={{
        folders,
        notes,
        workspaces,
        trash,
        passcode,
        passlockEnabled,
        setPasscode,
        setPasslockEnabled,
        isLoaded,
        sync,
        addFolder,
        deleteFolder,
        addNote,
        getNote,
        updateNote,
        deleteNote,
        restoreFromTrash,
        deleteForever,
        emptyTrash,
        listNoteShares,
        shareNote,
        unshareNote,
        addWorkspace,
        updateWorkspace,
        deleteWorkspace,
        addMemberToWorkspace,
        removeMemberFromWorkspace,
        getNoteCount,
      }}
    >
      {children}
    </NoteContext.Provider>
  );
};

export const useNotes = () => useContext(NoteContext);
