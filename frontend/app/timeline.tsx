import React, { useCallback, useState } from "react";
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
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

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

function fmtDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function fmtTime(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shiftDate(s: string, days: number): string {
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function TimelineScreen() {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<TLResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tt, setTt] = useState<TLResponse | null>(null);

  const tzOffset = -new Date().getTimezoneOffset();

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [t, machine] = await Promise.all([
        api.timeline(d, tzOffset),
        api.timelineOnThisDay(12, tzOffset).catch(() => null),
      ]);
      setData(t as TLResponse);
      setTt(machine);
    } catch (e) {
      console.warn("timeline load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tzOffset]);

  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [date, load])
  );

  const onRefresh = () => { setRefreshing(true); load(date); };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Life Timeline" />

      <View style={styles.dateBar} testID="timeline-date-bar">
        <Pressable style={styles.navBtn} onPress={() => setDate(shiftDate(date, -1))} testID="timeline-prev">
          <Ionicons name="chevron-back" size={18} color={theme.color.onSurface} />
        </Pressable>
        <View style={styles.dateBox}>
          <Text style={styles.dateText}>{fmtDate(date)}</Text>
          {date !== today && (
            <Pressable onPress={() => setDate(today)} testID="timeline-today">
              <Text style={styles.todayLink}>Jump to today</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.navBtn, date === today && styles.navDisabled]}
          onPress={() => date < today && setDate(shiftDate(date, 1))}
          testID="timeline-next"
        >
          <Ionicons name="chevron-forward" size={18} color={theme.color.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
      >
        {loading && !data ? (
          <View style={styles.loader}><ActivityIndicator color={theme.color.brand} /></View>
        ) : null}

        {data && (
          <>
            {/* Stats */}
            <View style={styles.statsCard} testID="timeline-stats">
              <View style={styles.statCol}>
                <Text style={styles.statVal}>{data.stats.event_count}</Text>
                <Text style={styles.statLbl}>events</Text>
              </View>
              <View style={styles.statCol}>
                <Text style={[styles.statVal, { color: "#ef4444" }]}>₹{Math.round(data.stats.spent || 0).toLocaleString("en-IN")}</Text>
                <Text style={styles.statLbl}>spent</Text>
              </View>
              <View style={styles.statCol}>
                <Text style={[styles.statVal, { color: "#22c55e" }]}>₹{Math.round(data.stats.received || 0).toLocaleString("en-IN")}</Text>
                <Text style={styles.statLbl}>received</Text>
              </View>
            </View>

            {/* On this day */}
            {tt && tt.events && tt.events.length > 0 && (
              <View style={styles.memCard} testID="timeline-memory-time-machine">
                <View style={styles.memHead}>
                  <Ionicons name="time" size={16} color={theme.color.brand} />
                  <Text style={styles.memTitle}>One year ago today — {tt.events.length} events</Text>
                </View>
                {tt.events.slice(0, 3).map((e, i) => (
                  <Text key={i} style={styles.memLine} numberOfLines={1}>• {e.title}</Text>
                ))}
                <Pressable onPress={() => setDate(tt.date)} testID="timeline-jump-memory">
                  <Text style={styles.memLink}>Open {tt.date}</Text>
                </Pressable>
              </View>
            )}

            {/* Event feed */}
            {data.events.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={32} color={theme.color.onSurfaceSecondary} />
                <Text style={styles.emptyTitle}>Nothing recorded</Text>
                <Text style={styles.emptyText}>
                  Chat with Nova, log a workout, or connect Google — events from your day will land here.
                </Text>
              </View>
            ) : (
              <View>
                {data.events.map((e, idx) => (
                  <View key={`${e.kind}-${e.ref_id || idx}`} style={styles.eventRow} testID={`timeline-event-${idx}`}>
                    <View style={styles.timeCol}>
                      <Text style={styles.timeText}>{fmtTime(e.at)}</Text>
                    </View>
                    <View style={styles.kindIcon}>
                      <Ionicons name={(e.icon as any) || "ellipse"} size={16} color={theme.color.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.evTitle} numberOfLines={2}>{e.title}</Text>
                      {!!e.subtitle && <Text style={styles.evSub} numberOfLines={2}>{e.subtitle}</Text>}
                      <Text style={styles.evKind}>{e.kind.replace(/_/g, " ")}</Text>
                    </View>
                  </View>
                ))}
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
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
    gap: theme.spacing.md,
  },
  navBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  navDisabled: { opacity: 0.3 },
  dateBox: { flex: 1, alignItems: "center" },
  dateText: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 18 },
  todayLink: { color: theme.color.brand, fontSize: 12, marginTop: 2 },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  loader: { paddingVertical: theme.spacing.xxxl, alignItems: "center" },
  statsCard: {
    flexDirection: "row",
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  statCol: { flex: 1, alignItems: "center" },
  statVal: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  statLbl: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2, textTransform: "uppercase", letterSpacing: 1 },
  memCard: {
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.brandSecondary,
    gap: 6,
  },
  memHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  memTitle: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600" },
  memLine: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  memLink: { color: theme.color.brand, fontSize: 12, marginTop: 4 },
  empty: { alignItems: "center", paddingVertical: theme.spacing.xxxl, gap: 8 },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "500" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", paddingHorizontal: 24 },
  eventRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
  },
  timeCol: { width: 52, alignItems: "flex-end" },
  timeText: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  kindIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center", justifyContent: "center",
    marginTop: 2,
  },
  evTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  evSub: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  evKind: { color: theme.color.brand, fontSize: 10, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 },
});
