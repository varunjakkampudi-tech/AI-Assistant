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
  Modal,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface SpendingSummary {
  has_data: boolean;
  currency?: string;
  period_days?: number;
  summary?: {
    total_spent: number;
    total_received: number;
    net_flow: number;
    transaction_count: number;
    avg_daily_spend: number;
  };
  top_categories?: Array<{ name: string; amount: number; percentage: number }>;
  top_merchants?: Array<{ name: string; amount: number }>;
  daily_trend?: Array<{ date: string; spent: number; received: number }>;
}

interface Insight {
  type: string;
  priority: string;
  icon: string;
  message: string;
  detail?: string;
}

interface RecurringTx {
  merchant: string;
  amount: number;
  frequency: string;
  occurrences: number;
  category: string;
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  food: "restaurant",
  fuel: "car",
  shopping: "bag",
  transport: "bus",
  utilities: "flash",
  entertainment: "tv",
  health: "fitness",
  education: "school",
  investment: "trending-up",
  insurance: "shield-checkmark",
  rent: "home",
  subscription: "repeat",
  transfer: "swap-horizontal",
  other: "ellipsis-horizontal-circle",
};

const formatCurrency = (n: number, currency = "INR") => {
  if (n == null || isNaN(n)) return "—";
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  return `${symbol}${Math.round(n).toLocaleString("en-IN")}`;
};

