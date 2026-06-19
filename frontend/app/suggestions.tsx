import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useColors } from "@/src/auth";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

type Kind = "feature" | "improvement" | "bug" | "other";

const KINDS: { value: Kind; label: string; icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap }[] = [
  { value: "feature", label: "New feature", icon: "sparkles-outline" },
  { value: "improvement", label: "Improvement", icon: "trending-up-outline" },
  { value: "bug", label: "Bug", icon: "bug-outline" },
  { value: "other", label: "Other", icon: "chatbox-ellipses-outline" },
];

const STATUS_META: Record<string, { color: string; label: string }> = {
  received:   { color: "#7c8aa5", label: "RECEIVED" },
  considering:{ color: "#facc15", label: "REVIEWING" },
  planned:    { color: "#60a5fa", label: "PLANNED" },
  in_progress:{ color: "#22c55e", label: "IN PROGRESS" },
  shipped:    { color: "#22c55e", label: "SHIPPED" },
  declined:   { color: "#ef4444", label: "DECLINED" },
};

interface Suggestion {
  id: string;
  title: string;
  body: string;
  kind: Kind;
  status: string;
  upvotes: number;
  created_at: string;
}

export default function SuggestionsScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<Kind>("feature");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.suggestionsList();
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("suggestions load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      Alert.alert("Add a title and details");
      return;
    }
    setPosting(true);
    try {
      const created = await api.suggestionCreate({ title: title.trim(), body: body.trim(), kind });
      setItems((s) => [created, ...s]);
      setTitle("");
      setBody("");
    } catch (e: any) {
      Alert.alert("Couldn't submit", e?.message || "");
    } finally { setPosting(false); }
  };

  const remove = async (id: string) => {
    Alert.alert("Remove suggestion?", "This deletes it from the queue.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          try {
            await api.suggestionDelete(id);
            setItems((s) => s.filter((x) => x.id !== id));
          } catch (e: any) {
            Alert.alert("Couldn't remove", e?.message || "");
          }
        }
      },
    ]);
  };

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };

  return (
    <View style={styles.root} testID="suggestions-screen">
      <ScreenHeader title="Suggestions" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.brand} />}
      >
        {/* Intro */}
        <View style={styles.heroCard}>
          <Ionicons name="bulb" size={22} color={c.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Help shape ORA OS</Text>
            <Text style={styles.heroSub}>
              Tell us what to build next. Every suggestion is reviewed by the team — the most upvoted ones get prioritised in the roadmap.
            </Text>
          </View>
        </View>

        {/* Submit form */}
        <View style={styles.formCard}>
          <Text style={styles.formLabel}>Type</Text>
          <View style={styles.kindRow}>
            {KINDS.map((k) => (
              <Pressable
                key={k.value}
                style={[styles.kindPill, kind === k.value && styles.kindPillActive]}
                onPress={() => setKind(k.value)}
                testID={`sugg-kind-${k.value}`}
              >
                <Ionicons name={k.icon} size={13} color={kind === k.value ? c.onBrand : c.onSurface} />
                <Text style={[styles.kindText, kind === k.value && { color: c.onBrand, fontWeight: "700" }]}>
                  {k.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Title — short and clear"
            placeholderTextColor={c.onSurfaceSecondary}
            maxLength={160}
            testID="sugg-title"
          />
          <TextInput
            style={[styles.input, { minHeight: 110, textAlignVertical: "top" }]}
            value={body}
            onChangeText={setBody}
            placeholder="Describe the idea. Why does it matter? What happens today vs. what would you like to happen?"
            placeholderTextColor={c.onSurfaceSecondary}
            multiline
            maxLength={4000}
            testID="sugg-body"
          />
          <Text style={styles.helper}>{body.length}/4000</Text>

          <Pressable
            style={[styles.submitBtn, posting && { opacity: 0.55 }]}
            onPress={submit}
            disabled={posting}
            testID="sugg-submit"
          >
            {posting ? (
              <ActivityIndicator color={c.onBrand} />
            ) : (
              <>
                <Ionicons name="send" size={14} color={c.onBrand} />
                <Text style={styles.submitText}>Send suggestion</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Recent */}
        <Text style={styles.sectionLabel}>RECENT IDEAS</Text>
        {loading ? (
          <ActivityIndicator color={c.brand} style={{ marginTop: 32 }} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>No suggestions yet. Be the first to drop an idea 👆</Text>
        ) : items.map((s) => {
          const meta = STATUS_META[s.status] || STATUS_META.received;
          const kindMeta = KINDS.find((k) => k.value === s.kind) || KINDS[3];
          return (
            <View key={s.id} style={styles.itemCard} testID={`sugg-item-${s.id}`}>
              <View style={styles.itemHead}>
                <View style={styles.itemKindBadge}>
                  <Ionicons name={kindMeta.icon} size={12} color={c.brand} />
                  <Text style={styles.itemKindText}>{kindMeta.label}</Text>
                </View>
                <View style={[styles.itemStatus, { borderColor: meta.color }]}>
                  <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
                  <Text style={[styles.itemStatusText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
              <Text style={styles.itemTitle}>{s.title}</Text>
              <Text style={styles.itemBody}>{s.body}</Text>
              <View style={styles.itemFooter}>
                <Text style={styles.itemDate}>{fmt(s.created_at)}</Text>
                <Pressable onPress={() => remove(s.id)} hitSlop={10} testID={`sugg-remove-${s.id}`}>
                  <Ionicons name="trash-outline" size={14} color={c.onSurfaceSecondary} />
                </Pressable>
              </View>
            </View>
          );
        })}

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 80 },
  heroCard: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    backgroundColor: c.brandTertiary,
    borderRadius: theme.radius.lg, padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.brandSecondary,
  },
  heroTitle: { color: c.onSurface, fontSize: 15, fontWeight: "600" },
  heroSub: { color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2, lineHeight: 16 },
  formCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg, padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    gap: theme.spacing.sm,
  },
  formLabel: { color: c.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.5, fontWeight: "600" },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kindPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: theme.spacing.sm, paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  kindPillActive: { backgroundColor: c.brand, borderColor: c.brand },
  kindText: { color: c.onSurface, fontSize: 11, fontWeight: "500" },
  input: {
    backgroundColor: c.surface, color: c.onSurface,
    borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
    fontSize: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  helper: { color: c.onSurfaceSecondary, fontSize: 10, textAlign: "right" },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: c.brand, paddingVertical: 13, borderRadius: theme.radius.pill,
    marginTop: 4,
  },
  submitText: { color: c.onBrand, fontWeight: "700", fontSize: 14 },
  sectionLabel: {
    color: c.onSurfaceSecondary, fontSize: 11, fontWeight: "600",
    letterSpacing: 1.8, marginTop: theme.spacing.lg,
  },
  empty: { color: c.onSurfaceSecondary, fontSize: 13, fontStyle: "italic", textAlign: "center", paddingVertical: 24 },
  itemCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg, padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    gap: 6,
  },
  itemHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  itemKindBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: c.brandTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.brandSecondary,
  },
  itemKindText: { color: c.brand, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  itemStatus: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  itemStatusText: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  itemTitle: { color: c.onSurface, fontSize: 15, fontWeight: "600", marginTop: 4 },
  itemBody: { color: c.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  itemFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  itemDate: { color: c.onSurfaceSecondary, fontSize: 11 },
});
