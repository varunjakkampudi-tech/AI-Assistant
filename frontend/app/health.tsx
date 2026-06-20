import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FeatureGate } from "@/src/features";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface Summary {
  count: number;
  latest: number;
  average: number;
  min: number;
  max: number;
  trend_pct: number;
  unit: string;
  last_logged_at?: string;
}

interface HealthSummary {
  days: number;
  summary: Record<string, Summary>;
  insights: Array<{ type: string; priority: string; icon: string; message: string; detail?: string }>;
  streaks: Record<string, number>;
  log_count: number;
}

const METRIC_META: Record<string, { label: string; icon: keyof typeof import("@expo/vector-icons/Ionicons").default.glyphMap; placeholder: string }> = {
  sleep_hours: { label: "Sleep", icon: "moon", placeholder: "Hours (e.g. 7.5)" },
  water_glasses: { label: "Water", icon: "water", placeholder: "Glasses (e.g. 8)" },
  workout_minutes: { label: "Workout", icon: "barbell", placeholder: "Minutes (e.g. 30)" },
  steps: { label: "Steps", icon: "walk", placeholder: "Count (e.g. 8500)" },
  weight_kg: { label: "Weight", icon: "fitness", placeholder: "Kg (e.g. 70.4)" },
  mood: { label: "Mood", icon: "happy", placeholder: "1-5" },
  calories: { label: "Calories", icon: "flame", placeholder: "kcal" },
};

export default function HealthScreen() {
  return (
    <FeatureGate feature="health">
      <HealthScreenInner />
    </FeatureGate>
  );
}

