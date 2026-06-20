import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, Alert } from "react-native";
import { adminFetch, COLORS } from "@/src/admin/api";
import { Page, Card, Section, Button, Badge, Spinner, Grid, Stat } from "@/src/admin/ui";

const PROVIDERS = ["bedrock", "openai", "anthropic", "gemini", "azure", "groq", "deepseek", "ollama"];
const FEATURES = ["chat", "journal", "career", "knowledge", "digital_twin", "voice", "briefing", "search", "memory"];

export default function AIModelsScreen() {
  const [data, setData] = useState<any | null>(null);
  const [featureMap, setFeatureMap] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({ api_key: "", secret_key: "", endpoint: "", region: "", enabled: true });

  const load = async () => {
    const [p, fm] = await Promise.all([
      adminFetch("/api/admin/ai/providers"),
      adminFetch("/api/admin/ai/feature-models"),
    ]);
    setData(p); setFeatureMap(fm.items || []);
  };
  useEffect(() => { load(); }, []);

  const saveProvider = async (name: string) => {
    try {
      const existing = data.items.find((x: any) => x.name === name);
      if (existing) {
        await adminFetch(`/api/admin/ai/providers/${name}`, { method: "PATCH", body: JSON.stringify(draft) });
      } else {
        await adminFetch(`/api/admin/ai/providers`, { method: "POST", body: JSON.stringify({ name, ...draft, label: data.labels[name] }) });
      }
      setEditing(null);
      setDraft({ api_key: "", secret_key: "", endpoint: "", region: "", enabled: true });
      await load();
    } catch (e: any) { Alert.alert("Save failed", e?.message || ""); }
  };

  const toggleProvider = async (name: string, enabled: boolean) => {
    try {
      await adminFetch(`/api/admin/ai/providers/${name}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const assignFeatureModel = async (feature: string, primary: string, fallbacks: string[]) => {
    try {
      await adminFetch("/api/admin/ai/feature-models", { method: "POST", body: JSON.stringify({ feature, primary_model_id: primary, fallback_model_ids: fallbacks }) });
      await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const allModels: string[] = useMemo(() => {
    const set = new Set<string>();
    if (!data) return [];
    Object.values(data.catalog || {}).forEach((arr: any) => (arr as string[]).forEach((m) => set.add(m)));
    return Array.from(set);
  }, [data]);

  if (!data) return <Page title="AI Model Control"><Spinner /></Page>;

  return (
    <Page title="AI Model Control" subtitle="Providers, credentials, per-feature routing & failover">
      <Section title="Providers">
        <View style={{ gap: 12 }}>
          {PROVIDERS.map((name) => {
            const p = data.items.find((x: any) => x.name === name);
            const enabled = !!p?.enabled;
            const isEditing = editing === name;
            return (
              <Card key={name}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: "600" }}>{data.labels[name]}</Text>
                    <Text style={{ color: COLORS.textDim, fontSize: 12, marginTop: 2 }}>
                      {p ? (p.api_key ? `key: ${p.api_key}` : "no key set") : "not configured"}
                      {p?.region ? ` · ${p.region}` : ""}
                    </Text>
                  </View>
                  <Badge label={enabled ? "enabled" : "disabled"} kind={enabled ? "ok" : "neutral"} />
                  <View style={{ marginLeft: 12, flexDirection: "row", gap: 6 }}>
                    <Button small label={enabled ? "Disable" : "Enable"} kind="ghost" onPress={() => toggleProvider(name, !enabled)} testID={`provider-toggle-${name}`} />
                    <Button small label={isEditing ? "Cancel" : "Edit"} kind="ghost" onPress={() => setEditing(isEditing ? null : name)} testID={`provider-edit-${name}`} />
                  </View>
                </View>
                {isEditing ? (
                  <View style={{ marginTop: 14, gap: 8 }}>
                    {(["api_key", "secret_key", "endpoint", "region"] as const).map(f => (
                      <TextInput
                        key={f}
                        value={draft[f]}
                        onChangeText={v => setDraft({ ...draft, [f]: v })}
                        placeholder={f.replace("_", " ")}
                        placeholderTextColor={COLORS.textFaint}
                        secureTextEntry={f === "api_key" || f === "secret_key"}
                        style={{ backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text }}
                        data-testid={`provider-${name}-${f}`}
                      />
                    ))}
                    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                      <Button small label="Save credentials" onPress={() => saveProvider(name)} testID={`provider-save-${name}`} />
                    </View>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                  {(data.catalog[name] || []).map((m: string) => (
                    <View key={m} style={{ backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                      <Text style={{ color: COLORS.textDim, fontSize: 11 }}>{m}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            );
          })}
        </View>
      </Section>

      <Section title="Per-Feature Model Routing">
        <Text style={{ color: COLORS.textDim, fontSize: 12, marginBottom: 12 }}>
          Pick the primary model for each feature. Failover chain can be edited per row.
        </Text>
        <View style={{ gap: 12 }}>
          {FEATURES.map(f => {
            const cur = featureMap.find(x => x.feature === f);
            return (
              <Card key={f}>
                <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: "600", textTransform: "capitalize" }}>{f.replace("_", " ")}</Text>
                <Text style={{ color: COLORS.textDim, fontSize: 11, marginTop: 4 }}>
                  Primary: <Text style={{ color: COLORS.brand }}>{cur?.primary_model_id || "—"}</Text>
                  {cur?.fallback_model_ids?.length ? `   →  Fallbacks: ${cur.fallback_model_ids.join(" → ")}` : ""}
                </Text>
                <ScrollView horizontal style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {allModels.map(m => (
                      <Pressable
                        key={m}
                        onPress={() => assignFeatureModel(f, m, cur?.fallback_model_ids || [])}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: cur?.primary_model_id === m ? COLORS.brand : COLORS.border, backgroundColor: cur?.primary_model_id === m ? COLORS.brandSoft : "transparent" }}
                        data-testid={`feature-${f}-model-${m}`}
                      >
                        <Text style={{ color: cur?.primary_model_id === m ? COLORS.brand : COLORS.textDim, fontSize: 11 }}>{m}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </Card>
            );
          })}
        </View>
      </Section>
    </Page>
  );
}
