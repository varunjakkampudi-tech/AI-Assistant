import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";

import { theme } from "@/src/theme";

interface Props {
  active: boolean;
  size?: number;
}

// Animated glowing orb / waveform substitute used while the user is recording or
// the assistant is thinking. Pure-RN, no extra deps. 60fps via native driver.
export default function VoiceOrb({ active, size = 220 }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      rotate.stopAnimation();
      pulse.setValue(0);
      return;
    }
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ).start();
    Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [active, pulse, rotate]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.05] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none" testID="voice-orb">
      <Animated.View
        style={[
          styles.ring,
          { width: size, height: size, borderRadius: size / 2, transform: [{ scale: ringScale }], opacity: ringOpacity },
        ]}
      />
      <Animated.View
        style={[
          styles.glow,
          { width: size * 0.78, height: size * 0.78, borderRadius: (size * 0.78) / 2, transform: [{ scale }], opacity },
        ]}
      />
      <Animated.View
        style={[
          styles.core,
          {
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: (size * 0.42) / 2,
            transform: [{ rotate: spin }],
          },
        ]}
      />
      <View
        style={[
          styles.center,
          { width: size * 0.22, height: size * 0.22, borderRadius: (size * 0.22) / 2 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    borderWidth: 1,
    borderColor: theme.color.brand,
  },
  glow: {
    position: "absolute",
    backgroundColor: theme.color.brand,
    shadowColor: theme.color.brand,
    shadowOpacity: 0.9,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  core: {
    position: "absolute",
    backgroundColor: theme.color.brandSecondary,
    opacity: 0.85,
  },
  center: {
    position: "absolute",
    backgroundColor: "#FFE3B5",
    shadowColor: "#FFE3B5",
    shadowOpacity: 1,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
});
