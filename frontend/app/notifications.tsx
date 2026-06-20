import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface Notif {
  id: string;
  package_name?: string | null;
  title: string;
  text: string;
  sub_text?: string;
  posted_at: string;
  received_at: string;
  kind?: string | null;
  amount?: number | null;
  currency?: string | null;
  direction?: string | null;
  merchant?: string | null;
}

const KIND_TABS: { key: string | null; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: null, label: "All", icon: "albums-outline" },
  { key: "transaction", label: "Money", icon: "wallet-outline" },
  { key: "message", label: "Messages", icon: "chatbubble-outline" },
  { key: "other", label: "Other", icon: "ellipsis-horizontal" },
];

function kindMeta(n: Notif): { icon: keyof typeof Ionicons.glyphMap; color: string; label: string } {
  if (n.kind === "transaction") {
    const debit = n.direction === "debit";
    return {
      icon: debit ? "arrow-up-circle" : "arrow-down-circle",
      color: debit ? "#ef4444" : "#22c55e",
      label: debit ? "Debit" : "Credit",
    };
  }
  if (n.kind === "message")
    return { icon: "chatbubble-ellipses", color: theme.color.brand, label: "Message" };
  return { icon: "notifications", color: theme.color.onSurfaceSecondary, label: n.package_name || "Push" };
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<Notif[]>([]);
  const [tab, setTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<Notif | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listNotifications(tab ?? undefined);
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("notifications load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const deleteOne = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.deleteNotification(id);
      setItems((s) => s.filter((n) => n.id !== id));
      if (open?.id === id) setOpen(null);
    } catch (e: any) {
      Alert.alert("Couldn't delete", e?.message || "");
    } finally {
      setBusyId(null);
    }
  }, [open]);

  const confirmDelete = useCallback((n: Notif) => {
    const msg = n.title || n.text || "this notification";
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Delete "${msg}"?`)) deleteOne(n.id);
      return;
    }
    Alert.alert("Delete?", msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteOne(n.id) },
    ]);
  }, [deleteOne]);

  const clearAll = useCallback(async () => {
    const doClear = async () => {
      setClearing(true);
      try {
        const res = await api.clearNotifications(tab ?? undefined);
        setItems([]);
        setOpen(null);
        if (Platform.OS !== "web") Alert.alert("Cleared", `Removed ${res.deleted} item${res.deleted === 1 ? "" : "s"}.`);
      } catch (e: any) {
        Alert.alert("Couldn't clear", e?.message || "");
      } finally {
        setClearing(false);
      }
    };
    const scope = tab ? `all ${tab} notifications` : "ALL notifications";
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Clear ${scope}? This can't be undone.`)) doClear();
      return;
    }
    Alert.alert(`Clear ${scope}?`, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: doClear },
    ]);
  }, [tab]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const n of items) {
      const k = n.kind || "other";
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [items]);

  return (
    <View style={styles.root} testID="notifications-screen">
      <ScreenHeader
        title="Notifications"
        rightSlot={
          <Pressable
            style={[styles.headerBtn, (items.length === 0 || clearing) && { opacity: 0.4 }]}
            onPress={clearAll}
            disabled={items.length === 0 || clearing}
            testID="notifications-clear-all"
            hitSlop={8}
          >
            {clearing ? (
              <ActivityIndicator size="small" color={theme.color.onSurface} />
            ) : (
              <Ionicons name="trash-bin-outline" size={18} color={theme.color.onSurface} />
            )}
          </Pressable>
        }
      />

      <View style={styles.tabsRow}>
        {KIND_TABS.map((t) => {
          const active = tab === t.key;
          const c = t.key === null ? counts.all : counts[t.key] || 0;
          return (
            <Pressable
              key={t.label}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              testID={`notif-tab-${t.label.toLowerCase()}`}
            >
              <Ionicons
                name={t.icon}
                size={13}
                color={active ? theme.color.onBrand : theme.color.onSurface}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              {c > 0 && (
                <View style={[styles.countDot, active && { backgroundColor: theme.color.onBrand }]}>
                  <Text style={[styles.countDotText, active && { color: theme.color.brand }]}>{c}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={theme.color.brand}
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 64 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={42} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyText}>
              Bank alerts, app pushes and ORA pings will appear here. Tap one to read it, or use the trash
              icon to clear it.
            </Text>
          </View>
        ) : (
          items.map((n) => {
            const meta = kindMeta(n);
            return (
              <Pressable
                key={n.id}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                onPress={() => setOpen(n)}
                testID={`notif-row-${n.id}`}
              >
                <View style={[styles.icon, { backgroundColor: `${meta.color}22` }]}>
                  <Ionicons name={meta.icon} size={18} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title} numberOfLines={1}>
                      {n.title || meta.label}
                    </Text>
                    {n.kind === "transaction" && n.amount != null && (
                      <Text style={[styles.amount, { color: meta.color }]}>
                        {n.direction === "debit" ? "-" : "+"}
                        {n.currency || ""}
                        {n.amount}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.snippet} numberOfLines={2}>
                    {n.text || n.sub_text || ""}
                  </Text>
                  <Text style={styles.meta}>{relativeTime(n.posted_at || n.received_at)}</Text>
                </View>
                <Pressable
                  hitSlop={8}
                  style={styles.trashBtn}
                  onPress={(e) => { e.stopPropagation?.(); confirmDelete(n); }}
                  disabled={busyId === n.id}
                  testID={`notif-trash-${n.id}`}
                >
                  {busyId === n.id ? (
                    <ActivityIndicator size="small" color={theme.color.onSurfaceSecondary} />
                  ) : (
                    <Ionicons name="trash-outline" size={16} color={theme.color.onSurfaceSecondary} />
                  )}
                </Pressable>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Detail modal */}
      <Modal
        visible={!!open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(null)}
      >
        <View style={styles.modalRoot} testID="notif-detail-modal">
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {open?.title || kindMeta(open as Notif).label}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => setOpen(null)}
                testID="notif-detail-close"
              >
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            {open && (
              <>
                <Text style={styles.modalMeta}>
                  {open.package_name || "Push"} · {relativeTime(open.posted_at || open.received_at)}
                </Text>
                {open.kind === "transaction" && open.amount != null && (
                  <View style={styles.txCard}>
                    <Text style={[styles.txAmount, { color: kindMeta(open).color }]}>
                      {open.direction === "debit" ? "−" : "+"}
                      {open.currency || ""} {open.amount}
                    </Text>
                    {!!open.merchant && <Text style={styles.txMerchant}>{open.merchant}</Text>}
                  </View>
                )}
                <ScrollView style={{ maxHeight: 320 }}>
                  <Text style={styles.modalBody}>{open.text || open.sub_text || ""}</Text>
                </ScrollView>
                <View style={styles.modalActions}>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnGhost]}
                    onPress={() => setOpen(null)}
                  >
                    <Text style={styles.modalBtnGhostText}>Close</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnDanger]}
                    onPress={() => confirmDelete(open)}
                    disabled={busyId === open.id}
                    testID="notif-detail-delete"
                  >
                    {busyId === open.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="trash" size={14} color="#fff" />
                        <Text style={styles.modalBtnDangerText}>Delete</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
  },
  tabActive: { backgroundColor: theme.color.brand },
  tabText: { color: theme.color.onSurface, fontSize: 11, fontWeight: "600" },
  tabTextActive: { color: theme.color.onBrand },
  countDot: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: theme.color.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  countDotText: { color: theme.color.onSurface, fontSize: 9, fontWeight: "700" },

  content: { padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: theme.spacing.xxxl },

  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  amount: { fontSize: 13, fontWeight: "700" },
  snippet: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  meta: { color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 4, opacity: 0.7 },
  trashBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },

  empty: { alignItems: "center", gap: theme.spacing.sm, paddingTop: theme.spacing.xxxl },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "500" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", paddingHorizontal: 36 },

  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: theme.color.surface,
    padding: theme.spacing.lg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.brandSecondary,
  },
  modalHead: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.md },
  modalTitle: { flex: 1, color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 18 },
  modalMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  modalBody: { color: theme.color.onSurface, fontSize: 14, lineHeight: 20, marginTop: theme.spacing.sm },
  txCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  txAmount: { fontFamily: theme.font.display, fontSize: 22, fontWeight: "700" },
  txMerchant: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 4 },

  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
  },
  modalBtnGhost: { backgroundColor: theme.color.surfaceSecondary },
  modalBtnGhostText: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600" },
  modalBtnDanger: { backgroundColor: "#b91c1c" },
  modalBtnDangerText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
