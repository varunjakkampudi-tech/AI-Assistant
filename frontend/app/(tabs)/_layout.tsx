import React from "react";
import { Tabs } from "expo-router";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { theme } from "@/src/theme";

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
  { name: "you", label: "You", icon: "person-outline", iconFocused: "person", testID: "tab-you" },
];

function CustomTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <View style={[styles.bar, { paddingBottom: bottomPad }]} testID="bottom-tab-bar">
      <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
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
                  <Ionicons name="sparkles" size={22} color={theme.color.onBrand} />
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
                color={isFocused ? theme.color.brand : theme.color.onSurfaceSecondary}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: isFocused ? theme.color.brand : theme.color.onSurfaceSecondary },
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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.color.surface },
      }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="timeline" options={{ title: "Timeline" }} />
      <Tabs.Screen name="ask" options={{ title: "Ask" }} />
      <Tabs.Screen name="vault" options={{ title: "Vault" }} />
      <Tabs.Screen name="you" options={{ title: "You" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Platform.OS === "android" ? "rgba(12,12,14,0.92)" : "rgba(12,12,14,0.55)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
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
    backgroundColor: theme.color.brand,
    opacity: 0.16,
  },
  askGlowMid: {
    position: "absolute",
    top: -4,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.color.brand,
    opacity: 0.22,
  },
  askButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.color.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.color.brand,
    shadowOpacity: 0.7,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    borderWidth: 2,
    borderColor: "rgba(255, 220, 160, 0.4)",
  },
  askLabel: {
    color: theme.color.brand,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
    letterSpacing: 0.3,
  },
});
