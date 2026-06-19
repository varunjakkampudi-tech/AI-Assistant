import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";
import { useColors } from "@/src/auth";

interface Props {
  title: string;
  rightSlot?: React.ReactNode;
  showBack?: boolean;
}

export default function ScreenHeader({ title, rightSlot, showBack = true }: Props) {
  const router = useRouter();
  const c = useColors();
  const styles = useMemo(() => StyleSheet.create({
    safe: { backgroundColor: c.surface },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    btn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceSecondary,
    },
    title: {
      flex: 1,
      textAlign: "center",
      color: c.onSurface,
      fontFamily: theme.font.display,
      fontSize: 20,
    },
    right: { alignItems: "flex-end" },
  }), [c]);
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <View style={styles.row}>
        {showBack ? (
          <Pressable
            style={styles.btn}
            onPress={() => router.back()}
            hitSlop={10}
            testID="back-button"
          >
            <Ionicons name="chevron-back" size={22} color={c.onSurface} />
          </Pressable>
        ) : (
          <View style={styles.btn} />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.right}>{rightSlot ?? <View style={styles.btn} />}</View>
      </View>
    </SafeAreaView>
  );
}
