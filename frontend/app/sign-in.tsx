import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import VoiceOrb from "@/src/components/VoiceOrb";

export default function SignInScreen() {
  const { signInWithGoogle, refresh, loading } = useAuth();
  const [busy, setBusy] = React.useState(false);

  const onSignIn = async () => {
    try {
      setBusy(true);
      await signInWithGoogle();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="sign-in-screen">
      <Image
        source={{
          uri: "https://images.pexels.com/photos/2387818/pexels-photo-2387818.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(10,10,12,0.92)", "rgba(10,10,12,0.97)", "#0a0a0c"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.center}>
        <VoiceOrb active size={140} />
        <Text style={styles.title}>Welcome to ORA</Text>
        <Text style={styles.sub}>Sign in with Google to unlock your assistant with personal memory, calendar, and inbox awareness.</Text>

        <Pressable
          style={[styles.btn, busy && { opacity: 0.5 }]}
          onPress={onSignIn}
          disabled={busy || loading}
          testID="sign-in-google-button"
        >
          {busy ? (
            <ActivityIndicator color={theme.color.onBrand} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={theme.color.onBrand} />
              <Text style={styles.btnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={styles.secondary}
          onPress={refresh}
          testID="sign-in-recheck-button"
        >
          <Text style={styles.secondaryText}>I&apos;ve completed sign-in — refresh</Text>
        </Pressable>

        <Text style={styles.fineprint}>
          ORA uses your Google sign-in for identity and (with your consent) to read upcoming Calendar events and recent Gmail. Tokens never leave the server.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl, gap: theme.spacing.lg },
  title: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 36,
    marginTop: theme.spacing.lg,
  },
  sub: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.xxl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    minHeight: 48,
    shadowColor: theme.color.brand,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  btnText: { color: theme.color.onBrand, fontWeight: "600", fontSize: 15 },
  secondary: { paddingVertical: 8 },
  secondaryText: { color: theme.color.onSurfaceSecondary, fontSize: 13, textDecorationLine: "underline" },
  fineprint: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    textAlign: "center",
    marginTop: theme.spacing.lg,
    maxWidth: 320,
    lineHeight: 16,
  },
});
