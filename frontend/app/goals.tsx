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
import { api, Goal } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

export default function GoalsScreen() {
  const [items, setItems] = useState<Goal[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await api.listGoals();
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
    if (!title.trim()) return;
    await api.createGoal({ title: title.trim(), target: target.trim(), description: description.trim() });
    setTitle("");
    setTarget("");
    setDescription("");
    setModalOpen(false);
    load();
  }, [title, target, description, load]);

  const setProgress = useCallback(
    async (id: string, delta: number) => {
      setItems((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, progress: Math.max(0, Math.min(100, g.progress + delta)) } : g,
        ),
      );
      const cur = items.find((g) => g.id === id);
      const next = Math.max(0, Math.min(100, (cur?.progress || 0) + delta));
      try {
        await api.updateGoal(id, { progress: next });
      } catch {
        load();
      }
    },
    [items, load],
  );

  const toggleStatus = useCallback(
    async (g: Goal) => {
      const next = g.status === "completed" ? "active" : "completed";
      await api.updateGoal(g.id, { status: next, progress: next === "completed" ? 100 : g.progress });
      load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((g) => g.id !== id));
      await api.deleteGoal(id);
    },
    [],
  );

  return (
    <View style={styles.root} testID="goals-screen">
      <ScreenHeader
        title="Goals"
        rightSlot={
          <Pressable
            style={styles.addBtn}
            onPress={() => setModalOpen(true)}
            hitSlop={10}
            testID="add-goal-button"
          >
            <Ionicons name="add" size={22} color={theme.color.brand} />
          </Pressable>
        }
      />

      {items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="trophy-outline" size={36} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>Set your first goal</Text>
          <Text style={styles.emptySub}>Track learning, fitness, projects — ORA will help.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => setModalOpen(true)} testID="empty-add-goal">
            <Text style={styles.primaryBtnText}>Add a goal</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`goal-row-${item.id}`}>
              <View style={styles.head}>
                <Pressable
                  style={styles.check}
                  onPress={() => toggleStatus(item)}
                  hitSlop={10}
                  testID={`goal-check-${item.id}`}
                >
                  <Ionicons
                    name={item.status === "completed" ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={item.status === "completed" ? theme.color.success : theme.color.brand}
                  />
                </Pressable>
                <Text
                  style={[styles.title, item.status === "completed" && styles.titleDone]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                <Pressable onPress={() => remove(item.id)} hitSlop={10} testID={`goal-delete-${item.id}`}>
                  <Ionicons name="trash-outline" size={16} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              </View>
              {!!item.target && <Text style={styles.targetText}>Target: {item.target}</Text>}
              {!!item.description && <Text style={styles.descText}>{item.description}</Text>}
              <View style={styles.progressRow}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setProgress(item.id, -10)}
                  testID={`goal-decrease-${item.id}`}
                >
                  <Ionicons name="remove" size={16} color={theme.color.onSurface} />
                </Pressable>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${item.progress}%` }]} />
                </View>
                <Text style={styles.percent}>{item.progress}%</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setProgress(item.id, 10)}
                  testID={`goal-increase-${item.id}`}
                >
                  <Ionicons name="add" size={16} color={theme.color.onSurface} />
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New goal</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Title (e.g. AWS Certification)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={title}
              onChangeText={setTitle}
              testID="goal-title-input"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Target (e.g. By Aug 31)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={target}
              onChangeText={setTarget}
              testID="goal-target-input"
            />
            <TextInput
              style={[styles.modalInput, { minHeight: 70, textAlignVertical: "top" }]}
              placeholder="Description (optional)"
              placeholderTextColor={theme.color.onSurfaceSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              testID="goal-description-input"
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setModalOpen(false)}
                testID="goal-cancel"
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={create} testID="goal-save">
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
  list: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    gap: theme.spacing.sm,
  },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  check: { width: 26, alignItems: "center" },
  title: { flex: 1, color: theme.color.onSurface, fontSize: 16, fontWeight: "500" },
  titleDone: { textDecorationLine: "line-through", color: theme.color.onSurfaceSecondary },
  targetText: { color: theme.color.brand, fontSize: 12 },
  descText: { color: theme.color.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.color.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.color.surfaceTertiary, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: theme.color.brand },
  percent: { color: theme.color.onSurface, fontSize: 12, width: 36, textAlign: "right" },
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
