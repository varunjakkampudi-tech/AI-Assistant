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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";

import { theme } from "@/src/theme";
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
  integrations: Record<string, { connected: boolean; note: string }>;
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
  const [data, setData] = useState<BriefingData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          });
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
                  Mention a date in chat (e.g. "team review on Aug 14") — Nova will surface it here.
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

            {/* Integration banner */}
            <View style={[styles.card, styles.integrationCard]} testID="briefing-integrations-card">
              <View style={styles.cardHead}>
                <Ionicons name="link-outline" size={20} color={theme.color.brand} />
                <Text style={styles.cardTitle}>Connect inbox & calendar</Text>
              </View>
              <Text style={styles.cardEmpty}>
                Gmail and Google Calendar (and Outlook) bring meeting and email summaries into this
                briefing. Connecting them requires your own Google Cloud OAuth client (or Azure AD
                app) with the right scopes — share credentials and I'll wire them up.
              </Text>
              {Object.entries(data.integrations).map(([name, info]) => (
                <View key={name} style={styles.intRow}>
                  <Ionicons
                    name={info.connected ? "checkmark-circle" : "ellipse-outline"}
                    size={16}
                    color={info.connected ? theme.color.success : theme.color.onSurfaceSecondary}
                  />
                  <Text style={styles.intName}>{name.replace("_", " ")}</Text>
                  <Text style={styles.intStatus}>
                    {info.connected ? "Connected" : "Not connected"}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={styles.footer}>{data.session_count} conversations on record</Text>
          </>
        )}
      </ScrollView>
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
});
