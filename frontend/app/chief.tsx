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
import { FeatureGate } from "@/src/features";
import { useFocusEffect, useRouter } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface BriefingSection {
  type: string;
  title: string;
  icon: string;
  count?: number;
  items?: any[];
  summary?: string;
}

interface PlanItem {
  time: string;
  activity: string;
  type: string;
  location?: string;
  duration?: number;
}

interface QuickAction {
  label: string;
  action: string;
  icon: string;
}

interface ChiefBriefing {
  greeting: string;
  date: string;
  day_of_week: string;
  sections: BriefingSection[];
  suggested_plan: PlanItem[];
  quick_actions: QuickAction[];
}

const ACTION_ROUTES: Record<string, string> = {
  return_calls: "/calls",
  review_tasks: "/reminders",
  update_goals: "/goals",
  briefing: "/briefing",
  summary: "/dashboard",
  tomorrow_plan: "/chief",
  meeting_notes: "/",
};

const PLAN_TYPE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  routine: { icon: "sunny-outline", color: theme.color.brand },
  meeting: { icon: "people-outline", color: "#7aa6ff" },
  focus: { icon: "flash-outline", color: "#e1b168" },
  break: { icon: "cafe-outline", color: "#9d7ae0" },
};

export default function ChiefScreen() {
  return (
    <FeatureGate feature="chief_of_staff">
      <ChiefScreenInner />
    </FeatureGate>
  );
}

