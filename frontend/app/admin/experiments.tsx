import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ScrollView } from "react-native";
import { adminFetch, COLORS, fmtDate, fmtNum } from "@/src/admin/api";
import { Page, Card, Section, Button, Badge, Spinner, Table, MiniBar, Stat, Grid } from "@/src/admin/ui";

const STATUSES = ["draft", "running", "paused", "completed"];

export default function ExperimentsScreen() {
  const [items, setItems] = useState<any[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openResults, setOpenResults] = useState<string | null>(null);

  const load = async () => setItems((await adminFetch("/api/admin/experiments")).items);
  useEffect(() => { load(); }, []);

  const setStatus = async (exp: any, status: string) => {
    try { await adminFetch(`/api/admin/experiments/${exp.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };
  const del = async (exp: any) => {
    if (!confirm(`Delete experiment "${exp.key}"? All assignments and events will also be removed.`)) return;
    try { await adminFetch(`/api/admin/experiments/${exp.id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  if (!items) return <Page title="A/B Testing Console"><Spinner /></Page>;

  return (
    <Page
      title="A/B Testing Console"
      subtitle="Run controlled experiments — risky model changes, prompts, UI copy — without exposing every user."
      actions={<Button label={showCreate ? "Cancel" : "+ New Experiment"} onPress={() => setShowCreate((v) => !v)} testID="new-experiment-btn" />}
    >
      {showCreate ? <CreateExperiment onDone={async () => { setShowCreate(false); await load(); }} /> : null}

      <Section title="Experiments">
        {items.length === 0 ? (
          <Card>
            <Text style={{ color: COLORS.textDim, textAlign: "center", padding: 16 }}>
              No experiments yet — create one to start testing model / prompt / copy variants.
            </Text>
          </Card>
        ) : null}
        <View style={{ gap: 10 }}>
          {items.map((e) => (
            <Card key={e.id} testID={`exp-${e.key}`}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: 15, fontWeight: "600" }}>{e.label || e.key}</Text>
                  <Text style={{ color: COLORS.textFaint, fontSize: 11 }}>{e.key}  ·  primary: {e.primary_metric}  ·  updated {fmtDate(e.updated_at)}</Text>
                  {e.description ? <Text style={{ color: COLORS.textDim, fontSize: 12, marginTop: 4 }}>{e.description}</Text> : null}
                </View>
                <Badge label={e.status} kind={e.status === "running" ? "ok" : e.status === "paused" ? "warn" : e.status === "completed" ? "info" : "neutral"} />
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {(e.variants || []).map((v: any) => (
                  <View key={v.key} style={{ backgroundColor: COLORS.brandSoft, borderColor: COLORS.brand, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Text style={{ color: COLORS.brand, fontSize: 11, fontWeight: "700" }}>{v.key.toUpperCase()} · {v.weight}%</Text>
                    {v.label ? <Text style={{ color: COLORS.textDim, fontSize: 10 }}>{v.label}</Text> : null}
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {STATUSES.map((s) => (
                  <Button key={s} small label={s} kind={e.status === s ? "primary" : "ghost"} onPress={() => setStatus(e, s)} testID={`exp-${e.key}-status-${s}`} />
                ))}
                <Button small label="View Results" onPress={() => setOpenResults(openResults === e.id ? null : e.id)} testID={`exp-${e.key}-results`} />
                <Button small label="Delete" kind="danger" onPress={() => del(e)} testID={`exp-${e.key}-del`} />
              </View>

              {openResults === e.id ? <Results expId={e.id} /> : null}
            </Card>
          ))}
        </View>
      </Section>
    </Page>
  );
}

function CreateExperiment({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [primary, setPrimary] = useState("conversion");
  const [aKey, setAKey] = useState("A");
  const [aLabel, setALabel] = useState("Control");
  const [aWeight, setAWeight] = useState("50");
  const [aCfg, setACfg] = useState("{}");
  const [bKey, setBKey] = useState("B");
  const [bLabel, setBLabel] = useState("Variant");
  const [bWeight, setBWeight] = useState("50");
  const [bCfg, setBCfg] = useState("{}");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!key.trim()) { Alert.alert("Required", "Experiment key is required"); return; }
    let aConfig = {}, bConfig = {};
    try { aConfig = JSON.parse(aCfg || "{}"); } catch { Alert.alert("Invalid JSON", "Variant A config must be valid JSON"); return; }
    try { bConfig = JSON.parse(bCfg || "{}"); } catch { Alert.alert("Invalid JSON", "Variant B config must be valid JSON"); return; }
    setSaving(true);
    try {
      await adminFetch("/api/admin/experiments", {
        method: "POST",
        body: JSON.stringify({
          key: key.trim(), label: label || key, description, status: "draft",
          primary_metric: primary,
          variants: [
            { key: aKey, label: aLabel, weight: parseInt(aWeight) || 50, config: aConfig },
            { key: bKey, label: bLabel, weight: parseInt(bWeight) || 50, config: bConfig },
          ],
        }),
      });
      onDone();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
    finally { setSaving(false); }
  };

  return (
    <Section title="New Experiment">
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <TextInput value={key} onChangeText={setKey} placeholder="experiment_key (e.g. chat_model_2026q1)" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { flex: 2, minWidth: 280 }]} data-testid="new-exp-key" />
          <TextInput value={label} onChangeText={setLabel} placeholder="Display label" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { flex: 1, minWidth: 200 }]} data-testid="new-exp-label" />
          <TextInput value={primary} onChangeText={setPrimary} placeholder="primary metric (event name)" placeholderTextColor={COLORS.textFaint} style={inputStyle} data-testid="new-exp-metric" />
        </View>
        <TextInput value={description} onChangeText={setDescription} placeholder="Description / hypothesis" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { width: "100%", height: 60, marginBottom: 12 }]} multiline data-testid="new-exp-desc" />

        <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 8 }}>VARIANTS</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <VariantCard title="Variant A (control)" kK={aKey} setKK={setAKey} lbl={aLabel} setLbl={setALabel} w={aWeight} setW={setAWeight} cfg={aCfg} setCfg={setACfg} testidPrefix="va" />
          <VariantCard title="Variant B" kK={bKey} setKK={setBKey} lbl={bLabel} setLbl={setBLabel} w={bWeight} setW={setBWeight} cfg={bCfg} setCfg={setBCfg} testidPrefix="vb" />
        </View>

        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
          <Button label={saving ? "Saving..." : "Create Experiment"} onPress={create} disabled={saving} testID="create-exp-submit" />
        </View>
      </Card>
    </Section>
  );
}

