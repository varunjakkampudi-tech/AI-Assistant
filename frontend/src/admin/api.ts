/**
 * Admin API client — all admin endpoints in one place.
 * Token persisted in expo-secure-store (native) / localStorage (web).
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL!;
export const ACCESS_KEY = "ora_access_token";
export const REFRESH_KEY = "ora_refresh_token";

export const COLORS = {
  bg: "#0a0a0c",
  panel: "#121215",
  card: "#17171b",
  border: "#26262c",
  borderStrong: "#3a3a44",
  text: "#F2F2F4",
  textDim: "#9A9AA2",
  textFaint: "#65656B",
  brand: "#E1B168",
  brandSoft: "#291F11",
  ok: "#4A7A59",
  warn: "#C99645",
  err: "#B83A3A",
  beta: "#7d6cf2",
};

const isWeb = Platform.OS === "web";

async function setStored(key: string, val: string | null) {
  if (isWeb) {
    try {
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch {}
    return;
  }
  try {
    if (val === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, val);
  } catch {}
}

async function getStored(key: string): Promise<string | null> {
  if (isWeb) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

export async function adminFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getStored(ACCESS_KEY);
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep as text */ }
  if (!r.ok) throw new Error(json?.detail || text || `HTTP ${r.status}`);
  return json;
}

export async function adminLogin(email: string, password: string) {
  const r = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.detail || "Login failed");
  await setStored(ACCESS_KEY, j.access_token);
  await setStored(REFRESH_KEY, j.refresh_token);
  return j.user;
}

export async function adminLogout() {
  await setStored(ACCESS_KEY, null);
  await setStored(REFRESH_KEY, null);
}

export async function adminMe(): Promise<any | null> {
  try { return (await adminFetch("/api/admin/me")).user; } catch { return null; }
}

export function fmtMoney(n: number | undefined | null): string {
  const v = Number(n || 0);
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtNum(n: number | undefined | null): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${v}`;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
