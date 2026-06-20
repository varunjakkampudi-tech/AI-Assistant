import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { adminFetch, COLORS, fmtMoney } from "@/src/admin/api";
import { Page, Card, Section, Stat, Grid, Button, Badge, Spinner, Table } from "@/src/admin/ui";

export default function BillingScreen() {
  const [summary, setSummary] = useState<any | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);

  const load = async () => {
    const [s, p] = await Promise.all([
      adminFetch("/api/admin/billing/summary"),
      adminFetch("/api/admin/subscriptions/plans"),
    ]);
    setSummary(s); setPlans(p.items || []);
  };
  useEffect(() => { load(); }, []);

  const savePlan = async () => {
    if (!edit) return;
    try {
      await adminFetch("/api/admin/subscriptions/plans", { method: "PUT", body: JSON.stringify({
        key: edit.key, label: edit.label,
        price_usd_monthly: parseFloat(edit.price_usd_monthly) || 0,
        storage_gb: parseFloat(edit.storage_gb) || 0,
        monthly_token_limit: parseInt(edit.monthly_token_limit) || 0,
        upload_limit_mb: parseInt(edit.upload_limit_mb) || 0,
        ai_requests_per_day: parseInt(edit.ai_requests_per_day) || 0,
        features: typeof edit.features === "string" ? edit.features.split(",").map((s: string) => s.trim()) : edit.features,
      }) });
      setEdit(null); await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  if (!summary) return <Page title="Billing & Plans"><Spinner /></Page>;

  return (
    <Page title="Billing & Plans" subtitle={summary.note || "Subscription & revenue snapshot"}>
      <Section title="Revenue Snapshot">
        <Grid cols={4}>
          <Stat label="MRR" value={fmtMoney(summary.mrr)} tone="ok" />
          <Stat label="ARR" value={fmtMoney(summary.arr)} tone="ok" />
          <Stat label="Active Subscriptions" value={summary.active_subscriptions} />
          <Stat label="Free Users" value={summary.free_users} />
        </Grid>
        <Card>
          <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 10 }}>PLAN DISTRIBUTION</Text>
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            {Object.entries(summary.plan_distribution || {}).map(([k, v]: any) => (
              <View key={k} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Badge label={k} kind={k === "enterprise" ? "ok" : k === "premium" ? "warn" : k === "pro" ? "info" : "neutral"} />
                <Text style={{ color: COLORS.text }}>{v} users · {fmtMoney(summary.plan_prices[k])}/mo</Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <Section title="Plans">
        <Table
          columns={[
            { key: "label", label: "Plan", render: (v, r) => <View><Text style={{ color: COLORS.text, fontWeight: "600" }}>{v}</Text><Text style={{ color: COLORS.textFaint, fontSize: 11 }}>{r.key}</Text></View> },
            { key: "price_usd_monthly", label: "Price", width: 120, render: v => <Text style={{ color: COLORS.brand }}>{fmtMoney(v)}/mo</Text> },
            { key: "storage_gb", label: "Storage", width: 100, render: v => <Text style={{ color: COLORS.text }}>{v} GB</Text> },
            { key: "monthly_token_limit", label: "Tokens/mo", width: 140, render: v => <Text style={{ color: COLORS.text }}>{Number(v).toLocaleString()}</Text> },
            { key: "ai_requests_per_day", label: "AI/day", width: 100 },
            { key: "actions", label: "", width: 100, render: (_, r) => <Button small label="Edit" kind="ghost" onPress={() => setEdit({ ...r, features: (r.features || []).join(", ") })} testID={`plan-edit-${r.key}`} /> },
          ]}
          rows={plans}
        />
      </Section>

      {edit ? (
        <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" } as any}>
          <Card style={{ width: 520 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "600", marginBottom: 16 }}>Edit Plan · {edit.key}</Text>
            {[
              ["label", "Label"],
              ["price_usd_monthly", "Price (USD/mo)"],
              ["storage_gb", "Storage (GB)"],
              ["monthly_token_limit", "Monthly token limit"],
              ["upload_limit_mb", "Upload limit (MB)"],
              ["ai_requests_per_day", "AI requests/day"],
              ["features", "Features (comma-separated)"],
            ].map(([k, label]) => (
              <View key={k as string} style={{ marginBottom: 10 }}>
                <Text style={{ color: COLORS.textDim, fontSize: 11, marginBottom: 4 }}>{label}</Text>
                <TextInput value={String((edit as any)[k as string] ?? "")} onChangeText={v => setEdit({ ...edit, [k as string]: v })} style={inp} data-testid={`plan-field-${k}`} />
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <Button label="Cancel" kind="ghost" onPress={() => setEdit(null)} testID="plan-cancel-btn" />
              <Button label="Save" onPress={savePlan} testID="plan-save-btn" />
            </View>
          </Card>
        </View>
      ) : null}
    </Page>
  );
}

const inp: any = { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text };
