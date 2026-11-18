import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
} from 'react-native';
import {
  ChevronLeft,
  UserPlus,
  Sparkles,
  Share2,
  X,
  Plus,
  Trash2,
  Copy,
  Check,
  SquareCheck,
  Strikethrough,
  Underline,
  Link as LinkIcon,
  Paperclip,
  Download,
  File as FileIcon,
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { useNotes } from '../context/NoteContext';
import { useAuth } from '../context/AuthContext';
import * as Clipboard from 'expo-clipboard';
import { api } from '../lib/api';
import { merge3, mapCursor } from '../../shared/merge';
import { column, MAX_WIDTH } from '../lib/responsive';
import { FEATURES } from '../config/features';
import { confirmAction } from '../lib/confirm';

// How often an open note checks for edits: fast while someone else is in it.
const FAST_POLL_MS = 600;
const SLOW_POLL_MS = 2000;
// Wait this long after the last keystroke before saving.
const FAST_SAVE_MS = 250;
const SLOW_SAVE_MS = 600;
// Someone counts as typing if they edited within this window.
const TYPING_WINDOW_MS = 2000;
const TEXT_FIELDS = ['title', 'content'];

// Strikethrough and underline are Unicode combining marks, so formatting stays plain text
// and keeps working with live merging.
const STRIKE = '\u0336';
const UNDERLINE = '\u0332';
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function toggleMark(text, mark) {
  if (text.includes(mark)) return text.split(mark).join('');
  return [...text].map(c => (/\s/.test(c) ? c : c + mark)).join('');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const AVATAR_COLORS = ['#FF9500', '#5856D6', '#34C759', '#FF3B30', '#007AFF', '#AF52DE', '#FF2D55'];

function avatarColor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(iso).toLocaleString();
}

const NoteEditorScreen = ({ route, navigation }) => {
  const { note: initialNote, folderId, workspace: workspaceParam, openShare: openShareOnStart } = route.params || {};
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { addNote, updateNote, workspaces, listNoteShares, shareNote, unshareNote } = useNotes();

  const [noteId, setNoteId] = useState(initialNote?.id || null);
  const [title, setTitle] = useState(initialNote?.title || '');
  const [content, setContent] = useState(initialNote?.content || '');
  const [meta, setMeta] = useState(initialNote || null);
  const [status, setStatus] = useState('');

  const [isAISummarizing, setIsAISummarizing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [showAIModal, setShowAIModal] = useState(false);

  const [showShareModal, setShowShareModal] = useState(false);
  const [shares, setShares] = useState([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState('editor');
  const [shareError, setShareError] = useState('');
  const [sharing, setSharing] = useState(false);

  const access = meta?.access || 'owner';
  const readOnly = access === 'viewer';
  const isOwner = access === 'owner';
  const workspaceId = meta?.workspaceId || workspaceParam?.id || null;
  const workspace = workspaces.find(w => w.id === workspaceId) || workspaceParam || null;

  // `base` is the last version confirmed by the server. Local edits are whatever differs from it.
  const base = useRef({
    version: initialNote?.version || 0,
    title: initialNote?.title || '',
    content: initialNote?.content || '',
  });
  const local = useRef({ title: initialNote?.title || '', content: initialNote?.content || '' });
  const noteIdRef = useRef(noteId);
  const lastEditAt = useRef(0);
  const lastField = useRef('content');
  const saving = useRef(null);
  const saveTimer = useRef(null);
  const [viewers, setViewers] = useState([]);
  const viewersRef = useRef([]);

  // Cursor per field, so edits from others don't move it.
  const cursor = useRef({ title: { start: 0, end: 0 }, content: { start: 0, end: 0 } });
  const focusedField = useRef(null);
  const [selection, setSelection] = useState({});
  const titleRef = useRef(null);
  const contentRef = useRef(null);

  // Web: cursor positions to restore once React has written new text into a box.
  const pendingCursor = useRef({});
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    Object.entries(pendingCursor.current).forEach(([field, sel]) => {
      const el = (field === 'title' ? titleRef : contentRef).current;
      if (!el) return;
      if (sel.focus) el.focus();
      el.setSelectionRange(sel.start, sel.end);
    });
    pendingCursor.current = {};
  }, [title, content]);

  // Current cursor of a field. On web the text box itself is the most reliable source.
  const readCursor = field => {
    const el = (field === 'title' ? titleRef : contentRef).current;
    if (Platform.OS === 'web' && el && typeof el.selectionStart === 'number') {
      return { start: el.selectionStart, end: el.selectionEnd };
    }
    return cursor.current[field];
  };

  const setLocal = (field, value, { remote = false } = {}) => {
    const old = local.current[field];
    local.current = { ...local.current, [field]: value };
    const el = (field === 'title' ? titleRef : contentRef).current;
    const focused = Platform.OS === 'web' ? el && el === document.activeElement : focusedField.current === field;
    if (remote && old !== value && focused) {
      const c = readCursor(field);
      const next = { start: mapCursor(old, value, c.start), end: mapCursor(old, value, c.end) };
      cursor.current[field] = next;
      if (Platform.OS === 'web') {
        pendingCursor.current[field] = { ...next, focus: false };
      } else {
        setSelection(sel => ({ ...sel, [field]: next }));
      }
    }
    if (field === 'title') setTitle(value);
    else setContent(value);
  };

  const onSelect = field => e => {
    cursor.current[field] = e.nativeEvent.selection;
    if (selection[field]) setSelection(sel => ({ ...sel, [field]: undefined }));
  };

  const pendingFields = () => TEXT_FIELDS.filter(f => local.current[f] !== base.current[f]);

  // Takes the server's copy as the new base and keeps any edits typed since `sent` went out.
  const adopt = useCallback((note, sent = {}) => {
    TEXT_FIELDS.forEach(field => {
      const mine = local.current[field];
      let next;
      if (sent[field] !== undefined) {
        next = mine === sent[field] ? note[field] : merge3(sent[field], mine, note[field]);
      } else {
        next = mine === base.current[field] ? note[field] : merge3(base.current[field], mine, note[field]);
      }
      if (next !== mine) setLocal(field, next, { remote: true });
    });
    base.current = { version: note.version, title: note.title, content: note.content };
    setMeta(note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDelay = () => (viewersRef.current.length ? FAST_SAVE_MS : SLOW_SAVE_MS);

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (saving.current) {
      await saving.current;
    }
    const fields = pendingFields();
    if (!fields.length) return;
    const sent = {};
    fields.forEach(f => { sent[f] = local.current[f]; });

    const run = (async () => {
      setStatus('Saving…');
      try {
        let note;
        if (noteIdRef.current) {
          const baseText = {};
          fields.forEach(f => { baseText[f] = base.current[f]; });
          note = await updateNote(noteIdRef.current, {
            ...sent,
            baseVersion: base.current.version,
            base: baseText,
          });
        } else {
          note = await addNote({
            title: local.current.title,
            content: local.current.content,
            folderId,
            workspaceId: workspaceParam?.id,
          });
          noteIdRef.current = note.id;
          setNoteId(note.id);
        }
        adopt(note, sent);
        setStatus('Saved');
      } catch (e) {
        setStatus(`Not saved: ${e.message}`);
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
    // Anything typed while that save was in flight goes out next.
    if (pendingFields().length) saveTimer.current = setTimeout(save, saveDelay());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNote, updateNote, folderId, workspaceParam, adopt]);

  const edit = (field, value) => {
    if (readOnly) return;
    setLocal(field, value);
    lastEditAt.current = Date.now();
    lastField.current = field;
    setStatus('Editing…');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, saveDelay());
  };

  // Live updates: report presence (and where we are typing), pull the latest version, merge it in.
  useEffect(() => {
    if (!noteId) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      try {
        const typing = Date.now() - lastEditAt.current < TYPING_WINDOW_MS;
        const field = focusedField.current || lastField.current;
        const text = local.current[field] || '';
        const line = text.slice(0, readCursor(field)?.start || 0).split('\n').length;
        const { note: latest, viewers: others } = await api.post(`notes/${noteId}/presence`, {
          editing: typing,
          field,
          line,
        });
        if (stopped) return;
        viewersRef.current = others;
        setViewers(others);
        if (saving.current || latest.version <= base.current.version) {
          setMeta(m => ({ ...latest, title: m?.title ?? latest.title, content: m?.content ?? latest.content }));
        } else if (pendingFields().length) {
          save(); // the server merges our pending edits with theirs
        } else {
          adopt(latest);
        }
      } catch (e) {
        if (e.status === 404) setStatus('This note was deleted or is no longer shared with you');
      } finally {
        if (!stopped) timer = setTimeout(tick, viewersRef.current.length ? FAST_POLL_MS : SLOW_POLL_MS);
      }
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      api.del(`notes/${noteId}/presence`).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, save, adopt]);

  // Save anything pending when leaving the screen.
  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    save();
  }, [save]);

  const close = async () => {
    await save();
    navigation.goBack();
  };

  // --- sharing ---

  // --- tags ---
  const [tagDraft, setTagDraft] = useState('');
  const tags = meta?.tags || [];

  const saveTags = async next => {
    await save(); // make sure the note exists first
    if (!noteIdRef.current) {
      setStatus('Write something first, then add tags.');
      return;
    }
    try {
      const note = await updateNote(noteIdRef.current, { tags: next });
      setMeta(note);
    } catch (e) {
      setStatus(`Not saved: ${e.message}`);
    }
  };

  const addTag = () => {
    const tag = tagDraft.trim().replace(/^#/, '');
    setTagDraft('');
    if (!tag || tags.some(t => t.toLowerCase() === tag.toLowerCase())) return;
    saveTags([...tags, tag.slice(0, 40)]);
  };

  const removeTag = tag => saveTags(tags.filter(t => t !== tag));

  useEffect(() => {
    if (openShareOnStart) openShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openShare = async () => {
    setShareError('');
    setShowShareModal(true);
    await save();
    if (!noteIdRef.current) {
      setShareError('Write something first, then share the note.');
      return;
    }
    try {
      setShares(await listNoteShares(noteIdRef.current));
    } catch (e) {
      setShareError(e.message);
    }
  };

  const handleShare = async () => {
    if (!shareEmail.trim() || !noteIdRef.current) return;
    setSharing(true);
    setShareError('');
    try {
      await shareNote(noteIdRef.current, shareEmail.trim(), shareRole);
      setShareEmail('');
      setShares(await listNoteShares(noteIdRef.current));
    } catch (e) {
      setShareError(e.message);
    } finally {
      setSharing(false);
    }
  };

  const handleUnshare = async userId => {
    try {
      await unshareNote(noteIdRef.current, userId);
      setShares(await listNoteShares(noteIdRef.current));
    } catch (e) {
      setShareError(e.message);
    }
  };

  // --- formatting (applies to the note body) ---
  const { height: windowHeight } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState(0);
  const contentMinHeight = Math.max(320, windowHeight - 260);

  // Grow the body with its text so the page scrolls instead of the text box.
  // Web: measure the DOM directly (an onContentSizeChange loop would keep growing it).
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = contentRef.current;
    if (!el || !el.style) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(contentMinHeight, el.scrollHeight)}px`;
  }, [content, contentMinHeight]);

  const contentSel = () => {
    const len = local.current.content.length;
    // Web: the text box keeps its selection after a toolbar button takes focus, so read it directly.
    const el = contentRef.current;
    if (Platform.OS === 'web' && el && typeof el.selectionStart === 'number') {
      return { start: Math.min(el.selectionStart, len), end: Math.min(el.selectionEnd, len) };
    }
    const c = cursor.current.content;
    return c ? { start: Math.min(c.start, len), end: Math.min(c.end, len) } : { start: len, end: len };
  };

  const applyContent = (next, sel) => {
    edit('content', next);
    cursor.current.content = sel;
    const el = contentRef.current;
    if (Platform.OS === 'web' && el) {
      pendingCursor.current.content = { ...sel, focus: true };
    } else {
      setSelection(prev => ({ ...prev, content: { ...sel } }));
      el?.focus();
    }
  };

  const insertAtCursor = text => {
    if (readOnly) return;
    const t = local.current.content;
    const { start, end } = contentSel();
    const pos = start + text.length;
    applyContent(t.slice(0, start) + text + t.slice(end), { start: pos, end: pos });
  };

  const markSelection = mark => {
    if (readOnly) return;
    const t = local.current.content;
    const { start, end } = contentSel();
    if (start === end) {
      setStatus('Select some text first');
      return;
    }
    const middle = toggleMark(t.slice(start, end), mark);
    applyContent(t.slice(0, start) + middle + t.slice(end), { start, end: start + middle.length });
  };

  // ☐ → ☑ → plain line, for every line in the selection.
  const toggleChecklist = () => {
    if (readOnly) return;
    const t = local.current.content;
    const { start, end } = contentSel();
    const lineStart = t.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = t.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = t.length;
    const block = t
      .slice(lineStart, lineEnd)
      .split('\n')
      .map(line => (line.startsWith('☐ ') ? `☑ ${line.slice(2)}` : line.startsWith('☑ ') ? line.slice(2) : `☐ ${line}`))
      .join('\n');
    const pos = lineStart + block.length;
    applyContent(t.slice(0, lineStart) + block + t.slice(lineEnd), { start: pos, end: pos });
  };

  // --- links ---
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkError, setLinkError] = useState('');

  const openLinkModal = () => {
    const { start, end } = contentSel();
    setLinkLabel(local.current.content.slice(start, end).trim());
    setLinkUrl('');
    setLinkError('');
    setShowLinkModal(true);
  };

  const insertLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^[a-z][\w+.-]*:/i.test(url)) url = `https://${url}`;
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) {
      setLinkError('Enter a web address, for example example.com');
      return;
    }
    const label = linkLabel.trim();
    setShowLinkModal(false);
    insertAtCursor(label ? `${label} (${url})` : url);
  };

  const links = [...new Set(content.match(URL_RE) || [])].slice(0, 12);

  // --- attachments ---
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const loadAttachments = useCallback(async () => {
    if (!noteIdRef.current) return;
    try {
      const { attachments: list } = await api.get(`notes/${noteIdRef.current}/attachments`);
      setAttachments(list);
    } catch {
      // keep the current list
    }
  }, []);

  useEffect(() => {
    loadAttachments();
  }, [noteId, meta?.attachmentCount, loadAttachments]);

  const pickFile = async () => {
    if (readOnly) return;
    if (Platform.OS !== 'web') {
      setStatus('Attaching files works in the web app for now.');
      return;
    }
    await save();
    if (!noteIdRef.current) {
      setStatus('Write something first, then attach files.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        setStatus('Files can be up to 3 MB');
        return;
      }
      setUploading(true);
      setStatus(`Uploading ${file.name}…`);
      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('Could not read the file'));
          reader.readAsDataURL(file);
        });
        await api.post(`notes/${noteIdRef.current}/attachments`, { name: file.name, type: file.type, data });
        await loadAttachments();
        setStatus('File attached');
      } catch (e) {
        setStatus(`Upload failed: ${e.message}`);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const downloadAttachment = file => {
    const url = `${process.env.EXPO_PUBLIC_API_URL || ''}/api/attachments/${file.id}`;
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
    } else {
      Linking.openURL(url);
    }
  };

  const removeAttachment = async file => {
    const ok = await confirmAction('Remove file?', `"${file.name}" will be removed from this note.`, 'Remove');
    if (!ok) return;
    try {
      await api.del(`attachments/${file.id}`);
      await loadAttachments();
    } catch (e) {
      setStatus(e.message);
    }
  };

  // --- AI summary ---
  const [aiError, setAiError] = useState('');
  const [copied, setCopied] = useState(false);

  const summaryAsText = result => [result.summary, '', ...result.points.map(point => `• ${point}`)].join('\n').trim();

  const handleAISummarize = async () => {
    setShowAIModal(true);
    setAiError('');
    setAiResult(null);
    setCopied(false);
    setIsAISummarizing(true);
    try {
      await save(); // summarize what is on screen
      if (!noteIdRef.current) throw new Error('Write something first, then ask for a summary.');
      setAiResult(await api.post(`notes/${noteIdRef.current}/summary`));
    } catch (e) {
      setAiError(e.message);
    } finally {
      setIsAISummarizing(false);
    }
  };

  const copySummary = async () => {
    if (!aiResult) return;
    try {
      await Clipboard.setStringAsync(summaryAsText(aiResult));
      setCopied(true);
    } catch {
      setAiError('Copy failed. Select the text and copy it instead.');
    }
  };

  const insertAISummary = () => {
    if (!aiResult) return;
    const text = local.current.content;
    const gap = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    edit('content', `${text}${gap}Summary\n${summaryAsText(aiResult)}\n`);
    setShowAIModal(false);
  };

  const editedByOther = meta?.updatedBy && meta.updatedBy !== user?.id;
  const typers = viewers.filter(v => v.editing);
  const statusText = status && status !== 'Saved'
    ? status
    : editedByOther
      ? `Edited by ${meta.updatedByName} ${timeAgo(meta.updatedAt)}`
      : status;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
          <TouchableOpacity onPress={close} style={[styles.backButton, { backgroundColor: colors.lightGray }]}>
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>

          {workspace && (
            <View style={styles.collaborationInfo}>
               <View style={[styles.workspaceDot, { backgroundColor: workspace.color }]} />
               <Text style={[styles.workspaceNameText, { color: colors.textSecondary }]} numberOfLines={1}>{workspace.name}</Text>
            </View>
          )}
        </View>

        <View style={styles.headerRight}>
          {viewers.length > 0 && (
            <View style={styles.activeMembers} accessibilityLabel={`Also here: ${viewers.map(v => v.name).join(', ')}`}>
               {viewers.slice(0, 3).map((v, i) => (
                 <View key={v.id} style={[styles.activeAvatar, { backgroundColor: avatarColor(v.id), marginLeft: i === 0 ? 0 : -8, borderColor: v.editing ? colors.success : colors.card }]}>
                    <Text style={styles.activeAvatarText}>{v.name[0]}</Text>
                 </View>
               ))}
               {viewers.length > 3 && (
                 <View style={[styles.activeAvatar, { backgroundColor: colors.placeholder, marginLeft: -8, borderColor: colors.card }]}>
                    <Text style={styles.activeAvatarText}>+{viewers.length - 3}</Text>
                 </View>
               )}
            </View>
          )}
          <TouchableOpacity onPress={openShare} style={{ marginRight: 15 }}>
            <Share2 size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={close}>
            <Text style={[styles.saveText, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Share Modal */}
      <Modal
        visible={showShareModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowShareModal(false)}
      >
        <View style={styles.modalOverlayCenter}>
          <View style={[styles.shareModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Share Note</Text>
              <TouchableOpacity onPress={() => setShowShareModal(false)}>
                <X size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {isOwner ? (
              <>
                <Text style={[styles.shareToggleDesc, { color: colors.textSecondary, marginBottom: 10 }]}>
                  Invite someone by the email they signed up with. Editors can write with you in real time.
                </Text>
                <TextInput
                  style={[styles.shareInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.lightGray }]}
                  placeholder="friend@email.com"
                  placeholderTextColor={colors.placeholder}
                  value={shareEmail}
                  onChangeText={setShareEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onSubmitEditing={handleShare}
                />
                <View style={styles.roleRow}>
                  {['editor', 'viewer'].map(r => (
                    <TouchableOpacity
                      key={r}
                      onPress={() => setShareRole(r)}
                      style={[styles.rolePill, { borderColor: colors.border }, shareRole === r && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    >
                      <Text style={{ color: shareRole === r ? '#FFF' : colors.text, fontWeight: '600' }}>
                        {r === 'editor' ? 'Can edit' : 'Can view'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[styles.inviteBtn, { backgroundColor: colors.primary, opacity: sharing ? 0.6 : 1 }]}
                    onPress={handleShare}
                    disabled={sharing}
                  >
                    {sharing ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '700' }}>Invite</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={[styles.shareToggleDesc, { color: colors.textSecondary, marginBottom: 10 }]}>
                Shared with you by {meta?.ownerName}. {readOnly ? 'You can view this note.' : 'You can edit this note.'}
              </Text>
            )}

            {shareError ? <Text style={styles.shareErrorText}>{shareError}</Text> : null}

            {shares.map(s => (
              <View key={s.id} style={[styles.shareRow, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{s.name}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{s.email} · {s.role === 'editor' ? 'Can edit' : 'Can view'}</Text>
                </View>
                {(isOwner || s.id === user?.id) && (
                  <TouchableOpacity onPress={() => handleUnshare(s.id)}>
                    <Trash2 size={18} color={colors.danger || '#FF3B30'} />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <TouchableOpacity
              style={[styles.closeModalBtn, { backgroundColor: colors.lightGray }]}
              onPress={() => setShowShareModal(false)}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Toolbar */}
      <View style={[styles.toolbar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.toolbarItem} onPress={openShare}>
          <UserPlus size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={[styles.statusText, { color: colors.textSecondary }]} numberOfLines={1}>
          {readOnly ? 'View only' : statusText}
        </Text>

        {FEATURES.aiSummary && (
          <TouchableOpacity style={[styles.aiButton, { backgroundColor: colors.primary }]} onPress={handleAISummarize} accessibilityLabel="Summarize this note with AI">
            <Sparkles size={18} color={colors.white} />
            <Text style={styles.aiButtonText}>Summarize</Text>
          </TouchableOpacity>
        )}
        {FEATURES.aiAssistant && (
          <TouchableOpacity style={[styles.aiButton, { backgroundColor: colors.primary, marginLeft: 8 }]} onPress={() => navigation.navigate('AINote', { title, content })}>
            <Sparkles size={18} color={colors.white} />
            <Text style={styles.aiButtonText}>AI Assistant</Text>
          </TouchableOpacity>
        )}
      </View>

      {!readOnly && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.formatBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
          contentContainerStyle={styles.formatBarContent}
          keyboardShouldPersistTaps="always"
        >
          {[
            { key: 'check', label: 'Checklist', icon: <SquareCheck size={18} color={colors.text} />, onPress: toggleChecklist },
            { key: 'strike', label: 'Strikethrough', icon: <Strikethrough size={18} color={colors.text} />, onPress: () => markSelection(STRIKE) },
            { key: 'underline', label: 'Underline', icon: <Underline size={18} color={colors.text} />, onPress: () => markSelection(UNDERLINE) },
            { key: 'yes', label: 'Insert check mark', text: '✓', color: colors.success, onPress: () => insertAtCursor('✓ ') },
            { key: 'no', label: 'Insert cross mark', text: '✗', color: colors.danger, onPress: () => insertAtCursor('✗ ') },
            { key: 'link', label: 'Add link', icon: <LinkIcon size={18} color={colors.text} />, onPress: openLinkModal },
            { key: 'file', label: 'Attach file', icon: uploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Paperclip size={18} color={colors.text} />, onPress: pickFile },
          ].map(b => (
            <TouchableOpacity
              key={b.key}
              onPress={b.onPress}
              disabled={b.key === 'file' && uploading}
              accessibilityLabel={b.label}
              style={[styles.formatButton, { backgroundColor: colors.lightGray }]}
            >
              {b.icon || <Text style={{ color: b.color, fontSize: 18, fontWeight: '800' }}>{b.text}</Text>}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {typers.length > 0 && (
        <View style={[styles.typingLine, { backgroundColor: avatarColor(typers[0].id) }]} />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.editorContainer}
      >
        <ScrollView contentContainerStyle={[styles.scrollContent, column(MAX_WIDTH.reading)]} showsVerticalScrollIndicator={false}>
          {typers.length > 0 && (
            <View style={styles.typingBar} accessibilityLiveRegion="polite">
              {typers.map(t => (
                <View key={t.id} style={[styles.typingTag, { backgroundColor: avatarColor(t.id) }]}>
                  <Text style={styles.typingTagText} numberOfLines={1}>
                    {t.name.split(' ')[0]} · {t.field === 'title' ? 'title' : `line ${t.line || 1}`}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <TextInput
            style={[styles.titleInput, { color: colors.text }]}
            ref={titleRef}
            placeholder="Note Title"
            placeholderTextColor={colors.placeholder}
            value={title}
            onChangeText={v => edit('title', v)}
            onSelectionChange={onSelect('title')}
            selection={selection.title}
            onFocus={() => { focusedField.current = 'title'; }}
            onBlur={() => { focusedField.current = null; }}
            editable={!readOnly}
            multiline
          />
          <View style={styles.tagRow}>
            {tags.map(tag => (
              <View key={tag} style={[styles.tagChip, { backgroundColor: colors.primary + '14' }]}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>#{tag}</Text>
                {!readOnly && (
                  <TouchableOpacity onPress={() => removeTag(tag)} accessibilityLabel={`Remove tag ${tag}`} style={{ marginLeft: 6 }}>
                    <X size={14} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {!readOnly && (
              <TextInput
                style={[styles.tagInput, { color: colors.text, borderColor: colors.border }]}
                placeholder="Add tag"
                placeholderTextColor={colors.placeholder}
                value={tagDraft}
                onChangeText={setTagDraft}
                onSubmitEditing={addTag}
                onBlur={addTag}
                autoCapitalize="none"
                returnKeyType="done"
              />
            )}
          </View>
          <TextInput
            style={[styles.contentInput, { color: colors.text, minHeight: contentMinHeight }, Platform.OS !== 'web' && { height: Math.max(contentMinHeight, contentHeight) }]}
            placeholder="Write something in English or ภาษาไทย..."
            placeholderTextColor={colors.placeholder}
            value={content}
            ref={contentRef}
            onChangeText={v => edit('content', v)}
            onContentSizeChange={e => {
              if (Platform.OS === 'web') return;
              const h = Math.round(e.nativeEvent.contentSize.height);
              setContentHeight(prev => (Math.abs(prev - h) > 2 ? h : prev));
            }}
            onSelectionChange={onSelect('content')}
            selection={selection.content}
            onFocus={() => { focusedField.current = 'content'; }}
            onBlur={() => { focusedField.current = null; }}
            editable={!readOnly}
            multiline
            textAlignVertical="top"
          />

          {links.length > 0 && (
            <View style={styles.extraSection}>
              <Text style={[styles.extraTitle, { color: colors.textSecondary }]}>Links</Text>
              <View style={styles.chipRow}>
                {links.map(url => (
                  <TouchableOpacity key={url} onPress={() => Linking.openURL(url)} style={[styles.linkChip, { borderColor: colors.border }]}>
                    <LinkIcon size={14} color={colors.primary} />
                    <Text style={[styles.linkChipText, { color: colors.primary }]} numberOfLines={1}>
                      {url.replace(/^https?:\/\//, '')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {attachments.length > 0 && (
            <View style={styles.extraSection}>
              <Text style={[styles.extraTitle, { color: colors.textSecondary }]}>Files</Text>
              {attachments.map(file => (
                <View key={file.id} style={[styles.fileRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <FileIcon size={20} color={colors.primary} />
                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>{file.name}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                      {formatSize(file.size)}{file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => downloadAttachment(file)} accessibilityLabel={`Download ${file.name}`} style={styles.fileAction}>
                    <Download size={18} color={colors.text} />
                  </TouchableOpacity>
                  {(isOwner || file.uploadedBy === user?.id) && (
                    <TouchableOpacity onPress={() => removeAttachment(file)} accessibilityLabel={`Remove ${file.name}`} style={styles.fileAction}>
                      <Trash2 size={18} color={colors.danger || '#FF3B30'} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add Link Modal */}
      <Modal visible={showLinkModal} transparent animationType="fade" onRequestClose={() => setShowLinkModal(false)}>
        <View style={styles.modalOverlayCenter}>
          <View style={[styles.shareModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Add link</Text>
              <TouchableOpacity onPress={() => setShowLinkModal(false)}>
                <X size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.shareInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.lightGray }]}
              placeholder="example.com"
              placeholderTextColor={colors.placeholder}
              value={linkUrl}
              onChangeText={setLinkUrl}
              autoCapitalize="none"
              keyboardType="url"
              autoFocus
              onSubmitEditing={insertLink}
            />
            <TextInput
              style={[styles.shareInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.lightGray, marginTop: 10 }]}
              placeholder="Text to show (optional)"
              placeholderTextColor={colors.placeholder}
              value={linkLabel}
              onChangeText={setLinkLabel}
              onSubmitEditing={insertLink}
            />
            {linkError ? <Text style={styles.shareErrorText}>{linkError}</Text> : null}
            <TouchableOpacity style={[styles.closeModalBtn, { backgroundColor: colors.primary }]} onPress={insertLink}>
              <Text style={{ color: '#FFF', fontWeight: '700' }}>Add link</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI Summary Modal */}
      <Modal
        visible={showAIModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAIModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <View style={styles.aiHeaderTitle}>
                <Sparkles size={24} color={colors.primary} />
                <Text style={[styles.modalTitle, { color: colors.text, marginLeft: 10 }]}>AI Summary</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAIModal(false)}>
                <X size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {isAISummarizing ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Reading your note…</Text>
              </View>
            ) : aiError ? (
              <View style={styles.loadingContainer}>
                <Text style={[styles.aiText, { color: colors.text, textAlign: 'center' }]}>{aiError}</Text>
                <TouchableOpacity style={[styles.aiAction, { borderColor: colors.border, marginTop: 20 }]} onPress={handleAISummarize}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : aiResult ? (
              <>
                <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
                  <Text style={[styles.aiText, { color: colors.text, marginBottom: 16 }]} selectable>{aiResult.summary}</Text>
                  {aiResult.points.map((point, index) => (
                    <View key={index} style={styles.aiPoint}>
                      <View style={[styles.topicDot, { backgroundColor: colors.primary, marginTop: 9 }]} />
                      <Text style={[styles.aiPointText, { color: colors.text }]} selectable>{point}</Text>
                    </View>
                  ))}
                </ScrollView>

                <View style={styles.aiActions}>
                  <TouchableOpacity style={[styles.aiAction, { borderColor: colors.border }]} onPress={copySummary}>
                    {copied ? <Check size={18} color={colors.success} /> : <Copy size={18} color={colors.text} />}
                    <Text style={[styles.aiActionText, { color: colors.text }]}>{copied ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                  {!readOnly && (
                    <TouchableOpacity style={[styles.aiAction, { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={insertAISummary}>
                      <Plus size={18} color="#FFF" />
                      <Text style={[styles.aiActionText, { color: '#FFF' }]}>Add to note</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.aiAction, { borderColor: colors.border }]} onPress={() => setShowAIModal(false)}>
                    <Text style={[styles.aiActionText, { color: colors.textSecondary, marginLeft: 0 }]}>Close</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  formatBar: {
    flexGrow: 0,
    borderBottomWidth: 1,
  },
  formatBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  formatButton: {
    width: 40,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  extraSection: {
    marginTop: 24,
  },
  extraTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    maxWidth: 280,
  },
  linkChipText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '600',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  fileAction: {
    padding: 6,
    marginLeft: 4,
  },
  typingLine: {
    height: 3,
    width: '100%',
  },
  typingBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  typingTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
    maxWidth: 220,
  },
  typingTagText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  aiPoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  aiPointText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    marginLeft: 10,
  },
  aiActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
  },
  aiAction: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 10,
    marginBottom: 8,
  },
  aiActionText: {
    fontWeight: '700',
    fontSize: 15,
    marginLeft: 8,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: -8,
    marginBottom: 20,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 8,
    marginBottom: 8,
  },
  tagInput: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 90,
    marginBottom: 8,
    fontSize: 14,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    marginHorizontal: 8,
  },
  shareInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  rolePill: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  inviteBtn: {
    marginLeft: 'auto',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 72,
    alignItems: 'center',
  },
  shareErrorText: {
    color: '#FF3B30',
    fontSize: 13,
    marginBottom: 8,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  collaborationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    maxWidth: 150,
  },
  workspaceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  workspaceNameText: {
    fontSize: 12,
    fontWeight: '600',
  },
  activeMembers: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  activeAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeAvatarText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveText: {
    fontWeight: '800',
    fontSize: 18,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  toolbarItem: {
    padding: 10,
    marginRight: 8,
  },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginLeft: 'auto',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  aiButtonText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '700',
    marginLeft: 8,
  },
  editorContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 10,
  },
  titleInput: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 20,
  },
  contentInput: {
    fontSize: 18,
    lineHeight: 28,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    padding: 24,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    minHeight: '60%',
  },
  aiHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 50,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    fontWeight: '600',
  },
  aiSection: {
    padding: 20,
    borderRadius: 20,
    marginTop: 10,
  },
  aiLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  aiText: {
    fontSize: 16,
    lineHeight: 24,
  },
  topicsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  topicItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginRight: 10,
    marginBottom: 10,
  },
  topicDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  topicText: {
    fontSize: 14,
    fontWeight: '600',
  },
  insertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    marginTop: 30,
    marginBottom: 40,
  },
  insertBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    marginLeft: 10,
  },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  shareModalContent: {
    maxWidth: 480,
    width: '100%',
    borderRadius: 24,
    padding: 24,
  },
  shareToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  shareToggleLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  shareToggleDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  shareLinkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  shareLinkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  copyIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  closeModalBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  }
});


export default NoteEditorScreen;
