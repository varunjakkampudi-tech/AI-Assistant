import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FeatureGate } from "@/src/features";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api, Memory, MemoryCategory } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

const CATEGORIES: { key: MemoryCategory | "all"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All", icon: "albums-outline" },
  { key: "person", label: "People", icon: "people-outline" },
  { key: "project", label: "Projects", icon: "briefcase-outline" },
  { key: "goal", label: "Goals", icon: "trophy-outline" },
  { key: "skill", label: "Skills", icon: "barbell-outline" },
  { key: "meeting", label: "Meetings", icon: "calendar-outline" },
  { key: "date", label: "Dates", icon: "today-outline" },
  { key: "preference", label: "Prefs", icon: "heart-outline" },
  { key: "other", label: "Other", icon: "ellipsis-horizontal" },
];

export default function MemoriesScreen() {
  return (
    <FeatureGate feature="memory_bank">
      <MemoriesScreenInner />
    </FeatureGate>
  );
}

function MemoriesScreenInner() {
  const [items, setItems] = useState<Memory[] | null>(null);
  const [cat, setCat] = useState<MemoryCategory | "all">("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await api.listMemories({
        category: cat === "all" ? undefined : cat,
        search: search.trim() || undefined,
      });
      setItems(list);
    } catch {
      setItems([]);
    }
  }, [cat, search]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const remove = useCallback(async (id: string) => {
    setItems((prev) => (prev || []).filter((m) => m.id !== id));
    try {
      await api.deleteMemory(id);
    } catch {
      load();
    }
  }, [load]);

  return (
    <View style={styles.root} testID="memories-screen">
      <ScreenHeader title="Memories" />
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={theme.color.onSurfaceSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search memories"
          placeholderTextColor={theme.color.onSurfaceSecondary}
          value={search}
          onChangeText={setSearch}
          testID="memory-search-input"
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipScroll}
      >
        {CATEGORIES.map((c) => {
          const active = cat === c.key;
          return (
            <Pressable
              key={c.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setCat(c.key)}
              testID={`memory-chip-${c.key}`}
            >
              <Ionicons name={c.icon} size={13} color={active ? theme.color.onBrand : theme.color.brand} />
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={36} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>No memories yet</Text>
          <Text style={styles.emptySub}>
            Chat with ORA — facts about you (people, projects, goals, dates) get saved here automatically.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`memory-row-${item.id}`}>
              <View style={styles.cardHead}>
                <View style={styles.catBadge}>
                  <Text style={styles.catBadgeText}>{item.category}</Text>
                </View>
                <Text style={styles.subject} numberOfLines={1}>
                  {item.subject}
                </Text>
                <Pressable
                  onPress={() => remove(item.id)}
                  hitSlop={10}
                  testID={`memory-delete-${item.id}`}
                >
                  <Ionicons name="close" size={16} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              </View>
              <Text style={styles.content}>{item.content}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  searchInput: { flex: 1, color: theme.color.onSurface, fontSize: 14, paddingVertical: 4 },
  chipScroll: { flexGrow: 0, marginTop: theme.spacing.md },
  chipRow: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipLabel: { color: theme.color.onSurface, fontSize: 12 },
  chipLabelActive: { color: theme.color.onBrand, fontWeight: "600" },
  listContent: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    gap: theme.spacing.sm,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  catBadge: {
    backgroundColor: theme.color.brandTertiary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
  },
  catBadgeText: {
    color: theme.color.brand,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  subject: { flex: 1, color: theme.color.onSurface, fontSize: 15, fontWeight: "500" },
  content: { color: theme.color.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl, gap: theme.spacing.md },
  emptyTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  emptySub: { color: theme.color.onSurfaceSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
