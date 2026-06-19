import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface Dimension {
  score: number;
  grade: string;
  signals: string[];
  items_tracked: number;
}

interface LifeData {
  overall: number;
  overall_grade: string;
  dimensions: Record<string, Dimension>;
  weakest: { name: string; score: number };
  strongest: { name: string; score: number };
  recommendations?: Array<{
    dimension: string;
    title: string;
    why: string;
    icon: string;
    priority: string;
  }>;
}

const DIM_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  health: { label: "Health", icon: "heart", color: "#ef4444" },
  career: { label: "Career", icon: "briefcase", color: "#7aa6ff" },
  finance: { label: "Finance", icon: "wallet", color: "#22c55e" },
  learning: { label: "Learning", icon: "school", color: "#9d7ae0" },
  relationships: { label: "Relationships", icon: "people", color: "#e1b168" },
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "#ef4444",
  medium: "#e1b168",
  low: "#7aa6ff",
};

function ScoreRing({ score, size = 110, color }: { score: number; size?: number; color: string }) {
  // Pure-RN ring using two stacked circles + an arc-like effect via border styling.
  // For cross-platform simplicity we use a colored chip with progress bar inside,
  // visually equivalent to a ring without needing SVG.
  const pct = Math.max(0, Math.min(100, score));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.color.surfaceSecondary,
        borderWidth: 4,
        borderColor: `${color}33`,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${pct}%`,
          backgroundColor: `${color}22`,
        }}
      />
      <Text style={{ color, fontFamily: theme.font.display, fontSize: size * 0.32 }}>{pct}</Text>
      <Text style={{ color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 2 }}>/ 100</Text>
    </View>
  );
}

export default function LifeOSScreen() {
  const [data, setData] = useState<LifeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.lifeDashboard();
      setData(d);
    } catch (e) {
      console.warn("life dashboard failed", e);
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

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Life OS" />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Life OS" />
        <View style={styles.loadingBox}>
          <Text style={styles.emptyText}>Couldn't load Life OS.</Text>
        </View>
      </View>
    );
  }

  const dimEntries = Object.entries(data.dimensions);
  const overallColor =
    data.overall >= 75 ? "#22c55e" : data.overall >= 60 ? "#e1b168" : data.overall >= 40 ? "#f97316" : "#ef4444";

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Life OS"
        rightSlot={
          <Pressable
            style={styles.headerBtn}
            onPress={() => {
              setRefreshing(true);
              load();
            }}
            testID="life-refresh"
          >
            <Ionicons name="refresh" size={20} color={theme.color.onSurface} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={theme.color.brand}
          />
        }
        testID="life-scroll"
      >
        {/* Overall */}
        <View style={styles.heroCard}>
          <View style={styles.heroLeft}>
            <Text style={styles.heroLabel}>OVERALL</Text>
            <Text style={[styles.heroGrade, { color: overallColor }]} testID="life-overall-grade">
              {data.overall_grade}
            </Text>
            <Text style={styles.heroSub}>
              Strongest:{" "}
              <Text style={{ color: theme.color.onSurface }}>
                {DIM_META[data.strongest.name]?.label || data.strongest.name}
              </Text>{" "}
              ({data.strongest.score})
            </Text>
            <Text style={styles.heroSub}>
              Focus:{" "}
              <Text style={{ color: theme.color.onSurface }}>
                {DIM_META[data.weakest.name]?.label || data.weakest.name}
              </Text>{" "}
              ({data.weakest.score})
            </Text>
          </View>
          <ScoreRing score={data.overall} color={overallColor} size={120} />
        </View>

        {/* Recommendations */}
        {data.recommendations && data.recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today's actions</Text>
            {data.recommendations.map((r, idx) => {
              const pcolor = PRIORITY_COLOR[r.priority] || theme.color.brand;
              return (
                <View key={idx} style={styles.recCard} testID={`life-rec-${idx}`}>
                  <View style={[styles.recIconWrap, { backgroundColor: `${pcolor}22` }]}>
                    <Ionicons name={(r.icon + "-outline") as any} size={18} color={pcolor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.recHeader}>
                      <Text style={styles.recDim}>{DIM_META[r.dimension]?.label || r.dimension}</Text>
                      <View style={[styles.priorityBadge, { backgroundColor: `${pcolor}22` }]}>
                        <Text style={[styles.priorityText, { color: pcolor }]}>{r.priority.toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.recTitle}>{r.title}</Text>
                    <Text style={styles.recWhy}>{r.why}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Dimensions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dimensions</Text>
          {dimEntries.map(([key, dim]) => {
            const meta = DIM_META[key] || { label: key, icon: "ellipse" as const, color: theme.color.brand };
            const color =
              dim.score >= 75 ? "#22c55e" : dim.score >= 60 ? meta.color : dim.score >= 40 ? "#f97316" : "#ef4444";
            return (
              <View key={key} style={styles.dimCard} testID={`life-dim-${key}`}>
                <View style={styles.dimHeader}>
                  <View style={[styles.dimIconWrap, { backgroundColor: `${meta.color}22` }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dimLabel}>{meta.label}</Text>
                    <Text style={styles.dimGrade}>{dim.grade}</Text>
                  </View>
                  <Text style={[styles.dimScore, { color }]}>{dim.score}</Text>
                </View>
                <View style={styles.dimBarTrack}>
                  <View style={[styles.dimBarFill, { width: `${dim.score}%`, backgroundColor: color }]} />
                </View>
                {dim.signals && dim.signals.length > 0 && (
                  <View style={styles.signalsList}>
                    {dim.signals.slice(0, 3).map((s, i) => (
                      <View key={i} style={styles.signalRow}>
                        <Ionicons name="ellipse" size={4} color={theme.color.onSurfaceSecondary} />
                        <Text style={styles.signalText}>{s}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          Scores update based on your goals, reminders, knowledge vault, finance data and contacts. Add more
          tracked items to make Nova's picture of your life sharper.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
  },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.lg,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  heroLeft: { flex: 1 },
  heroLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.4 },
  heroGrade: { fontFamily: theme.font.display, fontSize: 26, marginTop: 4 },
  heroSub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  section: { marginBottom: theme.spacing.xl },
  sectionTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: theme.spacing.md,
  },
  recCard: {
    flexDirection: "row",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.brand,
  },
  recIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  recHeader: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  recDim: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "600",
    flex: 1,
  },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  priorityText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.6 },
  recTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500", marginBottom: 2 },
  recWhy: { color: theme.color.onSurfaceSecondary, fontSize: 12, lineHeight: 17 },
  dimCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  dimHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  dimIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dimLabel: { color: theme.color.onSurface, fontSize: 15, fontWeight: "500" },
  dimGrade: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  dimScore: { fontFamily: theme.font.display, fontSize: 24 },
  dimBarTrack: {
    height: 6,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: theme.spacing.sm,
  },
  dimBarFill: { height: "100%", borderRadius: 3 },
  signalsList: { gap: 4 },
  signalRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  signalText: { color: theme.color.onSurfaceSecondary, fontSize: 12, flex: 1 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  footnote: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: theme.spacing.md,
  },
});
