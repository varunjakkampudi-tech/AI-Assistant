import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";

import { theme } from "@/src/theme";

// Three-dot typing indicator for "Nova is thinking..."
export default function TypingDots() {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    const anims = [loop(a, 0), loop(b, 150), loop(c, 300)];
    anims.forEach((x) => x.start());
    return () => anims.forEach((x) => x.stop());
  }, [a, b, c]);

  const dot = (v: Animated.Value) => ({
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
  });

  return (
    <View style={styles.row} testID="typing-indicator">
      <Animated.View style={[styles.dot, dot(a)]} />
      <Animated.View style={[styles.dot, dot(b)]} />
      <Animated.View style={[styles.dot, dot(c)]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color.brand },
});
