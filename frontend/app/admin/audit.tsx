import React, { useEffect, useState } from "react";
import { View, Text, TextInput } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Spinner, Table, Badge, Button } from "@/src/admin/ui";

export default function AuditScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");

  const load = async () => {
    const data = await adminFetch(`/api/admin/audit?limit=200&q=${encodeURIComponent(q)}`);
    setItems(data.items || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <Page title="Audit Log" subtitle="Immutable record of every admin action"
      actions={
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={load} placeholder="Search action / actor / target…" placeholderTextColor={COLORS.textFaint} style={inputStyle} data-testid="audit-search" />
          <Button label="Search" onPress={load} testID="audit-search-btn" />
        </View>
      }>
      <Table
        columns={[
          { key: "action", label: "Action", render: v => <Badge label={v} kind="info" /> },
          { key: "actor_email", label: "Actor", width: 220 },
          { key: "target", label: "Target", width: 200 },
          { key: "ip", label: "IP", width: 140 },
          { key: "created_at", label: "When", width: 180, render: v => <Text style={{ color: COLORS.textDim, fontSize: 12 }}>{fmtDate(v)}</Text> },
        ]}
        rows={items.map((r, i) => ({ ...r, key: r.id || i }))}
        empty="No audit events yet."
      />
    </Page>
  );
}

const inputStyle: any = { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text, width: 320 };
