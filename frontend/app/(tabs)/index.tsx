import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import VoiceOrb from "@/src/components/VoiceOrb";
import { useAuth, useColors } from "@/src/auth";
import ProfileSheet from "@/src/components/ProfileSheet";
import MenuSheet from "@/src/components/MenuSheet";

interface Briefing {
  greeting: string;
  name: string | null;
  weather: { temperature_c: number; summary: string } | null;
  pending_reminders: Array<{ id: string; text: string }>;
  active_goals: Array<{ id: string; title: string; progress: number }>;
  upcoming_events?: Array<{ id: string; summary: string; start: string }>;
  recent_emails?: Array<{ id: string; subject: string; unread: boolean }>;
  missed_calls?: Array<any>;
  session_count: number;
}

interface OverviewItem {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  testID: string;
}

interface QuickAction {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  testID: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Ask AI", icon: "sparkles", route: "/ask", testID: "qa-ask" },
  { label: "Add Task", icon: "checkbox-outline", route: "/reminders", testID: "qa-task" },
  { label: "Log Health", icon: "heart-outline", route: "/health", testID: "qa-health" },
  { label: "Scan Docs", icon: "scan-outline", route: "/knowledge", testID: "qa-docs" },
];

export default function HomeScreen() {
  const router = useRouter();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { user } = useAuth();
  const initial = (user?.name || user?.email || "U").charAt(0).toUpperCase();
  const [data, setData] = useState<Briefing | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const load = useCallback(async () => {
    let lat: number | null = null;
    let lon: number | null = null;
    const tzOffset = -new Date().getTimezoneOffset();
    if (Platform.OS !== "web") {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const pos = await Promise.race<any>([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("t")), 4000)),
          ]).catch(() => null);
          if (pos) { lat = pos.coords.latitude; lon = pos.coords.longitude; }
        }
      } catch { /* ignore */ }
    }
    try {
      const d = await api.briefing(lat, lon, tzOffset);
      setData(d as Briefing);
    } catch {
      // soft fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const priorityCount = (data?.pending_reminders.length || 0)
    + (data?.upcoming_events?.length || 0)
    + (data?.active_goals?.length || 0);

  const overview: OverviewItem[] = [
    { label: "Messages", value: data?.recent_emails?.length ?? 0, icon: "chatbubble-ellipses", testID: "ov-messages" },
    { label: "Events", value: data?.upcoming_events?.length ?? 0, icon: "calendar", testID: "ov-events" },
    { label: "Tasks", value: data?.pending_reminders?.length ?? 0, icon: "checkbox", testID: "ov-tasks" },
    {
      label: "Focus Score",
      value: data ? Math.min(99, 60 + (data.active_goals?.length || 0) * 6 + (data.session_count || 0)) : 0,
      icon: "trending-up", testID: "ov-focus",
    },
  ];

  const greeting = data ? (data.name ? `${data.greeting}, ${data.name}` : data.greeting) : "Welcome";

  return (
    <View style={styles.root} testID="home-screen">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: c.surface }}>
        <View style={styles.topBar}>
          <Pressable
            style={styles.avatarBtn}
            onPress={() => setShowProfile(true)}
            testID="home-avatar-button"
          >
            <LinearGradient
              colors={[c.brandSecondary, c.brand]}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarInitial} testID="home-avatar-initial">{initial}</Text>
            </LinearGradient>
          </Pressable>
          <View style={styles.brandWrap} pointerEvents="none">
            <Text style={styles.brandWord} testID="home-brand">ORA OS</Text>
          </View>
          <Pressable
            style={styles.iconBtn}
            onPress={() => setShowMenu(true)}
            hitSlop={10}
            testID="home-menu-button"
          >
            <Ionicons name="menu" size={20} color={c.onSurface} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brand} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting */}
        <View style={styles.greetingWrap}>
          <View style={styles.greetingRow}>
            <Text style={styles.greetingText} testID="home-greeting">
              {greeting}
            </Text>
            <Text style={styles.wave}> 👋</Text>
          </View>
          <Text style={styles.greetingSub}>
            Here&apos;s your {timeOfDay()} briefing
          </Text>
        </View>

        {/* Hero orb */}
        <View style={styles.orbWrap}>
          <View style={styles.orbHaloOuter} />
          <View style={styles.orbHaloMid} />
          <VoiceOrb active size={180} />
        </View>

        {/* Priorities card */}
        <Pressable
          style={styles.priorityCard}
          onPress={() => router.push("/briefing")}
          testID="priority-card"
        >
          <View style={styles.priorityIcon}>
            <Ionicons name="flash" size={18} color={c.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.priorityTitle}>
              {loading ? "Loading priorities…" : `You have ${priorityCount} priorit${priorityCount === 1 ? "y" : "ies"}`}
            </Text>
            <Text style={styles.prioritySub}>Tap to review</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.onSurfaceSecondary} />
        </Pressable>

        {/* Overview */}
        <Text style={styles.sectionLabel}>OVERVIEW</Text>
        <View style={styles.overviewGrid}>
          {overview.map((it) => (
            <View key={it.label} style={styles.overviewCard} testID={it.testID}>
              <View style={styles.overviewRow}>
                <Text style={styles.overviewLabel}>{it.label}</Text>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name={it.icon} size={14} color={c.brand} />
                </View>
              </View>
              <Text style={styles.overviewValue}>{it.value}</Text>
            </View>
          ))}
        </View>

        {/* Quick actions */}
        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        <View style={styles.actionsRow}>
          {QUICK_ACTIONS.map((qa) => (
            <Pressable
              key={qa.label}
              style={styles.actionItem}
              onPress={() => router.push(qa.route as any)}
              testID={qa.testID}
            >
              <View style={styles.actionIconWrap}>
                <Ionicons name={qa.icon} size={22} color={c.brand} />
              </View>
              <Text style={styles.actionLabel}>{qa.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Insights teaser */}
        <Pressable
          style={styles.insightTeaser}
          onPress={() => router.push("/dashboard")}
          testID="insights-teaser"
        >
          <View style={styles.insightLeft}>
            <View style={styles.insightDot} />
            <Text style={styles.insightLabel}>AI INSIGHTS</Text>
          </View>
          <Text style={styles.insightTitle}>
            {data?.active_goals?.length
              ? `${data.active_goals.length} goal${data.active_goals.length === 1 ? "" : "s"} in motion`
              : "Set a goal to get AI insights"}
          </Text>
          <View style={styles.insightFooter}>
            <Text style={styles.insightAction}>View dashboard</Text>
            <Ionicons name="arrow-forward" size={14} color={c.brand} />
          </View>
        </Pressable>

        {loading && (
          <ActivityIndicator color={c.brand} style={{ marginTop: 16 }} />
        )}

        <View style={{ height: 140 }} />
      </ScrollView>
      <ProfileSheet visible={showProfile} onClose={() => setShowProfile(false)} />
      <MenuSheet visible={showMenu} onClose={() => setShowMenu(false)} />
    </View>
  );
}

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  avatarBtn: { width: 38, height: 38, borderRadius: 19, overflow: "hidden" },
  avatarGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: c.onBrand, fontFamily: theme.font.display, fontSize: 17, lineHeight: 20 },
  brandWrap: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  brandWord: {
    color: c.brand,
    fontFamily: theme.font.display,
    fontSize: 18,
    letterSpacing: 4,
    fontWeight: "600",
  },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingBottom: 160 },
  greetingWrap: { marginTop: theme.spacing.md, marginBottom: theme.spacing.lg },
  greetingRow: { flexDirection: "row", alignItems: "center" },
  greetingText: {
    color: c.onSurface,
    fontFamily: theme.font.display,
    fontSize: 30,
    letterSpacing: -0.5,
  },
  wave: { fontSize: 26 },
  greetingSub: {
    color: c.onSurfaceSecondary,
    fontSize: 14,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  orbWrap: {
    alignItems: "center",
    justifyContent: "center",
    height: 220,
    marginVertical: theme.spacing.md,
    position: "relative",
  },
  orbHaloOuter: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: c.brand,
    opacity: 0.06,
  },
  orbHaloMid: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: c.brand,
    opacity: 0.1,
  },
  priorityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginBottom: theme.spacing.xl,
  },
  priorityIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  priorityTitle: { color: c.onSurface, fontSize: 15, fontWeight: "500" },
  prioritySub: { color: c.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  sectionLabel: {
    color: c.onSurfaceSecondary,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.8,
    marginBottom: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  overviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  overviewCard: {
    width: "47%",
    flexGrow: 1,
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    gap: theme.spacing.sm,
  },
  overviewRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  overviewLabel: {
    color: c.onSurfaceSecondary,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  overviewIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  overviewValue: {
    color: c.onSurface,
    fontFamily: theme.font.display,
    fontSize: 26,
    letterSpacing: -0.5,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  actionItem: {
    flex: 1,
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  actionIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: c.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: c.brand,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  actionLabel: {
    color: c.onSurfaceSecondary,
    fontSize: 11,
    fontWeight: "500",
  },
  insightTeaser: {
    marginTop: theme.spacing.xl,
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    gap: theme.spacing.sm,
  },
  insightLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  insightDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.brand },
  insightLabel: {
    color: c.brand,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  insightTitle: { color: c.onSurface, fontSize: 16, fontWeight: "500" },
  insightFooter: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  insightAction: { color: c.brand, fontSize: 12, fontWeight: "600" },
});
