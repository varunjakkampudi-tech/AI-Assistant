import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import * as WebBrowser from "expo-web-browser";
import { Platform, Linking } from "react-native";

import { api } from "@/src/api";

interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
}

interface Ctx {
  user: GoogleUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
}

const AuthContext = createContext<Ctx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signInWithGoogle = useCallback(async () => {
    const { url } = await api.googleAuthUrl();
    const base = process.env.EXPO_PUBLIC_BACKEND_URL!;
    if (Platform.OS === "web") {
      Linking.openURL(url);
    } else {
      await WebBrowser.openAuthSessionAsync(url, `${base}/api/google/callback`);
    }
    // give backend a moment to persist tokens, then re-check
    setTimeout(() => refresh(), 1000);
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signInWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
