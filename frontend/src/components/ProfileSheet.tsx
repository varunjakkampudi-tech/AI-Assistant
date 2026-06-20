import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Image as RNImage,
  Linking,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { theme } from "@/src/theme";
import { useAuth, useColors, authedFetch } from "@/src/auth";
import { api } from "@/src/api";

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Row {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  route: string;
  testID: string;
}

const ACCOUNT_ROWS: Row[] = [
  { icon: "settings-outline", label: "Settings", sub: "Theme, privacy, cookies, notifications", route: "/settings", testID: "profile-settings" },
  { icon: "shield-checkmark-outline", label: "Security Center", sub: "Sessions, audit log, breach alerts", route: "/security", testID: "profile-security" },
  { icon: "help-circle-outline", label: "Help & Support", sub: "FAQ, contact, report a bug", route: "/help", testID: "profile-help" },
  { icon: "bulb-outline", label: "Suggest an idea", sub: "Tell us what to build next", route: "/suggestions", testID: "profile-suggest" },
];

export default function ProfileSheet({ visible, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, accessToken, signOut } = useAuth();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const initial = (user?.name || user?.email || "U").charAt(0).toUpperCase();
  const [stats, setStats] = useState<{ memories: number; sessions: number; activeSessions: number } | null>(null);
  const [expoInfo, setExpoInfo] = useState<any | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState<any[] | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const r = await authedFetch("/api/security/sessions", accessToken);
      const j = await r.json();
      setDevices(Array.isArray(j.sessions) ? j.sessions : []);
    } catch (e: any) {
      Alert.alert("Couldn't load devices", e?.message || "");
    } finally { setDevicesLoading(false); }
  }, [accessToken]);

  const revokeDevice = useCallback(async (sessionId: string, label: string) => {
    const doRevoke = async () => {
      setRevoking(sessionId);
      try {
        const r = await authedFetch(`/api/security/sessions/${sessionId}/revoke`, accessToken, { method: "POST" });
        if (!r.ok) throw new Error(await r.text());
        setDevices((d) => (d || []).filter((s) => s.id !== sessionId));
        setStats((s) => s ? { ...s, activeSessions: Math.max(0, s.activeSessions - 1) } : s);
      } catch (e: any) {
        Alert.alert("Couldn't sign out device", e?.message || "");
      } finally { setRevoking(null); }
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Sign out "${label}"?`)) doRevoke();
      return;
    }
    Alert.alert("Sign out this device?", label, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: doRevoke },
    ]);
  }, [accessToken]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
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
      } catch { /* soft */ }
      try {
        const r = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/expo-qr`);
        if (r.ok) setExpoInfo(await r.json());
      } catch { /* soft */ }
    })();
  }, [visible, accessToken]);

  const navTo = (route: string) => {
    onClose();
    setTimeout(() => router.push(route as any), 80);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="profile-backdrop">
        <Pressable
          style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + theme.spacing.xl }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.topRow}>
            <View style={styles.handle} pointerEvents="none">
              <View style={styles.handleBar} />
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} testID="profile-close">
              <Ionicons name="close" size={20} color={c.onSurfaceSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Profile card */}
            <View style={styles.profileCard} testID="profile-card">
              <LinearGradient colors={[c.brandSecondary, c.brand]} style={styles.profileAvatar}>
                <Text style={styles.profileInitial} testID="profile-initial">{initial}</Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName} numberOfLines={1}>{user?.name || "ORA OS member"}</Text>
                <Text style={styles.profileEmail} numberOfLines={1}>{user?.email || "—"}</Text>
                <View style={styles.providerRow}>
                  <Ionicons
                    name={user?.provider === "google" ? "logo-google" : user?.provider === "apple" ? "logo-apple" : "mail"}
                    size={10}
                    color={c.brand}
                  />
                  <Text style={styles.providerTag}>
                    {user?.provider === "email_otp" ? "Email OTP" : (user?.provider || "—")}
                  </Text>
                </View>
              </View>
              <Pressable style={styles.signoutBtn} onPress={() => { onClose(); signOut(); }} testID="profile-signout">
                <Ionicons name="log-out-outline" size={18} color={c.onSurfaceSecondary} />
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
                <Pressable
                  style={styles.statBox}
                  onPress={() => { setShowDevices(true); if (!devices) loadDevices(); }}
                  testID="profile-devices-stat"
                >
                  <Text style={styles.statVal}>{stats.activeSessions}</Text>
                  <Text style={styles.statLbl}>Devices</Text>
                </Pressable>
              </View>
            )}

            {/* Expo QR card */}
            {expoInfo && (
              <View style={styles.expoCard} testID="profile-expo-qr">
                <View style={styles.expoLeft}>
                  <Text style={styles.expoLabel}>OPEN ON PHONE</Text>
                  <Text style={styles.expoTitle}>Scan with Expo Go</Text>
                  <Text style={styles.expoSub}>Install Expo Go, then point your camera here.</Text>
                  <View style={styles.expoBtns}>
                    <Pressable style={styles.expoBtn} onPress={() => Linking.openURL(expoInfo.expo_go_ios)}>
                      <Ionicons name="logo-apple" size={12} color={c.brand} />
                      <Text style={styles.expoBtnText}>iOS</Text>
                    </Pressable>
                    <Pressable style={styles.expoBtn} onPress={() => Linking.openURL(expoInfo.expo_go_android)}>
                      <Ionicons name="logo-android" size={12} color={c.brand} />
                      <Text style={styles.expoBtnText}>Android</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.qrFrame}>
                  <RNImage
                    source={{ uri: `${expoInfo.qr_image_url}?t=${Date.now()}` }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                </View>
              </View>
            )}

            <Text style={styles.sectionLabel}>ACCOUNT</Text>
            <View style={styles.sectionCard}>
              {ACCOUNT_ROWS.map((row, idx) => (
                <Pressable
                  key={row.route}
                  style={[styles.row, idx < ACCOUNT_ROWS.length - 1 && styles.rowDivider]}
                  onPress={() => navTo(row.route)}
                  testID={row.testID}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name={row.icon} size={18} color={c.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{row.label}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{row.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.onSurfaceSecondary} />
                </Pressable>
              ))}
            </View>

            <Text style={styles.footer}>ORA OS · v1.0.0 · AI Operating System for life.</Text>
          </ScrollView>
        </Pressable>
      </Pressable>

      {/* Devices modal */}
      <Modal
        visible={showDevices}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDevices(false)}
      >
        <View style={styles.devicesBackdrop}>
          <View style={[styles.devicesSheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.devicesHead}>
              <Text style={styles.devicesTitle}>Signed-in devices</Text>
              <Pressable
                onPress={() => setShowDevices(false)}
                hitSlop={10}
                style={styles.closeBtn}
                testID="devices-close"
              >
                <Ionicons name="close" size={20} color={c.onSurfaceSecondary} />
              </Pressable>
            </View>
            <Text style={styles.devicesSub}>
              These are all the sessions currently logged in to your ORA OS account. Tap “Sign out” to revoke any device.
            </Text>
            <ScrollView style={{ flex: 1, marginTop: theme.spacing.md }}>
              {devicesLoading ? (
                <ActivityIndicator color={c.brand} style={{ marginTop: 32 }} />
              ) : !devices || devices.length === 0 ? (
                <View style={{ alignItems: "center", marginTop: 48, gap: 8 }}>
                  <Ionicons name="phone-portrait-outline" size={36} color={c.onSurfaceSecondary} />
                  <Text style={styles.rowSub}>No active devices</Text>
                </View>
              ) : (
                devices.map((s) => {
                  const label = s.device_label || s.browser || "Unknown device";
                  const created = s.created_at ? new Date(s.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
                  const lastSeen = s.last_seen_at ? new Date(s.last_seen_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
                  return (
                    <View key={s.id} style={styles.deviceCard} testID={`device-${s.id}`}>
                      <View style={styles.rowIcon}>
                        <Ionicons
                          name={/iphone|ipad|ios/i.test(label) ? "phone-portrait" : /android/i.test(label) ? "logo-android" : /mac|win|linux|desktop/i.test(label) ? "desktop" : "globe"}
                          size={18}
                          color={c.brand}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
                        {!!s.browser && s.browser !== label && (
                          <Text style={styles.rowSub} numberOfLines={1}>{s.browser}</Text>
                        )}
                        {!!s.ip && (
                          <Text style={styles.rowSub} numberOfLines={1}>IP {s.ip}</Text>
                        )}
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {lastSeen ? `Last active ${lastSeen}` : created ? `Signed in ${created}` : ""}
                        </Text>
                      </View>
                      <Pressable
                        style={[styles.signoutDeviceBtn, revoking === s.id && { opacity: 0.5 }]}
                        onPress={() => revokeDevice(s.id, label)}
                        disabled={revoking === s.id}
                        testID={`device-revoke-${s.id}`}
                      >
                        {revoking === s.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="log-out-outline" size={13} color="#fff" />
                            <Text style={styles.signoutDeviceText}>Sign out</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: theme.spacing.lg,
    maxHeight: "92%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
    paddingTop: 4,
  },
  handle: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
  },
  closeBtn: {
    marginLeft: "auto",
    marginTop: 18,
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  profileCard: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  profileAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  profileInitial: { color: c.onBrand, fontFamily: theme.font.display, fontSize: 24 },
  profileName: { color: c.onSurface, fontSize: 16, fontWeight: "600" },
  profileEmail: { color: c.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  providerRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  providerTag: { color: c.brand, fontSize: 10, letterSpacing: 1 },
  signoutBtn: { padding: 8 },
  statsRow: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  statBox: {
    flex: 1, backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  statVal: { color: c.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  statLbl: { color: c.onSurfaceSecondary, fontSize: 10, marginTop: 4, letterSpacing: 0.8 },
  expoCard: {
    flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.md,
    backgroundColor: c.brandTertiary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.brandSecondary,
    alignItems: "center",
  },
  expoLeft: { flex: 1, gap: 4 },
  expoLabel: { color: c.brand, fontSize: 9, fontWeight: "700", letterSpacing: 1.8 },
  expoTitle: { color: c.onSurface, fontFamily: theme.font.display, fontSize: 18 },
  expoSub: { color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  expoBtns: { flexDirection: "row", gap: 6, marginTop: 6 },
  expoBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: c.surfaceSecondary,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  expoBtnText: { color: c.brand, fontSize: 11, fontWeight: "600" },
  qrFrame: {
    width: 100, height: 100, borderRadius: theme.radius.md,
    backgroundColor: "#fff",
    padding: 6, alignItems: "center", justifyContent: "center",
  },
  qrImage: { width: "100%", height: "100%" },
  sectionLabel: {
    color: c.onSurfaceSecondary, fontSize: 11, fontWeight: "600",
    letterSpacing: 1.8, marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm,
  },
  sectionCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { color: c.onSurface, fontSize: 14, fontWeight: "500" },
  rowSub: { color: c.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  footer: { color: c.onSurfaceSecondary, fontSize: 12, textAlign: "center", marginTop: theme.spacing.xl, fontStyle: "italic" },

  devicesBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  devicesSheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: theme.spacing.lg,
    height: "82%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: c.brandSecondary,
  },
  devicesHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  },
  devicesTitle: {
    color: c.onSurface,
    fontFamily: theme.font.display,
    fontSize: 20,
  },
  devicesSub: { color: c.onSurfaceSecondary, fontSize: 12, lineHeight: 17 },
  deviceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: c.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  signoutDeviceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#b91c1c",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  signoutDeviceText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
