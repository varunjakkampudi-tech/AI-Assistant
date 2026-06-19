import React, { useCallback, useEffect, useRef, useState } from "react";
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
  Share,
  ScrollView,
  Image as RNImage,
  Linking,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import * as ImagePicker from "expo-image-picker";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useRouter, useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { api, ChatMessage } from "@/src/api";
import VoiceOrb from "@/src/components/VoiceOrb";
import TypingDots from "@/src/components/TypingDots";
import MenuSheet from "@/src/components/MenuSheet";

const SESSION_KEY = "ora_current_session";

const SUGGESTIONS = [
  { icon: "bulb-outline", label: "Explain a tricky concept", prompt: "Explain quantum entanglement like I'm 12." },
  { icon: "create-outline", label: "Help me write", prompt: "Help me draft a short, warm thank-you note to a mentor." },
  { icon: "code-slash-outline", label: "Debug some code", prompt: "Why does my Python list comprehension throw a NameError when I use a walrus operator inside it?" },
  { icon: "compass-outline", label: "Plan a trip", prompt: "Plan a 3-day food-focused trip to Lisbon for first-time travelers." },
] as const;

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<{ b64: string; mime: string; uri: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const hydrateActiveSession = useCallback(async () => {
    const existing = await storage.getItem<string>(SESSION_KEY, "");
    if (existing) {
      try {
        const msgs = await api.getMessages(existing);
        setSessionId(existing);
        setMessages(msgs);
        setError(null);
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      const s = await api.createSession();
      await storage.setItem(SESSION_KEY, s.id);
      setSessionId(s.id);
      setMessages([]);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      hydrateActiveSession();
      return () => Speech.stop();
    }, [hydrateActiveSession]),
  );

  const startNewChat = useCallback(async () => {
    Speech.stop();
    try {
      const s = await api.createSession();
      await storage.setItem(SESSION_KEY, s.id);
      setSessionId(s.id);
      setMessages([]);
      setPendingImage(null);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, []);

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Photo permission denied");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if (!a.base64) {
        setError("Could not read image");
        return;
      }
      const mime = a.mimeType || (a.uri?.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
      setPendingImage({ b64: a.base64, mime, uri: a.uri });
    } catch (e: any) {
      setError(`Image error: ${e?.message || e}`);
    }
  }, []);

  const send = useCallback(
    async (textArg?: string) => {
      const content = (textArg ?? input).trim();
      const hasImage = !!pendingImage;
      if ((!content && !hasImage) || !sessionId || sending) return;
      setInput("");
      Keyboard.dismiss();
      setSending(true);
      setError(null);

      const optimistic: ChatMessage = {
        id: `tmp-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        image_b64: pendingImage?.b64 || null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const imgToSend = pendingImage;
      setPendingImage(null);

      try {
        // Use tool-calling endpoint for enhanced AI capabilities
        const res = await api.chatWithTools(
          sessionId,
          content,
          imgToSend?.b64 || null,
          imgToSend?.mime || null,
          true // enable tools
        );
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== optimistic.id);
          return [...without, res.user_message, res.assistant_message];
        });
        
        // Log tool calls for debugging (can be used for UI later)
        if (res.tool_calls && res.tool_calls.length > 0) {
          console.log("Tool calls executed:", res.tool_calls.map(tc => tc.tool_name));
        }
        
        if (ttsEnabled && res.assistant_message?.content) {
          Speech.stop();
          setIsSpeaking(true);
          Speech.speak(res.assistant_message.content, {
            rate: 1.0,
            pitch: 1.0,
            onDone: () => setIsSpeaking(false),
            onStopped: () => setIsSpeaking(false),
            onError: () => setIsSpeaking(false),
          });
        }
      } catch (e: any) {
        setError(String(e?.message || e));
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      } finally {
        setSending(false);
      }
    },
    [input, pendingImage, sessionId, sending, ttsEnabled],
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
      setIsSpeaking(false);
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      setError(`Recording error: ${e?.message || e}`);
    }
  }, [recorder]);

  const interruptSpeech = useCallback(() => {
    Speech.stop();
    setIsSpeaking(false);
  }, []);

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

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length, sending]);

  const isRecording = recorderState.isRecording;
  const isBusy = sending || transcribing;

  const shareConversation = useCallback(async () => {
    if (messages.length === 0) return;
    const text = messages
      .map((m) => `${m.role === "user" ? "You" : "ORA"}: ${m.content}`)
      .join("\n\n");
    try {
      await Share.share({ message: `My conversation with ORA\n\n${text}\n\n— Sent from ORA OS` });
    } catch (e: any) {
      setError(`Share failed: ${e?.message || e}`);
    }
  }, [messages]);

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === "user") {
      const emoji =
        item.emotion === "frustrated" ? "😤" :
        item.emotion === "urgent" ? "⚡" :
        item.emotion === "excited" ? "🎉" :
        item.emotion === "sad" ? "💛" : null;
      return (
        <View style={styles.userRow} testID={`message-user-${item.id}`}>
          <View style={styles.userBubble}>
            {item.image_b64 && (
              <RNImage
                source={{ uri: `data:image/jpeg;base64,${item.image_b64}` }}
                style={styles.userImage}
                resizeMode="cover"
              />
            )}
            {!!item.content && (
              <Text style={styles.userText} selectable>
                {item.content}
              </Text>
            )}
          </View>
          {emoji && (
            <Text style={styles.emotionTag} testID={`emotion-${item.id}`}>
              {emoji} {item.emotion}
            </Text>
          )}
        </View>
      );
    }
    return (
      <View style={styles.aiRow} testID={`message-ai-${item.id}`}>
        <View style={styles.aiBadge}>
          <Ionicons name="sparkles" size={14} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.aiText} selectable>
            {item.content}
          </Text>
          {item.whatsapp_link && (
            <Pressable
              style={styles.whatsappBtn}
              onPress={() => Linking.openURL(item.whatsapp_link!)}
              testID={`whatsapp-${item.id}`}
            >
              <Ionicons name="logo-whatsapp" size={16} color="#fff" />
              <Text style={styles.whatsappBtnText}>Open in WhatsApp</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }, []);

  const empty = messages.length === 0;

  return (
    <View style={styles.root} testID="chat-screen">
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
        <View style={styles.header} testID="chat-header">
          <Pressable
            style={styles.headerBtn}
            onPress={() => setMenuOpen(true)}
            hitSlop={10}
            testID="open-menu-button"
          >
            <Ionicons name="menu" size={22} color={theme.color.onSurface} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>ORA OS</Text>
            <Text style={styles.headerSubtitle}>How can I help you today?</Text>
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
          {messages.length > 0 && (
            <Pressable
              style={styles.headerBtn}
              onPress={shareConversation}
              hitSlop={10}
              testID="share-button"
            >
              <Ionicons name="share-outline" size={20} color={theme.color.onSurface} />
            </Pressable>
          )}
          <Pressable
            style={styles.headerBtn}
            onPress={startNewChat}
            hitSlop={10}
            testID="new-chat-button"
          >
            <Ionicons name="create-outline" size={22} color={theme.color.onSurface} />
          </Pressable>
        </View>

        {isRecording && (
          <View style={styles.recordingOverlay} pointerEvents="box-none" testID="recording-overlay">
            <VoiceOrb active size={240} />
            <Text style={styles.recordingHint}>Listening…</Text>
            <Text style={styles.recordingSub}>Tap the mic again to send</Text>
          </View>
        )}

        {!isRecording && empty ? (
          <View style={styles.emptyWrap} testID="empty-state">
            <VoiceOrb active size={160} />
            <Text style={styles.emptyTitle}>Hello{"\n"}How can I help you today?</Text>
            <Text style={styles.emptySubtitle}>
              Ask anything — type, hold the mic, or attach an image.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionsRow}
              style={styles.suggestionsScroll}
            >
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s.label}
                  style={styles.suggestionChip}
                  onPress={() => send(s.prompt)}
                  testID={`suggestion-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Ionicons name={s.icon as any} size={14} color={theme.color.brand} />
                  <Text style={styles.suggestionLabel}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
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

        {error && (
          <Pressable onPress={() => setError(null)} style={styles.errorToast} testID="error-toast">
            <Ionicons name="alert-circle" size={16} color="#fff" />
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
          </Pressable>
        )}

        {/* Speaking-now interrupt overlay */}
        {isSpeaking && (
          <Pressable
            onPress={interruptSpeech}
            style={styles.speakingPill}
            testID="speaking-interrupt-pill"
          >
            <Ionicons name="stop-circle" size={16} color={theme.color.onBrand} />
            <Text style={styles.speakingText}>ORA is speaking — tap to interrupt</Text>
          </Pressable>
        )}
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.inputWrap, { paddingBottom: theme.spacing.sm }]}>
          {pendingImage && (
            <View style={styles.imagePreviewRow} testID="pending-image-preview">
              <RNImage source={{ uri: pendingImage.uri }} style={styles.imagePreview} />
              <Pressable
                onPress={() => setPendingImage(null)}
                style={styles.imageClear}
                hitSlop={10}
                testID="clear-image-button"
              >
                <Ionicons name="close" size={14} color={theme.color.onSurface} />
              </Pressable>
            </View>
          )}
          <BlurView intensity={60} tint="dark" style={styles.inputBlur}>
            <View style={styles.inputRow}>
              <Pressable
                style={styles.iconBtn}
                onPress={pickImage}
                hitSlop={10}
                disabled={isBusy || isRecording}
                testID="attach-image-button"
              >
                <Ionicons name="image-outline" size={20} color={theme.color.onSurfaceSecondary} />
              </Pressable>
              <TextInput
                style={styles.input}
            placeholder={transcribing ? "Transcribing…" : "Ask anything…"}
                placeholderTextColor={theme.color.onSurfaceSecondary}
                value={input}
                onChangeText={setInput}
                editable={!isBusy && !isRecording}
                multiline
                returnKeyType="send"
                onSubmitEditing={() => send()}
                onKeyPress={(e: any) => {
                  // Web: Enter (without Shift) submits; Shift+Enter inserts newline
                  if (Platform.OS === "web" && e?.nativeEvent?.key === "Enter" && !e?.nativeEvent?.shiftKey) {
                    e.preventDefault?.();
                    send();
                  }
                }}
                testID="chat-input"
              />
              {input.trim().length > 0 || pendingImage ? (
                <Pressable
                  style={[styles.sendBtn, sending && { opacity: 0.5 }]}
                  onPress={() => send()}
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

      <MenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNewChat={startNewChat}
      />
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
    paddingBottom: 260,
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
    gap: theme.spacing.sm,
  },
  userImage: { width: 220, height: 160, borderRadius: theme.radius.md },
  userText: { color: theme.color.onSurfaceTertiary, fontSize: 15, lineHeight: 22 },
  aiRow: { flexDirection: "row", gap: theme.spacing.md, paddingRight: theme.spacing.lg },
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
  aiText: { flex: 1, color: theme.color.onSurface, fontSize: 16, lineHeight: 24 },
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
  suggestionsScroll: { width: "100%", marginTop: theme.spacing.lg, flexGrow: 0 },
  suggestionsRow: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
    alignItems: "center",
  },
  suggestionChip: {
    height: 36,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.brandSecondary,
  },
  suggestionLabel: { color: theme.color.onSurfaceTertiary, fontSize: 13 },
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
    bottom: 78,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  imagePreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: theme.radius.md,
    padding: 4,
    gap: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  imagePreview: { width: 56, height: 56, borderRadius: theme.radius.sm },
  imageClear: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.color.surface,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: theme.spacing.sm,
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
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
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
  emotionTag: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 4,
    marginRight: 4,
  },
  whatsappBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginTop: theme.spacing.md,
    backgroundColor: "#25D366",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
  },
  whatsappBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  speakingPill: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    shadowColor: theme.color.brand,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    zIndex: 10,
  },
  speakingText: { color: theme.color.onBrand, fontSize: 13, fontWeight: "600" },
});
