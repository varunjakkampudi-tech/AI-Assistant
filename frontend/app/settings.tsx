import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Switch,
  Alert,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { theme } from "@/src/theme";
import { useAuth, authedFetch, useColors } from "@/src/auth";
import ScreenHeader from "@/src/components/ScreenHeader";

interface Settings {
  theme: "light" | "dark" | "system";
  ai_data_usage: boolean;
  cookies_essential: boolean;
  cookies_analytics: boolean;
  cookies_marketing: boolean;
  notifications_email: boolean;
  notifications_push: boolean;
}

export default function SettingsScreen() {
  const router = useRouter();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { accessToken, theme: themeMode, setTheme, signOut, signOutAll, user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const r = await authedFetch("/api/settings", accessToken);
      if (r.ok) setSettings(await r.json());
    } finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const update = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      await authedFetch("/api/settings", accessToken, {
        method: "PUT", body: JSON.stringify(patch),
      });
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message || "");
    } finally { setSaving(false); }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const r = await authedFetch("/api/account/export", accessToken, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      Alert.alert(
        "Data exported",
        `${Object.keys(j).length} sections. On a real device this would download as JSON. On web, check the console.`,
      );
      // eslint-disable-next-line no-console
      console.log("EXPORTED DATA:", j);
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "");
    } finally { setExporting(false); }
  };

  const deleteAccount = () => {
    Alert.alert(
      "Delete account?",
      "This permanently removes your conversations, memories, journals, health logs, finance and career data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever",
          style: "destructive",
          onPress: async () => {
            try {
              await authedFetch("/api/account/delete", accessToken, { method: "POST" });
              await signOut();
              router.replace("/sign-in" as any);
            } catch (e: any) {
              Alert.alert("Delete failed", e?.message || "");
            }
          },
        },
      ],
    );
  };

  if (loading || !settings) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Settings" />
        <ActivityIndicator color={c.brand} style={{ marginTop: 64 }} />
      </View>
    );
  }

  return (
    <View style={styles.root} testID="settings-screen">
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Profile */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>PROFILE</Text>
          <Row label="Email" value={user?.email || "—"} testID="set-email" c={c} />
          <Row label="Name" value={user?.name || "—"} testID="set-name" c={c} />
          <Row label="Sign-in method" value={user?.provider || "—"} testID="set-provider" c={c} />
        </View>

        {/* Appearance */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>APPEARANCE</Text>
          <Text style={styles.sub}>Theme</Text>
          <View style={styles.segmentRow}>
            {(["light", "dark", "system"] as const).map((m) => (
              <Pressable
                key={m}
                style={[styles.segment, themeMode === m && styles.segmentActive]}
                onPress={() => setTheme(m)}
                testID={`theme-${m}`}
              >
                <Ionicons
                  name={m === "light" ? "sunny" : m === "dark" ? "moon" : "phone-portrait"}
                  size={16}
                  color={themeMode === m ? c.onBrand : c.onSurface}
                />
                <Text style={[styles.segmentText, themeMode === m && { color: c.onBrand, fontWeight: "700" }]}>
                  {m === "system" ? "System" : m.charAt(0).toUpperCase() + m.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Privacy & AI data */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>PRIVACY &amp; AI DATA USAGE</Text>
          <Toggle
            label="Help improve ORA's AI"
            sub="Use my conversations to improve AI models and product quality. Off by default."
            value={settings.ai_data_usage}
            onChange={(v) => update({ ai_data_usage: v })}
            testID="toggle-ai-data"
            c={c}
          />
          <Pressable style={styles.linkRow} onPress={exportData} disabled={exporting} testID="btn-export">
            <Ionicons name="download-outline" size={18} color={c.brand} />
            <Text style={styles.linkRowText}>{exporting ? "Exporting…" : "Export my data"}</Text>
            <Ionicons name="chevron-forward" size={16} color={c.onSurfaceSecondary} />
          </Pressable>
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/legal/privacy`)}
            testID="btn-privacy-policy"
          >
            <Ionicons name="document-text-outline" size={18} color={c.brand} />
            <Text style={styles.linkRowText}>Privacy Policy</Text>
            <Ionicons name="open-outline" size={16} color={c.onSurfaceSecondary} />
          </Pressable>
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/legal/terms`)}
            testID="btn-terms"
          >
            <Ionicons name="document-text-outline" size={18} color={c.brand} />
            <Text style={styles.linkRowText}>Terms of Service</Text>
            <Ionicons name="open-outline" size={16} color={c.onSurfaceSecondary} />
          </Pressable>
        </View>

        {/* Cookies */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>COOKIES &amp; TRACKING</Text>
          <Toggle
            label="Essential cookies"
            sub="Required for sign-in. Cannot be disabled."
            value={true}
            onChange={() => {}}
            disabled
            testID="toggle-cookies-essential"
            c={c}
          />
          <Toggle
            label="Analytics"
            sub="Help us improve the app. No personal content shared."
            value={settings.cookies_analytics}
            onChange={(v) => update({ cookies_analytics: v })}
            testID="toggle-cookies-analytics"
            c={c}
          />
          <Toggle
            label="Marketing"
            sub="Not currently used. Reserved for the future."
            value={settings.cookies_marketing}
            onChange={(v) => update({ cookies_marketing: v })}
            testID="toggle-cookies-marketing"
            c={c}
          />
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/legal/cookies`)}
          >
            <Ionicons name="document-text-outline" size={18} color={c.brand} />
            <Text style={styles.linkRowText}>Cookie Policy</Text>
            <Ionicons name="open-outline" size={16} color={c.onSurfaceSecondary} />
          </Pressable>
        </View>

        {/* Notifications */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>NOTIFICATIONS</Text>
          <Toggle
            label="Email alerts"
            sub="Security events, breach alerts."
            value={settings.notifications_email}
            onChange={(v) => update({ notifications_email: v })}
            testID="toggle-notif-email"
            c={c}
          />
          <Toggle
            label="In-app notifications"
            sub="Reminders, missed-call summaries."
            value={settings.notifications_push}
            onChange={(v) => update({ notifications_push: v })}
            testID="toggle-notif-push"
            c={c}
          />
        </View>

        {/* Security center link */}
        <Pressable
          style={[styles.card, styles.linkCard]}
          onPress={() => router.push("/security" as any)}
          testID="open-security"
        >
          <View style={styles.linkCardLeft}>
            <Ionicons name="shield-checkmark" size={20} color={c.brand} />
            <View>
              <Text style={styles.linkCardTitle}>Security Center</Text>
              <Text style={styles.linkCardSub}>Sessions, audit log, devices</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.onSurfaceSecondary} />
        </Pressable>

        {/* Help */}
        <Pressable
          style={[styles.card, styles.linkCard]}
          onPress={() => router.push("/help" as any)}
          testID="open-help"
        >
          <View style={styles.linkCardLeft}>
            <Ionicons name="help-circle" size={20} color={c.brand} />
            <View>
              <Text style={styles.linkCardTitle}>Help &amp; Support</Text>
              <Text style={styles.linkCardSub}>FAQ, contact, report a bug</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.onSurfaceSecondary} />
        </Pressable>

        {/* Account actions */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>ACCOUNT</Text>
          <Pressable style={styles.linkRow} onPress={signOut} testID="btn-signout">
            <Ionicons name="log-out-outline" size={18} color={c.onSurface} />
            <Text style={styles.linkRowText}>Sign out</Text>
          </Pressable>
          <Pressable
            style={styles.linkRow}
            onPress={() => {
              Alert.alert("Sign out from all devices?", "All your active sessions will be revoked.", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out all", style: "destructive", onPress: signOutAll },
              ]);
            }}
            testID="btn-signout-all"
          >
            <Ionicons name="phone-portrait-outline" size={18} color={c.onSurface} />
            <Text style={styles.linkRowText}>Sign out from all devices</Text>
          </Pressable>
          <Pressable style={styles.linkRow} onPress={deleteAccount} testID="btn-delete-account">
            <Ionicons name="trash-outline" size={18} color={c.error} />
            <Text style={[styles.linkRowText, { color: c.error }]}>Delete account permanently</Text>
          </Pressable>
        </View>

        {saving && <Text style={styles.savingTxt}>Saving…</Text>}
        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

function Row({ label, value, testID, c }: { label: string; value: string; testID?: string; c: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }} testID={testID}>
      <Text style={{ color: c.onSurfaceSecondary, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: c.onSurface, fontSize: 13, fontWeight: "500", maxWidth: "60%" }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Toggle({ label, sub, value, onChange, disabled, testID, c }: {
  label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 8 }} testID={testID}>
      <View style={{ flex: 1 }}>
        <Text style={[{ color: c.onSurface, fontSize: 14, fontWeight: "500" }, disabled && { opacity: 0.6 }]}>{label}</Text>
        {!!sub && <Text style={{ color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2, lineHeight: 16 }}>{sub}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: c.surfaceTertiary, true: c.brand }}
        thumbColor={value ? c.onBrand : "#888"}
      />
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 100 },
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    gap: theme.spacing.sm,
  },
  cardLabel: {
    color: c.onSurfaceSecondary,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.8,
    marginBottom: theme.spacing.xs,
  },
  sub: { color: c.onSurfaceSecondary, fontSize: 12 },
  segmentRow: { flexDirection: "row", gap: theme.spacing.sm },
  segment: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: theme.radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  segmentActive: { backgroundColor: c.brand, borderColor: c.brand },
  segmentText: { color: c.onSurface, fontSize: 12, fontWeight: "500" },
  linkRow: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    paddingVertical: 12,
  },
  linkRowText: { flex: 1, color: c.onSurface, fontSize: 14 },
  linkCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  linkCardLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, flex: 1 },
  linkCardTitle: { color: c.onSurface, fontSize: 14, fontWeight: "600" },
  linkCardSub: { color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  savingTxt: { color: c.brand, fontSize: 12, textAlign: "center", fontStyle: "italic" },
});
