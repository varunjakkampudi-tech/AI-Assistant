import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface FamilyResponse {
  family_members: Array<{ name: string; relationship: string; last_contact?: string; interaction_count?: number }>;
  important_dates: Array<{ subject: string; content: string; category: string; importance?: number }>;
  all_contacts_count: number;
}

export default function FamilyScreen() {
  const [data, setData] = useState<FamilyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.family());
    } catch (e) { console.warn("family", e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Family Hub" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 64 }} />
        ) : !data ? null : (
          <>
            <View style={styles.heroCard}>
              <Ionicons name="heart" size={20} color={theme.color.brand} />
              <Text style={styles.heroTitle}>People who matter</Text>
              <Text style={styles.heroSub}>
                Auto-detected from your chats with ORA ("my mom", "my brother", "wife"…). Tell ORA about important dates and they appear below.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Family members ({data.family_members.length})</Text>
              {data.family_members.length === 0 ? (
                <Text style={styles.empty}>
                  Tell ORA "My mom's name is Asha" or "My wife is Priya" in chat — they'll appear here.
                </Text>
              ) : (
                data.family_members.map((p) => (
                  <View key={p.name} style={styles.row} testID={`family-${p.name}`}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{(p.name || "?").slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{p.name}</Text>
                      <Text style={styles.meta}>{p.relationship} · {p.interaction_count ?? 0} interactions</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Important dates ({data.important_dates.length})</Text>
              {data.important_dates.length === 0 ? (
                <Text style={styles.empty}>
                  Add dates by chatting: "Mom's birthday is March 12" or "Anniversary on June 6". ORA auto-extracts and saves.
                </Text>
              ) : (
                data.important_dates.map((d, i) => (
                  <View key={i} style={styles.row} testID={`date-${i}`}>
                    <View style={[styles.avatar, { backgroundColor: theme.color.brandTertiary }]}>
                      <Ionicons name="calendar" size={16} color={theme.color.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{d.subject}</Text>
                      <Text style={styles.meta} numberOfLines={3}>{d.content}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  heroCard: {
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.brandSecondary,
  },
  heroTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 18 },
  heroSub: { color: theme.color.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  section: { gap: theme.spacing.sm },
  sectionTitle: { color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 },
  row: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.color.brand,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 16 },
  name: { color: theme.color.onSurface, fontSize: 14, fontWeight: "500" },
  meta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  empty: { color: theme.color.onSurfaceSecondary, fontSize: 12, fontStyle: "italic", padding: theme.spacing.md },
});
