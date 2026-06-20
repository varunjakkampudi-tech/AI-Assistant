import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Button, Badge, Spinner } from "@/src/admin/ui";

const STATUSES = ["enabled", "disabled", "beta", "internal", "rollout"];

export default function FeatureFlagsScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const load = async () => {
    setBusy(true);
    try {
      const d = await adminFetch("/api/admin/features");
      setItems(d.items || []);
      const drafts: Record<string, string> = {};
      (d.items || []).forEach((f: any) => { drafts[f.key] = f.paused_reason || ""; });
      setReasonDraft(drafts);
    }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (flag: any, patch: any) => {
    try {
      await adminFetch("/api/admin/features", { method: "PUT", body: JSON.stringify({ ...flag, ...patch }) });
      await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const addFlag = async () => {
    if (!newKey.trim()) return;
    await save({ key: newKey.trim(), label: newKey.trim(), status: "enabled", rollout_pct: 100, audience: [] }, {});
    setNewKey("");
  };

  const del = async (key: string) => {
    if (!confirm(`Delete feature flag "${key}"?`)) return;
    try { await adminFetch(`/api/admin/features/${key}`, { method: "DELETE" }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  return (
    <Page title="Feature Release Center" subtitle="Toggle, beta, percentage rollout — no code deployment"
      actions={
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={newKey} onChangeText={setNewKey} placeholder="new_feature_key" placeholderTextColor={COLORS.textFaint} style={inputStyle} data-testid="new-feature-input" />
          <Button label="Add Flag" onPress={addFlag} testID="add-feature-btn" />
        </View>
      }>
      {busy && items.length === 0 ? <Spinner /> : null}
      <View style={{ gap: 10 }}>
        {items.map((f) => (
          <Card key={f.key} testID={`feature-${f.key}`}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontSize: 15, fontWeight: "600" }}>{f.label}</Text>
                <Text style={{ color: COLORS.textFaint, fontSize: 11 }}>{f.key}  ·  updated {fmtDate(f.updated_at)}</Text>
              </View>
              <Badge label={f.status} kind={f.status === "enabled" ? "ok" : f.status === "disabled" ? "neutral" : f.status === "beta" ? "info" : "warn"} />
              <Pressable onPress={() => del(f.key)} style={{ marginLeft: 12 }} data-testid={`feature-delete-${f.key}`}><Text style={{ color: COLORS.err }}>✕</Text></Pressable>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {STATUSES.map(s => (
                <Button key={s} small label={s} kind={f.status === s ? "primary" : "ghost"} onPress={() => save(f, { status: s })} testID={`feature-${f.key}-status-${s}`} />
              ))}
            </View>
            <Text style={{ color: COLORS.textDim, fontSize: 11, marginBottom: 6 }}>ROLLOUT · {f.rollout_pct}%</Text>
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
              {[0, 10, 25, 50, 75, 100].map(p => (
                <Pressable key={p} onPress={() => save(f, { rollout_pct: p })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: f.rollout_pct === p ? COLORS.brand : "transparent", borderWidth: 1, borderColor: f.rollout_pct === p ? COLORS.brand : COLORS.border }} data-testid={`feature-${f.key}-rollout-${p}`}>
                  <Text style={{ color: f.rollout_pct === p ? COLORS.bg : COLORS.textDim, fontSize: 12, fontWeight: "600" }}>{p}%</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: COLORS.textDim, fontSize: 11, marginBottom: 6 }}>PAUSED MESSAGE · shown to users when this feature is hidden</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <TextInput
                value={reasonDraft[f.key] ?? ""}
                onChangeText={(v) => setReasonDraft((d) => ({ ...d, [f.key]: v }))}
                placeholder="e.g. Down for maintenance until 7 PM IST"
                placeholderTextColor={COLORS.textFaint}
                style={[inputStyle, { flex: 1, width: undefined }]}
                data-testid={`feature-${f.key}-reason-input`}
              />
              <Button
                small
                label="Save message"
                onPress={() => save(f, { paused_reason: reasonDraft[f.key] || "" })}
                testID={`feature-${f.key}-reason-save`}
              />
            </View>
            {f.paused_reason ? (
              <Text style={{ color: COLORS.brand, fontSize: 11, marginTop: 8, fontStyle: "italic" }}>
                Current message: “{f.paused_reason}”
              </Text>
            ) : null}
          </Card>
        ))}
      </View>
    </Page>
  );
}

const inputStyle: any = { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text, width: 220 };
