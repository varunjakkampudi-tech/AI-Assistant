import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Stat, Grid, Spinner, Table, Badge } from "@/src/admin/ui";

export default function SecurityScreen() {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    const load = async () => { try { setData(await adminFetch("/api/admin/security/overview")); } catch {} };
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, []);
  if (!data) return <Page title="Security Center"><Spinner /></Page>;

  return (
    <Page title="Security Center" subtitle="Failed logins, rate limits, new devices, blocked accounts">
      <Section title="Last 24 Hours">
        <Grid cols={4}>
          <Stat label="Failed Logins" value={data.failed_logins_24h} tone={data.failed_logins_24h > 20 ? "err" : data.failed_logins_24h > 5 ? "warn" : "ok"} />
          <Stat label="Rate Limit Hits" value={data.rate_limit_violations_24h} tone={data.rate_limit_violations_24h > 5 ? "warn" : "ok"} />
          <Stat label="New Device Logins (7d)" value={data.new_device_logins_7d} />
          <Stat label="Blocked Users" value={data.blocked_users} tone={data.blocked_users > 0 ? "warn" : "ok"} />
        </Grid>
      </Section>

      <Section title="Suspicious Events">
        <Table
          columns={[
            { key: "event", label: "Event", render: (v) => <Badge label={v} kind={v?.includes("rate_limited") ? "warn" : "err"} /> },
            { key: "ip", label: "IP", width: 160 },
            { key: "device_label", label: "Device", width: 140 },
            { key: "created_at", label: "When", width: 180, render: v => <Text style={{ color: COLORS.textDim, fontSize: 12 }}>{fmtDate(v)}</Text> },
          ]}
          rows={(data.suspicious_recent || []).slice(0, 50).map((r: any, i: number) => ({ ...r, key: r.id || i }))}
          empty="No suspicious activity in the last 7 days."
        />
      </Section>
    </Page>
  );
}
