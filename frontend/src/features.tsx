/**
 * Feature flag context — fetches /api/features/public on mount and on auth changes.
 * - `useFeature(key)` returns true/false.
 * - `<FeatureGate feature="career">{children}</FeatureGate>` renders a friendly
 *   "this feature is unavailable" screen if the admin disabled the feature.
 *
 * Refreshes every 60s so admin toggles propagate to end users quickly.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { authFetch } from "./auth";

type Features = Record<string, boolean>;

interface FeaturesValue {
  features: Features;
  loading: boolean;
  refresh: () => Promise<void>;
}

const FeaturesContext = createContext<FeaturesValue>({ features: {}, loading: true, refresh: async () => {} });

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<Features>({});
  const [loading, setLoading] = useState(true);
  const timer = useRef<any>(null);

  const refresh = useCallback(async () => {
    try {
      const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/features/public`;
      const r = await authFetch(url);
      const j = await r.json();
      setFeatures(j?.features || {});
    } catch {
      // keep last known map; don't block UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 60_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  return <FeaturesContext.Provider value={{ features, loading, refresh }}>{children}</FeaturesContext.Provider>;
}

export function useFeatures() {
  return useContext(FeaturesContext);
}

export function useFeature(key: string, fallback = true): boolean {
  const { features, loading } = useContext(FeaturesContext);
  if (loading && features[key] === undefined) return fallback;
  return features[key] !== false;
}

export function FeatureGate({ feature, children, fallbackLabel }: { feature: string; children: React.ReactNode; fallbackLabel?: string }) {
  const enabled = useFeature(feature);
  if (enabled) return <>{children}</>;
  return (
    <View style={s.gateRoot} data-testid={`feature-gate-${feature}`}>
      <View style={s.gateCard}>
        <Text style={s.gateIcon}>🔒</Text>
        <Text style={s.gateTitle}>This feature is currently unavailable</Text>
        <Text style={s.gateBody}>
          {fallbackLabel || `"${feature.replace(/_/g, " ")}" is paused by the administrator.`}
        </Text>
        <Text style={s.gateHint}>Please check back shortly — it can be re-enabled at any time.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  gateRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0a0a0c" },
  gateCard: { backgroundColor: "#17171b", borderColor: "#26262c", borderWidth: 1, borderRadius: 16, padding: 28, maxWidth: 440, alignItems: "center" },
  gateIcon: { fontSize: 36, marginBottom: 12 },
  gateTitle: { color: "#F2F2F4", fontSize: 18, fontWeight: "600", textAlign: "center", marginBottom: 10 },
  gateBody: { color: "#9A9AA2", fontSize: 14, textAlign: "center", lineHeight: 20 },
  gateHint: { color: "#65656B", fontSize: 12, textAlign: "center", marginTop: 14 },
});
