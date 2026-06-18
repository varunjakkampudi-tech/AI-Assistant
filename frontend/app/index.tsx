import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useRouter } from "expo-router";

import { theme } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { api, ChatMessage } from "@/src/api";
import VoiceOrb from "@/src/components/VoiceOrb";
import TypingDots from "@/src/components/TypingDots";

const SESSION_KEY = "nova_current_session";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Voice recorder
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  // Init: get or create a session
  useEffect(() => {
    (async () => {
      const existing = await storage.getItem<string>(SESSION_KEY, "");
      if (existing) {
        setSessionId(existing);
        try {
          const msgs = await api.getMessages(existing);
          setMessages(msgs);
        } catch {
          // session may have been deleted; create fresh
          await startNewChat();
        }
      } else {
        await startNewChat();
      }
    })();
    // configure audio mode for recording on iOS
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {});
  }, []);

  const startNewChat = useCallback(async () => {
    try {
      const s = await api.createSession();
      await storage.setItem(SESSION_KEY, s.id);
      setSessionId(s.id);
      setMessages([]);
      setError(null);
      Speech.stop();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || !sessionId || sending) return;
      setInput("");
      Keyboard.dismiss();
      setSending(true);
      setError(null);

      // optimistic user bubble
      const tempUser: ChatMessage = {
        id: `tmp-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUser]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      try {
        const res = await api.chat(sessionId, content);
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== tempUser.id);
          return [...without, res.user_message, res.assistant_message];
        });
        if (ttsEnabled && res.assistant_message?.content) {
          Speech.stop();
          Speech.speak(res.assistant_message.content, { rate: 1.0, pitch: 1.0 });
        }
      } catch (e: any) {
        setError(String(e?.message || e));
        setMessages((prev) => prev.filter((m) => m.id !== tempUser.id));
      } finally {
        setSending(false);
      }
    },
    [sessionId, sending, ttsEnabled],
  );

  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission denied");
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      Speech.stop();
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      setError(`Recording error: ${e?.message || e}`);
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setError("No audio captured");
        return;
      }
      setTranscribing(true);
      const text = await api.transcribe(uri);
      setTranscribing(false);
      if (text) {
        await send(text);
      } else {
        setError("Couldn't hear anything. Try again.");
      }
    } catch (e: any) {
      setTranscribing(false);
      setError(`Transcribe error: ${e?.message || e}`);
    }
  }, [recorder, send]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length, sending]);

  const isRecording = recorderState.isRecording;
  const isBusy = sending || transcribing;

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === "user") {
      return (
        <View style={styles.userRow} testID={`message-user-${item.id}`}>
          <View style={styles.userBubble}>
            <Text style={styles.userText} selectable>
              {item.content}
            </Text>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.aiRow} testID={`message-ai-${item.id}`}>
        <View style={styles.aiBadge}>
          <Ionicons name="sparkles" size={14} color={theme.color.brand} />
        </View>
        <Text style={styles.aiText} selectable>
          {item.content}
        </Text>
      </View>
    );
  }, []);

  const empty = messages.length === 0;

  return (
    <View style={styles.root} testID="chat-screen">
      {/* Background texture */}
      <Image
        source={{
          uri: "https://images.pexels.com/photos/2387818/pexels-photo-2387818.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(10,10,12,0.92)", "rgba(10,10,12,0.96)", "#0a0a0c"]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        {/* Header */}
        <View style={styles.header} testID="chat-header">
          <Pressable
            style={styles.headerBtn}
            onPress={() => router.push("/history")}
            hitSlop={10}
            testID="open-history-button"
          >
            <Ionicons name="menu" size={22} color={theme.color.onSurface} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Nova</Text>
            <Text style={styles.headerSubtitle}>Amazon Nova Lite</Text>
          </View>
          <Pressable
            style={styles.headerBtn}
            onPress={() => setTtsEnabled((v) => !v)}
            hitSlop={10}
            testID="toggle-tts-button"
          >
            <Ionicons
              name={ttsEnabled ? "volume-high" : "volume-mute"}
              size={20}
              color={ttsEnabled ? theme.color.brand : theme.color.onSurfaceSecondary}
            />
          </Pressable>
          <Pressable
            style={styles.headerBtn}
            onPress={startNewChat}
            hitSlop={10}
            testID="new-chat-button"
          >
            <Ionicons name="create-outline" size={22} color={theme.color.onSurface} />
          </Pressable>
        </View>

        {/* Recording overlay */}
        {isRecording && (
          <View style={styles.recordingOverlay} pointerEvents="box-none" testID="recording-overlay">
            <VoiceOrb active size={240} />
            <Text style={styles.recordingHint}>Listening…</Text>
            <Text style={styles.recordingSub}>Tap the mic again to send</Text>
          </View>
        )}

        {/* Chat area */}
        {!isRecording && empty ? (
          <View style={styles.emptyWrap} testID="empty-state">
            <VoiceOrb active size={160} />
            <Text style={styles.emptyTitle}>How may I help today?</Text>
            <Text style={styles.emptySubtitle}>
              Ask anything — type or hold the mic to speak.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            style={{ opacity: isRecording ? 0.15 : 1 }}
            ListFooterComponent={
              sending ? (
                <View style={styles.aiRow}>
                  <View style={styles.aiBadge}>
                    <Ionicons name="sparkles" size={14} color={theme.color.brand} />
                  </View>
                  <TypingDots />
                </View>
              ) : null
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* Error toast */}
        {error && (
          <Pressable onPress={() => setError(null)} style={styles.errorToast} testID="error-toast">
            <Ionicons name="alert-circle" size={16} color="#fff" />
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
          </Pressable>
        )}
      </SafeAreaView>

      {/* Glass input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.inputWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <BlurView intensity={60} tint="dark" style={styles.inputBlur}>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={transcribing ? "Transcribing…" : "Message Nova…"}
                placeholderTextColor={theme.color.onSurfaceSecondary}
                value={input}
                onChangeText={setInput}
                editable={!isBusy && !isRecording}
                multiline
                returnKeyType="send"
                onSubmitEditing={() => send(input)}
                testID="chat-input"
              />
              {input.trim().length > 0 ? (
                <Pressable
                  style={[styles.sendBtn, sending && { opacity: 0.5 }]}
                  onPress={() => send(input)}
                  disabled={sending}
                  testID="send-button"
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={theme.color.onBrand} />
                  ) : (
                    <Ionicons name="arrow-up" size={20} color={theme.color.onBrand} />
                  )}
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.micBtn, isRecording && styles.micBtnActive]}
                  onPress={isRecording ? stopRecording : startRecording}
                  disabled={transcribing}
                  testID="mic-button"
                >
                  {transcribing ? (
                    <ActivityIndicator size="small" color={theme.color.onBrand} />
                  ) : (
                    <Ionicons
                      name={isRecording ? "stop" : "mic"}
                      size={22}
                      color={theme.color.onBrand}
                    />
                  )}
                </Pressable>
              )}
            </View>
          </BlurView>
        </View>
      </KeyboardAvoidingView>
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
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  headerTitle: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 22,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: 160,
    gap: theme.spacing.lg,
  },
  userRow: { alignItems: "flex-end" },
  userBubble: {
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: theme.radius.lg,
    borderTopRightRadius: 6,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    maxWidth: "85%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  userText: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 15,
    lineHeight: 22,
  },
  aiRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingRight: theme.spacing.lg,
  },
  aiBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.brandTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.brandSecondary,
    marginTop: 2,
  },
  aiText: {
    flex: 1,
    color: theme.color.onSurface,
    fontSize: 16,
    lineHeight: 24,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  emptyTitle: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 30,
    textAlign: "center",
    marginTop: theme.spacing.lg,
  },
  emptySubtitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  recordingOverlay: {
    position: "absolute",
    top: 100,
    left: 0,
    right: 0,
    bottom: 140,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.lg,
    zIndex: 5,
  },
  recordingHint: {
    color: theme.color.onSurface,
    fontFamily: theme.font.display,
    fontSize: 24,
    marginTop: theme.spacing.md,
  },
  recordingSub: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  inputWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.spacing.lg,
  },
  inputBlur: {
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.borderStrong,
    backgroundColor: "rgba(20,20,24,0.55)",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  input: {
    flex: 1,
    color: theme.color.onSurface,
    fontSize: 16,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    maxHeight: 120,
    minHeight: 44,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.color.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.color.brand,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  micBtnActive: { backgroundColor: theme.color.error, shadowColor: theme.color.error },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  errorToast: {
    position: "absolute",
    top: 80,
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    backgroundColor: "rgba(139,58,58,0.95)",
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  errorText: { color: "#fff", fontSize: 13, flex: 1 },
});
