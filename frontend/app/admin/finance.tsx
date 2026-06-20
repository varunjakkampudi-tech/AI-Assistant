import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { adminFetch, COLORS, fmtMoney } from "@/src/admin/api";
import { Page, Card, Section, Stat, Grid, Spinner, MiniBar, Badge, Button } from "@/src/admin/ui";

const RANGES = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

export default function FinanceScreen() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any | null>(null);

  const load = async (d: number) => {
    setData(null);
    try { setData(await adminFetch(`/api/admin/finance/intelligence?days=${d}`)); } catch {}
  };
  useEffect(() => { load(days); }, [days]);

  if (!data) return <Page title="Finance Intelligence"><Spinner /></Page>;

  const margin = data.margin_pct as number;
  const profit = data.profit as number;

  return (
    <Page title="Finance Intelligence" subtitle="Revenue · Cost · Profit · Margin"
      actions={
        <View style={{ flexDirection: "row", gap: 6 }}>
          {RANGES.map(r => (
            <Button key={r.label} small label={r.label} kind={days === r.days ? "primary" : "ghost"} onPress={() => setDays(r.days)} testID={`finance-range-${r.label}`} />
          ))}
        </View>
      }>
      <Section title={`${data.window_days}-day Summary`}>
        <Grid cols={4}>
          <Stat label="Revenue" value={fmtMoney(data.revenue)} tone="ok" hint={`MRR ${fmtMoney(data.mrr)}`} />
          <Stat label="Total Cost" value={fmtMoney(data.total_cost)} tone="warn" hint={`AI ${fmtMoney(data.ai_cost)} · Voice ${fmtMoney(data.voice_cost)} · Storage ${fmtMoney(data.storage_cost)}`} />
          <Stat label="Profit" value={fmtMoney(profit)} tone={profit >= 0 ? "ok" : "err"} />
          <Stat label="Margin" value={`${margin}%`} tone={margin >= 50 ? "ok" : margin >= 20 ? "warn" : "err"} hint="profit / revenue" />
        </Grid>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
            <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", flex: 1 }}>REVENUE  ·  COST  ·  PROFIT  ·  LAST {data.window_days} DAYS</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Legend color={COLORS.brand} label="Revenue" />
              <Legend color={COLORS.warn} label="Cost" />
              <Legend color={COLORS.ok} label="Profit" />
            </View>
          </View>
          <View style={{ flexDirection: "column", gap: 6 }}>
            <Text style={lab}>Revenue</Text>
            <MiniBar values={(data.series || []).map((d: any) => d.revenue)} color={COLORS.brand} />
            <Text style={[lab, { marginTop: 10 }]}>Cost</Text>
            <MiniBar values={(data.series || []).map((d: any) => d.cost)} color={COLORS.warn} />
            <Text style={[lab, { marginTop: 10 }]}>Profit</Text>
            <MiniBar values={(data.series || []).map((d: any) => d.profit)} color={COLORS.ok} />
          </View>
        </Card>
      </Section>

      <Section title="Breakdown">
        <Grid cols={3}>
          <Stat label="AI Cost" value={fmtMoney(data.ai_cost)} hint={`${data.window_days}-day total`} />
          <Stat label="Voice Cost" value={fmtMoney(data.voice_cost)} hint={`${data.voice.calls} calls · ${data.voice.minutes} min`} />
          <Stat label="Storage Cost" value={fmtMoney(data.storage_cost)} hint="$0.10 / GB / mo est." />
        </Grid>
      </Section>

      <Section title="Plans">
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {Object.entries(data.plan_distribution || {}).map(([k, v]: any) => (
              <View key={k} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Badge label={k} kind={k === "enterprise" ? "ok" : k === "premium" ? "warn" : k === "pro" ? "info" : "neutral"} />
                <Text style={{ color: COLORS.text }}>{v} users · {fmtMoney(data.plan_prices[k])}/mo</Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>
    </Page>
  );
}

const Legend = ({ color, label }: { color: string; label: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
    <Text style={{ color: COLORS.textDim, fontSize: 11 }}>{label}</Text>
  </View>
);

const lab: any = { color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "600" };
