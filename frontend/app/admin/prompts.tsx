import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ScrollView } from "react-native";
import { adminFetch, COLORS, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Button, Badge, Spinner } from "@/src/admin/ui";

const KEYS = ["chat", "journal", "career_copilot", "finance_brain", "digital_twin", "search", "memory", "daily_briefing"];

export default function PromptsScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [active, setActive] = useState<string>("chat");
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await adminFetch("/api/admin/prompts");
    setItems(data.items || []);
  };
  useEffect(() => { load(); }, []);

  const cur = items.find(x => x.key === active);
  const published = cur?.versions?.find((v: any) => v.mode === "published");
  const drafts = cur?.versions?.filter((v: any) => v.mode === "draft") || [];
  const archived = cur?.versions?.filter((v: any) => v.mode === "archived") || [];

  const save = async (mode: "draft" | "published") => {
    if (!draft.trim()) { Alert.alert("Empty", "Prompt body required"); return; }
    setBusy(true);
    try {
      await adminFetch("/api/admin/prompts", { method: "POST", body: JSON.stringify({ key: active, label: active, body: draft, mode }) });
      setDraft("");
      await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
    finally { setBusy(false); }
  };

  const publish = async (id: string) => {
    try { await adminFetch(`/api/admin/prompts/${id}/publish`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const rollback = async (id: string) => {
    if (!confirm("Restore this archived version as published?")) return;
    try { await adminFetch(`/api/admin/prompts/${id}/rollback`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this version permanently?")) return;
    try { await adminFetch(`/api/admin/prompts/${id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  return (
    <Page title="Prompt Management" subtitle="Version, draft, publish, rollback — no deploy required">
      <Section title="Prompts">
        <ScrollView horizontal style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {KEYS.map(k => (
              <Pressable
                key={k}
                onPress={() => setActive(k)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: active === k ? COLORS.brand : COLORS.border, backgroundColor: active === k ? COLORS.brandSoft : "transparent" }}
                data-testid={`prompt-tab-${k}`}
              >
                <Text style={{ color: active === k ? COLORS.brand : COLORS.textDim, fontSize: 12 }}>{k}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
            <Text style={{ color: COLORS.text, fontSize: 15, fontWeight: "600", flex: 1 }}>Published version</Text>
            {published ? <Badge label="LIVE" kind="ok" /> : <Badge label="none" kind="neutral" />}
          </View>
          {published ? (
            <View>
              <Text style={{ color: COLORS.textDim, fontSize: 12, marginBottom: 8 }}>v{published.version} · {fmtDate(published.created_at)} · by {published.created_by}</Text>
              <View style={{ backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.border }}>
                <Text style={{ color: COLORS.text, fontSize: 13, lineHeight: 20 }}>{published.body}</Text>
              </View>
            </View>
          ) : <Text style={{ color: COLORS.textFaint }}>No published version yet.</Text>}
        </Card>
      </Section>

      <Section title="New version">
        <Card>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Enter the system prompt for this feature…"
            placeholderTextColor={COLORS.textFaint}
            style={{ minHeight: 180, color: COLORS.text, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, textAlignVertical: "top" }}
            data-testid="prompt-draft-input"
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Button label="Save Draft" kind="ghost" onPress={() => save("draft")} disabled={busy} testID="prompt-save-draft" />
            <Button label="Publish" onPress={() => save("published")} disabled={busy} testID="prompt-publish" />
          </View>
        </Card>
      </Section>

      <Section title="Drafts">
        {drafts.length === 0 ? <Text style={{ color: COLORS.textFaint }}>No drafts.</Text> : drafts.map((v: any) => (
          <Card key={v.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontSize: 12 }}>v{v.version} · {fmtDate(v.created_at)}</Text>
                <Text style={{ color: COLORS.textDim, fontSize: 12 }} numberOfLines={2}>{v.body}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Button small label="Publish" onPress={() => publish(v.id)} testID={`prompt-publish-${v.id}`} />
                <Button small label="Delete" kind="danger" onPress={() => del(v.id)} testID={`prompt-delete-${v.id}`} />
              </View>
            </View>
          </Card>
        ))}
      </Section>

      <Section title="Archived history">
        {archived.length === 0 ? <Text style={{ color: COLORS.textFaint }}>No history.</Text> : archived.map((v: any) => (
          <Card key={v.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.textDim, fontSize: 12 }}>v{v.version} · {fmtDate(v.created_at)} · by {v.created_by}</Text>
                <Text style={{ color: COLORS.textFaint, fontSize: 12 }} numberOfLines={2}>{v.body}</Text>
              </View>
              <Button small label="Rollback" kind="warn" onPress={() => rollback(v.id)} testID={`prompt-rollback-${v.id}`} />
            </View>
          </Card>
        ))}
      </Section>
    </Page>
  );
}
