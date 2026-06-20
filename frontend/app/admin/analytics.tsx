import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { adminFetch, COLORS } from "@/src/admin/api";
import { Page, Card, Section, Stat, Grid, Spinner, MiniBar, Table } from "@/src/admin/ui";

export default function AnalyticsScreen() {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    (async () => { try { setData(await adminFetch("/api/admin/analytics/overview")); } catch {} })();
  }, []);
  if (!data) return <Page title="Analytics"><Spinner /></Page>;

  const featRows = (data.feature_usage_7d || []).slice(0, 20).map((r: any) => ({ key: r.event, event: r.event, count: r.count }));

  return (
    <Page title="Analytics" subtitle="Retention, sessions and feature usage">
      <Section title="Retention & Sessions">
        <Grid cols={4}>
          <Stat label="Return Rate" value={`${data.retention.return_rate_pct}%`} tone={data.retention.return_rate_pct >= 30 ? "ok" : data.retention.return_rate_pct >= 10 ? "warn" : "err"} />
          <Stat label="Repeat Users" value={data.retention.repeat_users} hint={`of ${data.retention.total_users}`} />
          <Stat label="Avg Session" value={`${data.session_duration.avg_minutes} min`} />
          <Stat label="Max Session" value={`${data.session_duration.max_minutes} min`} hint={`n=${data.session_duration.sample_size}`} />
        </Grid>
      </Section>

      <Section title="Top Activity (7 days)">
        <Card>
          <Text style={{ color: COLORS.textDim, fontSize: 11, letterSpacing: 1, marginBottom: 8, fontWeight: "700" }}>EVENT VOLUME</Text>
          <MiniBar values={featRows.slice(0, 14).map((r: any) => r.count)} height={80} />
        </Card>
      </Section>

      <Section title="Event Breakdown">
        <Table columns={[
          { key: "event", label: "Event" },
          { key: "count", label: "Count (7d)", width: 140 },
        ]} rows={featRows} />
      </Section>
    </Page>
  );
}
