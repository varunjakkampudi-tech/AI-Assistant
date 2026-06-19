import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";
import { api } from "@/src/api";

interface TLEvent {
  kind: string;
  icon: string;
  title: string;
  subtitle?: string;
  at?: string;
  category?: string;
  ref_id?: string;
}

interface TLResponse {
  date: string;
  events: TLEvent[];
  stats: {
    event_count: number;
    by_kind: Record<string, number>;
    spent: number;
    received: number;
  };
}

type Filter = "All" | "Chat" | "Email" | "Calendar" | "Finance";

const FILTER_TO_KIND: Record<Filter, string[] | null> = {
  All: null,
  Chat: ["chat_message", "chat_session", "session_start"],
  Email: ["email_received", "email_sent", "email"],
  Calendar: ["calendar_event", "event", "meeting"],
  Finance: ["transaction", "spend", "income"],
};

const KIND_COLORS: Record<string, string> = {
  chat_message: "#5B6CFF",
  chat_session: "#5B6CFF",
  email_received: "#A99AFD",
  email_sent: "#A99AFD",
  meeting: "#FCB55F",
  calendar_event: "#FCB55F",
  event: "#FCB55F",
  transaction: "#E15F5F",
  spend: "#E15F5F",
  income: "#5EBE7E",
};

const KIND_ICONS: Record<string, keyof typeof import("@expo/vector-icons/Ionicons").default.glyphMap> = {
  chat_message: "chatbubble",
  chat_session: "chatbubbles",
  email_received: "mail",
  email_sent: "mail-unread",
  meeting: "calendar",
  calendar_event: "calendar",
  event: "calendar",
  transaction: "card",
  spend: "card",
  income: "wallet",
};

function fmtDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}
function fmtTime(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}
function shiftDate(s: string, days: number): string {
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function TimelineTabScreen() {
  const router = useRouter();
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<TLResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");

  const tzOffset = -new Date().getTimezoneOffset();

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const t = await api.timeline(d, tzOffset);
      setData(t as TLResponse);
    } catch (e) {
      console.warn("timeline load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tzOffset]);

  useFocusEffect(useCallback(() => { load(date); }, [date, load]));

  const onRefresh = () => { setRefreshing(true); load(date); };

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    const kinds = FILTER_TO_KIND[filter];
    if (!kinds) return data.events;
    return data.events.filter((e) => kinds.includes(e.kind));
  }, [data, filter]);

  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;
  const yest = shiftDate(today, -1);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: theme.color.surface }}>
        <View style={styles.header}>
          <Text style={styles.title}>Timeline</Text>
          <View style={styles.headerRight}>
            <Pressable
              style={styles.iconBtn}
              onPress={() => router.push("/search")}
              testID="timeline-search-btn"
            >
              <Ionicons name="search" size={18} color={theme.color.onSurface} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => setDate(isToday ? yest : today)}
              testID="timeline-filter-btn"
            >
              <Ionicons name="options" size={18} color={theme.color.onSurface} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.subTitle}>{fmtDate(date)}</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {(["All", "Chat", "Email", "Calendar", "Finance"] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f)}
                testID={`timeline-chip-${f.toLowerCase()}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
      >
        {loading && !data ? (
          <View style={styles.loader}><ActivityIndicator color={theme.color.brand} /></View>
        ) : filteredEvents.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={36} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>Nothing here</Text>
            <Text style={styles.emptyText}>
              Chat with ORA, connect Google, or log a metric — your day will fill in automatically.
            </Text>
          </View>
        ) : (
          <View>
            {filteredEvents.map((e, idx) => {
              const color = KIND_COLORS[e.kind] || theme.color.brand;
              const icon = (KIND_ICONS[e.kind] || (e.icon as any) || "ellipse") as keyof typeof import("@expo/vector-icons/Ionicons").default.glyphMap;
              return (
                <View
                  key={`${e.kind}-${e.ref_id || idx}`}
                  style={styles.eventRow}
                  testID={`timeline-event-${idx}`}
                >
                  <View style={styles.timeCol}>
                    <Text style={styles.timeText}>{fmtTime(e.at) || "—"}</Text>
                    <View style={[styles.timeDot, { backgroundColor: color }]} />
                  </View>
                  <View style={[styles.eventCard, { borderLeftColor: color }]}>
                    <View style={[styles.eventIcon, { backgroundColor: color + "26" }]}>
                      <Ionicons name={icon} size={16} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.evTitle} numberOfLines={2}>{e.title}</Text>
                      {!!e.subtitle && (
                        <Text style={styles.evSub} numberOfLines={2}>{e.subtitle}</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Date nav at bottom */}
        <View style={styles.dateNav}>
          <Pressable
            style={styles.navBtn}
            onPress={() => setDate(shiftDate(date, -1))}
            testID="timeline-prev"
          >
            <Ionicons name="chevron-back" size={18} color={theme.color.onSurface} />
            <Text style={styles.navText}>Previous</Text>
          </Pressable>
          {!isToday && (
            <Pressable onPress={() => setDate(today)} testID="timeline-today">
              <Text style={styles.todayLink}>Today</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.navBtn, isToday && styles.navDisabled]}
            onPress={() => !isToday && setDate(shiftDate(date, 1))}
            disabled={isToday}
            testID="timeline-next"
          >
            <Text style={styles.navText}>Next</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.color.onSurface} />
          </Pressable>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
  title: {
    flex: 1,
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 26,
    letterSpacing: -0.3,
  },
  headerRight: { flexDirection: "row", gap: theme.spacing.sm },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  subTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 13,
    paddingHorizontal: theme.spacing.lg,
    marginTop: 4,
  },
  chipRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { color: theme.color.onSurface, fontSize: 13, fontWeight: "500" },
  chipTextActive: { color: theme.color.onBrand, fontWeight: "700" },
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  loader: { paddingVertical: theme.spacing.xxxl, alignItems: "center" },
  empty: { alignItems: "center", paddingVertical: theme.spacing.xxxl, gap: 8 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "500" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", paddingHorizontal: 24, lineHeight: 18 },
  eventRow: { flexDirection: "row", gap: theme.spacing.md, marginBottom: theme.spacing.md },
  timeCol: { width: 56, alignItems: "center", paddingTop: 4 },
  timeText: { color: theme.color.onSurfaceSecondary, fontSize: 10, marginBottom: 6 },
  timeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 2 },
  eventCard: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing.md,
    alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    borderLeftWidth: 3,
  },
  eventIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  evTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  evSub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  dateNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: theme.spacing.lg,
    marginTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.divider,
  },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 8 },
  navDisabled: { opacity: 0.3 },
  navText: { color: theme.color.onSurface, fontSize: 12 },
  todayLink: { color: theme.color.brand, fontSize: 13, fontWeight: "600" },
});
