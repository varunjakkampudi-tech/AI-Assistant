import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { adminFetch, COLORS } from "@/src/admin/api";
import { Page, Card, Section, Spinner, Button } from "@/src/admin/ui";

const FIELDS = [
  ["app_name", "App Name"],
  ["logo_url", "Logo URL"],
  ["primary_color", "Primary Color"],
  ["accent_color", "Accent Color"],
  ["theme", "Theme (dark / light)"],
  ["support_email", "Support Email"],
  ["support_phone", "Support Phone"],
  ["privacy_url", "Privacy Policy URL"],
  ["terms_url", "Terms of Service URL"],
  ["cookies_url", "Cookie Policy URL"],
] as const;

export default function ConfigScreen() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => { try { setCfg(await adminFetch("/api/admin/config")); } catch {} })();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const patch: any = {};
      FIELDS.forEach(([k]) => { if (cfg[k] !== undefined) patch[k] = cfg[k]; });
      const r = await adminFetch("/api/admin/config", { method: "PUT", body: JSON.stringify(patch) });
      setCfg(r.config);
      Alert.alert("Saved", "Configuration updated.");
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
    finally { setBusy(false); }
  };

  if (!cfg) return <Page title="Configuration"><Spinner /></Page>;

  return (
    <Page title="Configuration" subtitle="Branding, support, legal — change without a deploy">
      <Section title="Platform Settings">
        <Card>
          {FIELDS.map(([k, label]) => (
            <View key={k} style={{ marginBottom: 12 }}>
              <Text style={lab}>{label}</Text>
              <TextInput
                value={cfg[k] ?? ""}
                onChangeText={v => setCfg({ ...cfg, [k]: v })}
                placeholderTextColor={COLORS.textFaint}
                style={inp}
                data-testid={`config-${k}`}
              />
            </View>
          ))}
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Button label="Save" onPress={save} disabled={busy} testID="config-save-btn" />
          </View>
        </Card>
      </Section>

      <Section title="Live Preview">
        <Card>
          <View style={{ padding: 16, backgroundColor: cfg.primary_color || COLORS.bg, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border }}>
            <Text style={{ color: cfg.accent_color || COLORS.brand, fontSize: 20, fontWeight: "600" }}>{cfg.app_name || "ORA OS"}</Text>
            <Text style={{ color: "#fff", marginTop: 6, fontSize: 13 }}>Support: {cfg.support_email}</Text>
          </View>
        </Card>
      </Section>
    </Page>
  );
}

const lab: any = { color: COLORS.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, fontWeight: "600" };
const inp: any = { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text };
