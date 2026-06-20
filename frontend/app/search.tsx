import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FeatureGate } from "@/src/features";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface Source {
  type: string;
  id: string;
  title: string;
  snippet: string;
  timestamp?: string;
  score: number;
  ref?: Record<string, any>;
}

interface SearchResult {
  query: string;
  answer: string;
  sources: Source[];
  stats: Record<string, number>;
  generated_at?: string;
}

const SOURCE_FILTERS: Array<{ id: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "chat", label: "Chats", icon: "chatbubbles-outline" },
  { id: "memory", label: "Memories", icon: "sparkles-outline" },
  { id: "goal", label: "Goals", icon: "trophy-outline" },
  { id: "reminder", label: "Reminders", icon: "alarm-outline" },
  { id: "knowledge", label: "Knowledge", icon: "library-outline" },
  { id: "finance", label: "Finance", icon: "wallet-outline" },
  { id: "calendar", label: "Calendar", icon: "calendar-outline" },
  { id: "email", label: "Email", icon: "mail-outline" },
];

const TYPE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  chat: { icon: "chatbubbles", color: "#7aa6ff", label: "Chat" },
  memory: { icon: "sparkles", color: "#e1b168", label: "Memory" },
  goal: { icon: "trophy", color: "#9d7ae0", label: "Goal" },
  reminder: { icon: "alarm", color: "#ff9b9b", label: "Reminder" },
  knowledge: { icon: "library", color: "#7ad0c6", label: "Doc" },
  transaction: { icon: "wallet", color: "#22c55e", label: "Txn" },
  notification: { icon: "notifications", color: "#cfcfd4", label: "Notif" },
  calendar: { icon: "calendar", color: "#e1b168", label: "Event" },
  email: { icon: "mail", color: "#7aa6ff", label: "Email" },
};

const EXAMPLE_QUERIES = [
  "What did Vijay say about deployment?",
  "When is mother's surgery?",
  "Show last month's spending on food",
  "AWS certification deadline",
];

