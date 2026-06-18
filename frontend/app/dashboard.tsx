import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface DashboardData {
  usage: {
    totals: { sessions: number; messages: number; memories: number; goals: number; reminders: number };
    daily_messages: Array<{ date: string; day: string; count: number }>;
    goals: { active: number; completed: number; average_progress: number };
    reminders: { pending: number; completed: number };
    memories_by_category: Record<string, number>;
  };
  spending: {
    has_data: boolean;
    currency?: string;
    summary?: {
      total_spent: number;
      total_received: number;
      net_flow: number;
      transaction_count: number;
      avg_daily_spend: number;
    };
    top_merchants?: Array<{ name: string; amount: number; percentage: number }>;
    daily_trend?: Array<{ date: string; spent: number; received: number }>;
  };
  productivity: {
    has_data: boolean;
    activity?: {
      total_interactions: number;
      user_messages: number;
      ai_responses: number;
      active_days: number;
    };
    peak_hours?: Array<{ hour: number; count: number; label: string }>;
    emotion_distribution?: Record<string, number>;
    completion_rates?: { goals: number; reminders: number };
  };
  insights: {
    insights: Array<{ type: string; priority: string; message: string }>;
  };
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState(30);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.dashboard(period);
      setData(d);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const formatCurrency = (amount: number, currency: string = "INR") => {
    const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency;
    return `${symbol}${amount.toLocaleString()}`;
  };

  return (
    <View style={styles.root} testID="dashboard-screen">
      <ScreenHeader title="Dashboard" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.color.brand}
          />
        }
      >
        {/* Period Selector */}
        <View style={styles.periodRow}>
          {[7, 30, 90].map((d) => (
            <Pressable
              key={d}
              style={[styles.periodBtn, period === d && styles.periodBtnActive]}
              onPress={() => setPeriod(d)}
            >
              <Text style={[styles.periodText, period === d && styles.periodTextActive]}>
                {d}d
              </Text>
            </Pressable>
          ))}
        </View>

        {data === null && !error ? (
          <View style={styles.loader}>
            <ActivityIndicator color={theme.color.brand} />
          </View>
        ) : null}

        {error && (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={18} color="#fff" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {data && (
          <>
            {/* Quick Stats */}
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Ionicons name="chatbubbles" size={24} color={theme.color.brand} />
                <Text style={styles.statValue}>{data.usage.totals.messages}</Text>
                <Text style={styles.statLabel}>Messages</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="sparkles" size={24} color={theme.color.brand} />
                <Text style={styles.statValue}>{data.usage.totals.memories}</Text>
                <Text style={styles.statLabel}>Memories</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="trophy" size={24} color={theme.color.brand} />
                <Text style={styles.statValue}>{data.usage.goals.active}</Text>
                <Text style={styles.statLabel}>Active Goals</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="alarm" size={24} color={theme.color.brand} />
                <Text style={styles.statValue}>{data.usage.reminders.pending}</Text>
                <Text style={styles.statLabel}>Pending</Text>
              </View>
            </View>

            {/* Activity Chart */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="bar-chart" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Activity (7 days)</Text>
              </View>
              <View style={styles.chartContainer}>
                {data.usage.daily_messages.map((d, i) => {
                  const max = Math.max(...data.usage.daily_messages.map((x) => x.count), 1);
                  const height = (d.count / max) * 80;
                  return (
                    <View key={i} style={styles.barCol}>
                      <View style={[styles.bar, { height: Math.max(height, 4) }]} />
                      <Text style={styles.barLabel}>{d.day}</Text>
                      <Text style={styles.barValue}>{d.count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Goal Progress */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="trophy-outline" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Goal Progress</Text>
              </View>
              <View style={styles.progressRow}>
                <View style={styles.progressItem}>
                  <Text style={styles.progressValue}>{data.usage.goals.completed}</Text>
                  <Text style={styles.progressLabel}>Completed</Text>
                </View>
                <View style={styles.progressItem}>
                  <Text style={styles.progressValue}>{data.usage.goals.active}</Text>
                  <Text style={styles.progressLabel}>In Progress</Text>
                </View>
                <View style={styles.progressItem}>
                  <Text style={styles.progressValue}>{data.usage.goals.average_progress}%</Text>
                  <Text style={styles.progressLabel}>Avg Progress</Text>
                </View>
              </View>
              <View style={styles.bigBar}>
                <View
                  style={[styles.bigBarFill, { width: `${data.usage.goals.average_progress}%` }]}
                />
              </View>
            </View>

            {/* Spending Insights */}
            {data.spending.has_data && data.spending.summary && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="wallet" size={20} color={theme.color.brand} />
                  <Text style={styles.cardTitle}>Spending ({period}d)</Text>
                </View>
                <View style={styles.spendingRow}>
                  <View style={styles.spendingItem}>
                    <Text style={styles.spendingLabel}>Spent</Text>
                    <Text style={[styles.spendingValue, { color: "#ef4444" }]}>
                      {formatCurrency(data.spending.summary.total_spent, data.spending.currency)}
                    </Text>
                  </View>
                  <View style={styles.spendingItem}>
                    <Text style={styles.spendingLabel}>Received</Text>
                    <Text style={[styles.spendingValue, { color: "#22c55e" }]}>
                      {formatCurrency(data.spending.summary.total_received, data.spending.currency)}
                    </Text>
                  </View>
                  <View style={styles.spendingItem}>
                    <Text style={styles.spendingLabel}>Net</Text>
                    <Text
                      style={[
                        styles.spendingValue,
                        { color: data.spending.summary.net_flow >= 0 ? "#22c55e" : "#ef4444" },
                      ]}
                    >
                      {formatCurrency(data.spending.summary.net_flow, data.spending.currency)}
                    </Text>
                  </View>
                </View>

                {data.spending.top_merchants && data.spending.top_merchants.length > 0 && (
                  <View style={styles.merchantsSection}>
                    <Text style={styles.subTitle}>Top Spending</Text>
                    {data.spending.top_merchants.slice(0, 5).map((m, i) => (
                      <View key={i} style={styles.merchantRow}>
                        <Text style={styles.merchantName}>{m.name}</Text>
                        <Text style={styles.merchantAmount}>
                          {formatCurrency(m.amount, data.spending.currency)} ({m.percentage}%)
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {!data.spending.has_data && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="wallet-outline" size={20} color={theme.color.brand} />
                  <Text style={styles.cardTitle}>Spending Insights</Text>
                </View>
                <Text style={styles.emptyText}>
                  No spending data yet. Banking notifications will appear here automatically.
                </Text>
              </View>
            )}

            {/* Productivity */}
            {data.productivity.has_data && data.productivity.activity && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="analytics" size={20} color={theme.color.brand} />
                  <Text style={styles.cardTitle}>Productivity</Text>
                </View>
                <View style={styles.productivityGrid}>
                  <View style={styles.productivityItem}>
                    <Text style={styles.productivityValue}>
                      {data.productivity.activity.total_interactions}
                    </Text>
                    <Text style={styles.productivityLabel}>Interactions</Text>
                  </View>
                  <View style={styles.productivityItem}>
                    <Text style={styles.productivityValue}>
                      {data.productivity.activity.active_days}
                    </Text>
                    <Text style={styles.productivityLabel}>Active Days</Text>
                  </View>
                  <View style={styles.productivityItem}>
                    <Text style={styles.productivityValue}>
                      {data.productivity.completion_rates?.goals || 0}%
                    </Text>
                    <Text style={styles.productivityLabel}>Goals Done</Text>
                  </View>
                  <View style={styles.productivityItem}>
                    <Text style={styles.productivityValue}>
                      {data.productivity.completion_rates?.reminders || 0}%
                    </Text>
                    <Text style={styles.productivityLabel}>Tasks Done</Text>
                  </View>
                </View>

                {data.productivity.peak_hours && data.productivity.peak_hours.length > 0 && (
                  <View style={styles.peakSection}>
                    <Text style={styles.subTitle}>Most Active Hours</Text>
                    <View style={styles.peakRow}>
                      {data.productivity.peak_hours.map((h, i) => (
                        <View key={i} style={styles.peakItem}>
                          <Text style={styles.peakTime}>{h.label}</Text>
                          <Text style={styles.peakCount}>{h.count} msgs</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* AI Insights */}
            {data.insights.insights.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="bulb" size={20} color={theme.color.brand} />
                  <Text style={styles.cardTitle}>AI Insights</Text>
                </View>
                {data.insights.insights.map((insight, i) => (
                  <View
                    key={i}
                    style={[
                      styles.insightRow,
                      insight.priority === "high" && styles.insightHigh,
                    ]}
                  >
                    <Ionicons
                      name={
                        insight.type === "goal"
                          ? "trophy"
                          : insight.type === "reminder"
                          ? "alarm"
                          : "sparkles"
                      }
                      size={16}
                      color={theme.color.brand}
                    />
                    <Text style={styles.insightText}>{insight.message}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Memory Categories */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="library" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Memory Bank</Text>
              </View>
              <View style={styles.categoryGrid}>
                {Object.entries(data.usage.memories_by_category).map(([cat, count]) => (
                  <View key={cat} style={styles.categoryItem}>
                    <Text style={styles.categoryCount}>{count}</Text>
                    <Text style={styles.categoryName}>{cat}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  loader: { paddingVertical: theme.spacing.xxxl, alignItems: "center" },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: "rgba(139,58,58,0.85)",
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  errorText: { color: "#fff", flex: 1, fontSize: 13 },
  periodRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    alignSelf: "center",
  },
  periodBtn: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  periodBtnActive: {
    backgroundColor: theme.color.brand,
    borderColor: theme.color.brand,
  },
  periodText: { color: theme.color.onSurface, fontSize: 13, fontWeight: "500" },
  periodTextActive: { color: theme.color.onBrand },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
  },
  statCard: {
    flex: 1,
    minWidth: (SCREEN_WIDTH - theme.spacing.lg * 2 - theme.spacing.md) / 2 - theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    alignItems: "center",
    gap: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  statValue: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 28,
  },
  statLabel: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    gap: theme.spacing.md,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  cardTitle: { flex: 1, color: theme.color.onSurface, fontSize: 15, fontWeight: "500" },
  chartContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 120,
    paddingTop: theme.spacing.md,
  },
  barCol: { alignItems: "center", flex: 1, gap: 4 },
  bar: {
    width: 24,
    backgroundColor: theme.color.brand,
    borderRadius: 4,
    minHeight: 4,
  },
  barLabel: { color: theme.color.onSurfaceSecondary, fontSize: 10 },
  barValue: { color: theme.color.onSurface, fontSize: 11, fontWeight: "600" },
  progressRow: { flexDirection: "row", justifyContent: "space-around" },
  progressItem: { alignItems: "center" },
  progressValue: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 24 },
  progressLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  bigBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.color.surfaceTertiary,
    overflow: "hidden",
  },
  bigBarFill: { height: "100%", backgroundColor: theme.color.brand },
  spendingRow: { flexDirection: "row", justifyContent: "space-around" },
  spendingItem: { alignItems: "center" },
  spendingLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 4 },
  spendingValue: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 18 },
  merchantsSection: { marginTop: theme.spacing.md },
  subTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: theme.spacing.sm,
  },
  merchantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.xs,
  },
  merchantName: { color: theme.color.onSurface, fontSize: 13 },
  merchantAmount: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  productivityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
  },
  productivityItem: {
    flex: 1,
    minWidth: "40%",
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
  },
  productivityValue: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  productivityLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  peakSection: { marginTop: theme.spacing.md },
  peakRow: { flexDirection: "row", gap: theme.spacing.md },
  peakItem: {
    flex: 1,
    backgroundColor: theme.color.surfaceTertiary,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    alignItems: "center",
  },
  peakTime: { color: theme.color.brand, fontSize: 12, fontWeight: "600" },
  peakCount: { color: theme.color.onSurfaceSecondary, fontSize: 10 },
  insightRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: theme.radius.md,
  },
  insightHigh: { borderLeftWidth: 3, borderLeftColor: theme.color.brand },
  insightText: { flex: 1, color: theme.color.onSurface, fontSize: 13, lineHeight: 18 },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  categoryItem: {
    backgroundColor: theme.color.surfaceTertiary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  categoryCount: { color: theme.color.brand, fontSize: 14, fontWeight: "600" },
  categoryName: { color: theme.color.onSurfaceSecondary, fontSize: 10, textTransform: "capitalize" },
});
