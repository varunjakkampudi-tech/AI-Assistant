import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { COLORS, adminLogin } from "@/src/admin/api";

export default function AdminSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@oraos.app");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      await adminLogin(email.trim(), password);
      router.replace("/admin" as any);
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally { setBusy(false); }
  };

  return (
    <View style={s.wrap}>
      <View style={s.card}>
        <View style={s.brandRow}>
          <View style={s.brandDot} />
          <View>
            <Text style={s.title}>ORA · Super Admin</Text>
            <Text style={s.sub}>Restricted access</Text>
          </View>
        </View>
        <Text style={s.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="admin@oraos.app"
          placeholderTextColor={COLORS.textFaint}
          style={s.input}
          data-testid="admin-email-input"
        />
        <Text style={s.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={COLORS.textFaint}
          style={s.input}
          data-testid="admin-password-input"
          onSubmitEditing={submit}
        />
        {err ? <Text style={s.err}>{err}</Text> : null}
        <Pressable onPress={submit} disabled={busy} style={[s.button, busy && { opacity: 0.6 }]} data-testid="admin-signin-button">
          {busy ? <ActivityIndicator color={COLORS.bg} /> : <Text style={s.buttonText}>Sign in</Text>}
        </Pressable>
        <Text style={s.foot}>Authorized personnel only. All actions are audit-logged.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg, padding: 24 },
  card: { width: 420, maxWidth: "100%", backgroundColor: COLORS.panel, borderRadius: 16, padding: 32, borderWidth: 1, borderColor: COLORS.border },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 28 },
  brandDot: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand },
  title: { color: COLORS.text, fontSize: 22, fontWeight: "600" },
  sub: { color: COLORS.brand, fontSize: 10, letterSpacing: 3, marginTop: 4 },
  label: { color: COLORS.textDim, fontSize: 11, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" },
  input: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, color: COLORS.text, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16, fontSize: 15 },
  err: { color: COLORS.err, marginBottom: 12, fontSize: 13 },
  button: { backgroundColor: COLORS.brand, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: COLORS.bg, fontWeight: "700", fontSize: 14, letterSpacing: 1 },
  foot: { color: COLORS.textFaint, fontSize: 11, marginTop: 24, textAlign: "center" },
});
