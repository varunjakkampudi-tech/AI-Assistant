import React from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

interface Item {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  route: string;
  testID: string;
}

const ITEMS: Item[] = [
  { icon: "sunny-outline", label: "Daily briefing", route: "/briefing", testID: "menu-briefing" },
  { icon: "chatbubbles-outline", label: "Conversations", route: "/history", testID: "menu-history" },
  { icon: "sparkles-outline", label: "Memories", route: "/memories", testID: "menu-memories" },
  { icon: "trophy-outline", label: "Goals", route: "/goals", testID: "menu-goals" },
  { icon: "alarm-outline", label: "Reminders", route: "/reminders", testID: "menu-reminders" },
  { icon: "analytics-outline", label: "Dashboard", route: "/dashboard", testID: "menu-dashboard" },
  { icon: "library-outline", label: "Knowledge Vault", route: "/knowledge", testID: "menu-knowledge" },
  { icon: "call-outline", label: "AI Calls", route: "/calls", testID: "menu-calls" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onNewChat?: () => void;
}

export default function MenuSheet({ visible, onClose, onNewChat }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const open = (route: string) => {
    onClose();
    setTimeout(() => router.push(route as any), 80);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="menu-backdrop">
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.xl }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Nova</Text>
          <ScrollView>
            {onNewChat && (
              <Pressable
                style={styles.row}
                onPress={() => {
                  onClose();
                  onNewChat();
                }}
                testID="menu-new-chat"
              >
                <View style={[styles.iconWrap, { backgroundColor: theme.color.brand }]}>
                  <Ionicons name="create" size={18} color={theme.color.onBrand} />
                </View>
                <Text style={[styles.rowLabel, { color: theme.color.brand }]}>New chat</Text>
              </Pressable>
            )}
            {ITEMS.map((it) => (
              <Pressable
                key={it.route}
                style={styles.row}
                onPress={() => open(it.route)}
                testID={it.testID}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={it.icon} size={18} color={theme.color.brand} />
                </View>
                <Text style={styles.rowLabel}>{it.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.color.surfaceSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    maxHeight: "75%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.color.borderStrong,
    marginBottom: theme.spacing.md,
  },
  title: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 22,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, color: theme.color.onSurface, fontSize: 15 },
});
