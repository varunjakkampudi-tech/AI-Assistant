import React, { useMemo } from "react";
import { Tabs } from "expo-router";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { useAuth, useColors } from "@/src/auth";

type IconName = keyof typeof Ionicons.glyphMap;

interface TabConfig {
  name: string;
  label: string;
  icon: IconName;
  iconFocused: IconName;
  testID: string;
}

const TABS: TabConfig[] = [
  { name: "index", label: "Home", icon: "home-outline", iconFocused: "home", testID: "tab-home" },
  { name: "timeline", label: "Timeline", icon: "menu-outline", iconFocused: "menu", testID: "tab-timeline" },
  { name: "ask", label: "Ask", icon: "sparkles", iconFocused: "sparkles", testID: "tab-ask" },
  { name: "vault", label: "Vault", icon: "albums-outline", iconFocused: "albums", testID: "tab-vault" },
];

function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);
  const c = useColors();
  const { effectiveTheme } = useAuth();
  const styles = useMemo(() => makeStyles(c, effectiveTheme), [c, effectiveTheme]);

  return (
    <View style={[styles.bar, { paddingBottom: bottomPad }]} testID="bottom-tab-bar">
      <BlurView intensity={70} tint={effectiveTheme === "light" ? "light" : "dark"} style={StyleSheet.absoluteFill} />
      <View style={styles.barInner}>
        {state.routes.map((route: any, index: number) => {
          const config = TABS.find((t) => t.name === route.name);
          if (!config) return null;
          const isFocused = state.index === index;
          const isAsk = config.name === "ask";

          const onPress = () => {
            Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          if (isAsk) {
            return (
              <Pressable
                key={route.key}
                style={styles.askWrap}
                onPress={onPress}
                testID={config.testID}
                accessibilityRole="button"
              >
                <View style={styles.askGlowOuter} />
                <View style={styles.askGlowMid} />
                <View style={styles.askButton}>
                  <Ionicons name="sparkles" size={22} color={c.onBrand} />
                </View>
                <Text style={styles.askLabel}>{config.label}</Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={route.key}
              style={styles.tabItem}
              onPress={onPress}
              testID={config.testID}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              <Ionicons
                name={isFocused ? config.iconFocused : config.icon}
                size={22}
                color={isFocused ? c.brand : c.onSurfaceSecondary}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: isFocused ? c.brand : c.onSurfaceSecondary },
                ]}
              >
                {config.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.surface },
      }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="timeline" options={{ title: "Timeline" }} />
      <Tabs.Screen name="ask" options={{ title: "Ask" }} />
      <Tabs.Screen name="vault" options={{ title: "Vault" }} />
    </Tabs>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>, mode: "light" | "dark") => StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: mode === "light"
      ? (Platform.OS === "android" ? "rgba(250,248,244,0.94)" : "rgba(250,248,244,0.7)")
      : (Platform.OS === "android" ? "rgba(12,12,14,0.92)" : "rgba(12,12,14,0.55)"),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  barInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 8,
    minHeight: 60,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 3,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  askWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 4,
    position: "relative",
  },
  askGlowOuter: {
    position: "absolute",
    top: -8,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: c.brand,
    opacity: 0.16,
  },
  askGlowMid: {
    position: "absolute",
    top: -4,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.brand,
    opacity: 0.22,
  },
  askButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: c.brand,
    shadowOpacity: 0.7,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    borderWidth: 2,
    borderColor: "rgba(255, 220, 160, 0.4)",
  },
  askLabel: {
    color: c.brand,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
    letterSpacing: 0.3,
  },
});
