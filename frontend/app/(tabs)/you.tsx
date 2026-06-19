import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Image as RNImage,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { theme } from "@/src/theme";
import { useAuth, authedFetch } from "@/src/auth";
import { api } from "@/src/api";

interface ItemConfig {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  route?: string;
  testID: string;
}

export default function YouScreen() {
  const router = useRouter();
  const { user, accessToken, signOut } = useAuth();
  const [stats, setStats] = useState<{ memories: number; sessions: number; activeSessions: number } | null>(null);
  const [expoInfo, setExpoInfo] = useState<{ qr_image_url: string; preview_url: string; expo_go_ios: string; expo_go_android: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [mems, sess, secSess] = await Promise.all([
        api.listMemories().catch(() => []),
        api.listSessions().catch(() => []),
        authedFetch("/api/security/sessions", accessToken).then((r) => r.ok ? r.json() : { sessions: [] }),
      ]);
      setStats({
        memories: (mems as any[]).length,
        sessions: (sess as any[]).length,
        activeSessions: (secSess.sessions || []).length,
      });
    } catch { /* soft fail */ }
    try {
      const r = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/expo-qr`);
      if (r.ok) setExpoInfo(await r.json());
    } catch { /* ignore */ }
  }, [accessToken]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sections: { label: string; items: ItemConfig[] }[] = [
    {
      label: "ACCOUNT",
      items: [
        { icon: "settings-outline", label: "Settings", sub: "Theme, privacy, cookies, notifications", route: "/settings", testID: "you-settings" },
        { icon: "shield-checkmark-outline", label: "Security Center", sub: "Sessions, audit log, breach alerts", route: "/security", testID: "you-security" },
        { icon: "help-circle-outline", label: "Help & Support", sub: "FAQ, contact, report a bug", route: "/help", testID: "you-help" },
      ],
    },
    {
      label: "EXPLORE",
      items: [
        { icon: "sunny-outline", label: "Daily Briefing", route: "/briefing", testID: "you-briefing" },
        { icon: "wallet-outline", label: "Finance", sub: "Spending, insights, recurring", route: "/finance", testID: "you-finance" },
        { icon: "fitness-outline", label: "Health", sub: "Sleep, steps, workouts", route: "/health", testID: "you-health" },
        { icon: "briefcase-outline", label: "Career Copilot", sub: "Jobs, resume, applications", route: "/career", testID: "you-career" },
        { icon: "trophy-outline", label: "Goals", sub: "Active objectives", route: "/goals", testID: "you-goals" },
        { icon: "alarm-outline", label: "Reminders", sub: "Tasks & smart nudges", route: "/reminders", testID: "you-reminders" },
      ],
    },
    {
      label: "AI POWER TOOLS",
      items: [
        { icon: "rocket-outline", label: "Chief of Staff", route: "/chief", testID: "you-chief" },
        { icon: "pulse-outline", label: "Life OS", route: "/life", testID: "you-life" },
        { icon: "journal-outline", label: "AI Journal", route: "/journal", testID: "you-journal" },
        { icon: "search-outline", label: "Search Everything", route: "/search", testID: "you-search" },
        { icon: "git-network-outline", label: "Knowledge Graph", route: "/graph", testID: "you-graph" },
        { icon: "library-outline", label: "Knowledge Vault", route: "/knowledge", testID: "you-knowledge" },
        { icon: "people-outline", label: "Family Hub", route: "/family", testID: "you-family" },
        { icon: "person-circle-outline", label: "Digital Twin", route: "/twin", testID: "you-twin" },
        { icon: "call-outline", label: "AI Calls", route: "/calls", testID: "you-calls" },
        { icon: "chatbubbles-outline", label: "Conversations", route: "/history", testID: "you-history" },
        { icon: "analytics-outline", label: "Dashboard", route: "/dashboard", testID: "you-dashboard" },
      ],
    },
  ];

  return (
    <View style={styles.root} testID="you-screen">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: theme.color.surface }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>You</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile card */}
        <View style={styles.profileCard} testID="you-profile-card">
          <LinearGradient colors={[theme.color.brandSecondary, theme.color.brand]} style={styles.profileAvatar}>
            <Text style={styles.profileInitial}>
              {(user?.name || user?.email || "U").charAt(0).toUpperCase()}
            </Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user?.name || "ORA member"}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{user?.email || "—"}</Text>
            <Text style={styles.providerTag}>
              <Ionicons
                name={user?.provider === "google" ? "logo-google" : user?.provider === "apple" ? "logo-apple" : "mail"}
                size={10}
                color={theme.color.brand}
              /> {user?.provider === "email_otp" ? "Email OTP" : (user?.provider || "—")}
            </Text>
          </View>
          <Pressable style={styles.signoutBtn} onPress={signOut} testID="you-signout">
            <Ionicons name="log-out-outline" size={18} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        </View>

        {/* Stats */}
        {stats && (
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{stats.memories}</Text>
              <Text style={styles.statLbl}>Memories</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{stats.sessions}</Text>
              <Text style={styles.statLbl}>Conversations</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{stats.activeSessions}</Text>
              <Text style={styles.statLbl}>Devices</Text>
            </View>
          </View>
        )}

        {/* Expo QR card */}
        {expoInfo && (
          <View style={styles.expoCard} testID="expo-qr-card">
            <View style={styles.expoLeft}>
              <Text style={styles.expoLabel}>OPEN ON PHONE</Text>
              <Text style={styles.expoTitle}>Scan with Expo Go</Text>
              <Text style={styles.expoSub}>Install Expo Go, then point your camera here.</Text>
              <View style={styles.expoBtns}>
                <Pressable style={styles.expoBtn} onPress={() => Linking.openURL(expoInfo.expo_go_ios)} testID="expo-go-ios">
                  <Ionicons name="logo-apple" size={12} color={theme.color.brand} />
                  <Text style={styles.expoBtnText}>iOS</Text>
                </Pressable>
                <Pressable style={styles.expoBtn} onPress={() => Linking.openURL(expoInfo.expo_go_android)} testID="expo-go-android">
                  <Ionicons name="logo-android" size={12} color={theme.color.brand} />
                  <Text style={styles.expoBtnText}>Android</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.qrFrame}>
              <RNImage source={{ uri: expoInfo.qr_image_url }} style={styles.qrImage} resizeMode="contain" />
            </View>
          </View>
        )}

        {/* Sections */}
        {sections.map((sec) => (
          <View key={sec.label} style={styles.section}>
            <Text style={styles.sectionLabel}>{sec.label}</Text>
            <View style={styles.sectionCard}>
              {sec.items.map((it, idx) => (
                <Pressable
                  key={it.label}
                  style={[styles.row, idx < sec.items.length - 1 && styles.rowDivider]}
                  onPress={() => it.route && router.push(it.route as any)}
                  testID={it.testID}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name={it.icon} size={18} color={theme.color.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{it.label}</Text>
                    {!!it.sub && <Text style={styles.rowSub}>{it.sub}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.tagline}>ORA OS · v1.0.0 · Your AI Operating System for life.</Text>

        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  headerTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 26, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  profileCard: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  profileAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  profileInitial: { color: theme.color.onBrand, fontFamily: theme.font.display, fontSize: 24 },
  profileName: { color: theme.color.onSurface, fontSize: 16, fontWeight: "600" },
  profileEmail: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  providerTag: { color: theme.color.brand, fontSize: 10, marginTop: 4, letterSpacing: 1 },
  signoutBtn: { padding: 8 },
  statsRow: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  statBox: {
    flex: 1, backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  statVal: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  statLbl: { color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 4, letterSpacing: 0.8 },
  expoCard: {
    flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.md,
    backgroundColor: theme.color.brandTertiary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.brandSecondary,
    alignItems: "center",
  },
  expoLeft: { flex: 1, gap: 4 },
  expoLabel: { color: theme.color.brand, fontSize: 9, fontWeight: "700", letterSpacing: 1.8 },
  expoTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 18 },
  expoSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  expoBtns: { flexDirection: "row", gap: 6, marginTop: 6 },
  expoBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: theme.color.surfaceSecondary,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  expoBtnText: { color: theme.color.brand, fontSize: 11, fontWeight: "600" },
  qrFrame: {
    width: 92, height: 92, borderRadius: theme.radius.md,
    backgroundColor: "#fff",
    padding: 4, alignItems: "center", justifyContent: "center",
  },
  qrImage: { width: "100%", height: "100%" },
  section: { marginTop: theme.spacing.xl },
  sectionLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "600", letterSpacing: 1.8, marginBottom: theme.spacing.sm },
  sectionCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.divider },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  rowSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  tagline: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", marginTop: theme.spacing.xl, fontStyle: "italic" },
});
