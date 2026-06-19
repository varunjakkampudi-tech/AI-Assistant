import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useAuth, authedFetch } from "@/src/auth";
import ScreenHeader from "@/src/components/ScreenHeader";

interface FAQ { q: string; a: string; }

export default function HelpScreen() {
  const { accessToken } = useAuth();
  const [faq, setFaq] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"general" | "bug" | "feature">("general");
  const [sending, setSending] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/support/faq`);
        if (r.ok) setFaq((await r.json()).faq || []);
      } finally { setLoading(false); }
    })();
  }, []);

  const submit = async () => {
    if (!subject.trim() || !message.trim()) {
      Alert.alert("Subject and message are required");
      return;
    }
    setSending(true);
    try {
      const r = await authedFetch("/api/support/contact", accessToken, {
        method: "POST",
        body: JSON.stringify({ subject, message, kind }),
      });
      if (!r.ok) throw new Error(await r.text());
      Alert.alert("Thanks!", "Your message has been received. We'll get back to you soon.");
      setSubject(""); setMessage("");
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message || "");
    } finally { setSending(false); }
  };

  return (
    <View style={styles.root} testID="help-screen">
      <ScreenHeader title="Help & Support" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.contactRow}>
          <Pressable
            style={styles.contactCard}
            onPress={() => Linking.openURL("mailto:support@oraos.app")}
            testID="contact-email"
          >
            <Ionicons name="mail" size={22} color={theme.color.brand} />
            <Text style={styles.contactLabel}>Email</Text>
            <Text style={styles.contactSub}>support@oraos.app</Text>
          </Pressable>
          <Pressable
            style={styles.contactCard}
            onPress={() => Linking.openURL("tel:+1-555-OOO-OS00")}
            testID="contact-phone"
          >
            <Ionicons name="call" size={22} color={theme.color.brand} />
            <Text style={styles.contactLabel}>Phone</Text>
            <Text style={styles.contactSub}>Mon–Fri 9–18</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>FREQUENTLY ASKED</Text>
        {loading ? <ActivityIndicator color={theme.color.brand} /> : faq.map((f, i) => (
          <Pressable
            key={i}
            style={styles.faqCard}
            onPress={() => setOpenIdx(openIdx === i ? null : i)}
            testID={`faq-${i}`}
          >
            <View style={styles.faqHead}>
              <Text style={styles.faqQ}>{f.q}</Text>
              <Ionicons
                name={openIdx === i ? "chevron-up" : "chevron-down"}
                size={16}
                color={theme.color.onSurfaceSecondary}
              />
            </View>
            {openIdx === i && <Text style={styles.faqA}>{f.a}</Text>}
          </Pressable>
        ))}

        <Text style={styles.section}>CONTACT US</Text>
        <View style={styles.kindRow}>
          {(["general", "bug", "feature"] as const).map((k) => (
            <Pressable
              key={k}
              style={[styles.kindPill, kind === k && styles.kindPillActive]}
              onPress={() => setKind(k)}
              testID={`kind-${k}`}
            >
              <Text style={[styles.kindText, kind === k && { color: theme.color.onBrand, fontWeight: "700" }]}>
                {k === "general" ? "General" : k === "bug" ? "Report bug" : "Request feature"}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="Subject"
          placeholderTextColor={theme.color.onSurfaceSecondary}
          testID="help-subject"
        />
        <TextInput
          style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]}
          value={message}
          onChangeText={setMessage}
          placeholder="Tell us what's on your mind…"
          placeholderTextColor={theme.color.onSurfaceSecondary}
          multiline
          testID="help-message"
        />
        <Pressable
          style={[styles.sendBtn, sending && { opacity: 0.5 }]}
          onPress={submit}
          disabled={sending}
          testID="help-send"
        >
          {sending ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.sendText}>Send message</Text>}
        </Pressable>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 60 },
  contactRow: { flexDirection: "row", gap: theme.spacing.md },
  contactCard: {
    flex: 1, alignItems: "center", gap: 4,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg, padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  contactLabel: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600", marginTop: 4 },
  contactSub: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  section: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "600", letterSpacing: 1.8, marginTop: theme.spacing.lg },
  faqCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  faqHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  faqQ: { flex: 1, color: theme.color.onSurface, fontSize: 14, fontWeight: "500", paddingRight: 8 },
  faqA: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginTop: theme.spacing.sm, lineHeight: 20 },
  kindRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  kindPill: {
    paddingHorizontal: theme.spacing.md, paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  kindPillActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  kindText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "500" },
  input: {
    backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 14,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.borderStrong,
  },
  sendBtn: { backgroundColor: theme.color.brand, paddingVertical: 14, borderRadius: theme.radius.pill, alignItems: "center" },
  sendText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 14 },
});
