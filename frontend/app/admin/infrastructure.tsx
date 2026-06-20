import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Stat, Grid, Spinner, Badge, Button } from "@/src/admin/ui";

export default function InfrastructureScreen() {
  const [data, setData] = useState<any | null>(null);

  const load = async () => { try { setData(await adminFetch("/api/admin/infrastructure")); } catch {} };
  useEffect(() => { load(); const i = setInterval(load, 10_000); return () => clearInterval(i); }, []);

  if (!data) return <Page title="Infrastructure"><Spinner /></Page>;

  const tonePct = (p: number) => p >= 90 ? "err" : p >= 70 ? "warn" : "ok";

  return (
    <Page title="Infrastructure" subtitle={`Real-time · refreshes every 10s · last ${fmtDate(data.checked_at)}`}
      actions={<Button label="Refresh" kind="ghost" onPress={load} testID="infra-refresh-btn" />}>
      <Section title="Compute">
        <Grid cols={4}>
          <Stat label="CPU" value={`${data.cpu?.percent ?? "—"}%`} tone={tonePct(data.cpu?.percent || 0)} hint={`${data.cpu?.count || 0} cores`} />
          <Stat label="Memory" value={`${data.memory?.percent ?? "—"}%`} tone={tonePct(data.memory?.percent || 0)} hint={`${data.memory?.used_mb || 0} / ${data.memory?.total_mb || 0} MB`} />
          <Stat label="Disk" value={`${data.disk?.percent ?? "—"}%`} tone={tonePct(data.disk?.percent || 0)} hint={`${data.disk?.used_gb || 0} / ${data.disk?.total_gb || 0} GB`} />
          <Stat label="Load Avg" value={(data.cpu?.load_avg || []).map((x: number) => x.toFixed(2)).join("  ·  ")} hint="1m · 5m · 15m" />
        </Grid>
      </Section>

      <Section title="Database">
        <Grid cols={4}>
          <View><Card>
            <Text style={lab}>Status</Text>
            <Badge label={data.database?.status || "?"} kind={data.database?.status === "healthy" ? "ok" : "err"} />
            <Text style={hint}>{data.database?.ping_ms != null ? `${data.database.ping_ms} ms ping` : (data.database?.error || "")}</Text>
          </Card></View>
          <Stat label="Objects" value={String(data.database?.objects || 0)} />
          <Stat label="Data Size" value={`${data.database?.data_size_mb || 0} MB`} />
          <Stat label="Storage Size" value={`${data.database?.storage_size_mb || 0} MB`} />
        </Grid>
      </Section>

      <Section title="API Latency">
        <Grid cols={4}>
          <Stat label="Samples" value={String(data.api_latency_ms?.samples ?? 0)} />
          <Stat label="P50" value={`${data.api_latency_ms?.p50 ?? "—"} ms`} tone="ok" />
          <Stat label="P95" value={`${data.api_latency_ms?.p95 ?? "—"} ms`} tone={(data.api_latency_ms?.p95 || 0) > 3000 ? "warn" : "ok"} />
          <Stat label="Max" value={`${data.api_latency_ms?.max ?? "—"} ms`} />
        </Grid>
      </Section>

      <Section title="Redis & Cache">
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Badge label={data.redis?.status || "n/a"} kind={data.redis?.configured ? "ok" : "neutral"} />
            <Text style={{ color: COLORS.textDim }}>{data.redis?.configured ? "REDIS_URL configured" : "Not configured — running in-memory only."}</Text>
          </View>
        </Card>
      </Section>
    </Page>
  );
}

const lab: any = { color: COLORS.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, fontWeight: "600" };
const hint: any = { color: COLORS.textFaint, fontSize: 11, marginTop: 8 };
