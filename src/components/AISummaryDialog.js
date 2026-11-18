import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Sparkles, X, Copy, Check, Plus, AlertCircle, RotateCcw } from 'lucide-react-native';

// What the dialog shows while the model works. Timed so it feels alive; the
// request itself usually takes one to two seconds.
const STEPS = ['Reading your note', 'Finding the key points', 'Writing the summary'];
const STEP_AT_MS = [0, 700, 1500];

function useLoop(active, duration = 900) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, useNativeDriver: false }),
        Animated.timing(value, { toValue: 0, duration, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, duration, value]);
  return value;
}

const Analysing = ({ colors }) => {
  const [step, setStep] = useState(0);
  const pulse = useLoop(true);
  useEffect(() => {
    const timers = STEP_AT_MS.slice(1).map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const shimmer = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  return (
    <View style={styles.analysing} accessibilityLiveRegion="polite">
      <Animated.View style={[styles.orb, { backgroundColor: colors.primary + '1F', transform: [{ scale }] }]}>
        <Sparkles size={30} color={colors.primary} />
      </Animated.View>
      <Text style={[styles.analysingTitle, { color: colors.text }]}>Analysing your note…</Text>

      <View style={styles.steps}>
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <View key={label} style={styles.stepRow}>
              <View style={[styles.stepIcon, { borderColor: done ? colors.success : current ? colors.primary : colors.border }]}>
                {done ? (
                  <Check size={14} color={colors.success} />
                ) : current ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : null}
              </View>
              <Text style={[styles.stepText, { color: done || current ? colors.text : colors.textSecondary }]}>{label}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.skeleton}>
        {[1, 0.92, 0.7].map((w, i) => (
          <Animated.View
            key={i}
            style={[styles.skeletonBar, { width: `${w * 100}%`, backgroundColor: colors.lightGray, opacity: shimmer }]}
          />
        ))}
      </View>
    </View>
  );
};

const AISummaryDialog = ({
  visible,
  onClose,
  loading,
  error,
  result,
  onRetry,
  onCopy,
  copied,
  onInsert,
  canInsert,
  noteTitle,
  colors,
}) => {
  const { height } = useWindowDimensions();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close summary" activeOpacity={1} />
        <View
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: Math.min(height - 48, 720) }]}
          accessibilityRole="dialog"
          accessibilityLabel="AI summary"
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={[styles.headerIcon, { backgroundColor: colors.primary + '1A' }]}>
              <Sparkles size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.title, { color: colors.text }]}>AI Summary</Text>
              {noteTitle ? (
                <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {noteTitle}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeIcon, { backgroundColor: colors.lightGray }]} accessibilityLabel="Close">
              <X size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <Analysing colors={colors} />
          ) : error ? (
            <View style={styles.errorBox}>
              <AlertCircle size={32} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.text }]}>{error}</Text>
              <TouchableOpacity style={[styles.action, styles.primary, { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={onRetry}>
                <RotateCcw size={16} color="#FFF" />
                <Text style={[styles.actionText, { color: '#FFF' }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : result ? (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.summaryBox, { backgroundColor: colors.primary + '12' }]}>
                  <Text style={[styles.summaryText, { color: colors.text }]} selectable>
                    {result.summary}
                  </Text>
                </View>
                {result.points.length > 0 && (
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Key points</Text>
                )}
                {result.points.map((point, i) => (
                  <View key={i} style={styles.point}>
                    <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.pointText, { color: colors.text }]} selectable>
                      {point}
                    </Text>
                  </View>
                ))}
              </ScrollView>

              <View style={[styles.footer, { borderTopColor: colors.border }]}>
                <TouchableOpacity style={[styles.action, { borderColor: colors.border }]} onPress={onCopy}>
                  {copied ? <Check size={16} color={colors.success} /> : <Copy size={16} color={colors.text} />}
                  <Text style={[styles.actionText, { color: colors.text }]}>{copied ? 'Copied' : 'Copy'}</Text>
                </TouchableOpacity>
                {canInsert && (
                  <TouchableOpacity style={[styles.action, styles.primary, { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={onInsert}>
                    <Plus size={16} color="#FFF" />
                    <Text style={[styles.actionText, { color: '#FFF' }]}>Add to note</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.action, styles.ghost]} onPress={onClose}>
                  <Text style={[styles.actionText, { color: colors.textSecondary, marginLeft: 0 }]}>Close</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    padding: 20,
  },
  summaryBox: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  summaryText: {
    fontSize: 16,
    lineHeight: 25,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 9,
    marginRight: 12,
  },
  pointText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    marginTop: 4,
  },
  primary: {},
  ghost: {
    borderColor: 'transparent',
    marginLeft: 'auto',
    marginRight: 0,
  },
  actionText: {
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 8,
  },
  analysing: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
  },
  orb: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analysingTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 18,
  },
  steps: {
    alignSelf: 'stretch',
    maxWidth: 320,
    width: '100%',
    marginHorizontal: 'auto',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepText: {
    fontSize: 15,
    fontWeight: '600',
  },
  skeleton: {
    alignSelf: 'stretch',
    marginTop: 12,
  },
  skeletonBar: {
    height: 12,
    borderRadius: 6,
    marginBottom: 10,
  },
  errorBox: {
    alignItems: 'center',
    padding: 28,
  },
  errorText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 18,
  },
});

export default AISummaryDialog;
