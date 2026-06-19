import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface TwinProfile {
  id: string;
  writing_style: {
    formality: number;
    verbosity: number;
    emoji_usage: number;
    common_greetings: string[];
    common_closings: string[];
    favorite_phrases: string[];
    avg_message_length: number;
  };
  speaking_style: { pace: string; filler_words: string[]; common_expressions: string[] };
  decision_patterns: { risk_tolerance: number; decision_speed: number; factors_considered: string[] };
  priorities: Record<string, number>;
  frequent_contacts: Array<{ name: string; relationship: string; last_contact: string; interaction_count: number }>;
  work_habits: { peak_hours: number[]; focus_duration: number };
  response_templates: Record<string, string>;
  learning_data_points: number;
  created_at: string;
  updated_at: string;
}

function StyleBar({ label, value, leftLabel, rightLabel }: { label: string; value: number; leftLabel: string; rightLabel: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={styles.styleBarRow} testID={`twin-bar-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <View style={styles.styleBarHeader}>
        <Text style={styles.styleBarLabel}>{label}</Text>
        <Text style={styles.styleBarValue}>{Math.round(pct)}%</Text>
      </View>
      <View style={styles.styleBarTrack}>
        <View style={[styles.styleBarFill, { left: `${pct - 4}%` }]} />
      </View>
      <View style={styles.styleBarFooter}>
        <Text style={styles.styleBarFooterText}>{leftLabel}</Text>
        <Text style={styles.styleBarFooterText}>{rightLabel}</Text>
      </View>
    </View>
  );
}

export default function TwinScreen() {
  const [profile, setProfile] = useState<TwinProfile | null>(null);
  const [stylePrompt, setStylePrompt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contextText, setContextText] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, sp] = await Promise.all([
        api.twinProfile(),
        api.twinStylePrompt().catch(() => ({ style_prompt: "" })),
      ]);
      setProfile(p);
      setStylePrompt(sp.style_prompt || "");
    } catch (e) {
      console.warn("twin load failed", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const generateSuggestion = async () => {
    if (!contactName.trim() || !contextText.trim()) {
      Alert.alert("Need both", "Enter the contact name and the context.");
      return;
    }
    setSuggesting(true);
    setSuggestion(null);
    try {
      const r = await api.twinSuggestReply(contactName.trim(), contextText.trim());
      setSuggestion(
        r.suggestion ??
          `No saved template — ORA will use your style:\n\n"${stylePrompt || "Style data still being learned…"}"`
      );
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed");
    } finally {
      setSuggesting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Digital Twin" />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Digital Twin" />
        <View style={styles.loadingBox}>
          <Text style={styles.emptyText}>Couldn't load profile.</Text>
        </View>
      </View>
    );
  }

  const ws = profile.writing_style;
  const dataPoints = profile.learning_data_points || 0;
  const learningStage =
    dataPoints < 10 ? "Just starting" : dataPoints < 50 ? "Learning" : dataPoints < 200 ? "Calibrating" : "Mature";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader title="Digital Twin" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />
        }
        testID="twin-scroll"
        keyboardShouldPersistTaps="handled"
      >
        {/* Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusBadge}>
            <Ionicons name="sparkles" size={14} color={theme.color.onBrand} />
            <Text style={styles.statusBadgeText}>{learningStage}</Text>
          </View>
          <Text style={styles.statusTitle} testID="twin-learning-points">
            {dataPoints} learning points
          </Text>
          <Text style={styles.statusSub}>
            ORA learns from every chat. The more you talk, the better it mirrors how you write, decide and prioritize.
          </Text>
        </View>

        {/* Style prompt */}
        {stylePrompt ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your communication style</Text>
            <View style={styles.quoteCard}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.color.brand} />
              <Text style={styles.quoteText} testID="twin-style-prompt">
                {stylePrompt}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Writing style bars */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Writing style</Text>
          <StyleBar
            label="Formality"
            value={ws.formality}
            leftLabel="Casual"
            rightLabel="Formal"
          />
          <StyleBar
            label="Verbosity"
            value={ws.verbosity}
            leftLabel="Brief"
            rightLabel="Detailed"
          />
          <StyleBar
            label="Emoji usage"
            value={ws.emoji_usage}
            leftLabel="Never"
            rightLabel="Often"
          />
          <Text style={styles.metaText} testID="twin-avg-len">
            Avg message length: {Math.round(ws.avg_message_length)} words
          </Text>
        </View>

        {/* Greetings / closings / phrases */}
        {(ws.common_greetings.length > 0 || ws.common_closings.length > 0 || ws.favorite_phrases.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your voice</Text>
            {ws.common_greetings.length > 0 && (
              <View style={styles.chipGroup}>
                <Text style={styles.chipGroupLabel}>Greetings</Text>
                <View style={styles.chipRow}>
                  {ws.common_greetings.map((g, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipText}>{g}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {ws.common_closings.length > 0 && (
              <View style={styles.chipGroup}>
                <Text style={styles.chipGroupLabel}>Closings</Text>
                <View style={styles.chipRow}>
                  {ws.common_closings.map((g, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipText}>{g}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {ws.favorite_phrases.length > 0 && (
              <View style={styles.chipGroup}>
                <Text style={styles.chipGroupLabel}>Favorite phrases</Text>
                <View style={styles.chipRow}>
                  {ws.favorite_phrases.slice(0, 10).map((g, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipText}>{g}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Frequent contacts */}
        {profile.frequent_contacts && profile.frequent_contacts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequent contacts</Text>
            {profile.frequent_contacts.slice(0, 8).map((c) => (
              <View key={c.name} style={styles.contactRow}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactInitial}>{c.name?.charAt(0)?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>{c.name}</Text>
                  <Text style={styles.contactMeta}>
                    {c.relationship} · {c.interaction_count}x interactions
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Priorities */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Priorities</Text>
          {Object.entries(profile.priorities).map(([key, value]) => (
            <View key={key} style={styles.priorityRow}>
              <Text style={styles.priorityLabel}>
                {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </Text>
              <View style={styles.priorityTrack}>
                <View style={[styles.priorityFill, { width: `${value * 100}%` }]} />
              </View>
              <Text style={styles.priorityValue}>{Math.round(value * 100)}</Text>
            </View>
          ))}
        </View>

        {/* Suggest reply */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suggest reply</Text>
          <Text style={styles.helperText}>
            Tell ORA who you're replying to and what the message says — it'll draft a reply in your style.
          </Text>
          <TextInput
            value={contactName}
            onChangeText={setContactName}
            placeholder="To: e.g. Vijay"
            placeholderTextColor={theme.color.onSurfaceSecondary}
            style={styles.input}
            testID="twin-contact-input"
          />
          <TextInput
            value={contextText}
            onChangeText={setContextText}
            placeholder="What did they say? / What's the situation?"
            placeholderTextColor={theme.color.onSurfaceSecondary}
            style={[styles.input, { height: 90, textAlignVertical: "top" }]}
            multiline
            testID="twin-context-input"
          />
          <Pressable
            style={[styles.suggestBtn, suggesting && { opacity: 0.6 }]}
            onPress={generateSuggestion}
            disabled={suggesting}
            testID="twin-suggest-btn"
          >
            {suggesting ? (
              <ActivityIndicator color={theme.color.onBrand} />
            ) : (
              <Text style={styles.suggestBtnText}>Draft reply</Text>
            )}
          </Pressable>
          {suggestion ? (
            <View style={styles.suggestionCard} testID="twin-suggestion">
              <Ionicons name="bulb-outline" size={18} color={theme.color.brand} />
              <Text style={styles.suggestionText}>{suggestion}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl },
  statusCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    marginBottom: theme.spacing.lg,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brand,
    marginBottom: theme.spacing.sm,
  },
  statusBadgeText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "600" },
  statusTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  statusSub: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  section: { marginBottom: theme.spacing.xl },
  sectionTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: theme.spacing.md,
  },
  quoteCard: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.brand,
  },
  quoteText: {
    flex: 1,
    color: theme.color.onSurface,
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
  },
  styleBarRow: { marginBottom: theme.spacing.md },
  styleBarHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  styleBarLabel: { color: theme.color.onSurface, fontSize: 13, fontWeight: "500" },
  styleBarValue: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 13 },
  styleBarTrack: {
    height: 8,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 4,
    position: "relative",
    overflow: "visible",
  },
  styleBarFill: {
    position: "absolute",
    top: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.color.brand,
    borderWidth: 2,
    borderColor: theme.color.surface,
  },
  styleBarFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  styleBarFooterText: { color: theme.color.onSurfaceSecondary, fontSize: 10 },
  metaText: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: theme.spacing.sm },
  chipGroup: { marginBottom: theme.spacing.md },
  chipGroupLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  chipText: { color: theme.color.onSurface, fontSize: 12 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  contactInitial: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 16 },
  contactName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  contactMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  priorityRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  priorityLabel: { color: theme.color.onSurface, fontSize: 13, width: 130 },
  priorityTrack: {
    flex: 1,
    height: 6,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 3,
    overflow: "hidden",
  },
  priorityFill: { height: "100%", backgroundColor: theme.color.brand },
  priorityValue: { color: theme.color.onSurfaceSecondary, fontSize: 11, width: 28, textAlign: "right" },
  helperText: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginBottom: theme.spacing.md },
  input: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    color: theme.color.onSurface,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    marginBottom: theme.spacing.sm,
  },
  suggestBtn: {
    backgroundColor: theme.color.brand,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestBtnText: { color: theme.color.onBrand, fontSize: 14, fontWeight: "600" },
  suggestionCard: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.brand,
  },
  suggestionText: { flex: 1, color: theme.color.onSurface, fontSize: 13, lineHeight: 19 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
});
