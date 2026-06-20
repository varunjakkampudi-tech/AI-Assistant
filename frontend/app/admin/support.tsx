import React, { useEffect, useState } from "react";
import { View, Text, Alert } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Spinner, Table, Badge, Button } from "@/src/admin/ui";

const STATUSES = ["open", "in_progress", "resolved", "closed"];

export default function SupportScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState("");

  const load = async () => {
    const d = await adminFetch(`/api/admin/support/tickets?status=${filter}`);
    setItems(d.items || []);
  };
  useEffect(() => { load(); }, [filter]);

  const set = async (id: string, status: string) => {
    try { await adminFetch(`/api/admin/support/tickets/${id}`, { method: "PUT", body: JSON.stringify({ status }) }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  return (
    <Page title="Support Center" subtitle="Tickets, bugs, feedback, feature requests"
      actions={
        <View style={{ flexDirection: "row", gap: 6 }}>
          {["", ...STATUSES].map(s => (
            <Button key={s || "all"} small label={s || "all"} kind={filter === s ? "primary" : "ghost"} onPress={() => setFilter(s)} testID={`support-filter-${s || "all"}`} />
          ))}
        </View>
      }>
      <Table
        columns={[
          { key: "kind", label: "Kind", width: 110, render: v => <Badge label={v || "general"} kind={v === "bug" ? "err" : v === "feature" ? "info" : "neutral"} /> },
          { key: "subject", label: "Subject" },
          { key: "email", label: "From", width: 200 },
          { key: "status", label: "Status", width: 130, render: (v, r) => (
            <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
              {STATUSES.map(s => (
                <Button key={s} small label={s} kind={(r.status || "open") === s ? "primary" : "ghost"} onPress={() => set(r.id, s)} testID={`support-set-${r.id}-${s}`} />
              ))}
            </View>
          ) },
          { key: "created_at", label: "When", width: 160, render: v => <Text style={{ color: COLORS.textDim, fontSize: 12 }}>{fmtDate(v)}</Text> },
        ]}
        rows={items.map((r, i) => ({ ...r, key: r.id || i }))}
        empty="No tickets."
      />
    </Page>
  );
}
