import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StatusBar,
  Alert
} from 'react-native';
import {
  ChevronLeft,
  Camera,
  User,
  Sun,
  Bell,
  Shield,
  Lock,
  Fingerprint,
  ChevronRight,
  Pencil,
  LogOut,
  Trash2
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { useNotes } from '../context/NoteContext';
import { useAuth } from '../context/AuthContext';
import { confirmAction } from '../lib/confirm';
import { column, MAX_WIDTH } from '../lib/responsive';
import { FEATURES } from '../config/features';
import Avatar from '../components/Avatar';

const SettingsScreen = ({ navigation }) => {
  const { isDark, toggleTheme, colors, typography } = useTheme();
  const { trash, passlockEnabled, setPasslockEnabled } = useNotes();
  const [faceIdEnabled, setFaceIdEnabled] = useState(true);

  const { user, logout, updateProfile, uploadAvatar, removeAvatar } = useAuth();

  // --- profile: name and photo ---
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);

  const startEditName = () => {
    setNameDraft(user?.name || '');
    setProfileMessage('');
    setEditingName(true);
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) {
      setProfileMessage('Name cannot be empty');
      return;
    }
    try {
      await updateProfile({ name });
      setEditingName(false);
      setProfileMessage('');
    } catch (e) {
      setProfileMessage(e.message);
    }
  };

  // Crops the picked image to a square and shrinks it to 256px before upload.
  const resizeImage = file =>
    new Promise((resolve, reject) => {
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        canvas
          .getContext('2d')
          .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That file is not an image we can read'));
      };
      img.src = url;
    });

  const pickPhoto = () => {
    if (Platform.OS !== 'web') {
      setProfileMessage('Changing your photo works in the web app for now.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      setPhotoBusy(true);
      setProfileMessage('');
      try {
        await uploadAvatar('image/jpeg', await resizeImage(file));
      } catch (e) {
        setProfileMessage(e.message);
      } finally {
        setPhotoBusy(false);
      }
    };
    input.click();
  };

  const deletePhoto = async () => {
    setPhotoBusy(true);
    try {
      await removeAvatar();
    } catch (e) {
      setProfileMessage(e.message);
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleLogout = async () => {
    const ok = await confirmAction('Logout', 'Are you sure you want to logout?', 'Logout');
    if (!ok) return;
    await logout();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const SettingItem = ({ icon, label, value, onPress, badge, showSwitch, switchValue, onSwitchChange }) => (
    <TouchableOpacity
      style={[styles.settingItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
      disabled={showSwitch}
    >
      <View style={[styles.settingIconContainer, { backgroundColor: isDark ? colors.lightGray : '#F8F9FA' }]}>
        {icon}
      </View>
      <Text style={[styles.settingLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.settingContent}>
        {value && <Text style={[styles.settingValue, { color: colors.textSecondary }]}>{value}</Text>}
        {badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
        {showSwitch ? (
          <Switch
            value={switchValue}
            onValueChange={onSwitchChange}
            trackColor={{ false: '#767577', true: colors.primary }}
            thumbColor={colors.white}
          />
        ) : (
          <ChevronRight size={20} color={colors.placeholder} />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ width: 40 }} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, column(MAX_WIDTH.reading)]} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <Avatar user={user} size={100} />
            <TouchableOpacity
              style={[styles.editIconContainer, { backgroundColor: colors.primary }]}
              onPress={pickPhoto}
              disabled={photoBusy}
              accessibilityLabel={user?.avatarUrl ? 'Change profile photo' : 'Add profile photo'}
            >
              {photoBusy ? <ActivityIndicator size="small" color={colors.white} /> : <Camera size={14} color={colors.white} />}
            </TouchableOpacity>
          </View>
          {user?.avatarUrl && (
            <TouchableOpacity onPress={deletePhoto} disabled={photoBusy} style={{ marginBottom: 8 }}>
              <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>Remove photo</Text>
            </TouchableOpacity>
          )}
          {editingName ? (
            <View style={styles.nameEditRow}>
              <TextInput
                style={[styles.nameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                value={nameDraft}
                onChangeText={setNameDraft}
                onSubmitEditing={saveName}
                maxLength={80}
                autoFocus
                accessibilityLabel="Your name"
              />
              <TouchableOpacity style={[styles.nameButton, { backgroundColor: colors.primary }]} onPress={saveName}>
                <Text style={{ color: '#FFF', fontWeight: '700' }}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.nameButton} onPress={() => setEditingName(false)}>
                <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={startEditName} style={styles.nameRow} accessibilityLabel="Edit your name">
              <Text style={[styles.profileName, { color: colors.text }]}>{user?.name}</Text>
              <Pencil size={14} color={colors.textSecondary} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          )}
          <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{user?.email}</Text>
          {profileMessage ? <Text style={{ color: colors.danger, marginTop: 8 }}>{profileMessage}</Text> : null}
        </View>

        {/* Account & Preference */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>ACCOUNT & PREFERENCE</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {FEATURES.profileEditing && (
              <>
                <SettingItem
                  icon={<User size={20} color={colors.primary} />}
                  label="Personal Information"
                />
                <View style={[styles.line, { backgroundColor: colors.border }]} />
              </>
            )}
            <SettingItem
              icon={<Sun size={20} color={colors.warning} />}
              label="Dark Mode"
              showSwitch={true}
              switchValue={isDark}
              onSwitchChange={toggleTheme}
            />
            {FEATURES.notifications && (
              <>
                <View style={[styles.line, { backgroundColor: colors.border }]} />
                <SettingItem
                  icon={<Bell size={20} color={colors.danger} />}
                  label="Notifications"
                />
              </>
            )}
          </View>
        </View>

        {/* Security & Privacy */}
        {(FEATURES.securityCenter || FEATURES.appLock) && (
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>SECURITY & PRIVACY</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {FEATURES.securityCenter && (
              <SettingItem
                icon={<Shield size={20} color={colors.primary} />}
                label="Security Center"
              />
            )}
            {FEATURES.securityCenter && FEATURES.appLock && <View style={[styles.line, { backgroundColor: colors.border }]} />}
            {FEATURES.appLock && (
            <>
            <SettingItem
              icon={<Lock size={20} color={colors.textSecondary} />}
              label="Passcode Lock"
              showSwitch={true}
              switchValue={passlockEnabled}
              onSwitchChange={(val) => {
                setPasslockEnabled(val);
                if (val) navigation.navigate('Passcode');
              }}
            />
            <View style={[styles.line, { backgroundColor: colors.border }]} />
            <SettingItem
              icon={<Fingerprint size={20} color={colors.success} />}
              label="FaceID Authentication"
              showSwitch={true}
              switchValue={faceIdEnabled}
              onSwitchChange={(val) => {
                setFaceIdEnabled(val);
                if (val) navigation.navigate('Biometric');
              }}
            />
            </>
            )}
          </View>
        </View>
        )}

        {/* Trash & Cleanup */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>STORAGE & CLEANUP</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SettingItem
              icon={<Trash2 size={20} color={colors.danger} />}
              label="Trash Bin"
              value={trash.workspaces.length + trash.notes.length > 0 ? `${trash.workspaces.length + trash.notes.length} ${trash.workspaces.length + trash.notes.length === 1 ? 'item' : 'items'}` : "Clean"}
              onPress={() => navigation.navigate('Trash')}
            />
          </View>
        </View>

        <TouchableOpacity style={[styles.logoutButton, { backgroundColor: isDark ? '#2C1212' : '#FFF1F0' }]} onPress={handleLogout}>
          <LogOut size={22} color={colors.danger} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>Logout from Device</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    minWidth: 180,
  },
  nameButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginLeft: 8,
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
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 20,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 15,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#FFEFEF',
  },
  editIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    padding: 8,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
  },
  section: {
    marginBottom: 25,
  },
  sectionHeader: {
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: 12,
    marginLeft: 5,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
  },
  settingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  settingContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingValue: {
    fontSize: 14,
    marginRight: 10,
  },
  line: {
    height: 1,
    marginHorizontal: 15,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    padding: 15,
    borderRadius: 12,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 12,
  },
});

export default SettingsScreen;
