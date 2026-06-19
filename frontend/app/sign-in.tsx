import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import VoiceOrb from "@/src/components/VoiceOrb";

type Stage = "method" | "email" | "code";

export default function SignInScreen() {
  const auth = useAuth();
  const [stage, setStage] = useState<Stage>("method");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devHint, setDevHint] = useState<string | null>(null);

  const onGoogle = async () => {
    setBusy(true); setError(null);
    Haptics.selectionAsync().catch(() => {});
    const r = await auth.signInWithGoogleViaWebBrowser();
    setBusy(false);
    if (!r.ok && r.error) setError(r.error);
  };

  const onApple = () => {
    Alert.alert(
      "Coming soon",
      "Sign in with Apple is available in the iOS build. We'll enable it before App Store submission.",
    );
  };

  const onEmail = () => {
    setStage("email");
    setError(null);
  };

  const sendCode = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    setBusy(true); setError(null); setDevHint(null);
    Haptics.selectionAsync().catch(() => {});
    const r = await auth.requestOtp(email.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Failed to send code");
      return;
    }
    if (!r.delivered && r.dev_code) {
      setDevHint(`Dev code: ${r.dev_code}`);
    }
    setStage("code");
  };

  const verifyCode = async () => {
    if (!code.trim() || code.trim().length < 4) {
      setError("Enter the 6-digit code");
      return;
    }
    setBusy(true); setError(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const r = await auth.verifyOtp(email.trim(), code.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Invalid code");
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
      testID="sign-in-screen"
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.orbWrap}>
            <VoiceOrb active size={120} />
          </View>
          <Text style={styles.brand}>ORA</Text>
          <Text style={styles.tagline}>Your AI Operating System for Life</Text>
        </View>

        {stage === "method" && (
          <View style={styles.methodWrap}>
            <Text style={styles.welcome}>Welcome</Text>
            <Text style={styles.subWelcome}>Sign in to continue. Passwordless by design.</Text>

            <Pressable
              style={[styles.bigBtn, styles.googleBtn]}
              onPress={onGoogle}
              disabled={busy}
              testID="signin-google-btn"
            >
              {busy ? (
                <ActivityIndicator color="#1a1104" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={18} color="#1a1104" />
                  <Text style={styles.bigBtnText}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={[styles.bigBtn, styles.appleBtn]}
              onPress={onApple}
              testID="signin-apple-btn"
            >
              <Ionicons name="logo-apple" size={18} color="#F7F7F8" />
              <Text style={[styles.bigBtnText, { color: "#F7F7F8" }]}>Sign in with Apple</Text>
              <View style={styles.comingPill}>
                <Text style={styles.comingText}>SOON</Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.bigBtn, styles.emailBtn]}
              onPress={onEmail}
              testID="signin-email-btn"
            >
              <Ionicons name="mail" size={18} color={theme.color.brand} />
              <Text style={[styles.bigBtnText, { color: theme.color.brand }]}>Sign in with Email</Text>
            </Pressable>

            <Text style={styles.legalText}>
              By continuing, you agree to our{" "}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/legal/terms`)}
              >Terms</Text>{" "}and{" "}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/legal/privacy`)}
              >Privacy Policy</Text>.
            </Text>
          </View>
        )}

        {stage === "email" && (
          <View style={styles.methodWrap}>
            <Pressable onPress={() => setStage("method")} hitSlop={10} style={styles.backLink}>
              <Ionicons name="chevron-back" size={16} color={theme.color.onSurfaceSecondary} />
              <Text style={styles.backLinkText}>Back</Text>
            </Pressable>
            <Text style={styles.welcome}>Your email</Text>
            <Text style={styles.subWelcome}>We'll send you a 6-digit code.</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              testID="signin-email-input"
            />
            <Pressable
              style={[styles.primaryBtn, busy && { opacity: 0.5 }]}
              onPress={sendCode}
              disabled={busy}
              testID="signin-send-code-btn"
            >
              {busy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.primaryBtnText}>Send code</Text>}
            </Pressable>
          </View>
        )}

        {stage === "code" && (
          <View style={styles.methodWrap}>
            <Pressable onPress={() => setStage("email")} hitSlop={10} style={styles.backLink}>
              <Ionicons name="chevron-back" size={16} color={theme.color.onSurfaceSecondary} />
              <Text style={styles.backLinkText}>Change email</Text>
            </Pressable>
            <Text style={styles.welcome}>Enter code</Text>
            <Text style={styles.subWelcome}>Code sent to <Text style={{ color: theme.color.onSurface }}>{email}</Text></Text>
            {devHint && (
              <View style={styles.devHint}>
                <Ionicons name="construct-outline" size={14} color={theme.color.brand} />
                <Text style={styles.devHintText}>{devHint}</Text>
              </View>
            )}
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="------"
              placeholderTextColor="#444448"
              keyboardType="number-pad"
              autoFocus
              testID="signin-code-input"
            />
            <Pressable
              style={[styles.primaryBtn, busy && { opacity: 0.5 }]}
              onPress={verifyCode}
              disabled={busy}
              testID="signin-verify-btn"
            >
              {busy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.primaryBtnText}>Verify &amp; sign in</Text>}
            </Pressable>
            <Pressable onPress={sendCode} disabled={busy} testID="signin-resend-btn">
              <Text style={styles.linkBtn}>Resend code</Text>
            </Pressable>
          </View>
        )}

        {error && (
          <View style={styles.errorBox} testID="signin-error">
            <Ionicons name="alert-circle" size={16} color="#fff" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, paddingVertical: 48, gap: 32 },
  hero: { alignItems: "center", marginTop: 24 },
  orbWrap: { marginBottom: 12 },
  brand: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 44, letterSpacing: 6 },
  tagline: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginTop: 4, letterSpacing: 0.5 },
  methodWrap: { gap: theme.spacing.md },
  welcome: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 30, letterSpacing: -0.5, marginTop: 12 },
  subWelcome: { color: theme.color.onSurfaceSecondary, fontSize: 14, marginBottom: theme.spacing.md },
  bigBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingVertical: 16,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bigBtnText: { fontSize: 15, fontWeight: "600" },
  googleBtn: { backgroundColor: "#fff", borderColor: "#fff" },
  appleBtn: { backgroundColor: theme.color.surfaceSecondary, borderColor: theme.color.borderStrong },
  emailBtn: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandSecondary },
  comingPill: { backgroundColor: theme.color.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  comingText: { color: theme.color.onSurfaceSecondary, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  legalText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", marginTop: theme.spacing.md, lineHeight: 18 },
  legalLink: { color: theme.color.brand, textDecorationLine: "underline" },
  input: {
    backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface,
    fontSize: 16,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.borderStrong,
  },
  codeInput: { fontFamily: theme.font.display, fontSize: 30, letterSpacing: 16, textAlign: "center", paddingVertical: 18 },
  primaryBtn: {
    backgroundColor: theme.color.brand,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.color.onBrand, fontSize: 15, fontWeight: "700" },
  linkBtn: { color: theme.color.brand, textAlign: "center", marginTop: theme.spacing.md, fontSize: 13 },
  backLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  backLinkText: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  devHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: theme.color.brandTertiary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: theme.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.brandSecondary,
  },
  devHintText: { color: theme.color.brand, fontSize: 12, fontWeight: "600" },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(139,58,58,0.85)",
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: theme.radius.md,
  },
  errorText: { color: "#fff", fontSize: 13, flex: 1 },
});
