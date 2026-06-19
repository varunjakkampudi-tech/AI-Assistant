import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface JournalEntry {
  id: string;
  date: string;
  wins: string[];
  mistakes: string[];
  mood: string;
  highlights: string[];
  narrative: string;
  stats?: { event_count?: number; spent?: number; received?: number };
}

const MOOD_ICON: Record<string, keyof typeof import("@expo/vector-icons/Ionicons").default.glyphMap> = {
  great: "happy", good: "sunny", neutral: "ellipse-outline",
  tired: "moon", frustrated: "alert-circle", sad: "rainy", excited: "sparkles",
};

export default function JournalScreen() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.journalList(60);
      setEntries(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("journal list", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const generateToday = async () => {
    setGenerating(true);
    try {
      await api.journalGenerate(undefined, -new Date().getTimezoneOffset(), true);
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't generate", e?.message || "Try again later.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="AI Journal"
        rightSlot={
          <Pressable style={styles.headerBtn} onPress={generateToday} disabled={generating} testID="journal-generate-btn">
            {generating ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : <Ionicons name="sparkles" size={18} color={theme.color.onSurface} />}
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 64 }} />
        ) : entries.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="journal-outline" size={36} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No journal yet</Text>
            <Text style={styles.emptyText}>Tap the spark icon to generate today's entry from your timeline.</Text>
            <Pressable style={styles.cta} onPress={generateToday} disabled={generating} testID="journal-generate-cta">
              {generating ? (
                <ActivityIndicator color={theme.color.onBrand} />
              ) : (
                <Text style={styles.ctaText}>Generate today's entry</Text>
              )}
            </Pressable>
          </View>
        ) : (
          entries.map((e) => (
            <View key={e.id} style={styles.card} testID={`journal-card-${e.date}`}>
              <View style={styles.cardHead}>
                <Ionicons name={MOOD_ICON[e.mood] || "ellipse-outline"} size={18} color={theme.color.brand} />
                <Text style={styles.cardDate}>{new Date(e.date + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</Text>
                <Text style={styles.cardMood}>{e.mood}</Text>
              </View>
              {!!e.narrative && <Text style={styles.narr}>{e.narrative}</Text>}

              {e.highlights?.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Highlights</Text>
                  {e.highlights.map((h, i) => (
                    <Text key={i} style={styles.bullet} numberOfLines={3}>• {h}</Text>
                  ))}
                </View>
              )}

              {e.wins?.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: "#22c55e" }]}>Wins</Text>
                  {e.wins.map((w, i) => (<Text key={i} style={styles.bullet}>✓ {w}</Text>))}
                </View>
              )}
              {e.mistakes?.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: "#ef4444" }]}>Mistakes</Text>
                  {e.mistakes.map((m, i) => (<Text key={i} style={styles.bullet}>! {m}</Text>))}
                </View>
              )}
              {e.stats && (
                <Text style={styles.footer}>
                  {e.stats.event_count ?? 0} events · ₹{Math.round(e.stats.spent || 0).toLocaleString("en-IN")} spent
                </Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.color.brand,
    alignItems: "center", justifyContent: "center",
  },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  empty: { alignItems: "center", paddingTop: theme.spacing.xxxl, gap: theme.spacing.md },
  emptyTitle: { color: theme.color.onSurface, fontSize: 18, fontFamily: theme.font.display },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 13, textAlign: "center", paddingHorizontal: 24 },
  cta: {
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
  },
  ctaText: { color: theme.color.onBrand, fontWeight: "600" },
  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    gap: theme.spacing.md,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  cardDate: { flex: 1, color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  cardMood: { color: theme.color.brand, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  narr: { color: theme.color.onSurface, fontSize: 15, lineHeight: 22, fontFamily: theme.font.display },
  section: { gap: 4 },
  sectionTitle: { color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 },
  bullet: { color: theme.color.onSurface, fontSize: 13, lineHeight: 18 },
  footer: { color: theme.color.onSurfaceSecondary, fontSize: 11, textAlign: "right", marginTop: 6 },
});
