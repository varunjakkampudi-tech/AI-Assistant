import React, { useMemo } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/src/theme";
import { useColors } from "@/src/auth";

interface Item {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  route: string;
  testID: string;
}

const SECTIONS: { label: string; items: Item[] }[] = [
  {
    label: "DAILY",
    items: [
      { icon: "sunny-outline", label: "Daily briefing", sub: "Morning headlines + your calendar", route: "/briefing", testID: "menu-briefing" },
      { icon: "rocket-outline", label: "Chief of Staff", sub: "Smart priorities & nudges", route: "/chief", testID: "menu-chief" },
      { icon: "pulse-outline", label: "Life OS", sub: "Habits, streaks, energy", route: "/life", testID: "menu-life" },
      { icon: "alarm-outline", label: "Reminders", sub: "Tasks & smart nudges", route: "/reminders", testID: "menu-reminders" },
      { icon: "trophy-outline", label: "Goals", sub: "Long-term objectives", route: "/goals", testID: "menu-goals" },
    ],
  },
  {
    label: "MONEY & WORK",
    items: [
      { icon: "wallet-outline", label: "Finance Brain", sub: "Spending, income, recurring", route: "/finance", testID: "menu-finance" },
      { icon: "briefcase-outline", label: "Career Copilot", sub: "Resume, jobs, auto-apply", route: "/career", testID: "menu-career" },
      { icon: "analytics-outline", label: "Dashboard", sub: "Everything at a glance", route: "/dashboard", testID: "menu-dashboard" },
    ],
  },
  {
    label: "WELLBEING",
    items: [
      { icon: "fitness-outline", label: "Health", sub: "Sleep, steps, workouts", route: "/health", testID: "menu-health" },
      { icon: "journal-outline", label: "AI Journal", sub: "Voice & text reflections", route: "/journal", testID: "menu-journal" },
      { icon: "people-outline", label: "Family Hub", sub: "Shared notes & events", route: "/family", testID: "menu-family" },
    ],
  },
  {
    label: "KNOWLEDGE",
    items: [
      { icon: "library-outline", label: "Knowledge Vault", sub: "Docs, contracts, receipts", route: "/knowledge", testID: "menu-knowledge" },
      { icon: "git-network-outline", label: "Knowledge Graph", sub: "Your second brain visualised", route: "/graph", testID: "menu-graph" },
      { icon: "search-outline", label: "Search everything", sub: "Across memory + vault", route: "/search", testID: "menu-search" },
      { icon: "sparkles-outline", label: "Memories", sub: "Everything ORA remembers", route: "/memories", testID: "menu-memories" },
    ],
  },
  {
    label: "COMMUNICATE",
    items: [
      { icon: "chatbubbles-outline", label: "Conversations", sub: "Chat history", route: "/history", testID: "menu-history" },
      { icon: "call-outline", label: "AI Calls", sub: "Place + screen calls", route: "/calls", testID: "menu-calls" },
      { icon: "person-circle-outline", label: "Digital Twin", sub: "Your style profile", route: "/twin", testID: "menu-twin" },
    ],
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onNewChat?: () => void;
}

export default function MenuSheet({ visible, onClose, onNewChat }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const open = (route: string) => {
    onClose();
    setTimeout(() => router.push(route as any), 80);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="menu-backdrop">
        <Pressable
          style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + theme.spacing.xl }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.topRow}>
            <View style={styles.handle} />
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} testID="menu-close">
              <Ionicons name="close" size={20} color={c.onSurfaceSecondary} />
            </Pressable>
          </View>
          <Text style={styles.title}>Everything in ORA OS</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            {onNewChat && (
              <Pressable
                style={[styles.row, styles.brandRow]}
                onPress={() => {
                  onClose();
                  onNewChat();
                }}
                testID="menu-new-chat"
              >
                <View style={[styles.iconWrap, { backgroundColor: c.brand }]}>
                  <Ionicons name="create" size={18} color={c.onBrand} />
                </View>
                <Text style={[styles.rowLabel, { color: c.brand, fontWeight: "600" }]}>Start a new chat</Text>
                <Ionicons name="chevron-forward" size={16} color={c.brand} />
              </Pressable>
            )}
            {SECTIONS.map((sec) => (
              <View key={sec.label} style={{ marginTop: theme.spacing.lg }}>
                <Text style={styles.sectionLabel}>{sec.label}</Text>
                <View style={styles.sectionCard}>
                  {sec.items.map((it, idx) => (
                    <Pressable
                      key={it.route}
                      style={[styles.row, idx < sec.items.length - 1 && styles.rowDivider]}
                      onPress={() => open(it.route)}
                      testID={it.testID}
                    >
                      <View style={styles.iconWrap}>
                        <Ionicons name={it.icon} size={18} color={c.brand} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>{it.label}</Text>
                        {!!it.sub && <Text style={styles.rowSub} numberOfLines={1}>{it.sub}</Text>}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={c.onSurfaceSecondary} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: theme.spacing.lg,
    maxHeight: "92%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  topRow: { flexDirection: "row", alignItems: "center", marginBottom: theme.spacing.sm },
  handle: { flex: 1, alignSelf: "center", height: 4, maxWidth: 40, marginLeft: 40, borderRadius: 2, backgroundColor: c.borderStrong },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  title: {
    color: c.onSurface, fontFamily: theme.font.display,
    fontSize: 26, letterSpacing: -0.3, marginBottom: 4,
  },
  sectionLabel: {
    color: c.onSurfaceSecondary, fontSize: 11, fontWeight: "600",
    letterSpacing: 1.8, marginBottom: theme.spacing.sm,
  },
  sectionCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
  },
  brandRow: {
    backgroundColor: c.brandTertiary,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.brandSecondary,
    marginTop: theme.spacing.md,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider },
  iconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { color: c.onSurface, fontSize: 14, fontWeight: "500" },
  rowSub: { color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
});
