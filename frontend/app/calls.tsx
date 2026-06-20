import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { FeatureGate } from "@/src/features";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface PhoneCall {
  id: string;
  phone_number: string;
  direction: string;
  purpose: string;
  status: string;
  duration_seconds: number;
  transcript: Array<{ role: string; text: string }>;
  summary: string;
  action_items: string[];
  created_at: string;
  started_at?: string;
  ended_at?: string;
}

export default function CallsScreen() {
  return (
    <FeatureGate feature="ai_calls">
      <CallsScreenInner />
    </FeatureGate>
  );
}

function CallsScreenInner() {
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailCall, setDetailCall] = useState<PhoneCall | null>(null);

  // New call form
  const [phoneNumber, setPhoneNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [callsRes, statsRes] = await Promise.all([
        api.listCalls(undefined, 50),
        api.callStats(),
      ]);
      setCalls(callsRes.calls);
      setStats(statsRes);
    } catch (e) {
      console.error("Failed to load calls:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const createCall = useCallback(async () => {
    if (!phoneNumber.trim() || !purpose.trim()) return;
    setCreating(true);
    try {
      await api.createCall(phoneNumber.trim(), purpose.trim());
      setPhoneNumber("");
      setPurpose("");
      setModalOpen(false);
      // Wait a bit for the mock call to complete
      setTimeout(() => load(), 2000);
    } catch (e: any) {
      console.error("Failed to create call:", e);
    } finally {
      setCreating(false);
    }
  }, [phoneNumber, purpose, load]);

  const cancelCall = useCallback(
    async (id: string) => {
      try {
        await api.cancelCall(id);
        load();
      } catch (e) {
        console.error("Failed to cancel:", e);
      }
    },
    [load]
  );

  const viewCall = useCallback(async (id: string) => {
    try {
      const call = await api.getCall(id);
      setDetailCall(call);
    } catch (e) {
      console.error("Failed to load call:", e);
    }
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTime = (iso?: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "#22c55e";
      case "in_progress":
        return theme.color.brand;
      case "failed":
        return "#ef4444";
      case "cancelled":
        return theme.color.onSurfaceSecondary;
      default:
        return theme.color.brand;
    }
  };

  const statusIcon = (status: string): keyof typeof Ionicons.glyphMap => {
    switch (status) {
      case "completed":
        return "checkmark-circle";
      case "in_progress":
        return "call";
      case "failed":
        return "close-circle";
      case "cancelled":
        return "ban";
      default:
        return "time";
    }
  };

  return (
    <View style={styles.root} testID="calls-screen">
      <ScreenHeader
        title="AI Calls"
        rightSlot={
          <Pressable
            style={styles.addBtn}
            onPress={() => setModalOpen(true)}
            testID="new-call-button"
          >
            <Ionicons name="call" size={20} color={theme.color.brand} />
          </Pressable>
        }
      />

      {/* Stats */}
      {stats && (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total_calls}</Text>
            <Text style={styles.statLabel}>Total Calls</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.by_status?.completed || 0}</Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total_duration_minutes}m</Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
        </View>
      )}

      {/* Mock Mode Banner */}
      <View style={styles.mockBanner}>
        <Ionicons name="flask" size={16} color={theme.color.brand} />
        <Text style={styles.mockText}>
          Demo Mode: Calls are simulated. Connect Twilio/Bland.ai for real calls.
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      ) : calls.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="call-outline" size={48} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>No AI Calls Yet</Text>
          <Text style={styles.emptySubtitle}>
            Have ORA make calls on your behalf — schedule appointments, follow up on tasks, and more.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => setModalOpen(true)}>
            <Text style={styles.primaryBtnText}>Make a Call</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.callCard}
              onPress={() => viewCall(item.id)}
              testID={`call-${item.id}`}
            >
              <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]}>
                <Ionicons name={statusIcon(item.status)} size={16} color="#fff" />
              </View>
              <View style={styles.callContent}>
                <Text style={styles.callPhone}>{item.phone_number}</Text>
                <Text style={styles.callPurpose} numberOfLines={1}>
                  {item.purpose}
                </Text>
                <View style={styles.callMeta}>
                  <Text style={styles.callTime}>{formatTime(item.created_at)}</Text>
                  {item.duration_seconds > 0 && (
                    <Text style={styles.callDuration}>{formatDuration(item.duration_seconds)}</Text>
                  )}
                </View>
              </View>
              {item.status === "pending" && (
                <Pressable
                  style={styles.cancelBtn}
                  onPress={() => cancelCall(item.id)}
                  hitSlop={10}
                >
                  <Ionicons name="close" size={18} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}

      {/* New Call Modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New AI Call</Text>
            <Text style={styles.modalSubtitle}>
              ORA will call this number and handle the conversation based on your purpose.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Phone number (e.g., +1234567890)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              testID="call-phone-input"
            />

            <TextInput
              style={[styles.modalInput, { minHeight: 80, textAlignVertical: "top" }]}
              placeholder="Purpose of the call (e.g., Schedule dentist appointment for next week)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={purpose}
              onChangeText={setPurpose}
              multiline
              testID="call-purpose-input"
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setModalOpen(false)}
                testID="call-cancel"
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, creating && { opacity: 0.5 }]}
                onPress={createCall}
                disabled={creating}
                testID="call-submit"
              >
                {creating ? (
                  <ActivityIndicator size="small" color={theme.color.onBrand} />
                ) : (
                  <>
                    <Ionicons name="call" size={16} color={theme.color.onBrand} />
                    <Text style={styles.primaryBtnText}>Start Call</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Call Detail Modal */}
      <Modal
        visible={!!detailCall}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailCall(null)}
      >
        <View style={styles.detailModalRoot}>
          <View style={styles.detailModalCard}>
            <View style={styles.detailHeader}>
              <View>
                <Text style={styles.detailPhone}>{detailCall?.phone_number}</Text>
                <View style={[styles.statusBadge, { backgroundColor: statusColor(detailCall?.status || "") }]}>
                  <Text style={styles.statusText}>{detailCall?.status?.toUpperCase()}</Text>
                </View>
              </View>
              <Pressable onPress={() => setDetailCall(null)} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.color.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={styles.detailContent}>
              <View style={styles.detailSection}>
                <Text style={styles.sectionTitle}>Purpose</Text>
                <Text style={styles.sectionText}>{detailCall?.purpose}</Text>
              </View>

              {detailCall?.summary && (
                <View style={styles.detailSection}>
                  <Text style={styles.sectionTitle}>Summary</Text>
                  <Text style={styles.sectionText}>{detailCall.summary}</Text>
                </View>
              )}

              {detailCall?.action_items && detailCall.action_items.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={styles.sectionTitle}>Action Items</Text>
                  {detailCall.action_items.map((item, i) => (
                    <View key={i} style={styles.actionItem}>
                      <View style={styles.actionDot} />
                      <Text style={styles.sectionText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {detailCall?.transcript && detailCall.transcript.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={styles.sectionTitle}>Transcript</Text>
                  {detailCall.transcript.map((msg, i) => (
                    <View
                      key={i}
                      style={[
                        styles.transcriptMsg,
                        msg.role === "ai" ? styles.aiMsg : styles.humanMsg,
                      ]}
                    >
                      <Text style={styles.transcriptRole}>
                        {msg.role === "ai" ? "ORA" : "Recipient"}
                      </Text>
                      <Text style={styles.transcriptText}>{msg.text}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.detailMeta}>
                {detailCall?.started_at && (
                  <Text style={styles.metaText}>Started: {formatTime(detailCall.started_at)}</Text>
                )}
                {detailCall?.ended_at && (
                  <Text style={styles.metaText}>Ended: {formatTime(detailCall.ended_at)}</Text>
                )}
                {detailCall?.duration_seconds ? (
                  <Text style={styles.metaText}>
                    Duration: {formatDuration(detailCall.duration_seconds)}
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
  },
  statValue: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 20 },
  statLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  mockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.md,
  },
  mockText: { flex: 1, color: theme.color.brand, fontSize: 12 },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  callCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  statusDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  callContent: { flex: 1 },
  callPhone: { color: theme.color.onSurface, fontSize: 15, fontWeight: "600" },
  callPurpose: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  callMeta: { flexDirection: "row", gap: theme.spacing.md, marginTop: 4 },
  callTime: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  callDuration: { color: theme.color.brand, fontSize: 11 },
  cancelBtn: { padding: theme.spacing.sm },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  emptyTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  emptySubtitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
  },
  primaryBtnText: { color: theme.color.onBrand, fontWeight: "600" },
  secondaryBtn: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceTertiary,
  },
  secondaryBtnText: { color: theme.color.onSurface },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  modalCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  modalTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  modalSubtitle: { color: theme.color.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  modalInput: {
    color: theme.color.onSurface,
    fontSize: 15,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  detailModalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  detailModalCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: "85%",
    padding: theme.spacing.xl,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  detailPhone: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  statusBadge: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    marginTop: theme.spacing.sm,
    alignSelf: "flex-start",
  },
  statusText: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  detailContent: { marginTop: theme.spacing.lg },
  detailSection: { marginBottom: theme.spacing.lg },
  sectionTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: theme.spacing.sm,
  },
  sectionText: { color: theme.color.onSurface, fontSize: 14, lineHeight: 20 },
  actionItem: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm, marginTop: 4 },
  actionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.brand,
    marginTop: 6,
  },
  transcriptMsg: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.sm,
  },
  aiMsg: { backgroundColor: theme.color.brandTertiary },
  humanMsg: { backgroundColor: theme.color.surfaceTertiary },
  transcriptRole: {
    color: theme.color.brand,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  transcriptText: { color: theme.color.onSurface, fontSize: 13, lineHeight: 18 },
  detailMeta: { marginTop: theme.spacing.lg, gap: 4 },
  metaText: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
});
