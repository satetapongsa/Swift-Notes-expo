import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  View, 
  Text, 
  StyleSheet, 
  Animated,
  SafeAreaView,
  StatusBar,
  Dimensions
} from 'react-native';
import { Colors, Typography } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { StickyNote } from 'lucide-react-native';

const { width } = Dimensions.get('window');

const SplashScreen = ({ navigation }) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, checking } = useAuth();
  const [animationDone, setAnimationDone] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Sequence of animations for a premium feel
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: false,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: false,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, {
            toValue: -15,
            duration: 1500,
            useNativeDriver: false,
          }),
          Animated.timing(bounceAnim, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: false,
          })
        ])
      ),
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 2500,
        useNativeDriver: false,
      })
    ]).start();

    const timer = setTimeout(() => setAnimationDone(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  // After the animation, go to the app if a session exists, otherwise to Login.
  useEffect(() => {
    if (!animationDone || checking) return;
    navigation.replace(user ? 'Main' : 'Login');
  }, [animationDone, checking, user, navigation]);

  const progressInterpolate = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <Animated.View 
        style={[
          styles.content, 
          { 
            opacity: fadeAnim,
            transform: [
              { scale: scaleAnim },
              { translateY: bounceAnim }
            ]
          }
        ]}
      >
        <View style={styles.logoContainer}>
          <StickyNote size={80} color="#FFFFFF" strokeWidth={1.5} />
        </View>
        <Text style={styles.appName}>Swift Notes</Text>
        <Text style={styles.tagline}>Write notes together, in real time.</Text>
      </Animated.View>

      <View style={styles.footer}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: progressInterpolate }]} />
        </View>
        
      </View>
    </SafeAreaView>
  );
};

const makeStyles = colors => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logoContainer: {
    width: 140,
    height: 140,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    // Premium Shadow
    elevation: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
  },
  appName: {
    ...Typography.h1,
    color: colors.text,
    fontSize: 42,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -1,
  },
  tagline: {
    ...Typography.body,
    color: colors.text,
    color: colors.textSecondary,
    marginTop: 8,
    fontSize: 16,
    fontWeight: '500',
    opacity: 0.8,
  },
  footer: {
    position: 'absolute',
    bottom: 60,
    width: width * 0.7,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: colors.lightGray,
    borderRadius: 3,
    marginBottom: 20,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  securedText: {
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    color: colors.placeholder,
    textTransform: 'uppercase',
  },
});

export default SplashScreen;

