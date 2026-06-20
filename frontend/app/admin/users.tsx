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
    try { setSelected(await adminFetch(`/api/admin/users/${id}`)); } catch {}
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

          <View style={{ marginTop: "auto", paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border }}>
            <Button label="Delete user permanently" kind="danger" onPress={() => del(selected.user.id)} testID="user-delete-btn" />
          </View>
        </View>
      ) : null}
    </Page>
  );
}
