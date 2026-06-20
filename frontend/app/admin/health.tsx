import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Spinner, Stat, Grid, Badge, Button } from "@/src/admin/ui";

export default function HealthScreen() {
  const [data, setData] = useState<any | null>(null);

  const load = async () => { try { setData(await adminFetch("/api/admin/health/snapshot")); } catch {} };
  useEffect(() => {
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, []);
  if (!data) return <Page title="System Health"><Spinner /></Page>;

  const statusBadge = (s: string) => {
    const k: any = s === "healthy" ? "ok" : s === "warning" ? "warn" : s === "critical" ? "err" : "neutral";
    return <Badge label={s} kind={k} />;
  };

  return (
    <Page title="System Health" subtitle={`Last checked ${fmtDate(data.checked_at)}`}
      actions={<Button label="Refresh" kind="ghost" onPress={load} testID="health-refresh-btn" />}>
      <Section title="Core Services">
        <Grid cols={4}>
          <View><Card><Text style={lab}>Frontend</Text>{statusBadge(data.frontend.status)}<Text style={hint}>{data.frontend.detail}</Text></Card></View>
          <View><Card><Text style={lab}>Backend API</Text>{statusBadge(data.backend.status)}<Text style={hint}>{data.backend.detail}</Text></Card></View>
          <View><Card><Text style={lab}>Database</Text>{statusBadge(data.database.status)}<Text style={hint}>{data.database.detail}</Text></Card></View>
          <View><Card>
            <Text style={lab}>Storage</Text>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "600" }}>{data.storage.data_size_mb} MB</Text>
            <Text style={hint}>{data.storage.objects} objects</Text>
          </Card></View>
        </Grid>
      </Section>

      <Section title="AI Providers">
        <View style={{ gap: 10 }}>
          {(data.providers || []).map((p: any) => (
            <Card key={p.name}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontWeight: "600" }}>{p.label}</Text>
                  <Text style={{ color: COLORS.textFaint, fontSize: 11 }}>{p.name}</Text>
                </View>
                {statusBadge(p.status)}
              </View>
            </Card>
          ))}
        </View>
      </Section>
    </Page>
  );
}

const lab: any = { color: COLORS.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, fontWeight: "600" };
const hint: any = { color: COLORS.textFaint, fontSize: 11, marginTop: 8 };
