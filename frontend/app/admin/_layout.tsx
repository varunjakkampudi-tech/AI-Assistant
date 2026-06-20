import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { Slot, usePathname, useRouter, useSegments } from "expo-router";
import { COLORS, adminMe, adminLogout } from "@/src/admin/api";

const NAV = [
  { href: "/admin", label: "Executive Dashboard", icon: "📊" },
  { href: "/admin/finance", label: "Finance Intelligence", icon: "💰" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/ai-models", label: "AI Model Control", icon: "🧠" },
  { href: "/admin/costs", label: "Cost Intelligence", icon: "💸" },
  { href: "/admin/prompts", label: "Prompts", icon: "📝" },
  { href: "/admin/features", label: "Feature Flags", icon: "🚩" },
  { href: "/admin/billing", label: "Billing & Plans", icon: "💳" },
  { href: "/admin/analytics", label: "Analytics", icon: "📈" },
  { href: "/admin/security", label: "Security", icon: "🛡️" },
  { href: "/admin/audit", label: "Audit Log", icon: "🧾" },
  { href: "/admin/notifications", label: "Notifications", icon: "📣" },
  { href: "/admin/config", label: "Configuration", icon: "⚙️" },
  { href: "/admin/health", label: "Provider Health", icon: "💚" },
  { href: "/admin/infrastructure", label: "Infrastructure", icon: "🖥️" },
  { href: "/admin/support", label: "Support Tickets", icon: "🎫" },
];

export default function AdminLayout() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const pathname = usePathname();
  const [me, setMe] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await adminMe();
      if (!alive) return;
      setMe(u);
      setLoading(false);
      const isLoginPage = segments[1] === "sign-in";
      if (!u && !isLoginPage) router.replace("/admin/sign-in" as any);
      if (u && isLoginPage) router.replace("/admin" as any);
    })();
    return () => { alive = false; };
  }, [segments.join("/")]);

  if (segments[1] === "sign-in") {
    return <View style={styles.root}><Slot /></View>;
  }

  if (loading || !me) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={COLORS.brand} />
        <Text style={styles.bootText}>ORA · Admin</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.sidebar}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.brandTitle}>ORA · Admin</Text>
            <Text style={styles.brandSub}>Super Console</Text>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href !== "/admin" && pathname.startsWith(n.href));
            return (
              <Pressable
                key={n.href}
                onPress={() => router.push(n.href as any)}
                style={[styles.navItem, active && styles.navItemActive]}
                data-testid={`admin-nav-${n.href.replace("/admin", "root").replace(/\//g, "-")}`}
              >
                <Text style={[styles.navIcon, active && { color: COLORS.brand }]}>{n.icon}</Text>
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>{n.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.userBlock}>
          <Text style={styles.userName} numberOfLines={1}>{me.name || me.email}</Text>
          <Text style={styles.userRole}>{(me.role || "").replace("_", " ").toUpperCase()}</Text>
          <Pressable
            onPress={async () => { await adminLogout(); router.replace("/admin/sign-in" as any); }}
            style={styles.logoutBtn}
            data-testid="admin-logout-button"
          >
            <Text style={styles.logoutText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.main}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: COLORS.bg, minHeight: "100%" },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg, gap: 16 },
  bootText: { color: COLORS.brand, letterSpacing: 4, fontSize: 14 },
  sidebar: {
    width: 260,
    backgroundColor: COLORS.panel,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    paddingVertical: 16,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: COLORS.border, marginBottom: 10 },
  brandDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.brand, opacity: 0.95 },
  brandTitle: { color: COLORS.text, fontSize: 16, fontWeight: "600" },
  brandSub: { color: COLORS.brand, fontSize: 10, letterSpacing: 3, marginTop: 2 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  navItemActive: { backgroundColor: COLORS.brandSoft, borderLeftWidth: 2, borderLeftColor: COLORS.brand },
  navIcon: { fontSize: 14, width: 18, textAlign: "center", color: COLORS.textDim },
  navLabel: { color: COLORS.textDim, fontSize: 13, flex: 1 },
  navLabelActive: { color: COLORS.text, fontWeight: "600" },
  userBlock: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 8, paddingHorizontal: 18, paddingTop: 14 },
  userName: { color: COLORS.text, fontSize: 13, fontWeight: "600" },
  userRole: { color: COLORS.brand, fontSize: 10, letterSpacing: 2, marginTop: 2 },
  logoutBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, alignItems: "center" },
  logoutText: { color: COLORS.text, fontSize: 12 },
  main: { flex: 1, backgroundColor: COLORS.bg },
});
