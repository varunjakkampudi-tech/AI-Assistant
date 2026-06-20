import React, { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { adminFetch, fmtMoney, COLORS } from "@/src/admin/api";
import { Page, Card, Stat, Grid, Section, Spinner, MiniBar, Badge } from "@/src/admin/ui";

const ROWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ExecutiveDashboard() {
  const [data, setData] = useState<any | null>(null);
  const [series, setSeries] = useState<any | null>(null);
  const [fin, setFin] = useState<any | null>(null);
  const [growth, setGrowth] = useState<any | null>(null);
  const [heat, setHeat] = useState<any | null>(null);
  const [providers, setProviders] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [o, cs, f, g, h] = await Promise.all([
          adminFetch("/api/admin/metrics/overview"),
          adminFetch("/api/admin/metrics/cost-series?days=14"),
          adminFetch("/api/admin/finance/intelligence?days=30"),
          adminFetch("/api/admin/metrics/user-growth?days=14"),
          adminFetch("/api/admin/metrics/usage-heatmap?days=14"),
        ]);
        if (!alive) return;
        setData(o); setSeries(cs); setFin(f); setGrowth(g); setHeat(h);
      } catch {}
    };
    const loadProv = async () => { try { setProviders(await adminFetch("/api/admin/health/providers-live")); } catch {} };
    load(); loadProv();
    const i1 = setInterval(load, 30_000);
    const i2 = setInterval(loadProv, 60_000);
    return () => { alive = false; clearInterval(i1); clearInterval(i2); };
  }, []);

  if (!data) return <Page title="Executive Dashboard"><Spinner /></Page>;
  const u = data.users, ai = data.ai, finOv = data.financial, plat = data.platform;

  return (
    <Page title="Executive Dashboard" subtitle="Real-time pulse of the ORA platform">
      {/* TOP TILES */}
      <Grid cols={4}>
        <Stat label="MRR" value={finOv ? fmtMoney(finOv.mrr) : "—"} tone="ok" hint="active subscriptions" />
        <Stat label="Margin (30d)" value={fin ? `${fin.margin_pct}%` : "—"} tone={fin?.margin_pct >= 50 ? "ok" : "warn"} hint={fin ? `${fmtMoney(fin.profit)} profit` : ""} />
        <Stat label="Active Users" value={u.active} tone="ok" hint={`${u.dau} DAU · ${u.wau} WAU · ${u.mau} MAU`} />
        <Stat label="AI Success Rate" value={`${ai.success_rate}%`} tone={ai.success_rate >= 99 ? "ok" : ai.success_rate >= 95 ? "warn" : "err"} hint={`${ai.requests_today} requests today`} />
      </Grid>

      {/* REVENUE vs COST vs PROFIT */}
      {fin ? (
        <Section title="Revenue · Cost · Profit (30d)">
          <Card>
            <View style={{ flexDirection: "row", marginBottom: 10 }}>
              <Text style={legend(COLORS.brand)}>● Revenue</Text>
              <Text style={legend(COLORS.warn)}>● Cost</Text>
              <Text style={legend(COLORS.ok)}>● Profit</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ color: COLORS.textFaint, fontSize: 11 }}>{fin.window_days} days</Text>
            </View>
            <Text style={smallLab}>Revenue</Text>
            <MiniBar values={(fin.series || []).map((d: any) => d.revenue)} color={COLORS.brand} height={36} />
            <Text style={[smallLab, { marginTop: 8 }]}>Cost</Text>
            <MiniBar values={(fin.series || []).map((d: any) => d.cost)} color={COLORS.warn} height={36} />
            <Text style={[smallLab, { marginTop: 8 }]}>Profit</Text>
            <MiniBar values={(fin.series || []).map((d: any) => d.profit)} color={COLORS.ok} height={36} />
          </Card>
        </Section>
      ) : null}

      {/* USER GROWTH */}
      {growth ? (
        <Section title="User Growth (14d)">
          <Card>
            <View style={{ flexDirection: "row", marginBottom: 10 }}>
              <Text style={legend(COLORS.brand)}>● New</Text>
              <Text style={legend(COLORS.beta)}>● Active</Text>
              <Text style={legend(COLORS.err)}>● Churn</Text>
            </View>
            <Text style={smallLab}>New users</Text>
            <MiniBar values={(growth.series || []).map((d: any) => d.new_users)} color={COLORS.brand} height={36} />
            <Text style={[smallLab, { marginTop: 8 }]}>Active</Text>
            <MiniBar values={(growth.series || []).map((d: any) => d.active)} color={COLORS.beta} height={36} />
            <Text style={[smallLab, { marginTop: 8 }]}>Churn</Text>
            <MiniBar values={(growth.series || []).map((d: any) => d.churn)} color={COLORS.err} height={36} />
          </Card>
        </Section>
      ) : null}

      {/* AI USAGE HEATMAP */}
      {heat ? (
        <Section title="AI Usage Heatmap (hour × day-of-week)">
          <Card>
            <ScrollView horizontal style={{ marginTop: 6 }}>
              <View>
                <View style={{ flexDirection: "row", marginLeft: 30 }}>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <Text key={h} style={{ color: COLORS.textFaint, fontSize: 9, width: 18, textAlign: "center" }}>{h}</Text>
                  ))}
                </View>
                {ROWS.map((label, r) => (
                  <View key={label} style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                    <Text style={{ color: COLORS.textDim, fontSize: 10, width: 30 }}>{label}</Text>
                    {heat.grid[r].map((v: number, h: number) => {
                      const max = Math.max(1, ...heat.grid.flat());
                      const intensity = Math.min(1, v / max);
                      const bg = intensity === 0
                        ? "#181820"
                        : `rgba(225, 177, 104, ${0.15 + 0.85 * intensity})`;
                      return <View key={h} style={{ width: 16, height: 16, marginRight: 2, marginBottom: 2, backgroundColor: bg, borderRadius: 2 }} />;
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text style={{ color: COLORS.textFaint, fontSize: 11, marginTop: 10 }}>Darker = more AI requests in that hour bucket over the last 14 days.</Text>
          </Card>
        </Section>
      ) : null}

      {/* PROVIDER HEALTH WIDGET */}
      {providers ? (
        <Section title="Provider Health (live)">
          <Card>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {providers.providers.map((p: any) => (
                <View key={p.name} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.status === "healthy" ? COLORS.ok : p.status === "critical" ? COLORS.err : p.status === "warning" ? COLORS.warn : COLORS.textFaint }} />
                  <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: "600" }}>{p.label || p.name}</Text>
                  <Text style={{ color: COLORS.textFaint, fontSize: 10 }}>{p.latency_ms != null ? `${p.latency_ms}ms` : p.status}</Text>
                </View>
              ))}
            </View>
            <Text style={{ color: COLORS.textFaint, fontSize: 11, marginTop: 12 }}>Refreshed every 60s · last {new Date(providers.checked_at).toLocaleTimeString()}</Text>
          </Card>
        </Section>
      ) : null}

      {/* AI COST 14d */}
      <Section title="AI Engine">
        <Grid cols={4}>
          <Stat label="Requests Today" value={ai.requests_today} hint={`${ai.requests_total} lifetime`} />
          <Stat label="Avg Latency" value={`${ai.month.avg_latency_ms || 0}ms`} hint="last 30d" />
          <Stat label="Tokens (30d)" value={(ai.month.input_tokens + ai.month.output_tokens).toLocaleString()} />
          <Stat label="AI Cost (30d)" value={fmtMoney(ai.month.cost_usd)} tone="warn" />
        </Grid>
        <Card>
          <Text style={smallLab}>AI cost · last 14 days · {fmtMoney(ai.month.cost_usd)} this month</Text>
          <MiniBar values={(series?.series || []).map((d: any) => d.cost_usd)} color={COLORS.brand} height={50} />
        </Card>
      </Section>

      {/* PLAN DISTRIBUTION */}
      <Section title="Plan Distribution">
        <Card>
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            {Object.entries(finOv.plan_distribution || {}).map(([k, v]: any) => (
              <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Badge label={k} kind={k === "enterprise" ? "ok" : k === "premium" ? "warn" : k === "pro" ? "info" : "neutral"} />
                <Text style={{ color: COLORS.text }}>{String(v)}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>

      {/* PLATFORM ACTIVITY */}
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

const legend = (c: string) => ({ color: c, fontSize: 11, marginRight: 14, fontWeight: "600" } as any);
const smallLab: any = { color: COLORS.textDim, fontSize: 10, letterSpacing: 1, marginBottom: 4, fontWeight: "600" };
