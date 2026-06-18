// Shared client + types for Nova backend.
export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  session_id: string;
  role: Role;
  content: string;
  image_b64?: string | null;
  emotion?: string | null;
  whatsapp_link?: string | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export type MemoryCategory =
  | "person"
  | "project"
  | "goal"
  | "skill"
  | "meeting"
  | "date"
  | "preference"
  | "other";

export interface Memory {
  id: string;
  category: MemoryCategory;
  subject: string;
  content: string;
  importance: number;
  source_session_id?: string | null;
  created_at: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  target: string;
  progress: number;
  status: "active" | "paused" | "completed";
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  text: string;
  condition: string;
  status: "pending" | "done" | "dismissed";
  created_at: string;
  updated_at: string;
}

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // Sessions
  createSession: (title?: string) =>
    jfetch<ChatSession>("/sessions", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  listSessions: (search?: string) =>
    jfetch<ChatSession[]>(`/sessions${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  getMessages: (id: string) => jfetch<ChatMessage[]>(`/sessions/${id}/messages`),
  deleteSession: (id: string) =>
    jfetch<{ ok: boolean }>(`/sessions/${id}`, { method: "DELETE" }),
  togglePin: (id: string) => jfetch<ChatSession>(`/sessions/${id}/pin`, { method: "POST" }),

  // Chat
  chat: (
    session_id: string,
    message: string,
    image_b64?: string | null,
    image_mime?: string | null,
  ) =>
    jfetch<{
      session_id: string;
      user_message: ChatMessage;
      assistant_message: ChatMessage;
    }>("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id, message, image_b64, image_mime }),
    }),

  // Transcribe
  transcribe: async (uri: string): Promise<string> => {
    const form = new FormData();
    // @ts-ignore RN FormData accepts this shape
    form.append("file", { uri, name: "audio.m4a", type: "audio/m4a" });
    const res = await fetch(`${BASE}/api/transcribe`, { method: "POST", body: form as any });
    if (!res.ok) throw new Error(`Transcribe ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data?.text || "").trim();
  },

  // Memories
  listMemories: (params?: { category?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.search) qs.set("search", params.search);
    const s = qs.toString();
    return jfetch<Memory[]>(`/memories${s ? `?${s}` : ""}`);
  },
  createMemory: (body: Partial<Memory>) =>
    jfetch<Memory>("/memories", { method: "POST", body: JSON.stringify(body) }),
  deleteMemory: (id: string) =>
    jfetch<{ ok: boolean }>(`/memories/${id}`, { method: "DELETE" }),

  // Goals
  listGoals: () => jfetch<Goal[]>("/goals"),
  createGoal: (body: { title: string; description?: string; target?: string }) =>
    jfetch<Goal>("/goals", { method: "POST", body: JSON.stringify(body) }),
  updateGoal: (id: string, body: Partial<Goal>) =>
    jfetch<Goal>(`/goals/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteGoal: (id: string) =>
    jfetch<{ ok: boolean }>(`/goals/${id}`, { method: "DELETE" }),

  // Reminders
  listReminders: (status?: string) =>
    jfetch<Reminder[]>(`/reminders${status ? `?status=${status}` : ""}`),
  createReminder: (body: { text: string; condition?: string }) =>
    jfetch<Reminder>("/reminders", { method: "POST", body: JSON.stringify(body) }),
  updateReminder: (id: string, body: Partial<Reminder>) =>
    jfetch<Reminder>(`/reminders/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteReminder: (id: string) =>
    jfetch<{ ok: boolean }>(`/reminders/${id}`, { method: "DELETE" }),

  // Briefing
  briefing: (lat?: number | null, lon?: number | null, tzOffset?: number) => {
    const qs = new URLSearchParams();
    if (lat != null && lon != null) {
      qs.set("lat", String(lat));
      qs.set("lon", String(lon));
    }
    if (tzOffset != null) qs.set("tz_offset", String(tzOffset));
    const s = qs.toString();
    return jfetch<{
      greeting: string;
      name: string | null;
      weather: {
        temperature_c: number;
        humidity: number;
        wind_kph: number;
        code: number;
        summary: string;
        timezone: string;
      } | null;
      pending_reminders: Reminder[];
      active_goals: Goal[];
      important_dates: Memory[];
      session_count: number;
      integrations: Record<string, { connected: boolean; note: string }>;
    }>(`/briefing${s ? `?${s}` : ""}`);
  },
};
