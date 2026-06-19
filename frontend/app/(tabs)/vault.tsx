import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";
import { api, Memory, MemoryCategory } from "@/src/api";

type FilterTab = "All" | "People" | "Projects" | "Goals" | "Dates";

const FILTER_TO_CATS: Record<FilterTab, MemoryCategory[] | null> = {
  All: null,
  People: ["person"],
  Projects: ["project"],
  Goals: ["goal"],
  Dates: ["date", "meeting"],
};

const CATEGORY_COLORS: Record<MemoryCategory, string> = {
  person: "#E1B168",
  project: "#9F7AEA",
  goal: "#48BB78",
  skill: "#4FD1C5",
  meeting: "#F6AD55",
  date: "#F687B3",
  preference: "#FC8181",
  other: "#A0AEC0",
};

const CATEGORY_ICONS: Record<MemoryCategory, keyof typeof Ionicons.glyphMap> = {
  person: "person",
  project: "briefcase",
  goal: "trophy",
  skill: "barbell",
  meeting: "calendar",
  date: "calendar-outline",
  preference: "heart",
  other: "sparkles",
};

export default function VaultScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Memory[] | null>(null);
  const [filter, setFilter] = useState<FilterTab>("All");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listMemories({ search: search.trim() || undefined });
      setItems(list);
    } catch {
      setItems([]);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const filtered = (items || []).filter((m) => {
    const cats = FILTER_TO_CATS[filter];
    if (!cats) return true;
    return cats.includes(m.category as MemoryCategory);
  });

  const people = (items || []).filter((m) => m.category === "person").slice(0, 6);
  const projects = (items || []).filter((m) => m.category === "project").slice(0, 4);
  const importantDates = (items || []).filter((m) => m.category === "date" || m.category === "meeting").slice(0, 4);

  return (
    <View style={styles.root} testID="vault-screen">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: theme.color.surface }}>
        <View style={styles.header}>
          <Text style={styles.title}>Memory</Text>
          <Pressable
            style={styles.iconBtn}
            onPress={() => setShowSearch((s) => !s)}
            testID="vault-search-toggle"
          >
            <Ionicons name="search" size={18} color={theme.color.onSurface} />
          </Pressable>
        </View>
        {showSearch && (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={theme.color.onSurfaceSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search memory"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={search}
              onChangeText={setSearch}
              autoFocus
              testID="vault-search-input"
            />
          </View>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {(["All", "People", "Projects", "Goals", "Dates"] as FilterTab[]).map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f)}
                testID={`vault-chip-${f.toLowerCase()}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      ) : (items || []).length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={36} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>Your memory is empty</Text>
          <Text style={styles.emptySub}>
            Chat with ORA — facts about you, people, projects, goals get saved here automatically.
          </Text>
          <Pressable
            style={styles.emptyBtn}
            onPress={() => router.push("/ask")}
            testID="vault-go-ask"
          >
            <Ionicons name="sparkles" size={14} color={theme.color.onBrand} />
            <Text style={styles.emptyBtnText}>Start a chat</Text>
          </Pressable>
        </View>
      ) : filter === "All" ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* People row */}
          {people.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>PEOPLE</Text>
                <Pressable onPress={() => setFilter("People")} testID="vault-view-people">
                  <Text style={styles.viewAll}>View all</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {people.map((m) => (
                  <View key={m.id} style={styles.personCard} testID={`vault-person-${m.id}`}>
                    <View style={[styles.personAvatar, { backgroundColor: CATEGORY_COLORS.person + "33" }]}>
                      <Text style={styles.personInitial}>
                        {m.subject.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.personName} numberOfLines={1}>{m.subject}</Text>
                    <Text style={styles.personMeta} numberOfLines={1}>
                      {m.content.slice(0, 30)}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Projects */}
          {projects.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>PROJECTS</Text>
                <Pressable onPress={() => setFilter("Projects")} testID="vault-view-projects">
                  <Text style={styles.viewAll}>View all</Text>
                </Pressable>
              </View>
              <View style={styles.projGrid}>
                {projects.slice(0, 2).map((m) => (
                  <View key={m.id} style={styles.projCard} testID={`vault-project-${m.id}`}>
                    <View style={[styles.projIcon, { backgroundColor: CATEGORY_COLORS.project + "33" }]}>
                      <Ionicons name="briefcase" size={16} color={CATEGORY_COLORS.project} />
                    </View>
                    <Text style={styles.projName} numberOfLines={1}>{m.subject}</Text>
                    <Text style={styles.projDesc} numberOfLines={2}>{m.content}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Important Dates */}
          {importantDates.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>IMPORTANT DATES</Text>
              {importantDates.map((m) => (
                <View key={m.id} style={styles.dateRow} testID={`vault-date-${m.id}`}>
                  <View style={[styles.dateIcon, { backgroundColor: CATEGORY_COLORS.date + "33" }]}>
                    <Ionicons name="heart" size={14} color={CATEGORY_COLORS.date} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dateName}>{m.subject}</Text>
                    <Text style={styles.dateMeta}>{m.content}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`vault-item-${item.id}`}>
              <View
                style={[
                  styles.cardIcon,
                  { backgroundColor: (CATEGORY_COLORS[item.category as MemoryCategory] || theme.color.brand) + "26" },
                ]}
              >
                <Ionicons
                  name={CATEGORY_ICONS[item.category as MemoryCategory] || "sparkles"}
                  size={16}
                  color={CATEGORY_COLORS[item.category as MemoryCategory] || theme.color.brand}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.subject}</Text>
                <Text style={styles.cardContent} numberOfLines={2}>{item.content}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  title: {
    flex: 1,
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 26,
    letterSpacing: -0.3,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  searchInput: { flex: 1, color: theme.color.onSurface, fontSize: 14, paddingVertical: 4 },
  chipRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { color: theme.color.onSurface, fontSize: 13, fontWeight: "500" },
  chipTextActive: { color: theme.color.onBrand, fontWeight: "700" },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  section: { marginBottom: theme.spacing.xl },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.md },
  sectionTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.8,
  },
  viewAll: { color: theme.color.brand, fontSize: 12, fontWeight: "600" },

  personCard: {
    width: 92,
    alignItems: "center",
    gap: 6,
  },
  personAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  personInitial: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 24 },
  personName: { color: theme.color.onSurface, fontSize: 12, fontWeight: "500" },
  personMeta: { color: theme.color.onSurfaceSecondary, fontSize: 10, textAlign: "center" },

  projGrid: { flexDirection: "row", gap: theme.spacing.md },
  projCard: {
    flex: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    gap: 8,
  },
  projIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  projName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  projDesc: { color: theme.color.onSurfaceSecondary, fontSize: 11, lineHeight: 16 },

  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    marginBottom: theme.spacing.sm,
  },
  dateIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  dateName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  dateMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },

  listContent: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 140 },
  card: {
    flexDirection: "row",
    gap: theme.spacing.md,
    alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  cardContent: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl, gap: theme.spacing.md },
  emptyTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22, marginTop: 8 },
  emptySub: { color: theme.color.onSurfaceSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    marginTop: theme.spacing.md,
  },
  emptyBtnText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 13 },
});
