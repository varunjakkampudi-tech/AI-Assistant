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
    return jfetch<any>(`/briefing${s ? `?${s}` : ""}`);
  },

  // Auth gate
  me: async (): Promise<{ email: string; name: string; picture?: string } | null> => {
    const res = await fetch(`${BASE}/api/me`);
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`me ${res.status}`);
    return res.json();
  },
  googleAuthUrl: () => jfetch<{ url: string }>("/google/auth-url"),

  // Notifications
  listNotifications: (kind?: string) =>
    jfetch<any[]>(`/notifications${kind ? `?kind=${kind}` : ""}`),
  deleteNotification: (id: string) =>
    jfetch<{ ok: boolean }>(`/notifications/${id}`, { method: "DELETE" }),

  // ==================== NEW FEATURES ====================

  // Chat with Tools
  chatWithTools: (
    session_id: string,
    message: string,
    image_b64?: string | null,
    image_mime?: string | null,
    use_tools: boolean = true,
  ) =>
    jfetch<{
      session_id: string;
      user_message: ChatMessage;
      assistant_message: ChatMessage;
      tool_calls: Array<{ tool_name: string; params: any; result: any }>;
    }>("/chat/tools", {
      method: "POST",
      body: JSON.stringify({ session_id, message, image_b64, image_mime, use_tools }),
    }),

  // Web Search
  webSearch: (query: string) =>
    jfetch<{ success: boolean; query: string; results: any[] }>("/search/web", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),

  // Knowledge Vault
  uploadDocument: async (uri: string, filename: string, mimeType: string): Promise<any> => {
    const form = new FormData();
    // @ts-ignore RN FormData
    form.append("file", { uri, name: filename, type: mimeType });
    const res = await fetch(`${BASE}/api/knowledge/upload`, { method: "POST", body: form as any });
    if (!res.ok) throw new Error(`Upload ${res.status}: ${await res.text()}`);
    return res.json();
  },
  listDocuments: (skip = 0, limit = 20) =>
    jfetch<{ documents: any[]; total: number }>(`/knowledge/documents?skip=${skip}&limit=${limit}`),
  getDocument: (id: string) => jfetch<any>(`/knowledge/documents/${id}`),
  deleteDocument: (id: string) =>
    jfetch<{ ok: boolean }>(`/knowledge/documents/${id}`, { method: "DELETE" }),
  searchKnowledge: (query: string) =>
    jfetch<{ query: string; results: any[] }>("/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
  knowledgeStats: () => jfetch<any>("/knowledge/stats"),

  // Phone Calls
  createCall: (phone_number: string, purpose: string, scheduled_at?: string) =>
    jfetch<{ success: boolean; call: any; message: string }>("/calls", {
      method: "POST",
      body: JSON.stringify({ phone_number, purpose, scheduled_at }),
    }),
  listCalls: (status?: string, limit = 50) =>
    jfetch<{ calls: any[]; total: number }>(`/calls?limit=${limit}${status ? `&status=${status}` : ""}`),
  getCall: (id: string) => jfetch<any>(`/calls/${id}`),
  cancelCall: (id: string) =>
    jfetch<{ ok: boolean }>(`/calls/${id}/cancel`, { method: "POST" }),
  callStats: () => jfetch<any>("/calls/stats/summary"),

  // Dashboard
  dashboard: (days = 30) => jfetch<any>(`/dashboard?days=${days}`),
  usageStats: (days = 30) => jfetch<any>(`/dashboard/usage?days=${days}`),
  spendingInsights: (days = 30) => jfetch<any>(`/dashboard/spending?days=${days}`),
  productivityAnalytics: (days = 7) => jfetch<any>(`/dashboard/productivity?days=${days}`),
  aiInsights: () => jfetch<any>("/dashboard/insights"),

  // Notification Stats
  notificationStats: () => jfetch<any>("/notifications/stats"),
  createMockNotification: (app_name: string, title: string, text: string) =>
    jfetch<any>("/notifications/mock", {
      method: "POST",
      body: JSON.stringify({ app_name, title, text }),
    }),
};
