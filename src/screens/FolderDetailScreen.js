import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  StatusBar
} from 'react-native';
import { ChevronLeft, FileText, Plus } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { useNotes } from '../context/NoteContext';
import { column, MAX_WIDTH } from '../lib/responsive';

const FolderDetailScreen = ({ route, navigation }) => {
  const { folder } = route.params;
  const { colors, isDark } = useTheme();
  const { notes, folders } = useNotes();

  // "All Notes" shows every note; any other folder shows only its own notes.
  const isAll = folder.id === 'default';
  const folderNotes = isAll ? notes : notes.filter(note => note.folderId === folder.id);
  const folderOf = note => folders.find(f => f.id === note.folderId && f.id !== 'default');

  const renderNoteItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.noteItem, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => navigation.navigate('Editor', { note: item })}
    >
      <View style={[styles.noteIcon, { backgroundColor: (isAll && folderOf(item) ? folderOf(item).color : folder.color) + '15' }]}>
        <FileText size={20} color={isAll && folderOf(item) ? folderOf(item).color : folder.color} />
      </View>
      <View style={styles.noteContent}>
        <Text style={[styles.noteTitle, { color: colors.text }]} numberOfLines={1}>
          {item.title || 'Untitled Note'}
        </Text>
        <Text style={[styles.noteSnippet, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.snippet || 'No content yet...'}
        </Text>
        {isAll && folderOf(item) && (
          <View style={[styles.folderBadge, { backgroundColor: folderOf(item).color + '1A' }]}>
            <View style={[styles.folderDot, { backgroundColor: folderOf(item).color }]} />
            <Text style={[styles.folderBadgeText, { color: folderOf(item).color }]} numberOfLines={1}>
              {folderOf(item).name}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={28} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.folderName, { color: colors.text }]}>{folder.name}</Text>
          <Text style={[styles.noteCount, { color: colors.textSecondary }]}>{folderNotes.length} notes</Text>
        </View>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('Editor', { folderId: isAll ? undefined : folder.id })}
          accessibilityLabel="New note"
        >
          <Plus size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={folderNotes}
        keyExtractor={item => item.id.toString()}
        renderItem={renderNoteItem}
        contentContainerStyle={[styles.listContent, column(MAX_WIDTH.reading)]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <FileText size={60} color={colors.placeholder} opacity={0.3} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{isAll ? 'No notes yet' : 'No notes in this folder'}</Text>
            <TouchableOpacity
              style={[styles.createButton, { backgroundColor: colors.primary }]}
              onPress={() => navigation.navigate('Editor', { folderId: isAll ? undefined : folder.id })}
            >
              <Plus size={20} color="#FFF" />
              <Text style={styles.createButtonText}>Create first note</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  backButton: {
    marginRight: 15,
  },
  headerInfo: {
    flex: 1,
  },
  folderName: {
    fontSize: 20,
    fontWeight: '800',
  },
  noteCount: {
    fontSize: 13,
    marginTop: 2,
  },
  moreButton: {
    padding: 5,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 16,
  },
  noteIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  noteContent: {
    flex: 1,
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  noteSnippet: {
    fontSize: 13,
  },
  folderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
    maxWidth: 200,
  },
  folderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  folderBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 15,
    marginBottom: 25,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    elevation: 4,
  },
  createButtonText: {
    color: '#FFF',
    fontWeight: '700',
    marginLeft: 8,
  },
});

export default FolderDetailScreen;