export default function FinanceScreen() {
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [recurring, setRecurring] = useState<RecurringTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);
  const [showAddModal, setShowAddModal] = useState(false);
  const [txTitle, setTxTitle] = useState("");
  const [txText, setTxText] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, ins, rec] = await Promise.all([
        api.financeSpendingSummary(days),
        api.financeInsights(days).catch(() => []),
        api.financeRecurring().catch(() => []),
      ]);
      setSummary(s);
      setInsights(Array.isArray(ins) ? ins : []);
      setRecurring(Array.isArray(rec) ? rec : []);
    } catch (e) {
      console.warn("finance load failed", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

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

  const submitTransaction = async () => {
    if (!txText.trim()) return;
    setAdding(true);
    try {
      const r = await api.financeProcessNotification(txTitle.trim() || "Bank", txText.trim());
      if (r.is_transaction) {
        setShowAddModal(false);
        setTxTitle("");
        setTxText("");
        await load();
      } else {
        Alert.alert("Not detected", "Couldn't detect a transaction in that message.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to process");
    } finally {
      setAdding(false);
    }
  };

  const ranges: Array<{ label: string; value: number }> = [
    { label: "7d", value: 7 },
    { label: "30d", value: 30 },
    { label: "90d", value: 90 },
  ];

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Finance Brain" />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      </View>
    );
  }

  const currency = summary?.currency || "INR";

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Finance Brain"
        rightSlot={
          <Pressable
            style={styles.headerBtn}
            onPress={() => setShowAddModal(true)}
            testID="finance-add-btn"
          >
            <Ionicons name="add" size={22} color={theme.color.onSurface} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />
        }
        testID="finance-scroll"
      >
        {/* Range selector */}
        <View style={styles.rangeRow}>
          {ranges.map((r) => (
            <Pressable
              key={r.value}
              style={[styles.rangePill, days === r.value && styles.rangePillActive]}
              onPress={() => setDays(r.value)}
              testID={`finance-range-${r.value}`}
            >
              <Text
                style={[
                  styles.rangePillText,
                  days === r.value && styles.rangePillTextActive,
                ]}
              >
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Insights */}
        {insights.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Insights</Text>
            {insights.map((ins, idx) => (
              <View
                key={idx}
                style={[
                  styles.insightCard,
                  ins.priority === "high" && styles.insightHigh,
                  ins.priority === "low" && styles.insightLow,
                ]}
                testID={`finance-insight-${idx}`}
              >
                <View style={styles.insightIcon}>
                  <Ionicons
                    name={ins.icon as any}
                    size={20}
                    color={
                      ins.priority === "high"
                        ? "#ef4444"
                        : ins.priority === "low"
                        ? "#22c55e"
                        : theme.color.brand
                    }
                  />
                </View>
                <View style={styles.insightBody}>
                  <Text style={styles.insightMsg}>{ins.message}</Text>
                  {ins.detail ? <Text style={styles.insightDetail}>{ins.detail}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Summary */}
        {summary?.has_data && summary.summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Last {days} days</Text>
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Spent</Text>
                  <Text style={[styles.summaryValue, { color: "#ef4444" }]} testID="finance-spent">
                    {formatCurrency(summary.summary.total_spent, currency)}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Received</Text>
                  <Text style={[styles.summaryValue, { color: "#22c55e" }]} testID="finance-received">
                    {formatCurrency(summary.summary.total_received, currency)}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Net</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      { color: summary.summary.net_flow >= 0 ? "#22c55e" : "#ef4444" },
                    ]}
                    testID="finance-net"
                  >
                    {formatCurrency(summary.summary.net_flow, currency)}
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryFooter}>
                <Text style={styles.summaryFooterText}>
                  {summary.summary.transaction_count} txns · avg{" "}
                  {formatCurrency(summary.summary.avg_daily_spend, currency)}/day
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="wallet-outline" size={32} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No spending data yet</Text>
            <Text style={styles.emptyText}>
              Tap + to add a bank/UPI notification and Nova will categorize it automatically.
            </Text>
          </View>
        )}

        {/* Top categories */}
        {summary?.top_categories && summary.top_categories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top categories</Text>
            {summary.top_categories.slice(0, 6).map((cat, idx) => {
              const icon = CATEGORY_ICONS[cat.name] || "ellipsis-horizontal-circle";
              return (
                <View key={cat.name} style={styles.catRow} testID={`finance-cat-${cat.name}`}>
                  <View style={styles.catIconWrap}>
                    <Ionicons name={icon} size={18} color={theme.color.brand} />
                  </View>
                  <View style={styles.catBody}>
                    <View style={styles.catTopLine}>
                      <Text style={styles.catName}>{cat.name.charAt(0).toUpperCase() + cat.name.slice(1)}</Text>
                      <Text style={styles.catAmount}>{formatCurrency(cat.amount, currency)}</Text>
                    </View>
                    <View style={styles.catBar}>
                      <View style={[styles.catBarFill, { width: `${Math.min(100, cat.percentage)}%` }]} />
                    </View>
                    <Text style={styles.catPct}>{cat.percentage}% of total</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Top merchants */}
        {summary?.top_merchants && summary.top_merchants.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top merchants</Text>
            {summary.top_merchants.slice(0, 5).map((m) => (
              <View key={m.name} style={styles.merchantRow}>
                <Text style={styles.merchantName} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={styles.merchantAmount}>{formatCurrency(m.amount, currency)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Recurring */}
        {recurring.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recurring</Text>
            {recurring.map((r) => (
              <View key={r.merchant} style={styles.recurringRow}>
                <View style={styles.catIconWrap}>
                  <Ionicons name="repeat" size={18} color={theme.color.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.merchantName}>{r.merchant}</Text>
                  <Text style={styles.recurringMeta}>
                    {r.frequency} · {r.occurrences}x · {r.category}
                  </Text>
                </View>
                <Text style={styles.merchantAmount}>{formatCurrency(r.amount, currency)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAddModal(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add bank / UPI notification</Text>
            <Text style={styles.modalHint}>
              Paste a bank SMS or notification — Nova will detect amount, merchant and category.
            </Text>
            <TextInput
              value={txTitle}
              onChangeText={setTxTitle}
              placeholder="Title (e.g. HDFC Bank)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              style={styles.input}
              testID="finance-tx-title"
            />
            <TextInput
              value={txText}
              onChangeText={setTxText}
              placeholder="Message (e.g. Rs.500 debited at Swiggy on 19-Jun. Avl bal Rs.5000)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              style={[styles.input, { height: 100, textAlignVertical: "top" }]}
              multiline
              testID="finance-tx-text"
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnPrimary, adding && { opacity: 0.6 }]}
                onPress={submitTransaction}
                disabled={adding}
                testID="finance-tx-submit"
              >
                {adding ? (
                  <ActivityIndicator color={theme.color.onBrand} />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Process</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  rangeRow: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  rangePill: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  rangePillActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  rangePillText: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  rangePillTextActive: { color: theme.color.onBrand, fontWeight: "600" },
  section: { marginBottom: theme.spacing.xl },
  sectionTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: theme.spacing.md,
  },
  insightCard: {
    flexDirection: "row",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.brand,
  },
  insightHigh: { borderLeftColor: "#ef4444" },
  insightLow: { borderLeftColor: "#22c55e" },
  insightIcon: { width: 32, alignItems: "center", justifyContent: "center" },
  insightBody: { flex: 1 },
  insightMsg: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  insightDetail: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  summaryCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-around" },
  summaryItem: { alignItems: "center" },
  summaryLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginBottom: 4 },
  summaryValue: { fontFamily: theme.font.display, fontSize: 20 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.color.divider, marginVertical: theme.spacing.md },
  summaryFooter: { alignItems: "center" },
  summaryFooterText: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  catRow: { flexDirection: "row", gap: theme.spacing.md, marginBottom: theme.spacing.md },
  catIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  catBody: { flex: 1 },
  catTopLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  catName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  catAmount: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 14 },
  catBar: {
    height: 4,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 2,
    marginTop: 6,
    overflow: "hidden",
  },
  catBarFill: { height: "100%", backgroundColor: theme.color.brand, borderRadius: 2 },
  catPct: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 4 },
  merchantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
  },
  merchantName: { color: theme.color.onSurface, fontSize: 14, flex: 1 },
  merchantAmount: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 14 },
  recurringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
  },
  recurringMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  emptyCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  emptyTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 16 },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 13, textAlign: "center" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  modalCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  modalTitle: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 18,
    marginBottom: theme.spacing.xs,
  },
  modalHint: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 13,
    marginBottom: theme.spacing.md,
  },
  input: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    color: theme.color.onSurface,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    marginBottom: theme.spacing.sm,
  },
  modalActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  modalBtn: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnPrimary: { backgroundColor: theme.color.brand },
  modalBtnPrimaryText: { color: theme.color.onBrand, fontWeight: "600", fontSize: 14 },
  modalBtnSecondary: {
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  modalBtnSecondaryText: { color: theme.color.onSurface, fontSize: 14 },
});
