import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'react-native';
import {
  ChevronLeft,
  UserPlus,
  Sparkles,
  Share2,
  BrainCircuit,
  X,
  Plus,
  Trash2,
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { useNotes } from '../context/NoteContext';
import { useAuth } from '../context/AuthContext';
import { AIService } from '../lib/AIService';
import { api } from '../lib/api';
import { merge3 } from '../../shared/merge';
import { column, MAX_WIDTH } from '../lib/responsive';
import { FEATURES } from '../config/features';

// How often an open note checks for edits made by other people.
const LIVE_POLL_MS = 2000;
// Wait this long after the last keystroke before saving.
const SAVE_DELAY_MS = 600;
// Remote changes are only applied when the local user has been idle this long.
const IDLE_BEFORE_REMOTE_MS = 1500;
// Someone counts as typing if they edited within this window.
const TYPING_WINDOW_MS = 3000;
const TEXT_FIELDS = ['title', 'content'];

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
  const saving = useRef(null);
  const saveTimer = useRef(null);
  const [viewers, setViewers] = useState([]);

  const setLocal = (field, value) => {
    local.current = { ...local.current, [field]: value };
    if (field === 'title') setTitle(value);
    else setContent(value);
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
      if (next !== mine) setLocal(field, next);
    });
    base.current = { version: note.version, title: note.title, content: note.content };
    setMeta(note);
  }, []);

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
    if (pendingFields().length) saveTimer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [addNote, updateNote, folderId, workspaceParam, adopt]);

  const edit = (field, value) => {
    if (readOnly) return;
    setLocal(field, value);
    lastEditAt.current = Date.now();
    setStatus('Editing…');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY_MS);
  };

  // Live updates: report presence, pull the latest version and merge it in.
  useEffect(() => {
    if (!noteId) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const typing = Date.now() - lastEditAt.current < TYPING_WINDOW_MS;
        const { note: latest, viewers: others } = await api.post(`notes/${noteId}/presence`, { editing: typing });
        if (stopped) return;
        setViewers(others);
        if (saving.current || latest.version <= base.current.version) {
          setMeta(latest);
          return;
        }
        if (pendingFields().length) {
          save(); // the server merges our pending edits with theirs
        } else if (Date.now() - lastEditAt.current >= IDLE_BEFORE_REMOTE_MS) {
          adopt(latest);
        }
      } catch (e) {
        if (e.status === 404) setStatus('This note was deleted or is no longer shared with you');
      }
    };
    tick();
    const timer = setInterval(tick, LIVE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      api.del(`notes/${noteId}/presence`).catch(() => {});
    };
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

  // --- AI (local mock for now) ---

  const handleAISummarize = async () => {
    setIsAISummarizing(true);
    setShowAIModal(true);
    try {
      setAiResult(await AIService.summarizeNote(content));
    } catch (error) {
      setShareError('');
      setShowAIModal(false);
      setStatus(error.message);
    } finally {
      setIsAISummarizing(false);
    }
  };

  const insertAISummary = () => {
    if (!aiResult) return;
    const summaryText = `\n\n--- AI Summary ---\n${aiResult.summary}\n\nKey Topics:\n${aiResult.topics.map(t => `• ${t}`).join('\n')}`;
    edit('content', content + summaryText);
    setShowAIModal(false);
  };

  const editedByOther = meta?.updatedBy && meta.updatedBy !== user?.id;
  const typingNames = viewers.filter(v => v.editing).map(v => v.name.split(' ')[0]);
  const statusText = status && status !== 'Saved' && status !== 'Editing…'
    ? status
    : typingNames.length
      ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`
      : status === 'Editing…'
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
        {FEATURES.aiAssistant && (
          <TouchableOpacity style={styles.toolbarItem} onPress={handleAISummarize} disabled={readOnly}>
            <BrainCircuit size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
        <Text style={[styles.statusText, { color: colors.textSecondary }]} numberOfLines={1}>
          {readOnly ? 'View only' : statusText}
        </Text>

        {FEATURES.aiAssistant && (
          <TouchableOpacity style={[styles.aiButton, { backgroundColor: colors.primary }]} onPress={() => navigation.navigate('AINote', { title, content })}>
            <Sparkles size={18} color={colors.white} />
            <Text style={styles.aiButtonText}>AI Assistant</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.editorContainer}
      >
        <ScrollView contentContainerStyle={[styles.scrollContent, column(MAX_WIDTH.reading)]} showsVerticalScrollIndicator={false}>
          <TextInput
            style={[styles.titleInput, { color: colors.text }]}
            placeholder="Note Title"
            placeholderTextColor={colors.placeholder}
            value={title}
            onChangeText={v => edit('title', v)}
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
            style={[styles.contentInput, { color: colors.textSecondary }]}
            placeholder="Write something in English or ภาษาไทย..."
            placeholderTextColor={colors.placeholder}
            value={content}
            onChangeText={v => edit('content', v)}
            editable={!readOnly}
            multiline
            textAlignVertical="top"
          />
        </ScrollView>
      </KeyboardAvoidingView>

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
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Analysing your note...</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={[styles.aiSection, { backgroundColor: colors.primary + '10' }]}>
                  <Text style={[styles.aiLabel, { color: colors.primary }]}>SUMMARY</Text>
                  <Text style={[styles.aiText, { color: colors.text }]}>{aiResult?.summary}</Text>
                </View>

                <Text style={[styles.aiLabel, { color: colors.textSecondary, marginTop: 20 }]}>KEY TOPICS</Text>
                <View style={styles.topicsGrid}>
                  {aiResult?.topics.map((topic, index) => (
                    <View key={index} style={[styles.topicItem, { backgroundColor: colors.lightGray }]}>
                      <View style={[styles.topicDot, { backgroundColor: colors.primary }]} />
                      <Text style={[styles.topicText, { color: colors.text }]}>{topic}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity 
                  style={[styles.insertBtn, { backgroundColor: colors.primary }]}
                  onPress={insertAISummary}
                >
                  <Plus size={20} color="#FFF" />
                  <Text style={styles.insertBtnText}>Append to Note</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
    minHeight: 300,
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