function HealthScreenInner() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeMetric, setActiveMetric] = useState<string>("sleep_hours");
  const [value, setValue] = useState("");
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.healthSummary(30);
      setSummary(s);
    } catch (e) { console.warn("health summary", e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onLog = async () => {
    const v = parseFloat(value);
    if (!value || isNaN(v) || v < 0) {
      Alert.alert("Invalid number", "Please enter a positive number.");
      return;
    }
    setLogging(true);
    try {
      await api.healthLog(activeMetric, v, "");
      setValue("");
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't log", e?.message || "");
    } finally {
      setLogging(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Health" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 64 }} />
        ) : (
          <>
            {/* Quick logger */}
            <View style={styles.loggerCard} testID="health-logger">
              <Text style={styles.sectionTitle}>Quick log</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {Object.entries(METRIC_META).map(([key, m]) => (
                  <Pressable
                    key={key}
                    onPress={() => { setActiveMetric(key); setValue(""); }}
                    style={[styles.metricPill, activeMetric === key && styles.metricPillActive]}
                    testID={`metric-${key}`}
                  >
                    <Ionicons name={m.icon} size={14} color={activeMetric === key ? theme.color.onBrand : theme.color.onSurface} />
                    <Text style={[styles.metricPillText, activeMetric === key && { color: theme.color.onBrand }]}>{m.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.loggerRow}>
                <TextInput
                  style={styles.input}
                  value={value}
                  onChangeText={setValue}
                  placeholder={METRIC_META[activeMetric].placeholder}
                  placeholderTextColor={theme.color.onSurfaceSecondary}
                  keyboardType="decimal-pad"
                  testID="health-input"
                />
                <Pressable
                  style={[styles.logBtn, logging && { opacity: 0.6 }]}
                  onPress={onLog}
                  disabled={logging}
                  testID="health-log-btn"
                >
                  {logging ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : <Text style={styles.logBtnText}>Log</Text>}
                </Pressable>
              </View>
            </View>

            {/* Insights */}
            {summary && summary.insights.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Insights</Text>
                {summary.insights.map((ins, i) => (
                  <View
                    key={i}
                    style={[
                      styles.insightCard,
                      ins.priority === "high" && { borderLeftColor: "#ef4444" },
                      ins.priority === "low" && { borderLeftColor: "#22c55e" },
                    ]}
                    testID={`health-insight-${i}`}
                  >
                    <Ionicons name={(ins.icon as any) || "alert-circle"} size={20} color={theme.color.brand} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.insightTitle}>{ins.message}</Text>
                      {!!ins.detail && <Text style={styles.insightDetail}>{ins.detail}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Metric cards */}
            {summary && Object.keys(summary.summary).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Last {summary.days} days</Text>
                {Object.entries(summary.summary).map(([metric, s]) => {
                  const meta = METRIC_META[metric] || { label: metric, icon: "ellipse" as any, placeholder: "" };
                  const streak = summary.streaks[metric] || 0;
                  return (
                    <View key={metric} style={styles.metricCard} testID={`health-card-${metric}`}>
                      <View style={styles.metricHead}>
                        <Ionicons name={meta.icon} size={18} color={theme.color.brand} />
                        <Text style={styles.metricLabel}>{meta.label}</Text>
                        {streak > 0 && (
                          <View style={styles.streakPill}>
                            <Ionicons name="flame" size={11} color={theme.color.onBrand} />
                            <Text style={styles.streakText}>{streak}d</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.metricRow}>
                        <Text style={styles.metricValue}>{s.latest} <Text style={styles.metricUnit}>{s.unit}</Text></Text>
                        <Text style={styles.metricMeta}>avg {s.average} · min {s.min} · max {s.max}</Text>
                      </View>
                      <View style={styles.trendRow}>
                        <Ionicons
                          name={s.trend_pct >= 0 ? "trending-up" : "trending-down"}
                          size={12}
                          color={s.trend_pct >= 0 ? "#22c55e" : "#ef4444"}
                        />
                        <Text style={[styles.trendText, { color: s.trend_pct >= 0 ? "#22c55e" : "#ef4444" }]}>
                          {s.trend_pct >= 0 ? "+" : ""}{s.trend_pct}%
                        </Text>
                        <Text style={styles.metricMeta}> · {s.count} logs</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {summary && summary.log_count === 0 && (
              <View style={styles.empty}>
                <Ionicons name="fitness-outline" size={36} color={theme.color.onSurfaceSecondary} />
                <Text style={styles.emptyTitle}>No health data yet</Text>
                <Text style={styles.emptyText}>Log a metric above — ORA starts spotting trends from day 1.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  sectionTitle: { color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: theme.spacing.sm },
  section: { gap: theme.spacing.sm },
  loggerCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  metricPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: theme.spacing.md, paddingVertical: 6,
    borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceTertiary,
  },
  metricPillActive: { backgroundColor: theme.color.brand },
  metricPillText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "500" },
  loggerRow: { flexDirection: "row", gap: theme.spacing.sm },
  input: {
    flex: 1, backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    color: theme.color.onSurface, fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  logBtn: {
    paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
    backgroundColor: theme.color.brand, borderRadius: theme.radius.md,
    alignItems: "center", justifyContent: "center", minWidth: 64,
  },
  logBtnText: { color: theme.color.onBrand, fontWeight: "600" },
  insightCard: {
    flexDirection: "row", gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderLeftWidth: 3, borderLeftColor: theme.color.brand,
    alignItems: "center",
    marginBottom: theme.spacing.sm,
  },
  insightTitle: { color: theme.color.onSurface, fontSize: 13, fontWeight: "500" },
  insightDetail: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  metricCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    gap: 6,
    marginBottom: theme.spacing.sm,
  },
  metricHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  metricLabel: { flex: 1, color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  streakPill: {
    flexDirection: "row", alignItems: "center", gap: 2,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: theme.radius.pill, backgroundColor: theme.color.brand,
  },
  streakText: { color: theme.color.onBrand, fontSize: 10, fontWeight: "700" },
  metricRow: { flexDirection: "row", alignItems: "baseline", gap: theme.spacing.sm },
  metricValue: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  metricUnit: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  metricMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  trendText: { fontSize: 11, fontWeight: "600" },
  empty: { alignItems: "center", paddingTop: theme.spacing.xxxl, gap: theme.spacing.sm },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "500" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", paddingHorizontal: 24 },
});
