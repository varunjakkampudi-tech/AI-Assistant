import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { adminFetch, fmtMoney, COLORS } from "@/src/admin/api";
import { Page, Card, Stat, Grid, Section, Spinner, MiniBar, Badge } from "@/src/admin/ui";

export default function ExecutiveDashboard() {
  const [data, setData] = useState<any | null>(null);
  const [series, setSeries] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [o, s] = await Promise.all([
          adminFetch("/api/admin/metrics/overview"),
          adminFetch("/api/admin/metrics/cost-series?days=14"),
        ]);
        if (alive) { setData(o); setSeries(s); }
      } catch (e) { /* swallow */ }
    };
    load();
    const i = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  if (!data) return <Page title="Executive Dashboard"><Spinner /></Page>;
  const u = data.users, ai = data.ai, fin = data.financial, plat = data.platform;
  return (
    <Page title="Executive Dashboard" subtitle="Real-time pulse of the ORA platform">
      <Section title="Users">
        <Grid cols={4}>
          <Stat label="Total Users" value={u.total} hint={`${u.new_today} new today`} />
          <Stat label="Active" value={u.active} tone="ok" hint={`${u.suspended + u.banned} blocked`} />
          <Stat label="DAU / WAU / MAU" value={`${u.dau} / ${u.wau} / ${u.mau}`} />
          <Stat label="Churn (suspended)" value={`${u.suspended + u.banned}`} tone={u.suspended + u.banned > 0 ? "warn" : "ok"} />
        </Grid>
        <Card>
          <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 10 }}>NEW USERS · LAST 7 DAYS</Text>
          <MiniBar values={(u.growth || []).map((g: any) => g.new_users)} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            {(u.growth || []).map((g: any) => (
              <Text key={g.date} style={{ color: COLORS.textFaint, fontSize: 10 }}>{g.date.slice(5)}</Text>
            ))}
          </View>
        </Card>
      </Section>

      <Section title="AI Engine">
        <Grid cols={4}>
          <Stat label="Requests Today" value={ai.requests_today} hint={`${ai.requests_total} lifetime`} />
          <Stat label="Success Rate" value={`${ai.success_rate}%`} tone={ai.success_rate >= 99 ? "ok" : ai.success_rate >= 95 ? "warn" : "err"} />
          <Stat label="Avg Latency" value={`${ai.month.avg_latency_ms || 0}ms`} hint="last 30d" />
          <Stat label="Tokens (30d)" value={(ai.month.input_tokens + ai.month.output_tokens).toLocaleString()} />
        </Grid>
        <Card>
          <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 10 }}>AI COST · LAST 14 DAYS · {fmtMoney(ai.month.cost_usd)} this month</Text>
          <MiniBar values={(series?.series || []).map((d: any) => d.cost_usd)} color={COLORS.brand} />
        </Card>
      </Section>

      <Section title="Financial">
        <Grid cols={4}>
          <Stat label="MRR" value={fmtMoney(fin.mrr)} tone="ok" />
          <Stat label="ARR" value={fmtMoney(fin.arr)} tone="ok" />
          <Stat label="AI Cost (30d)" value={fmtMoney(fin.ai_cost_month)} tone="warn" />
          <Stat label="Lifetime Cost" value={fmtMoney(fin.ai_cost_lifetime)} />
        </Grid>
        <Card>
          <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: 12 }}>PLAN DISTRIBUTION</Text>
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            {Object.entries(fin.plan_distribution || {}).map(([k, v]) => (
              <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Badge label={k} kind={k === "free" ? "neutral" : k === "pro" ? "info" : k === "premium" ? "warn" : "ok"} />
                <Text style={{ color: COLORS.text }}>{String(v)}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <Section title="Platform Activity">
        <Grid cols={4}>
          {Object.entries(plat).map(([k, v]) => (
            <Stat key={k} label={k.replace(/_/g, " ")} value={String(v)} />
          ))}
        </Grid>
      </Section>
    </Page>
  );
}
