/**
 * Feature flag context + A/B experiment hook.
 *
 * - `useFeature(key)` returns true/false.
 * - `<FeatureGate feature="career">{children}</FeatureGate>` renders a friendly
 *   "this feature is unavailable" screen if the admin disabled the feature.
 *   The screen shows the admin-broadcast `paused_reason` when present.
 *
 * - `useExperiment("checkout_flow")` returns
 *      { variant: "A" | "B" | null, config: {...}, logEvent(name, value?) }
 *   Sticky per user. Calls /api/experiments/assign once per experiment+session.
 *
 * Refreshes every 20s and on app foreground so admin toggles propagate quickly.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, AppState } from "react-native";
import { authFetch } from "./auth";

type Features = Record<string, boolean>;
type Reasons = Record<string, string>;

interface FeaturesValue {
  features: Features;
  reasons: Reasons;
  loading: boolean;
  refresh: () => Promise<void>;
}

const FeaturesContext = createContext<FeaturesValue>({ features: {}, reasons: {}, loading: true, refresh: async () => {} });

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<Features>({});
  const [reasons, setReasons] = useState<Reasons>({});
  const [loading, setLoading] = useState(true);
  const timer = useRef<any>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await authFetch(`${BASE}/api/features/public`);
      const j = await r.json();
      setFeatures(j?.features || {});
      setReasons(j?.reasons || {});
    } catch {
      // keep last known map; don't block UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 20_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      if (timer.current) clearInterval(timer.current);
      sub.remove();
    };
  }, [refresh]);

  return <FeaturesContext.Provider value={{ features, reasons, loading, refresh }}>{children}</FeaturesContext.Provider>;
}

export function useFeatures() {
  return useContext(FeaturesContext);
}

export function useFeature(key: string, fallback = true): boolean {
  const { features, loading } = useContext(FeaturesContext);
  if (loading && features[key] === undefined) return fallback;
  return features[key] !== false;
}

export function useFeatureReason(key: string): string | null {
  const { reasons } = useContext(FeaturesContext);
  return reasons[key] || null;
}

export function FeatureGate({ feature, children, fallbackLabel }: { feature: string; children: React.ReactNode; fallbackLabel?: string }) {
  const enabled = useFeature(feature);
  const reason = useFeatureReason(feature);
  if (enabled) return <>{children}</>;
  const message = reason || fallbackLabel || `"${feature.replace(/_/g, " ")}" is paused by the administrator.`;
  return (
    <View style={s.gateRoot} data-testid={`feature-gate-${feature}`}>
      <View style={s.gateCard}>
        <Text style={s.gateIcon}>🔒</Text>
        <Text style={s.gateTitle}>This feature is currently unavailable</Text>
        <Text style={s.gateBody}>{message}</Text>
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

// =====================================================================
// A/B experiments
// =====================================================================
interface ExperimentState {
  variant: string | null;
  config: Record<string, any>;
  logEvent: (event?: string, value?: number, metadata?: Record<string, any>) => Promise<void>;
}

export function useExperiment(key: string): ExperimentState {
  const [variant, setVariant] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await authFetch(`${BASE}/api/experiments/assign?key=${encodeURIComponent(key)}`);
        const j = await r.json();
        if (!alive) return;
        setVariant(j?.variant ?? null);
        setConfig(j?.config || {});
      } catch {
        if (alive) { setVariant(null); setConfig({}); }
      }
    })();
    return () => { alive = false; };
  }, [key]);

  const logEvent = useCallback(async (event = "conversion", value = 0, metadata: Record<string, any> = {}) => {
    try {
      await authFetch(`${BASE}/api/experiments/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, event, value, metadata }),
      });
    } catch {
      // best-effort; don't surface to UI
    }
  }, [key]);

  return { variant, config, logEvent };
}
