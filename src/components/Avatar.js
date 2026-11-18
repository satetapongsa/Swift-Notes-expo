import React from 'react';
import { Image, Text, View } from 'react-native';

const COLORS = ['#FF9500', '#5856D6', '#34C759', '#FF3B30', '#007AFF', '#AF52DE', '#FF2D55'];
const API_BASE = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

export function avatarColor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// Profile photo if the user uploaded one, otherwise their initial on a colour.
const Avatar = ({ user, size = 40, style }) => {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (user?.avatarUrl) {
    return (
      <Image
        source={{ uri: `${API_BASE}${user.avatarUrl}` }}
        style={[box, style]}
        accessibilityLabel={`${user.name}'s profile photo`}
      />
    );
  }
  const initial = (user?.name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={[box, { backgroundColor: avatarColor(user?.id), alignItems: 'center', justifyContent: 'center' }, style]}
      accessibilityLabel={user?.name}
    >
      <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: size * 0.42 }}>{initial}</Text>
    </View>
  );
};

export default Avatar;
