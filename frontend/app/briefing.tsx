import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Linking,
  Modal,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";

import { theme } from "@/src/theme";
import { FeatureGate } from "@/src/features";
import { api, Goal, Memory, Reminder } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface BriefingData {
  greeting: string;
  name: string | null;
  weather: {
    temperature_c: number;
    humidity: number;
    wind_kph: number;
    code: number;
    summary: string;
    timezone: string;
  } | null;
  pending_reminders: Reminder[];
  active_goals: Goal[];
  important_dates: Memory[];
  session_count: number;
  upcoming_events?: { id: string; summary: string; start: string; end: string; location?: string; html_link?: string }[];
  recent_emails?: { id: string; from: string; subject: string; date: string; snippet: string; unread: boolean }[];
  missed_calls?: { id: string; phone_number: string; contact_name?: string; missed_at: string }[];
  integrations: Record<string, { connected: boolean; email?: string | null; enabled?: boolean }>;
}

function weatherIcon(code?: number): keyof typeof Ionicons.glyphMap {
  if (code == null) return "partly-sunny-outline";
  if (code === 0 || code === 1) return "sunny";
  if (code === 2) return "partly-sunny";
  if (code === 3) return "cloudy";
  if (code >= 45 && code <= 48) return "cloudy-outline";
  if (code >= 51 && code <= 67) return "rainy";
  if (code >= 71 && code <= 86) return "snow";
  if (code >= 95) return "thunderstorm";
  return "partly-sunny-outline";
}

export default function BriefingScreen() {
  return (
    <FeatureGate feature="daily_briefing">
      <BriefingScreenInner />
    </FeatureGate>
  );
}