function ChiefScreenInner() {
  const router = useRouter();
  const [briefing, setBriefing] = useState<ChiefBriefing | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [nudges, setNudges] = useState<Array<{ icon: string; priority: string; title: string; detail?: string; source: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const tz_offset = Math.round(-new Date().getTimezoneOffset() / 60);
      const [b, s, n] = await Promise.all([
        api.chiefMorningBriefing(tz_offset),
        api.chiefSuggestions().catch(() => []),
        api.companionNudges().catch(() => []),
      ]);
      setBriefing(b);
      setSuggestions(Array.isArray(s) ? s : []);
      setNudges(Array.isArray(n) ? n : []);
    } catch (e) {
      console.warn("chief load failed", e);
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
        <ScreenHeader title="Chief of Staff" />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      </View>
    );
  }

  if (!briefing) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Chief of Staff" />
        <View style={styles.loadingBox}>
          <Text style={styles.empty}>Couldn't load briefing.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Chief of Staff"
        rightSlot={
          <Pressable
            style={styles.headerBtn}
            onPress={() => {
              setRefreshing(true);
              load();
            }}
            testID="chief-refresh"
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
        testID="chief-scroll"
      >
        {/* Greeting */}
        <View style={styles.heroCard}>
          <Text style={styles.heroDate}>
            {briefing.day_of_week} · {briefing.date}
          </Text>
          <Text style={styles.heroGreeting} testID="chief-greeting">
            {briefing.greeting}.
          </Text>
          <Text style={styles.heroSub}>Here's what I've lined up for you.</Text>
        </View>

        {/* Smart suggestions */}
        {suggestions.length > 0 && (
          <View style={styles.section}>
            {suggestions.map((s, idx) => (
              <View key={idx} style={styles.suggestionCard} testID={`chief-suggestion-${idx}`}>
                <Ionicons name="bulb-outline" size={18} color={theme.color.brand} />
                <Text style={styles.suggestionText}>{s.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Companion nudges (habit-aware) */}
        {nudges.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ORA nudges</Text>
            {nudges.map((n, idx) => (
              <View
                key={idx}
                style={[
                  styles.suggestionCard,
                  n.priority === "high" && { borderLeftWidth: 3, borderLeftColor: "#ef4444" },
                  n.priority === "low" && { borderLeftWidth: 3, borderLeftColor: "#22c55e" },
                ]}
                testID={`chief-nudge-${idx}`}
              >
                <Ionicons name={(n.icon as any) || "sparkles"} size={18} color={theme.color.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestionText}>{n.title}</Text>
                  {!!n.detail && <Text style={[styles.suggestionText, { fontSize: 11, color: theme.color.onSurfaceSecondary, marginTop: 2 }]}>{n.detail}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Sections */}
        {briefing.sections.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="leaf-outline" size={28} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>A calm day ahead</Text>
            <Text style={styles.empty}>
              No meetings, urgent tasks, or unread emails. Start a chat or set a goal to plan something.
            </Text>
          </View>
        ) : (
          briefing.sections.map((sec) => (
            <View key={sec.type} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name={(sec.icon + "-outline") as any} size={18} color={theme.color.brand} />
                <Text style={styles.sectionTitle}>{sec.title}</Text>
                {sec.count != null && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{sec.count}</Text>
                  </View>
                )}
              </View>
              {sec.summary ? <Text style={styles.sectionSummary}>{sec.summary}</Text> : null}
              {sec.items?.map((it: any, idx: number) => (
                <SectionItem key={idx} item={it} type={sec.type} testID={`chief-${sec.type}-${idx}`} />
              ))}
            </View>
          ))
        )}

        {/* Suggested plan */}
        {briefing.suggested_plan && briefing.suggested_plan.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="map-outline" size={18} color={theme.color.brand} />
              <Text style={styles.sectionTitle}>Suggested plan</Text>
            </View>
            <View style={styles.timelineCard}>
              {briefing.suggested_plan.map((p, idx) => {
                const meta = PLAN_TYPE_META[p.type] || PLAN_TYPE_META.routine;
                const isLast = idx === briefing.suggested_plan.length - 1;
                return (
                  <View key={idx} style={styles.timelineRow} testID={`chief-plan-${idx}`}>
                    <View style={styles.timelineGutter}>
                      <View style={[styles.timelineDot, { backgroundColor: meta.color }]}>
                        <Ionicons name={meta.icon} size={12} color={theme.color.onBrand} />
                      </View>
                      {!isLast && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineBody}>
                      <Text style={styles.timelineTime}>{p.time}</Text>
                      <Text style={styles.timelineActivity}>{p.activity}</Text>
                      {p.location ? (
                        <Text style={styles.timelineMeta}>
                          <Ionicons name="location-outline" size={11} /> {p.location}
                        </Text>
                      ) : null}
                      {p.duration ? <Text style={styles.timelineMeta}>{p.duration} min</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Quick actions */}
        {briefing.quick_actions && briefing.quick_actions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick actions</Text>
            <View style={styles.actionsRow}>
              {briefing.quick_actions.map((a, idx) => (
                <Pressable
                  key={idx}
                  style={styles.actionCard}
                  onPress={() => {
                    const route = ACTION_ROUTES[a.action] || "/";
                    router.push(route as any);
                  }}
                  testID={`chief-action-${a.action}`}
                >
                  <Ionicons name={(a.icon + "-outline") as any} size={20} color={theme.color.brand} />
                  <Text style={styles.actionLabel}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SectionItem({ item, type, testID }: { item: any; type: string; testID?: string }) {
  if (type === "calendar") {
    const t = typeof item.start === "string" && item.start.includes("T") ? item.start.split("T")[1].slice(0, 5) : "";
    return (
      <View style={styles.itemRow} testID={testID}>
        <Text style={styles.itemTime}>{t}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          {item.location ? <Text style={styles.itemMeta}>{item.location}</Text> : null}
        </View>
      </View>
    );
  }
  if (type === "tasks") {
    return (
      <View style={styles.itemRow} testID={testID}>
        <Ionicons
          name={item.type === "goal" ? "trophy-outline" : "alarm-outline"}
          size={16}
          color={theme.color.brand}
          style={{ marginTop: 2 }}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          {item.condition ? <Text style={styles.itemMeta}>When: {item.condition}</Text> : null}
          {item.progress != null && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${item.progress}%` }]} />
            </View>
          )}
        </View>
        {item.priority === "high" && (
          <View style={[styles.tag, { backgroundColor: "#5a1e1e" }]}>
            <Text style={[styles.tagText, { color: "#ff9b9b" }]}>HIGH</Text>
          </View>
        )}
      </View>
    );
  }
  if (type === "email") {
    return (
      <View style={styles.itemRow} testID={testID}>
        <Ionicons name="mail-outline" size={16} color={theme.color.brand} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.subject}
          </Text>
          <Text style={styles.itemMeta} numberOfLines={1}>
            {item.from}
          </Text>
        </View>
      </View>
    );
  }
  if (type === "calls") {
    return (
      <View style={styles.itemRow} testID={testID}>
        <Ionicons name="call-outline" size={16} color={theme.color.brand} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{item.name}</Text>
          {item.time ? <Text style={styles.itemMeta}>{new Date(item.time).toLocaleString()}</Text> : null}
        </View>
      </View>
    );
  }
  if (type === "overdue") {
    return (
      <View style={styles.itemRow} testID={testID}>
        <Ionicons name="alert-circle-outline" size={16} color="#ef4444" style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${item.progress || 0}%` }]} />
          </View>
        </View>
      </View>
    );
  }
  if (type === "progress") {
    return (
      <View style={styles.itemRow} testID={testID}>
        <Text style={styles.itemTitle}>{item.label}</Text>
        <Text style={[styles.itemTitle, { color: theme.color.brand }]}>{String(item.value)}</Text>
      </View>
    );
  }
  return (
    <View style={styles.itemRow} testID={testID}>
      <Text style={styles.itemTitle}>{JSON.stringify(item)}</Text>
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
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.brand,
  },
  heroDate: { color: theme.color.brand, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 },
  heroGreeting: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 28 },
  heroSub: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginTop: 4 },
  section: { marginBottom: theme.spacing.xl },
  sectionLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: theme.spacing.sm },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 16,
    flex: 1,
  },
  countBadge: {
    backgroundColor: theme.color.brand,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    minWidth: 22,
    alignItems: "center",
  },
  countBadgeText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "600" },
  sectionSummary: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginBottom: theme.spacing.sm },
  itemRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    alignItems: "flex-start",
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    marginBottom: 6,
  },
  itemTime: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 13, width: 50 },
  itemTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  itemMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  suggestionCard: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.brand,
  },
  suggestionText: { flex: 1, color: theme.color.onSurface, fontSize: 13, lineHeight: 19 },
  emptyCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  emptyTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 16 },
  empty: { color: theme.color.onSurfaceSecondary, fontSize: 13, textAlign: "center" },
  progressTrack: {
    height: 4,
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: 2,
    marginTop: 6,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: theme.color.brand },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  tagText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  timelineCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  timelineRow: { flexDirection: "row", gap: theme.spacing.md },
  timelineGutter: { alignItems: "center", width: 24 },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: theme.color.borderStrong,
    marginVertical: 4,
  },
  timelineBody: { flex: 1, paddingBottom: theme.spacing.md },
  timelineTime: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 13 },
  timelineActivity: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500", marginTop: 2 },
  timelineMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  actionCard: {
    flexBasis: "48%",
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  actionLabel: { color: theme.color.onSurface, fontSize: 13 },
});
