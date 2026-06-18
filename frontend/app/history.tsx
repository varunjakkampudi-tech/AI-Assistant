import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api, ChatSession } from "@/src/api";
import { storage } from "@/src/utils/storage";

const SESSION_KEY = "nova_current_session";

function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [currentId, setCurrentId] = useState<string>("");

  const load = useCallback(async () => {
    const cur = await storage.getItem<string>(SESSION_KEY, "");
    setCurrentId(cur || "");
    try {
      const list = await api.listSessions();
      setSessions(list);
    } catch {
      setSessions([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    load();
  }, [load]);

  const openSession = useCallback(
    async (id: string) => {
      await storage.setItem(SESSION_KEY, id);
      router.replace("/");
    },
    [router],
  );

  const newChat = useCallback(async () => {
    const s = await api.createSession();
    await storage.setItem(SESSION_KEY, s.id);
    router.replace("/");
  }, [router]);

  const deleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id);
      if (id === currentId) {
        await storage.removeItem(SESSION_KEY);
      }
      load();
    },
    [currentId, load],
  );

  return (
    <View style={styles.root} testID="history-screen">
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <View style={styles.header}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.back()}
            hitSlop={10}
            testID="history-back-button"
          >
            <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>Conversations</Text>
          <Pressable
            style={styles.iconBtn}
            onPress={newChat}
            hitSlop={10}
            testID="history-new-chat-button"
          >
            <Ionicons name="add" size={24} color={theme.color.brand} />
          </Pressable>
        </View>

        {sessions === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.color.brand} />
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="chatbubbles-outline" size={40} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.emptyTitle}>Begin your journey</Text>
            <Text style={styles.emptySubtitle}>Start a new chat to see it here</Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(s) => s.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const selected = item.id === currentId;
              return (
                <Pressable
                  onPress={() => openSession(item.id)}
                  style={[styles.row, selected && styles.rowSelected]}
                  testID={`session-row-${item.id}`}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="sparkles" size={16} color={theme.color.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title || "New Chat"}
                    </Text>
                    <Text style={styles.rowMeta}>{formatTime(item.updated_at)}</Text>
                  </View>
                  <Pressable
                    onPress={() => deleteSession(item.id)}
                    hitSlop={10}
                    style={styles.deleteBtn}
                    testID={`delete-session-${item.id}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.color.onSurfaceSecondary} />
                  </Pressable>
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.divider,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
  },
  title: {
    flex: 1,
    textAlign: "center",
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 20,
  },
  listContent: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    minHeight: 64,
  },
  rowSelected: {
    backgroundColor: theme.color.brandTertiary,
    borderColor: theme.color.brandSecondary,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { color: theme.color.onSurface, fontSize: 15, fontWeight: "500" },
  rowMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  deleteBtn: { padding: theme.spacing.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md },
  emptyTitle: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 22,
    marginTop: theme.spacing.lg,
  },
  emptySubtitle: { color: theme.color.onSurfaceSecondary, fontSize: 14 },
});
