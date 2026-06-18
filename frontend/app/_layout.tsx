import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0a0a0c" }, animation: "fade" }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