function VariantCard({ title, kK, setKK, lbl, setLbl, w, setW, cfg, setCfg, testidPrefix }: any) {
  return (
    <View style={{ flex: 1, minWidth: 320, backgroundColor: COLORS.bg, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, padding: 12 }}>
      <Text style={{ color: COLORS.brand, fontSize: 12, fontWeight: "700", marginBottom: 8 }}>{title}</Text>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
        <TextInput value={kK} onChangeText={setKK} placeholder="key" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { width: 70 }]} data-testid={`${testidPrefix}-key`} />
        <TextInput value={lbl} onChangeText={setLbl} placeholder="label" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { flex: 1 }]} data-testid={`${testidPrefix}-label`} />
        <TextInput value={w} onChangeText={setW} keyboardType="numeric" placeholder="50" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { width: 70 }]} data-testid={`${testidPrefix}-weight`} />
      </View>
      <TextInput value={cfg} onChangeText={setCfg} placeholder='{"model":"nova-lite"}' placeholderTextColor={COLORS.textFaint} style={[inputStyle, { width: "100%", height: 60, fontFamily: "monospace" }]} multiline data-testid={`${testidPrefix}-config`} />
    </View>
  );
}

function Results({ expId }: { expId: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { adminFetch(`/api/admin/experiments/${expId}/results`).then(setData); }, [expId]);
  if (!data) return <View style={{ paddingTop: 12 }}><Spinner /></View>;
  return (
    <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: COLORS.border }}>
      <Grid cols={3}>
        <Stat label="Total Assigned" value={fmtNum(data.total_assigned)} />
        <Stat label="Total Conversions" value={fmtNum(data.total_conversions)} />
        <Stat
          label="Best Uplift"
          value={data.leader ? `${data.uplift_pct > 0 ? "+" : ""}${data.uplift_pct}%` : "—"}
          tone={data.uplift_pct > 0 ? "ok" : data.uplift_pct < 0 ? "err" : "warn"}
          hint={data.leader ? `Leader: ${data.leader.variant}` : undefined}
        />
      </Grid>
      <Table
        rows={data.variants}
        columns={[
          { key: "variant", label: "Variant", width: 110, render: (v) => <Badge label={v} kind={data.leader?.variant === v ? "ok" : "info"} /> },
          { key: "assigned", label: "Assigned", width: 110 },
          { key: "conversions", label: "Conversions", width: 120 },
          { key: "users_converted", label: "Users", width: 90 },
          { key: "conversion_rate_pct", label: "CR %", width: 100, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{v}%</Text> },
          { key: "value_sum", label: "Value Σ", width: 110 },
          { key: "avg_value", label: "Avg value", width: 110 },
        ]}
      />
      {data.daily_series && data.daily_series.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 8 }}>DAILY CONVERSIONS</Text>
          <Card>
            {(data.experiment.variants || []).map((v: any) => (
              <View key={v.key} style={{ marginBottom: 10 }}>
                <Text style={{ color: COLORS.textDim, fontSize: 10, marginBottom: 4 }}>{v.key}</Text>
                <MiniBar values={data.daily_series.map((d: any) => d[v.key] || 0)} height={30} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </View>
  );
}

const inputStyle: any = { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text, minWidth: 160 };
