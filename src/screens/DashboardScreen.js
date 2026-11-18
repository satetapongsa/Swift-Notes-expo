import React, {useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  SafeAreaView,
  StatusBar,
  Modal,
  TouchableWithoutFeedback,
  Dimensions
} from 'react-native';
import {
  Menu,
  Search,
  User,
  Plus,
  Pin,
  MoreVertical,
  ChevronRight,
  FileText,
  Trash2,
  Share2,
  Tag,
  X,
  Folder,
  PinOff,
} from 'lucide-react-native';
import Sidebar from '../components/Sidebar';
import { useTheme } from '../theme/ThemeContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

import { useNotes } from '../context/NoteContext';
import { useLayout, column, gridRow, gridItem, MAX_WIDTH } from '../lib/responsive';

const GRID_GAP = 20;

const DashboardScreen = ({ navigation }) => {
  const { colors, typography, isDark } = useTheme();
  const { notes, folders, deleteNote, updateNote } = useNotes();
  const { columns } = useLayout();
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [selectedNote, setSelectedNote] = useState(null);
  const [showNoteMenu, setShowNoteMenu] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [menuError, setMenuError] = useState('');

  // Filters: everything, pinned, then one per tag actually used.
  const filters = useMemo(() => {
    const tags = [...new Set(notes.flatMap(n => n.tags || []))].sort((a, b) => a.localeCompare(b));
    return ['All', 'Pinned', ...tags];
  }, [notes]);

  useEffect(() => {
    if (!filters.includes(activeFilter)) setActiveFilter('All');
  }, [filters, activeFilter]);

  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      const matchQuery = note.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (note.snippet || note.content || '')?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         note.tags?.some(t => t.toLowerCase().includes(searchQuery.replace('#', '').toLowerCase()));

      const matchFilter = activeFilter === 'All' ||
                         (activeFilter === 'Pinned' ? note.isPinned : note.tags?.includes(activeFilter));

      return matchQuery && matchFilter;
    });
  }, [searchQuery, activeFilter, notes]);

  const closeMenu = () => {
    setShowNoteMenu(false);
    setShowFolderPicker(false);
    setMenuError('');
  };

  const runMenuAction = async action => {
    try {
      await action();
      closeMenu();
    } catch (e) {
      setMenuError(e.message);
    }
  };

  const handleDeleteNote = id => runMenuAction(() => deleteNote(id));
  const togglePin = note => runMenuAction(() => updateNote(note.id, { pinned: !note.pinned }));
  const moveToFolder = (note, folderId) => runMenuAction(() => updateNote(note.id, { folderId: folderId === 'default' ? null : folderId }));

  const openNoteMenu = (note) => {
    setSelectedNote(note);
    setMenuError('');
    setShowFolderPicker(false);
    setShowNoteMenu(true);
  };

  const canEdit = selectedNote && selectedNote.access !== 'viewer';
  const isOwner = selectedNote?.access === 'owner';

  const styles = createStyles(colors, typography);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: isDark ? colors.card : colors.white }]}>
        <TouchableOpacity onPress={() => setShowSidebar(true)}>
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Notes</Text>
        <TouchableOpacity style={[styles.profileButton, { backgroundColor: colors.lightGray }]} onPress={() => navigation.navigate('Settings')}>
          <User size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, column(MAX_WIDTH.list)]}>
        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Search size={20} color={colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search notes or #tags..."
            placeholderTextColor={colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery !== '' && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterContent}
        >
          {filters.map(filter => (
            <TouchableOpacity
              key={filter}
              onPress={() => setActiveFilter(filter)}
              style={[
                styles.filterPill,
                { backgroundColor: colors.pill },
                activeFilter === filter && { backgroundColor: colors.primary }
              ]}
            >
              <Text style={[
                styles.filterText,
                { color: colors.textSecondary },
                activeFilter === filter && { color: colors.white, fontWeight: '700' }
              ]}>
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Note List */}
        {filteredNotes.length === 0 ? (
          <View style={styles.emptyContent}>
             <FileText size={80} color={colors.border} />
             <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No notes found matching your search</Text>
          </View>
        ) : (
          <View style={gridRow(GRID_GAP)}>
          {filteredNotes.map(note => (
            <View key={note.id} style={gridItem(columns, GRID_GAP)}>
            <TouchableOpacity
              style={[
                styles.noteCard,
                { backgroundColor: colors.card, borderColor: colors.border },
                note.isFeatured && { borderColor: colors.primary, borderWidth: 1.5 }
              ]}
              onPress={() => navigation.navigate('Editor', { note })}
            >
              {note.image && <Image source={{ uri: note.image }} style={styles.noteImage} />}
              <View style={styles.noteCardContent}>
                <View style={styles.noteHeader}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    {note.pinned && <Pin size={16} color={colors.warning} style={{ marginRight: 8 }} />}
                    <Text style={[styles.noteTitle, { color: colors.text }]} numberOfLines={1}>{note.title}</Text>
                  </View>
                  <TouchableOpacity onPress={() => openNoteMenu(note)}>
                    <MoreVertical size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.noteSnippet, { color: colors.textSecondary }]} numberOfLines={2}>{note.snippet}</Text>
                <View style={styles.tagRow}>
                   {note.tags && note.tags.map(t => (
                     <View key={t} style={[styles.tagPill, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}>
                       <Text style={[styles.tagText, { color: colors.primary }]}>#{t}</Text>
                     </View>
                   ))}
                   <Text style={[styles.noteDate, { color: colors.textSecondary, marginLeft: 'auto' }]}>{note.date}</Text>
                </View>
              </View>
            </TouchableOpacity>
            </View>
          ))}
          </View>
        )}

        {/* Extra space for FAB */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.primary }]} onPress={() => navigation.navigate('Editor')}>
        <Plus size={32} color={colors.white} />
      </TouchableOpacity>

      {/* Sidebar Modal */}
      <Modal
        visible={showSidebar}
        transparent={true}
        animationType="none"
        onRequestClose={() => setShowSidebar(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setShowSidebar(false)}>
            <View style={styles.sidebarBackdrop} />
          </TouchableWithoutFeedback>
          <View style={styles.sidebarContainer}>
            <Sidebar
              navigation={navigation}
              onClose={() => setShowSidebar(false)}
              currentRoute="Main"
            />
          </View>
        </View>
      </Modal>

      {/* Note Action Menu (Bottom Sheet Style) */}
      <Modal
        visible={showNoteMenu}
        transparent={true}
        animationType="slide"
        onRequestClose={closeMenu}
      >
        <View style={styles.bottomSheetOverlay}>
          <TouchableWithoutFeedback onPress={closeMenu}>
            <View style={styles.sheetBackdrop} />
          </TouchableWithoutFeedback>
          <View style={[styles.actionSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.actionSheetTitle, { color: colors.textSecondary }]}>NOTE OPTIONS</Text>

            <TouchableOpacity
              style={[styles.actionItem, { borderBottomColor: colors.border }]}
              onPress={() => { closeMenu(); navigation.navigate('Editor', { note: selectedNote, openShare: true }); }}
            >
              <View style={[styles.actionIcon, { backgroundColor: colors.primary + '15' }]}>
                <Share2 size={24} color={colors.primary} />
              </View>
              <View style={styles.actionTextContent}>
                <Text style={[styles.actionLabel, { color: colors.text }]}>Share Note</Text>
                <Text style={[styles.actionDesc, { color: colors.textSecondary }]}>Send this note to others</Text>
              </View>
              <ChevronRight size={20} color={colors.placeholder} />
            </TouchableOpacity>

            {canEdit && (
              <TouchableOpacity
                style={[styles.actionItem, { borderBottomColor: colors.border }]}
                onPress={() => togglePin(selectedNote)}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.warning + '15' }]}>
                  {selectedNote?.pinned ? <PinOff size={24} color={colors.warning} /> : <Pin size={24} color={colors.warning} />}
                </View>
                <View style={styles.actionTextContent}>
                  <Text style={[styles.actionLabel, { color: colors.text }]}>{selectedNote?.pinned ? 'Unpin Note' : 'Pin Note'}</Text>
                  <Text style={[styles.actionDesc, { color: colors.textSecondary }]}>{selectedNote?.pinned ? 'Remove from the top of your list' : 'Keep it at the top of your list'}</Text>
                </View>
              </TouchableOpacity>
            )}

            {isOwner && (
              <TouchableOpacity
                style={[styles.actionItem, { borderBottomColor: colors.border }]}
                onPress={() => setShowFolderPicker(v => !v)}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.secondary + '15' }]}>
                  <Folder size={24} color={colors.secondary} />
                </View>
                <View style={styles.actionTextContent}>
                  <Text style={[styles.actionLabel, { color: colors.text }]}>Move to Folder</Text>
                  <Text style={[styles.actionDesc, { color: colors.textSecondary }]}>
                    {folders.find(f => f.id === (selectedNote?.folderId || 'default'))?.name || 'All Notes'}
                  </Text>
                </View>
                <ChevronRight size={20} color={colors.placeholder} style={showFolderPicker && { transform: [{ rotate: '90deg' }] }} />
              </TouchableOpacity>
            )}

            {isOwner && showFolderPicker && (
              <View style={styles.folderPicker}>
                {folders.map(f => {
                  const current = (selectedNote?.folderId || 'default') === f.id;
                  return (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => moveToFolder(selectedNote, f.id)}
                      style={[styles.folderOption, { borderColor: current ? colors.primary : colors.border }]}
                    >
                      <View style={[styles.folderDot, { backgroundColor: f.color }]} />
                      <Text style={{ color: colors.text, fontWeight: current ? '700' : '500' }}>{f.id === 'default' ? 'No folder' : f.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {menuError ? <Text style={{ color: colors.danger, marginVertical: 8 }}>{menuError}</Text> : null}

            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => handleDeleteNote(selectedNote?.id)}
            >
              <View style={[styles.actionIcon, { backgroundColor: colors.danger + '15' }]}>
                <Trash2 size={24} color={colors.danger} />
              </View>
              <View style={styles.actionTextContent}>
                <Text style={[styles.actionLabel, { color: colors.danger }]}>{isOwner ? 'Delete Note' : 'Remove from My Notes'}</Text>
                <Text style={[styles.actionDesc, { color: colors.textSecondary }]}>{isOwner ? 'Move this note to trash' : 'You will no longer have access'}</Text>
              </View>
              <ChevronRight size={20} color={colors.placeholder} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelButton, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
              onPress={closeMenu}
            >
              <Text style={[styles.cancelText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <View style={{ height: 30 }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors, typography) => StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    borderRadius: 15,
    height: 56,
    borderWidth: 1,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  filterBar: {
    marginBottom: 25,
  },
  filterContent: {
    paddingRight: 20,
  },
  filterPill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginRight: 10,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noteCard: {
    borderRadius: 25,
    marginBottom: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  noteImage: {
    width: '100%',
    height: 160,
  },
  noteCardContent: {
    padding: 20,
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  noteTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  noteSnippet: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 15,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  noteDate: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContent: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 15,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  modalOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebarBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sidebarContainer: {
    maxWidth: 340,
    width: '80%',
    height: '100%',
  },
  bottomSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  actionSheet: {
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 40,
  },
  actionSheetTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 25,
    textAlign: 'center',
  },
  folderPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingVertical: 10,
  },
  folderOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  folderDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
  },
  actionIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 18,
  },
  actionTextContent: {
    flex: 1,
  },
  actionLabel: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  actionDesc: {
    fontSize: 13,
  },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 20,
  },
  cancelButton: {
    marginTop: 25,
    padding: 18,
    borderRadius: 20,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 17,
    fontWeight: '700',
  },
});

export default DashboardScreen;
