/**
 * Auth + theme state — single source of truth for the frontend.
 *
 * Tokens stored in expo-secure-store (Keychain / EncryptedSharedPrefs).
 * Theme persisted in AsyncStorage so it loads before secure store unlocks.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Appearance } from "react-native";
import * as SecureStore from "expo-secure-store";

import { storage } from "@/src/utils/storage";
import { palettes, ColorPalette } from "@/src/theme";

const ACCESS_KEY = "ora_access_token";
const REFRESH_KEY = "ora_refresh_token";
const THEME_KEY = "ora_theme_pref";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL!;

export type ThemeMode = "light" | "dark" | "system";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: string;
}

interface AuthCtx {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  // sign-in flows
  requestOtp: (email: string) => Promise<{ ok: boolean; dev_code?: string; delivered: boolean; error?: string }>;
  verifyOtp: (email: string, code: string) => Promise<{ ok: boolean; error?: string }>;
  startGoogle: () => Promise<{ url: string; nonce: string } | null>;
  pollGoogle: (nonce: string) => Promise<{ status: string }>;
  signInWithGoogleViaWebBrowser: () => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  signOutAll: () => Promise<void>;
  refresh: () => Promise<void>;
  // theme
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => Promise<void>;
  effectiveTheme: "light" | "dark";
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

async function setSecure(key: string, val: string | null) {
  if (val === null) {
    try { await SecureStore.deleteItemAsync(key); } catch { /* ignore */ }
  } else {
    try { await SecureStore.setItemAsync(key, val); } catch { /* ignore */ }
  }
}

