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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api, Reminder } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

export default function RemindersScreen() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [condition, setCondition] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await api.listReminders();
      setItems(list);
    } catch {
      setItems([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const create = useCallback(async () => {
    if (!text.trim()) return;
    await api.createReminder({ text: text.trim(), condition: condition.trim() });
    setText("");
    setCondition("");
    setOpen(false);
    load();
  }, [text, condition, load]);

  const toggleDone = useCallback(async (r: Reminder) => {
    const next = r.status === "done" ? "pending" : "done";
    setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: next as any } : x)));
    await api.updateReminder(r.id, { status: next });
  }, []);

  const remove = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    await api.deleteReminder(id);
  }, []);

  const pending = items.filter((r) => r.status === "pending");
  const done = items.filter((r) => r.status !== "pending");

  return (
    <View style={styles.root} testID="reminders-screen">
      <ScreenHeader
        title="Reminders"
        rightSlot={
          <Pressable style={styles.addBtn} onPress={() => setOpen(true)} hitSlop={10} testID="add-reminder-button">
            <Ionicons name="add" size={22} color={theme.color.brand} />
          </Pressable>
        }
      />

      {items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="alarm-outline" size={36} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>No reminders yet</Text>
          <Text style={styles.emptySub}>
            Add things you want to be reminded about — even conditional ones like "after approval arrives".
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => setOpen(true)} testID="empty-add-reminder">
            <Text style={styles.primaryBtnText}>Add a reminder</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            pending.length > 0 ? <Text style={styles.section}>Pending</Text> : null
          }
          renderItem={({ item, index }) => {
            const showDoneHeader =
              item.status !== "pending" && pending.length === index;
            return (
              <>
                {showDoneHeader && <Text style={[styles.section, { marginTop: theme.spacing.lg }]}>Completed</Text>}
                <View
                  style={[styles.card, item.status !== "pending" && styles.cardDone]}
                  testID={`reminder-row-${item.id}`}
                >
                  <Pressable
                    style={styles.check}
                    onPress={() => toggleDone(item)}
                    hitSlop={10}
                    testID={`reminder-toggle-${item.id}`}
                  >
                    <Ionicons
                      name={item.status === "done" ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={item.status === "done" ? theme.color.success : theme.color.brand}
                    />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.text, item.status === "done" && styles.textDone]}
                      numberOfLines={3}
                    >
                      {item.text}
                    </Text>
                    {!!item.condition && (
                      <View style={styles.condRow}>
                        <Ionicons name="git-branch-outline" size={12} color={theme.color.brand} />
                        <Text style={styles.cond}>when: {item.condition}</Text>
                      </View>
                    )}
                  </View>
                  <Pressable onPress={() => remove(item.id)} hitSlop={10} testID={`reminder-delete-${item.id}`}>
                    <Ionicons name="close" size={16} color={theme.color.onSurfaceSecondary} />
                  </Pressable>
                </View>
              </>
            );
          }}
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New reminder</Text>
            <TextInput
              style={[styles.modalInput, { minHeight: 60, textAlignVertical: "top" }]}
              placeholder="What should I remind you about?"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={text}
              onChangeText={setText}
              multiline
              testID="reminder-text-input"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="When? (e.g. after certification approval arrives)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={condition}
              onChangeText={setCondition}
              testID="reminder-condition-input"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryBtn} onPress={() => setOpen(false)} testID="reminder-cancel">
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={create} testID="reminder-save">
                <Text style={styles.primaryBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  list: { padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: theme.spacing.xxxl },
  section: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    marginBottom: theme.spacing.sm,
  },
  cardDone: { opacity: 0.55 },
  check: { width: 26, alignItems: "center" },
  text: { color: theme.color.onSurface, fontSize: 15, lineHeight: 20 },
  textDone: { textDecorationLine: "line-through", color: theme.color.onSurfaceSecondary },
  condRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  cond: { color: theme.color.brand, fontSize: 11 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md, padding: theme.spacing.xl },
  emptyTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22 },
  emptySub: { color: theme.color.onSurfaceSecondary, fontSize: 14, textAlign: "center" },
  primaryBtn: {
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
  },
  primaryBtnText: { color: theme.color.onBrand, fontWeight: "600" },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: theme.spacing.xl },
  modalCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  modalTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 22, marginBottom: theme.spacing.sm },
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
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.md, marginTop: theme.spacing.sm },
  secondaryBtn: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceTertiary,
  },
  secondaryBtnText: { color: theme.color.onSurface },
});
