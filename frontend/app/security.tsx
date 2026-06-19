import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useAuth, authedFetch, useColors } from "@/src/auth";
import ScreenHeader from "@/src/components/ScreenHeader";

interface Session {
  id: string;
  device_label: string;
  browser?: string;
  ip?: string;
  last_seen_at: string;
  created_at: string;
}

interface AuditEvent {
  id: string;
  event: string;
  ok: boolean;
  device_label?: string;
  ip?: string;
  created_at: string;
  meta?: any;
}

const EVENT_LABEL: Record<string, string> = {
  "login.email_otp": "Email sign-in",
  "login.google": "Google sign-in",
  "logout": "Sign-out",
  "logout.all": "Sign-out all devices",
  "otp.requested": "Sign-in code requested",
  "otp.failed": "Failed sign-in attempt",
  "session.revoked": "Session revoked",
  "session.revoked_all": "All sessions revoked",
  "account.exported": "Data export",
  "account.deleted": "Account deleted",
};

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

export default function SecurityScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { accessToken, signOutAll } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        authedFetch("/api/security/sessions", accessToken).then((r) => r.ok ? r.json() : { sessions: [] }),
        authedFetch("/api/security/audit", accessToken).then((r) => r.ok ? r.json() : { events: [] }),
      ]);
      setSessions(s.sessions || []);
      setEvents(a.events || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const revoke = async (id: string) => {
    try {
      await authedFetch(`/api/security/sessions/${id}/revoke`, accessToken, { method: "POST" });
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't revoke", e?.message || "");
    }
  };

  return (
    <View style={styles.root} testID="security-screen">
      <ScreenHeader title="Security Center" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={c.brand} style={{ marginTop: 64 }} />
        ) : (
          <>
            <View style={styles.heroCard}>
              <Ionicons name="shield-checkmark" size={28} color={c.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Your account is protected</Text>
                <Text style={styles.heroSub}>
                  Bearer tokens stored in secure storage. All traffic is HTTPS. We notify you when a new device signs in.
                </Text>
              </View>
            </View>

            <Text style={styles.section}>ACTIVE SESSIONS ({sessions.length})</Text>
            {sessions.length === 0 ? (
              <Text style={styles.empty}>No active sessions.</Text>
            ) : (
              sessions.map((s) => (
                <View key={s.id} style={styles.card} testID={`session-${s.id}`}>
                  <View style={styles.sessionRow}>
                    <View style={styles.sessionIcon}>
                      <Ionicons
                        name={
                          s.device_label.includes("iPhone") ? "phone-portrait" :
                          s.device_label.includes("iPad") ? "tablet-portrait" :
                          s.device_label.includes("Android") ? "phone-portrait" :
                          s.device_label.includes("Mac") ? "laptop" :
                          "desktop"
                        }
                        size={20}
                        color={c.brand}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessionLabel}>
                        {s.device_label}{s.browser ? ` · ${s.browser}` : ""}
                      </Text>
                      <Text style={styles.sessionMeta}>
                        IP {s.ip || "—"} · Last seen {fmtTime(s.last_seen_at)}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.revokeBtn}
                      onPress={() => revoke(s.id)}
                      testID={`revoke-${s.id}`}
                    >
                      <Text style={styles.revokeText}>Sign out</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}

            <Pressable
              style={styles.dangerBtn}
              onPress={() => {
                Alert.alert("Sign out from all devices?", "All active sessions will be revoked.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Sign out all", style: "destructive", onPress: signOutAll },
                ]);
              }}
              testID="security-signout-all"
            >
              <Ionicons name="alert-circle" size={16} color={c.error} />
              <Text style={styles.dangerText}>Sign out from all devices</Text>
            </Pressable>

            <Text style={styles.section}>AUDIT LOG ({events.length})</Text>
            {events.length === 0 ? (
              <Text style={styles.empty}>No events yet.</Text>
            ) : (
              events.map((e) => (
                <View key={e.id} style={styles.eventRow} testID={`event-${e.id}`}>
                  <Ionicons
                    name={e.ok ? "checkmark-circle" : "alert-circle"}
                    size={16}
                    color={e.ok ? c.success : c.error}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventLabel}>{EVENT_LABEL[e.event] || e.event}</Text>
                    <Text style={styles.eventMeta}>
                      {e.device_label || "—"} · {e.ip || "—"} · {fmtTime(e.created_at)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 80 },
  heroCard: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    backgroundColor: c.brandTertiary,
    borderRadius: theme.radius.lg, padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.brandSecondary,
  },
  heroTitle: { color: c.onSurface, fontSize: 15, fontWeight: "600" },
  heroSub: { color: c.onSurfaceSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  section: { color: c.onSurfaceSecondary, fontSize: 11, fontWeight: "600", letterSpacing: 1.8, marginTop: theme.spacing.lg },
  empty: { color: c.onSurfaceSecondary, fontSize: 13, fontStyle: "italic" },
  card: {
    backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  sessionIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: c.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  sessionLabel: { color: c.onSurface, fontSize: 14, fontWeight: "600" },
  sessionMeta: { color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  revokeBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.pill, backgroundColor: c.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.error,
  },
  revokeText: { color: c.error, fontSize: 12, fontWeight: "600" },
  dangerBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: c.surfaceSecondary,
    paddingVertical: 12, paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.error,
    justifyContent: "center",
  },
  dangerText: { color: c.error, fontSize: 13, fontWeight: "600" },
  eventRow: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider,
  },
  eventLabel: { color: c.onSurface, fontSize: 13, fontWeight: "500" },
  eventMeta: { color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
});
