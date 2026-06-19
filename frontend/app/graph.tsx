import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface Node {
  id: string;
  label: string;
  type: string;
  importance: number;
  weight?: number;
  relationship?: string;
  count?: number;
  progress?: number;
  content?: string;
}

interface Edge { source: string; target: string; kind: string }

interface Graph {
  root: string;
  nodes: Node[];
  edges: Edge[];
  counts: { nodes: number; edges: number; by_type?: Record<string, number> };
}

const TYPE_COLORS: Record<string, string> = {
  self: "#E1B168",
  person: "#7AB9FF",
  project: "#B187FF",
  skill: "#FF9F6E",
  goal: "#6EE7B7",
  event: "#FFD66E",
  topic: "#9CA3AF",
  document: "#5EE2D6",
  spending: "#F87171",
};

const TYPE_ICONS: Record<string, keyof typeof import("@expo/vector-icons/Ionicons").default.glyphMap> = {
  self: "person",
  person: "people",
  project: "briefcase",
  skill: "school",
  goal: "trophy",
  event: "calendar",
  topic: "pricetag",
  document: "document-text",
  spending: "card",
};

export default function GraphScreen() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filtered, setFiltered] = useState<Graph | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const g = await api.graph();
      setGraph(g);
      setFiltered(null);
    } catch (e) { console.warn("graph", e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const runSearch = async () => {
    if (!query.trim()) { setFiltered(null); return; }
    setSearching(true);
    try {
      const g = await api.graphRelated(query.trim(), 1);
      setFiltered(g);
    } catch (e) { console.warn("graph search", e); }
    finally { setSearching(false); }
  };

  const view = filtered || graph;

  // Group nodes by type for rendering
  const byType: Record<string, Node[]> = {};
  if (view) {
    for (const n of view.nodes) {
      if (n.id === view.root) continue;
      (byType[n.type] = byType[n.type] || []).push(n);
    }
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Knowledge Graph" />
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={theme.color.onSurfaceSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Show everything related to..."
          placeholderTextColor={theme.color.onSurfaceSecondary}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
          returnKeyType="search"
          testID="graph-search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => { setQuery(""); setFiltered(null); }} testID="graph-clear">
            <Ionicons name="close-circle" size={16} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        )}
        <Pressable style={styles.searchBtn} onPress={runSearch} disabled={searching} testID="graph-search-btn">
          {searching ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : <Text style={styles.searchBtnText}>Find</Text>}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 64 }} />
        ) : view && view.nodes.length > 0 ? (
          <>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statN}>{view.counts.nodes}</Text>
                <Text style={styles.statL}>nodes</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statN}>{view.counts.edges}</Text>
                <Text style={styles.statL}>edges</Text>
              </View>
              {Object.entries(view.counts.by_type || {}).slice(0, 3).map(([t, n]) => (
                <View key={t} style={styles.stat}>
                  <Text style={[styles.statN, { color: TYPE_COLORS[t] || theme.color.brand }]}>{n}</Text>
                  <Text style={styles.statL}>{t}</Text>
                </View>
              ))}
            </View>

            {Object.entries(byType).map(([type, nodes]) => (
              <View key={type} style={styles.group} testID={`graph-group-${type}`}>
                <View style={styles.groupHead}>
                  <Ionicons name={TYPE_ICONS[type] || "ellipse"} size={14} color={TYPE_COLORS[type] || theme.color.brand} />
                  <Text style={styles.groupTitle}>{type}</Text>
                  <Text style={styles.groupCount}>{nodes.length}</Text>
                </View>
                <View style={styles.chipWrap}>
                  {nodes.sort((a, b) => b.importance - a.importance).map((n) => (
                    <Pressable
                      key={n.id}
                      style={[styles.chip, { borderColor: TYPE_COLORS[type] || theme.color.brand }]}
                      onPress={() => { setQuery(n.label); setTimeout(() => runSearch(), 50); }}
                      testID={`graph-chip-${n.id}`}
                    >
                      <Text style={styles.chipLabel} numberOfLines={1}>{n.label}</Text>
                      {!!n.relationship && <Text style={styles.chipMeta}>{n.relationship}</Text>}
                      {n.progress != null && <Text style={styles.chipMeta}>{n.progress}%</Text>}
                      {n.count != null && <Text style={styles.chipMeta}>×{n.count}</Text>}
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="git-network-outline" size={36} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No graph yet</Text>
            <Text style={styles.emptyText}>
              Chat with ORA about people, projects, and goals. Memories form the graph automatically.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.divider,
  },
  searchInput: { flex: 1, color: theme.color.onSurface, fontSize: 14 },
  searchBtn: {
    paddingHorizontal: theme.spacing.md, paddingVertical: 6,
    backgroundColor: theme.color.brand, borderRadius: theme.radius.pill,
  },
  searchBtnText: { color: theme.color.onBrand, fontSize: 12, fontWeight: "600" },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  statsRow: { flexDirection: "row", gap: theme.spacing.md, justifyContent: "space-around" },
  stat: { alignItems: "center" },
  statN: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  statL: { color: theme.color.onSurfaceSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  group: { gap: theme.spacing.sm },
  groupHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  groupTitle: { flex: 1, color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 },
  groupCount: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  chip: {
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    backgroundColor: theme.color.surfaceSecondary,
    maxWidth: "100%",
  },
  chipLabel: { color: theme.color.onSurface, fontSize: 13, fontWeight: "500" },
  chipMeta: { color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: theme.spacing.xxxl, gap: theme.spacing.sm },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "500" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", paddingHorizontal: 24 },
});
