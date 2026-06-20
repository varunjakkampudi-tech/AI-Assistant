import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Table, Button, Badge, Section, Spinner } from "@/src/admin/ui";

const ROLES = ["user", "admin", "super_admin"];
const PLANS = ["free", "pro", "premium", "enterprise"];

export default function UsersScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      const data = await adminFetch(`/api/admin/users?q=${encodeURIComponent(q)}&limit=100`);
      setItems(data.items);
      setTotal(data.total);
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const act = async (id: string, path: string, body?: any, method = "PUT") => {
    try {
      await adminFetch(`/api/admin/users/${id}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
      await load();
      if (selected?.user?.id === id) refreshSelected(id);
    } catch (e: any) {
      Alert.alert("Failed", e?.message || "Action failed");
    }
  };

  const refreshSelected = async (id: string) => {
    try {
      const [detail, usage] = await Promise.all([
        adminFetch(`/api/admin/users/${id}`),
        adminFetch(`/api/admin/users/${id}/usage?days=30`),
      ]);
      setSelected({ ...detail, usage });
    } catch {}
  };

  const [impersonateData, setImpersonateData] = useState<any | null>(null);

  const impersonate = async (id: string, email: string) => {
    if (!confirm(`Generate an impersonation session for ${email}? This will be audit-logged as "user.impersonated".`)) return;
    try {
      const r = await adminFetch(`/api/admin/users/${id}/impersonate`, { method: "POST", body: JSON.stringify({ reason: "support", duration_minutes: 60 }) });
      setImpersonateData({ ...r, targetEmail: email });
    } catch (e: any) { Alert.alert("Failed", e?.message || "Impersonation failed"); }
  };

  const del = async (id: string) => {
    if (!confirm("Permanently delete this user and all their data? This cannot be undone.")) return;
    try {
      await adminFetch(`/api/admin/users/${id}`, { method: "DELETE" });
      setSelected(null);
      await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || "Delete failed"); }
  };

  return (
    <Page title="Users" subtitle={`${total} users · search, suspend, promote, delete`}
      actions={
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={load}
            placeholder="Search email or name…"
            placeholderTextColor={COLORS.textFaint}
            style={{ backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text, width: 260 }}
            data-testid="users-search-input"
          />
          <Button label="Refresh" kind="ghost" onPress={load} testID="users-refresh-button" />
        </View>
      }>
      {busy && items.length === 0 ? <Spinner /> : (
        <Table
          columns={[
            { key: "email", label: "Email", render: (_, r) => (
              <Pressable onPress={() => refreshSelected(r.id)} data-testid={`user-row-${r.id}`}>
                <Text style={{ color: COLORS.text, fontWeight: "600" }}>{r.email}</Text>
                <Text style={{ color: COLORS.textFaint, fontSize: 11 }}>{r.name || "—"}</Text>
              </Pressable>
            ) },
            { key: "role", label: "Role", width: 110, render: (v) => <Badge label={v || "user"} kind={v === "super_admin" ? "warn" : v === "admin" ? "info" : "neutral"} /> },
            { key: "plan", label: "Plan", width: 90, render: (v) => <Badge label={v || "free"} kind={v === "enterprise" ? "ok" : v === "premium" ? "warn" : v === "pro" ? "info" : "neutral"} /> },
            { key: "status", label: "Status", width: 100, render: (v) => <Badge label={v || "active"} kind={v === "active" || !v ? "ok" : v === "suspended" ? "warn" : "err"} /> },
            { key: "provider", label: "Provider", width: 90 },
            { key: "created_at", label: "Joined", width: 160, render: (v) => <Text style={{ color: COLORS.textDim, fontSize: 12 }}>{fmtDate(v)}</Text> },
          ]}
          rows={items}
        />
      )}

      {selected ? (
        <View style={{ position: "absolute", right: 24, top: 24, bottom: 24, width: 380, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderStrong, padding: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "600", flex: 1 }}>{selected.user.email}</Text>
            <Pressable onPress={() => setSelected(null)} data-testid="user-detail-close"><Text style={{ color: COLORS.textDim, fontSize: 20 }}>×</Text></Pressable>
          </View>
          <Text style={{ color: COLORS.textDim, fontSize: 12 }}>ID: {selected.user.id}</Text>
          <Text style={{ color: COLORS.textDim, fontSize: 12, marginTop: 4 }}>Joined: {fmtDate(selected.user.created_at)}</Text>

          <Section title="Status">
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Button label="Activate" small onPress={() => act(selected.user.id, "/status", { status: "active" })} kind="ghost" testID="user-activate-btn" />
              <Button label="Suspend" small onPress={() => act(selected.user.id, "/status", { status: "suspended" })} kind="warn" testID="user-suspend-btn" />
              <Button label="Ban" small onPress={() => act(selected.user.id, "/status", { status: "banned" })} kind="danger" testID="user-ban-btn" />
            </View>
          </Section>

          <Section title="Role">
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {ROLES.map(r => (
                <Button key={r} label={r} small kind={selected.user.role === r ? "primary" : "ghost"} onPress={() => act(selected.user.id, "/role", { role: r })} testID={`user-role-${r}-btn`} />
              ))}
            </View>
          </Section>

          <Section title="Plan">
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {PLANS.map(p => (
                <Button key={p} label={p} small kind={selected.user.plan === p ? "primary" : "ghost"} onPress={() => act(selected.user.id, "/plan", { plan: p })} testID={`user-plan-${p}-btn`} />
              ))}
            </View>
          </Section>

          <Section title="Sessions & Activity">
            <Text style={{ color: COLORS.textDim, fontSize: 12 }}>Active sessions: {selected.sessions?.length || 0}</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
              <Button small label="Revoke all sessions" kind="ghost" onPress={() => act(selected.user.id, "/revoke-sessions", null, "POST")} testID="user-revoke-sessions-btn" />
            </View>
          </Section>

          <View style={{ marginTop: "auto", paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 8 }}>
            <Button label="Login as user (impersonate)" kind="warn" onPress={() => impersonate(selected.user.id, selected.user.email)} testID="user-impersonate-btn" />
            <Button label="Delete user permanently" kind="danger" onPress={() => del(selected.user.id)} testID="user-delete-btn" />
          </View>
        </View>
      ) : null}

      {selected?.usage ? (
        <View style={{ position: "absolute", left: 24, bottom: 24, width: 420, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderStrong, padding: 16, maxHeight: 380 }}>
          <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: "600", marginBottom: 12 }}>30-day Usage · {selected.usage.user.email}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {[
              ["Messages", selected.usage.counts?.messages],
              ["Voice Calls", selected.usage.counts?.voice_calls],
              ["Documents", selected.usage.counts?.documents],
              ["Memories", selected.usage.counts?.memories],
              ["Journal", selected.usage.counts?.journal_entries],
              ["Goals", selected.usage.counts?.goals],
              ["Applications", selected.usage.counts?.applications],
              ["Storage", `${selected.usage.storage?.mb || 0} MB`],
              ["Tokens", (selected.usage.ai?.total_tokens || 0).toLocaleString()],
              ["AI Cost", `$${(selected.usage.ai?.cost_usd || 0).toFixed(4)}`],
              ["AI Requests", selected.usage.ai?.requests],
              ["Sessions", selected.usage.active_sessions],
            ].map(([k, v], i) => (
              <View key={i} style={{ width: 120, marginBottom: 8 }}>
                <Text style={{ color: COLORS.textFaint, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{k}</Text>
                <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: "600", marginTop: 2 }}>{v ?? "—"}</Text>
              </View>
            ))}
          </View>
          {(selected.usage.by_feature || []).length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: COLORS.textDim, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginBottom: 6 }}>BY FEATURE</Text>
              {selected.usage.by_feature.slice(0, 5).map((b: any) => (
                <View key={b.feature} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: COLORS.textDim, fontSize: 12 }}>{b.feature}</Text>
                  <Text style={{ color: COLORS.brand, fontSize: 12 }}>{b.requests} · ${b.cost_usd.toFixed(4)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {impersonateData ? (
        <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" } as any}>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: 24, width: 560, borderWidth: 1, borderColor: COLORS.borderStrong }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "600", marginBottom: 6 }}>Impersonation session ready</Text>
            <Text style={{ color: COLORS.textDim, fontSize: 13, marginBottom: 14 }}>Audit logged as <Text style={{ color: COLORS.brand }}>user.impersonated</Text> for <Text style={{ color: COLORS.text }}>{impersonateData.targetEmail}</Text>. Use these tokens from a separate browser session (or curl) to act as the user. Your admin session here is untouched.</Text>
            <Text style={{ color: COLORS.textDim, fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>ACCESS TOKEN</Text>
            <Text selectable style={{ color: COLORS.text, fontSize: 11, backgroundColor: COLORS.bg, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, fontFamily: "monospace" as any }}>{impersonateData.access_token}</Text>
            <Text style={{ color: COLORS.textDim, fontSize: 10, letterSpacing: 1, marginTop: 12, marginBottom: 4 }}>REFRESH TOKEN</Text>
            <Text selectable style={{ color: COLORS.text, fontSize: 11, backgroundColor: COLORS.bg, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, fontFamily: "monospace" as any }}>{impersonateData.refresh_token}</Text>
            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <Button label="Copy access token" kind="ghost" onPress={() => { if (typeof window !== "undefined") { window.navigator.clipboard.writeText(impersonateData.access_token); alert("Copied"); } }} testID="impersonate-copy-btn" />
              <Button label="Close" onPress={() => setImpersonateData(null)} testID="impersonate-close-btn" />
            </View>
          </View>
        </View>
      ) : null}
    </Page>
  );
}
