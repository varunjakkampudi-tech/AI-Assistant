import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Image as RNImage,
  Linking,
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
            <View style={styles.handle} />
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
                <View style={styles.statBox}>
                  <Text style={styles.statVal}>{stats.activeSessions}</Text>
                  <Text style={styles.statLbl}>Devices</Text>
                </View>
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

            <Text style={styles.footer}>ORA OS · v1.0.0 · Your AI Operating System for life.</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
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
  topRow: { flexDirection: "row", alignItems: "center", marginBottom: theme.spacing.md },
  handle: {
    flex: 1,
    alignSelf: "center",
    height: 4,
    maxWidth: 40,
    marginLeft: 40,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
  },
  closeBtn: {
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
});
