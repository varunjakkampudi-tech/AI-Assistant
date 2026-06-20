import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Spinner, Table, Badge, Button } from "@/src/admin/ui";

const CHANNELS = ["push", "email", "announcement", "maintenance"];
const AUDIENCES = ["all", "beta", "premium", "enterprise"];

export default function NotificationsScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [channel, setChannel] = useState("announcement");
  const [audience, setAudience] = useState("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await adminFetch("/api/admin/notifications");
    setItems(data.items || []);
  };
  useEffect(() => { load(); }, []);

  const send = async () => {
    if (!title.trim() || !body.trim()) { Alert.alert("Missing", "Title and body required"); return; }
    setBusy(true);
    try {
      await adminFetch("/api/admin/notifications", { method: "POST", body: JSON.stringify({ channel, audience, title, body, user_ids: [] }) });
      setTitle(""); setBody("");
      await load();
      Alert.alert("Queued", "Notification has been queued.");
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
    finally { setBusy(false); }
  };

  return (
    <Page title="Notification Center" subtitle="Push, email, announcements, maintenance alerts">
      <Section title="Compose">
        <Card>
          <Text style={lab}>Channel</Text>
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
            {CHANNELS.map(c => (
              <Button key={c} small label={c} kind={channel === c ? "primary" : "ghost"} onPress={() => setChannel(c)} testID={`notif-channel-${c}`} />
            ))}
          </View>
          <Text style={lab}>Audience</Text>
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
            {AUDIENCES.map(a => (
              <Button key={a} small label={a} kind={audience === a ? "primary" : "ghost"} onPress={() => setAudience(a)} testID={`notif-audience-${a}`} />
            ))}
          </View>
          <Text style={lab}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="What's the headline?" placeholderTextColor={COLORS.textFaint} style={inp} data-testid="notif-title" />
          <Text style={lab}>Body</Text>
          <TextInput value={body} onChangeText={setBody} placeholder="Message body…" placeholderTextColor={COLORS.textFaint} style={[inp, { minHeight: 100, textAlignVertical: "top" }]} multiline data-testid="notif-body" />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Button label="Send" onPress={send} disabled={busy} testID="notif-send-btn" />
          </View>
        </Card>
      </Section>

      <Section title="History">
        <Table
          columns={[
            { key: "channel", label: "Channel", width: 140, render: v => <Badge label={v} kind="info" /> },
            { key: "audience", label: "Audience", width: 110 },
            { key: "title", label: "Title" },
            { key: "recipients_estimated", label: "Recipients", width: 110 },
            { key: "status", label: "Status", width: 110, render: v => <Badge label={v || "queued"} kind={v === "delivered" ? "ok" : "warn"} /> },
            { key: "created_at", label: "When", width: 170, render: v => <Text style={{ color: COLORS.textDim, fontSize: 12 }}>{fmtDate(v)}</Text> },
          ]}
          rows={items.map((r, i) => ({ ...r, key: r.id || i }))}
          empty="No notifications yet."
        />
      </Section>
    </Page>
  );
}

const lab: any = { color: COLORS.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, fontWeight: "600" };
const inp: any = { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, marginBottom: 14 };