function formatWhen(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const days = Math.round((Date.now() - d.getTime()) / 86400000);
    if (days < 1) return "today";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.round(days / 7)}w ago`;
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

export default function SearchScreen() {
  return (
    <FeatureGate feature="search_everything">
      <SearchScreenInner />
    </FeatureGate>
  );
}

function SearchScreenInner() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Set<string>>(new Set(SOURCE_FILTERS.map((f) => f.id)));
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runSearch = useCallback(
    async (q?: string) => {
      const text = (q ?? query).trim();
      if (!text) return;
      setLoading(true);
      setError(null);
      try {
        const sources = Array.from(active);
        const r = await api.unifiedSearch(text, sources, 12, true);
        setResult(r);
      } catch (e: any) {
        setError(e?.message || "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [active, query]
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader title="Search" />

      {/* Search bar */}
      <View style={styles.searchBarWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={theme.color.onSurfaceSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="What did Vijay say about…"
            placeholderTextColor={theme.color.onSurfaceSecondary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => runSearch()}
            onKeyPress={(e: any) => {
              if (Platform.OS === "web" && e?.nativeEvent?.key === "Enter") {
                e.preventDefault?.();
                runSearch();
              }
            }}
            testID="search-input"
            autoFocus
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} testID="search-clear">
              <Ionicons name="close-circle" size={18} color={theme.color.onSurfaceSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Source filters */}
      <View style={styles.filtersWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
          {SOURCE_FILTERS.map((f) => {
            const on = active.has(f.id);
            return (
              <Pressable
                key={f.id}
                style={[styles.filterChip, on && styles.filterChipActive]}
                onPress={() => toggle(f.id)}
                testID={`search-filter-${f.id}`}
              >
                <Ionicons
                  name={f.icon}
                  size={14}
                  color={on ? theme.color.onBrand : theme.color.onSurfaceSecondary}
                />
                <Text style={[styles.filterChipText, on && styles.filterChipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!result && !loading && (
          <View style={styles.emptyHero}>
            <Ionicons name="search-circle-outline" size={56} color={theme.color.brand} />
            <Text style={styles.emptyTitle}>Search across your life</Text>
            <Text style={styles.emptyText}>
              ORA searches all your chats, memories, goals, reminders, knowledge documents, transactions, calendar
              and email — and synthesizes an answer with sources.
            </Text>
            <Text style={styles.examplesLabel}>Try one of these:</Text>
            <View style={styles.examplesRow}>
              {EXAMPLE_QUERIES.map((eq) => (
                <Pressable
                  key={eq}
                  style={styles.exampleChip}
                  onPress={() => {
                    setQuery(eq);
                    runSearch(eq);
                  }}
                  testID={`search-example-${eq.slice(0, 12).replace(/\W/g, "")}`}
                >
                  <Text style={styles.exampleText}>{eq}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={theme.color.brand} />
            <Text style={styles.loadingText}>Searching your data…</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorCard} testID="search-error">
            <Ionicons name="warning-outline" size={20} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {result && !loading && (
          <>
            {result.answer ? (
              <View style={styles.answerCard} testID="search-answer">
                <View style={styles.answerHeader}>
                  <Ionicons name="sparkles" size={16} color={theme.color.brand} />
                  <Text style={styles.answerHeaderText}>ORA's answer</Text>
                </View>
                <Text style={styles.answerText}>{result.answer}</Text>
              </View>
            ) : null}

            {/* Stats */}
            {result.sources.length > 0 && (
              <View style={styles.statsRow}>
                {Object.entries(result.stats || {}).map(([k, v]) => {
                  const meta = TYPE_META[k] || TYPE_META.chat;
                  return (
                    <View key={k} style={styles.statChip}>
                      <Ionicons name={meta.icon} size={12} color={meta.color} />
                      <Text style={styles.statChipText}>
                        {v} {meta.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Sources */}
            {result.sources.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptyText}>Try different keywords or enable more source filters above.</Text>
              </View>
            ) : (
              result.sources.map((src, idx) => {
                const meta = TYPE_META[src.type] || TYPE_META.chat;
                return (
                  <View key={`${src.type}-${src.id || idx}`} style={styles.sourceCard} testID={`search-source-${idx}`}>
                    <View style={styles.sourceHeader}>
                      <View style={[styles.sourceIcon, { backgroundColor: `${meta.color}22` }]}>
                        <Ionicons name={meta.icon} size={14} color={meta.color} />
                      </View>
                      <Text style={styles.sourceType}>{meta.label}</Text>
                      <Text style={styles.sourceTime}>{formatWhen(src.timestamp)}</Text>
                      <Text style={styles.sourceRank}>[{idx + 1}]</Text>
                    </View>
                    <Text style={styles.sourceTitle} numberOfLines={2}>
                      {src.title}
                    </Text>
                    {src.snippet ? (
                      <Text style={styles.sourceSnippet} numberOfLines={3}>
                        {src.snippet}
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  searchBarWrap: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  searchInput: { flex: 1, color: theme.color.onSurface, fontSize: 15, paddingVertical: 0 },
  filtersWrap: { paddingBottom: theme.spacing.sm },
  filtersRow: { gap: theme.spacing.xs, paddingHorizontal: theme.spacing.lg },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  filterChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  filterChipText: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  filterChipTextActive: { color: theme.color.onBrand, fontWeight: "600" },
  scroll: { padding: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.xxxl },
  emptyHero: {
    alignItems: "center",
    paddingVertical: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  emptyTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 18, marginTop: theme.spacing.sm },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 13, textAlign: "center", maxWidth: 320, lineHeight: 18 },
  examplesLabel: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  examplesRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: theme.spacing.xs },
  exampleChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  exampleText: { color: theme.color.onSurface, fontSize: 12 },
  loadingBox: { alignItems: "center", paddingVertical: theme.spacing.xxl, gap: theme.spacing.sm },
  loadingText: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  errorCard: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    alignItems: "center",
    backgroundColor: "#5a1e1e",
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorText: { color: "#ff9b9b", fontSize: 13, flex: 1 },
  answerCard: {
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.brand,
  },
  answerHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: theme.spacing.sm },
  answerHeaderText: {
    color: theme.color.brand,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "600",
  },
  answerText: { color: theme.color.onSurface, fontSize: 15, lineHeight: 22 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: theme.spacing.md },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  statChipText: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  sourceCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  sourceHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs, marginBottom: 6 },
  sourceIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  sourceType: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "600",
  },
  sourceTime: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginLeft: "auto" },
  sourceRank: { color: theme.color.brand, fontSize: 11, fontFamily: theme.font.display },
  sourceTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500", marginBottom: 4 },
  sourceSnippet: { color: theme.color.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  emptyCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    alignItems: "center",
    gap: theme.spacing.sm,
  },
});
