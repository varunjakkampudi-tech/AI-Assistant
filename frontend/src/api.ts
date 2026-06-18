// Centralised types for chat
export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  session_id: string;
  role: Role;
  content: string;
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
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
  createSession: (title?: string) =>
    jfetch<ChatSession>("/sessions", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  listSessions: () => jfetch<ChatSession[]>("/sessions"),
  getMessages: (id: string) => jfetch<ChatMessage[]>(`/sessions/${id}/messages`),
  deleteSession: (id: string) =>
    jfetch<{ ok: boolean }>(`/sessions/${id}`, { method: "DELETE" }),
  chat: (session_id: string, message: string) =>
    jfetch<{
      session_id: string;
      user_message: ChatMessage;
      assistant_message: ChatMessage;
    }>("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id, message }),
    }),
  transcribe: async (uri: string): Promise<string> => {
    const form = new FormData();
    // @ts-ignore - RN FormData accepts this shape
    form.append("file", { uri, name: "audio.m4a", type: "audio/m4a" });
    const res = await fetch(`${BASE}/api/transcribe`, {
      method: "POST",
      body: form as any,
    });
    if (!res.ok) {
      throw new Error(`Transcribe ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return (data?.text || "").trim();
  },
};
