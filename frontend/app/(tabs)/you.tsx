import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { LinearGradient } from "expo-linear-gradient";

import { theme } from "@/src/theme";
import { api } from "@/src/api";

interface Section {
  label: string;
  items: ItemConfig[];
}
interface ItemConfig {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  route?: string;
  action?: () => void;
  color?: string;
  testID: string;
}

export default function YouScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ email: string; name: string; picture?: string } | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [stats, setStats] = useState<{ messages: number; memories: number; sessions: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [me, gs, mems, sess] = await Promise.all([
        api.me().catch(() => null),
        api.googleStatus().catch(() => ({ connected: false })),
        api.listMemories().catch(() => []),
        api.listSessions().catch(() => []),
      ]);
      setProfile(me as any);
      setGoogleConnected(!!gs?.connected);
      setStats({
        messages: 0,
        memories: (mems as any[]).length,
        sessions: (sess as any[]).length,
      });
    } catch {
      // soft fail
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const connectGoogle = useCallback(async () => {
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${base}/api/google/auth-url`);
      const data = await res.json();
      if (!data?.url) return;
      if (Platform.OS === "web") {
        Linking.openURL(data.url);
      } else {
        await WebBrowser.openAuthSessionAsync(data.url, `${base}/api/google/callback`);
      }
      setTimeout(() => load(), 1200);
    } catch (e: any) {
      Alert.alert("Connect failed", e?.message || "");
    }
  }, [load]);

  const disconnectGoogle = useCallback(async () => {
    Alert.alert("Disconnect Google?", "ORA will lose access to your inbox & calendar.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          try {
            const base = process.env.EXPO_PUBLIC_BACKEND_URL;
            await fetch(`${base}/api/google/disconnect`, { method: "POST" });
            load();
          } catch (e: any) {
            Alert.alert("Failed", e?.message || "");
          }
        },
      },
    ]);
  }, [load]);

  const sections: Section[] = [
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
        { icon: "rocket-outline", label: "Chief of Staff", sub: "Daily prioritization", route: "/chief", testID: "you-chief" },
        { icon: "pulse-outline", label: "Life OS", sub: "Holistic life dashboard", route: "/life", testID: "you-life" },
        { icon: "journal-outline", label: "AI Journal", sub: "Auto-generated daily entries", route: "/journal", testID: "you-journal" },
        { icon: "search-outline", label: "Search Everything", route: "/search", testID: "you-search" },
        { icon: "git-network-outline", label: "Knowledge Graph", route: "/graph", testID: "you-graph" },
        { icon: "library-outline", label: "Knowledge Vault", sub: "Documents & RAG", route: "/knowledge", testID: "you-knowledge" },
      ],
    },
    {
      label: "MORE",
      items: [
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
          <LinearGradient
            colors={[theme.color.brandSecondary, theme.color.brand]}
            style={styles.profileAvatar}
          >
            <Text style={styles.profileInitial}>
              {(profile?.name || "U").charAt(0).toUpperCase()}
            </Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>
              {profile?.name || "Welcome to ORA OS"}
            </Text>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {profile?.email || "Connect Google to personalize"}
            </Text>
          </View>
          {googleConnected ? (
            <View style={styles.connectedDot}>
              <Ionicons name="checkmark-circle" size={20} color={theme.color.success} />
            </View>
          ) : (
            <Pressable
              style={styles.connectBtn}
              onPress={connectGoogle}
              testID="you-connect-google"
            >
              <Ionicons name="logo-google" size={14} color={theme.color.onBrand} />
              <Text style={styles.connectText}>Connect</Text>
            </Pressable>
          )}
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
              <Text style={styles.statVal}>
                <Ionicons name="sparkles" size={18} color={theme.color.brand} />
              </Text>
              <Text style={styles.statLbl}>ORA OS v1.0</Text>
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
                  style={[
                    styles.row,
                    idx < sec.items.length - 1 && styles.rowDivider,
                  ]}
                  onPress={() => {
                    if (it.action) it.action();
                    else if (it.route) router.push(it.route as any);
                  }}
                  testID={it.testID}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name={it.icon} size={18} color={it.color || theme.color.brand} />
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

        {/* Account actions */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.sectionCard}>
            {googleConnected && (
              <Pressable
                style={[styles.row, styles.rowDivider]}
                onPress={disconnectGoogle}
                testID="you-disconnect-google"
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="log-out-outline" size={18} color={theme.color.error} />
                </View>
                <Text style={[styles.rowLabel, { color: theme.color.error }]}>Disconnect Google</Text>
              </Pressable>
            )}
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name="information-circle-outline" size={18} color={theme.color.onSurfaceSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>About</Text>
                <Text style={styles.rowSub}>ORA OS · Version 1.0.0</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.tagline}>
          ORA — Your AI Operating System for life.
        </Text>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  headerTitle: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 26,
    letterSpacing: -0.3,
  },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitial: {
    color: theme.color.onBrand,
    fontFamily: theme.font.display,
    fontSize: 24,
  },
  profileName: { color: theme.color.onSurface, fontSize: 16, fontWeight: "600" },
  profileEmail: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
  },
  connectText: { color: theme.color.onBrand, fontSize: 12, fontWeight: "700" },
  connectedDot: { padding: 4 },
  statsRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  statBox: {
    flex: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  statVal: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  statLbl: { color: theme.color.onSurfaceSecondary, fontSize: 10, marginTop: 4, letterSpacing: 0.8 },
  section: { marginTop: theme.spacing.xl },
  sectionLabel: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.8,
    marginBottom: theme.spacing.sm,
  },
  sectionCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  rowSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  tagline: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    textAlign: "center",
    marginTop: theme.spacing.xl,
    fontStyle: "italic",
  },
});