function BriefingScreenInner() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openEmail, setOpenEmail] = useState<any | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [trashing, setTrashing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    let lat: number | null = null;
    let lon: number | null = null;
    const tzOffset = -new Date().getTimezoneOffset(); // minutes east of UTC

    if (Platform.OS !== "web") {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        let granted = perm.granted;
        if (!granted && perm.canAskAgain) {
          const req = await Location.requestForegroundPermissionsAsync();
          granted = req.granted;
        }
        if (granted) {
          // Hard timeout so a stuck GPS lookup in Expo Go never blocks the briefing
          const pos = await Promise.race<any>([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("location-timeout")), 5000)),
          ]);
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
        }
      } catch {
        // weather just stays null
      }
    }

    try {
      const d = await api.briefing(lat, lon, tzOffset);
      setData(d as BriefingData);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const connectGoogle = useCallback(async () => {
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${base}/api/google/auth-url`);
      const data = await res.json();
      if (!data?.url) {
        setError("Could not get auth URL");
        return;
      }
      if (Platform.OS === "web") {
        Linking.openURL(data.url);
      } else {
        await WebBrowser.openAuthSessionAsync(data.url, `${base}/api/google/callback`);
      }
      // Refresh briefing after they return
      setTimeout(() => load(), 1000);
    } catch (e: any) {
      setError(`Connect failed: ${e?.message || e}`);
    }
  }, [load]);

  const disconnectGoogle = useCallback(async () => {
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL;
      await fetch(`${base}/api/google/disconnect`, { method: "POST" });
      load();
    } catch (e: any) {
      setError(`Disconnect failed: ${e?.message || e}`);
    }
  }, [load]);

  const viewEmail = useCallback(async (id: string) => {
    setEmailLoading(true);
    setOpenEmail({ id, loading: true });
    try {
      const full = await api.gmailGet(id);
      setOpenEmail(full);
    } catch (e: any) {
      setOpenEmail(null);
      Alert.alert("Couldn't load email", e?.message || "");
    } finally {
      setEmailLoading(false);
    }
  }, []);

  const trashEmail = useCallback(async (id: string) => {
    setTrashing(id);
    try {
      await api.gmailTrash(id);
      // Remove from local list
      setData((d) =>
        d ? { ...d, recent_emails: (d.recent_emails || []).filter((e) => e.id !== id) } : d,
      );
      if (openEmail?.id === id) setOpenEmail(null);
    } catch (e: any) {
      Alert.alert(
        "Couldn't delete",
        e?.message?.includes("403")
          ? "Reconnect Google to grant inbox-management access."
          : e?.message || "",
      );
    } finally {
      setTrashing(null);
    }
  }, [openEmail]);

  const confirmTrash = useCallback((id: string, subject: string) => {
    if (Platform.OS === "web") {
      // Alert.alert with buttons doesn't render on web in Expo — use confirm
      // eslint-disable-next-line no-alert
      if (window.confirm(`Move "${subject}" to Trash?`)) trashEmail(id);
      return;
    }
    Alert.alert("Move to Trash?", subject, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => trashEmail(id) },
    ]);
  }, [trashEmail]);

  const greetingLine = data
    ? data.name
      ? `${data.greeting}, ${data.name}.`
      : `${data.greeting}.`
    : "";

  return (
    <View style={styles.root} testID="briefing-screen">
      <ScreenHeader title="Daily Briefing" />
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
        {data === null && !error ? (
          <View style={styles.loader}>
            <ActivityIndicator color={theme.color.brand} />
          </View>
        ) : null}

        {error && (
          <View style={styles.errorCard} testID="briefing-error">
            <Ionicons name="alert-circle" size={18} color="#fff" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {data && (
          <>
            <Text style={styles.greeting}>{greetingLine}</Text>
            <Text style={styles.sub}>Here's your snapshot for today.</Text>

            {/* Weather */}
            <View style={styles.card} testID="briefing-weather-card">
              <View style={styles.cardHead}>
                <Ionicons name={weatherIcon(data.weather?.code)} size={22} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Weather</Text>
              </View>
              {data.weather ? (
                <View>
                  <Text style={styles.weatherTemp}>
                    {Math.round(data.weather.temperature_c)}°C
                  </Text>
                  <Text style={styles.weatherSummary}>{data.weather.summary}</Text>
                  <Text style={styles.weatherMeta}>
                    Humidity {data.weather.humidity}% · Wind {Math.round(data.weather.wind_kph)} km/h
                  </Text>
                </View>
              ) : (
                <Text style={styles.cardEmpty}>
                  {Platform.OS === "web"
                    ? "Open on mobile to see weather for your location."
                    : "Allow location access to see your weather. Pull to refresh."}
                </Text>
              )}
            </View>

            {/* Reminders */}
            <View style={styles.card} testID="briefing-reminders-card">
              <View style={styles.cardHead}>
                <Ionicons name="alarm-outline" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Pending reminders</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{data.pending_reminders.length}</Text>
                </View>
              </View>
              {data.pending_reminders.length === 0 ? (
                <Text style={styles.cardEmpty}>Nothing pending. You're all caught up.</Text>
              ) : (
                data.pending_reminders.slice(0, 5).map((r) => (
                  <View key={r.id} style={styles.lineItem}>
                    <View style={styles.dot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineText}>{r.text}</Text>
                      {!!r.condition && (
                        <Text style={styles.lineSub}>when: {r.condition}</Text>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Missed Calls */}
            {data.missed_calls && data.missed_calls.length > 0 && (
              <View style={styles.card} testID="briefing-missed-calls-card">
                <View style={styles.cardHead}>
                  <Ionicons name="call-outline" size={20} color="#ef4444" />
                  <Text style={[styles.cardTitle, { color: "#ef4444" }]}>Missed calls</Text>
                  <View style={[styles.countPill, { backgroundColor: "rgba(239,68,68,0.15)" }]}>
                    <Text style={[styles.countText, { color: "#ef4444" }]}>{data.missed_calls.length}</Text>
                  </View>
                </View>
                {data.missed_calls.slice(0, 5).map((call) => (
                  <View key={call.id} style={styles.lineItem}>
                    <View style={[styles.dot, { backgroundColor: "#ef4444" }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineText}>
                        {call.contact_name || call.phone_number}
                      </Text>
                      <Text style={styles.lineSub}>
                        {new Date(call.missed_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.callBackBtn}
                      onPress={() => Linking.openURL(`tel:${call.phone_number}`)}
                    >
                      <Ionicons name="call" size={16} color={theme.color.brand} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* Goals */}
            <View style={styles.card} testID="briefing-goals-card">
              <View style={styles.cardHead}>
                <Ionicons name="trophy-outline" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Active goals</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{data.active_goals.length}</Text>
                </View>
              </View>
              {data.active_goals.length === 0 ? (
                <Text style={styles.cardEmpty}>No active goals — set one to start tracking.</Text>
              ) : (
                data.active_goals.slice(0, 5).map((g) => (
                  <View key={g.id} style={styles.lineItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineText}>{g.title}</Text>
                      <View style={styles.bar}>
                        <View style={[styles.barFill, { width: `${g.progress}%` }]} />
                      </View>
                    </View>
                    <Text style={styles.percent}>{g.progress}%</Text>
                  </View>
                ))
              )}
            </View>

            {/* Important dates */}
            <View style={styles.card} testID="briefing-dates-card">
              <View style={styles.cardHead}>
                <Ionicons name="calendar-outline" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Important dates</Text>
              </View>
              {data.important_dates.length === 0 ? (
                <Text style={styles.cardEmpty}>
                  Mention a date in chat (e.g. "team review on Aug 14") — ORA will surface it here.
                </Text>
              ) : (
                data.important_dates.slice(0, 5).map((m) => (
                  <View key={m.id} style={styles.lineItem}>
                    <View style={styles.dot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineText}>{m.subject}</Text>
                      <Text style={styles.lineSub}>{m.content}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Calendar */}
            {data.integrations.google_calendar?.connected && (
              <View style={styles.card} testID="briefing-calendar-card">
                <View style={styles.cardHead}>
                  <Ionicons name="calendar" size={20} color={theme.color.brand} />
                  <Text style={styles.cardTitle}>Upcoming events</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countText}>{data.upcoming_events?.length || 0}</Text>
                  </View>
                </View>
                {(data.upcoming_events || []).length === 0 ? (
                  <Text style={styles.cardEmpty}>Nothing on your calendar.</Text>
                ) : (
                  (data.upcoming_events || []).map((ev) => (
                    <View key={ev.id} style={styles.lineItem}>
                      <View style={styles.dot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lineText}>{ev.summary}</Text>
                        <Text style={styles.lineSub}>
                          {new Date(ev.start).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                          {ev.location ? ` · ${ev.location}` : ""}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* Email */}
            {data.integrations.gmail?.connected && (
              <View style={styles.card} testID="briefing-email-card">
                <View style={styles.cardHead}>
                  <Ionicons name="mail" size={20} color={theme.color.brand} />
                  <Text style={styles.cardTitle}>Recent emails</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countText}>{data.recent_emails?.length || 0}</Text>
                  </View>
                </View>
                {(data.recent_emails || []).length === 0 ? (
                  <Text style={styles.cardEmpty}>Inbox is clear.</Text>
                ) : (
                  (data.recent_emails || []).map((em) => (
                    <Pressable
                      key={em.id}
                      style={({ pressed }) => [
                        styles.lineItem,
                        styles.lineItemPressable,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={() => viewEmail(em.id)}
                      testID={`briefing-email-${em.id}`}
                    >
                      <View style={[styles.dot, em.unread && { backgroundColor: theme.color.brand }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lineText} numberOfLines={1}>
                          {em.subject}
                        </Text>
                        <Text style={styles.lineSub} numberOfLines={1}>
                          {em.from.replace(/<.*>/, "").trim()} · {em.snippet.slice(0, 60)}
                        </Text>
                      </View>
                      <Pressable
                        hitSlop={8}
                        onPress={(e) => { e.stopPropagation?.(); confirmTrash(em.id, em.subject); }}
                        disabled={trashing === em.id}
                        style={styles.inlineTrash}
                        testID={`briefing-email-trash-${em.id}`}
                      >
                        {trashing === em.id ? (
                          <ActivityIndicator size="small" color={theme.color.onSurfaceSecondary} />
                        ) : (
                          <Ionicons name="trash-outline" size={16} color={theme.color.onSurfaceSecondary} />
                        )}
                      </Pressable>
                    </Pressable>
                  ))
                )}
              </View>
            )}

            {/* Integration banner */}
            <View style={[styles.card, styles.integrationCard]} testID="briefing-integrations-card">
              <View style={styles.cardHead}>
                <Ionicons name="link-outline" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>
                  {data.integrations.google_calendar?.connected ? "Google connected" : "Connect your inbox"}
                </Text>
              </View>
              {data.integrations.google_calendar?.connected ? (
                <>
                  <Text style={styles.cardEmpty}>
                    Signed in as {data.integrations.google_calendar.email || "Google user"}.
                  </Text>
                  <Pressable
                    onPress={disconnectGoogle}
                    style={[styles.connectBtn, { backgroundColor: theme.color.surfaceTertiary }]}
                    testID="disconnect-google-button"
                  >
                    <Text style={[styles.connectBtnText, { color: theme.color.onSurface }]}>Disconnect Google</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.cardEmpty}>
                    Connect Google to see your upcoming events and recent inbox in this briefing.
                  </Text>
                  <Pressable
                    onPress={connectGoogle}
                    style={styles.connectBtn}
                    testID="connect-google-button"
                  >
                    <Ionicons name="logo-google" size={16} color={theme.color.onBrand} />
                    <Text style={styles.connectBtnText}>Connect Google</Text>
                  </Pressable>
                </>
              )}
            </View>

            <Text style={styles.footer}>{data.session_count} conversations on record</Text>
          </>
        )}
      </ScrollView>

      {/* Email detail modal */}
      <Modal
        visible={!!openEmail}
        animationType="slide"
        transparent
        onRequestClose={() => setOpenEmail(null)}
      >
        <View style={styles.modalRoot} testID="email-detail-modal">
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {openEmail?.subject || "Email"}
              </Text>
              <Pressable
                onPress={() => setOpenEmail(null)}
                hitSlop={8}
                testID="email-detail-close"
              >
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            {openEmail?.loading || emailLoading ? (
              <ActivityIndicator color={theme.color.brand} style={{ marginVertical: 32 }} />
            ) : (
              <>
                <Text style={styles.modalMeta} numberOfLines={1}>
                  From: {openEmail?.from || ""}
                </Text>
                {!!openEmail?.date && (
                  <Text style={styles.modalMeta}>{openEmail.date}</Text>
                )}
                <ScrollView style={{ maxHeight: 360 }}>
                  <Text style={styles.modalBody}>{openEmail?.body || openEmail?.snippet || ""}</Text>
                </ScrollView>
                <View style={styles.modalActions}>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnGhost]}
                    onPress={() => setOpenEmail(null)}
                    testID="email-detail-dismiss"
                  >
                    <Text style={styles.modalBtnGhostText}>Close</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalBtn, styles.modalBtnDanger]}
                    onPress={() => openEmail?.id && confirmTrash(openEmail.id, openEmail.subject || "this email")}
                    disabled={!!trashing}
                    testID="email-detail-trash"
                  >
                    {trashing === openEmail?.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="trash" size={14} color="#fff" />
                        <Text style={styles.modalBtnDangerText}>Move to Trash</Text>
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
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  loader: { paddingVertical: theme.spacing.xxxl, alignItems: "center" },
  greeting: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 28 },
  sub: { color: theme.color.onSurfaceSecondary, fontSize: 14, marginTop: -8 },
  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    gap: theme.spacing.md,
  },
  integrationCard: { borderColor: theme.color.brandSecondary, backgroundColor: theme.color.brandTertiary },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  cardTitle: { flex: 1, color: theme.color.onSurface, fontSize: 15, fontWeight: "500" },
  countPill: {
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    minWidth: 22,
    alignItems: "center",
  },
  countText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "700" },
  cardEmpty: { color: theme.color.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  weatherTemp: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 40 },
  weatherSummary: { color: theme.color.brand, fontSize: 14, marginTop: 2 },
  weatherMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: theme.spacing.sm },
  lineItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color.brand },
  lineText: { color: theme.color.onSurface, fontSize: 14 },
  lineSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  bar: { height: 4, borderRadius: 2, backgroundColor: theme.color.surfaceTertiary, marginTop: 6, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: theme.color.brand },
  percent: { color: theme.color.onSurface, fontSize: 12, width: 38, textAlign: "right" },
  intRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingVertical: 2 },
  intName: { flex: 1, color: theme.color.onSurface, fontSize: 13, textTransform: "capitalize" },
  intStatus: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  footer: { color: theme.color.onSurfaceSecondary, fontSize: 11, textAlign: "center", marginTop: theme.spacing.md },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: "rgba(139,58,58,0.85)",
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  errorText: { color: "#fff", flex: 1, fontSize: 13 },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    marginTop: theme.spacing.sm,
  },
  connectBtnText: { color: theme.color.onBrand, fontWeight: "600" },
  callBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  lineItemPressable: {
    paddingVertical: 6,
    borderRadius: 8,
  },
  inlineTrash: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: theme.color.surface,
    padding: theme.spacing.lg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.brandSecondary,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  modalTitle: {
    flex: 1,
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 18,
  },
  modalMeta: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
  },
  modalBody: {
    color: theme.color.onSurface,
    fontSize: 14,
    lineHeight: 20,
    marginTop: theme.spacing.sm,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
  },
  modalBtnGhost: {
    backgroundColor: theme.color.surfaceSecondary,
  },
  modalBtnGhostText: {
    color: theme.color.onSurface,
    fontSize: 13,
    fontWeight: "600",
  },
  modalBtnDanger: {
    backgroundColor: "#b91c1c",
  },
  modalBtnDangerText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});