async function getSecure(key: string): Promise<string | null> {
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [system, setSystem] = useState<"light" | "dark">(Appearance.getColorScheme() === "light" ? "light" : "dark");

  // Hydrate
  useEffect(() => {
    (async () => {
      const [a, r, themePref] = await Promise.all([
        getSecure(ACCESS_KEY),
        getSecure(REFRESH_KEY),
        storage.getItem<string>(THEME_KEY, "dark"),
      ]);
      if (themePref === "light" || themePref === "dark" || themePref === "system") {
        setThemeState(themePref);
      }
      if (a && r) {
        setAccessToken(a);
        setRefreshToken(r);
        // fetch profile
        try {
          const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${a}` } });
          if (me.ok) {
            const j = await me.json();
            setUser(j.user);
          } else if (me.status === 401) {
            // try refresh
            const rr = await fetch(`${BASE}/api/auth/refresh`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refresh_token: r }),
            });
            if (rr.ok) {
              const tj = await rr.json();
              setAccessToken(tj.access_token);
              await setSecure(ACCESS_KEY, tj.access_token);
              const me2 = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tj.access_token}` } });
              if (me2.ok) setUser((await me2.json()).user);
            } else {
              setUser(null);
              setAccessToken(null);
              setRefreshToken(null);
              await setSecure(ACCESS_KEY, null);
              await setSecure(REFRESH_KEY, null);
            }
          }
        } catch { /* offline; keep tokens */ }
      }
      setLoading(false);
    })();
    const sub = Appearance.addChangeListener((s) => setSystem(s.colorScheme === "light" ? "light" : "dark"));
    return () => sub.remove();
  }, []);

  const requestOtp = useCallback(async (email: string) => {
    try {
      const r = await fetch(`${BASE}/api/auth/otp/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (!r.ok) return { ok: false, delivered: false, error: j?.detail || "Failed to send code" };
      return { ok: true, dev_code: j.dev_code, delivered: !!j.delivered_via_email };
    } catch (e: any) {
      return { ok: false, delivered: false, error: String(e?.message || e) };
    }
  }, []);

  const finalizeTokens = async (access: string, refresh: string, u: AuthUser) => {
    setAccessToken(access);
    setRefreshToken(refresh);
    setUser(u);
    await setSecure(ACCESS_KEY, access);
    await setSecure(REFRESH_KEY, refresh);
  };

  const verifyOtp = useCallback(async (email: string, code: string) => {
    try {
      const r = await fetch(`${BASE}/api/auth/otp/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: j?.detail || "Invalid code" };
      await finalizeTokens(j.access_token, j.refresh_token, j.user);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, []);

  const startGoogle = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/auth/google/start`);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }, []);

  const pollGoogle = useCallback(async (nonce: string) => {
    try {
      const r = await fetch(`${BASE}/api/auth/google/poll/${nonce}`);
      const j = await r.json();
      if (j.status === "done") {
        await finalizeTokens(j.access_token, j.refresh_token, j.user);
      }
      return { status: j.status };
    } catch {
      return { status: "error" };
    }
  }, []);

  const signInWithGoogleViaWebBrowser = useCallback(async () => {
    try {
      const WebBrowser = await import("expo-web-browser");
      const started = await startGoogle();
      if (!started) return { ok: false, error: "Could not start Google sign-in" };
      const opened = await WebBrowser.openAuthSessionAsync(started.url, `${BASE}/api/google/callback`);
      // Poll up to ~12s
      for (let i = 0; i < 12; i++) {
        const p = await pollGoogle(started.nonce);
        if (p.status === "done") return { ok: true };
        await new Promise((r) => setTimeout(r, 1000));
      }
      return { ok: false, error: opened.type === "cancel" ? "Cancelled" : "Sign-in timed out" };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, [startGoogle, pollGoogle]);

  const signOut = useCallback(async () => {
    try {
      if (accessToken && refreshToken) {
        await fetch(`${BASE}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      }
    } catch { /* ignore */ }
    setUser(null); setAccessToken(null); setRefreshToken(null);
    await setSecure(ACCESS_KEY, null);
    await setSecure(REFRESH_KEY, null);
  }, [accessToken, refreshToken]);

  const signOutAll = useCallback(async () => {
    try {
      if (accessToken) {
        await fetch(`${BASE}/api/auth/logout-all`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      }
    } catch { /* ignore */ }
    await signOut();
  }, [accessToken, signOut]);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const r = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (r.ok) setUser((await r.json()).user);
    } catch { /* ignore */ }
  }, [accessToken]);

  const setTheme = useCallback(async (m: ThemeMode) => {
    setThemeState(m);
    await storage.setItem(THEME_KEY, m);
    if (accessToken) {
      try {
        await fetch(`${BASE}/api/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ theme: m }),
        });
      } catch { /* ignore */ }
    }
  }, [accessToken]);

  const effectiveTheme: "light" | "dark" = theme === "system" ? system : theme;

  const value: AuthCtx = useMemo(() => ({
    user, accessToken, loading,
    requestOtp, verifyOtp,
    startGoogle, pollGoogle, signInWithGoogleViaWebBrowser,
    signOut, signOutAll, refresh,
    theme, setTheme, effectiveTheme,
  }), [user, accessToken, loading, requestOtp, verifyOtp, startGoogle, pollGoogle, signInWithGoogleViaWebBrowser, signOut, signOutAll, refresh, theme, setTheme, effectiveTheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be inside AuthProvider");
  return v;
}

/**
 * Returns the active colour palette based on the user's theme preference.
 * Screens that need to be light/dark aware should compute their styles
 * inside the render function from this palette (e.g. inline styles or
 * `useMemo`-cached StyleSheet) instead of importing `theme.color.*` statically.
 */
export function useColors(): ColorPalette {
  const { effectiveTheme } = useAuth();
  return palettes[effectiveTheme];
}

// Helper for any API call that needs bearer auth
export async function authedFetch(path: string, accessToken: string | null, init?: RequestInit) {
  const headers: any = {
    "Content-Type": "application/json",
    ...(init?.headers || {}),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const r = await fetch(url, { ...init, headers });
  return r;
}
