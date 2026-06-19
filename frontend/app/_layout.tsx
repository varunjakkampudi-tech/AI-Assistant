import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { setApiToken } from "@/src/api";
import { theme as baseTheme } from "@/src/theme";

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    setApiToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "sign-in" || segments[0] === "legal";
    if (!user && !inAuthGroup) {
      router.replace("/sign-in" as any);
    } else if (user && inAuthGroup) {
      router.replace("/" as any);
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={styles.boot}>
        <View style={styles.bootOrb} />
        <ActivityIndicator color={baseTheme.color.brand} />
        <Text style={styles.bootText}>ORA OS</Text>
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();

  const [fontsLoaded, fontsError] = useFonts({
    Fraunces:
      "https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.0.20/files/fraunces-latin-400-normal.woff2",
    "Fraunces-Medium":
      "https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.0.20/files/fraunces-latin-500-normal.woff2",
  });

  const fontsReady = fontsLoaded || !!fontsError;

  useEffect(() => {
    if ((iconsLoaded || iconsError) && fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [iconsLoaded, iconsError, fontsReady]);

  if ((!iconsLoaded && !iconsError) || !fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0a0a0c" }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "#0a0a0c" },
                animation: "fade",
              }}
            />
          </AuthGate>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: "#0a0a0c",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  bootOrb: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: baseTheme.color.brand,
    opacity: 0.5,
    shadowColor: baseTheme.color.brand,
    shadowOpacity: 0.9,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  bootText: {
    color: baseTheme.color.brand,
    fontFamily: baseTheme.font.display,
    fontSize: 24,
    letterSpacing: 4,
  },
});
