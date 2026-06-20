import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { adminFetch, COLORS, fmtMoney } from "@/src/admin/api";
import { Page, Card, Section, Stat, Grid, Button, Spinner, Table, Badge, MiniBar } from "@/src/admin/ui";

export default function CostCenter() {
  const [usage, setUsage] = useState<any | null>(null);
  const [budget, setBudget] = useState<any | null>(null);
  const [series, setSeries] = useState<any | null>(null);
  const [monthlyUsd, setMonthlyUsd] = useState("500");
  const [emailTo, setEmailTo] = useState("");

  const load = async () => {
    const [u, b, s] = await Promise.all([
      adminFetch("/api/admin/ai/usage?days=14&limit=200"),
      adminFetch("/api/admin/ai/budget"),
      adminFetch("/api/admin/metrics/cost-series?days=30"),
    ]);
    setUsage(u); setBudget(b); setSeries(s);
    if (b?.budget) {
      setMonthlyUsd(String(b.budget.monthly_usd ?? 500));
      setEmailTo(String(b.budget.email_to || ""));
    }
  };
  useEffect(() => { load(); }, []);

  const saveBudget = async () => {
    try {
      await adminFetch("/api/admin/ai/budget", {
        method: "PUT",
        body: JSON.stringify({ monthly_usd: parseFloat(monthlyUsd) || 0, email_to: emailTo, alert_pct: [50, 75, 90, 100] }),
      });
      await load();
      Alert.alert("Saved", "Budget updated");
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  if (!usage || !budget) return <Page title="AI Cost Center"><Spinner /></Page>;

  const provRows = Object.entries(usage.by_provider).map(([k, v]: any) => ({ key: k, provider: k, requests: v.requests, tokens: v.tokens, cost_usd: v.cost_usd }));
  const modelRows = Object.entries(usage.by_model).map(([k, v]: any) => ({ key: k, model: k, requests: v.requests, tokens: v.tokens, cost_usd: v.cost_usd }));
  const featRows = Object.entries(usage.by_feature).map(([k, v]: any) => ({ key: k, feature: k, requests: v.requests, tokens: v.tokens, cost_usd: v.cost_usd }));

  const pct = budget.spent_pct || 0;
  const tone: any = pct >= 100 ? "err" : pct >= 75 ? "warn" : "ok";

  return (
    <Page title="AI Cost Center" subtitle="Spend by provider, model, and feature — with real-time budget guardrails">
      <Section title="Budget & Spend">
        <Grid cols={4}>
          <Stat label="Monthly Budget" value={fmtMoney(budget.budget.monthly_usd)} />
          <Stat label="Spent This Month" value={fmtMoney(budget.spent_usd)} tone={tone} />
          <Stat label="Budget Used" value={`${pct}%`} tone={tone} hint={`${100 - Math.min(100, pct)}% remaining`} />
          <Stat label="Forecast Days" value={budget.spent_usd > 0 ? Math.round(budget.budget.monthly_usd / (budget.spent_usd / new Date().getDate())) : "∞"} hint="at current daily rate" />
        </Grid>
        <Card>
          <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 10 }}>30-DAY COST TREND</Text>
          <MiniBar values={(series?.series || []).map((d: any) => d.cost_usd)} />
        </Card>
        <View style={{ marginTop: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <TextInput value={monthlyUsd} onChangeText={setMonthlyUsd} keyboardType="numeric" placeholder="500" placeholderTextColor={COLORS.textFaint} style={inputStyle} data-testid="budget-monthly-input" />
          <TextInput value={emailTo} onChangeText={setEmailTo} placeholder="alert email (optional)" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { flex: 1 }]} data-testid="budget-email-input" />
          <Button label="Save Budget" onPress={saveBudget} testID="budget-save-btn" />
        </View>
      </Section>

      <Section title="By Provider">
        <Table columns={[
          { key: "provider", label: "Provider", render: (v) => <Badge label={v} kind="info" /> },
          { key: "requests", label: "Requests", width: 120 },
          { key: "tokens", label: "Tokens", width: 140 },
          { key: "cost_usd", label: "Cost", width: 120, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
        ]} rows={provRows} />
      </Section>

      <Section title="By Model">
        <Table columns={[
          { key: "model", label: "Model" },
          { key: "requests", label: "Requests", width: 120 },
          { key: "tokens", label: "Tokens", width: 140 },
          { key: "cost_usd", label: "Cost", width: 120, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
        ]} rows={modelRows} />
      </Section>

      <Section title="By Feature">
        <Table columns={[
          { key: "feature", label: "Feature", render: (v) => <Badge label={v} kind="warn" /> },
          { key: "requests", label: "Requests", width: 120 },
          { key: "tokens", label: "Tokens", width: 140 },
          { key: "cost_usd", label: "Cost", width: 120, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
        ]} rows={featRows} />
      </Section>
    </Page>
  );
}

const inputStyle: any = { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, minWidth: 160 };
