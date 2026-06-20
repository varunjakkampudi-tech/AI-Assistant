import React, { ReactNode } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from "react-native";
import { COLORS, fmtNum } from "./api";

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={ui.page}>
      <View style={ui.header}>
        <View style={{ flex: 1 }}>
          <Text style={ui.headerTitle} data-testid="admin-page-title">{title}</Text>
          {subtitle ? <Text style={ui.headerSub}>{subtitle}</Text> : null}
        </View>
        {actions}
      </View>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return <View style={[ui.card, style]} {...(testID ? { "data-testid": testID } : {})}>{children}</View>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "ok" | "warn" | "err" }) {
  const toneColor = tone === "ok" ? COLORS.ok : tone === "warn" ? COLORS.warn : tone === "err" ? COLORS.err : COLORS.text;
  return (
    <View style={ui.stat}>
      <Text style={ui.statLabel}>{label}</Text>
      <Text style={[ui.statValue, { color: toneColor }]}>{value}</Text>
      {hint ? <Text style={ui.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function Grid({ children, cols = 4, gap = 12 }: { children: ReactNode; cols?: number; gap?: number }) {
  // crude flex grid that wraps. Children take 1/cols width minus gap.
  const arr = React.Children.toArray(children);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap, marginBottom: 16 }}>
      {arr.map((c, i) => (
        <View key={i} style={{ flexBasis: `calc((100% - ${(cols - 1) * gap}px) / ${cols})` as any, minWidth: 200, flexGrow: 1 } as ViewStyle}>{c as any}</View>
      ))}
    </View>
  );
}

export function Button({ label, onPress, kind = "primary", disabled, testID, small }: { label: string; onPress: () => void; kind?: "primary" | "ghost" | "danger" | "warn"; disabled?: boolean; testID?: string; small?: boolean }) {
  const map: any = {
    primary: { bg: COLORS.brand, fg: COLORS.bg, border: COLORS.brand },
    ghost: { bg: "transparent", fg: COLORS.text, border: COLORS.border },
    danger: { bg: COLORS.err, fg: "#fff", border: COLORS.err },
    warn: { bg: COLORS.warn, fg: COLORS.bg, border: COLORS.warn },
  };
  const t = map[kind];
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[{ backgroundColor: t.bg, borderColor: t.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: small ? 10 : 14, paddingVertical: small ? 6 : 10, opacity: disabled ? 0.5 : 1, alignItems: "center", justifyContent: "center" }]}
      {...(testID ? { "data-testid": testID } : {})}
    >
      <Text style={{ color: t.fg, fontSize: small ? 12 : 13, fontWeight: "600", letterSpacing: 0.5 }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, kind = "neutral" }: { label: string; kind?: "neutral" | "ok" | "warn" | "err" | "info" }) {
  const map: any = {
    neutral: { bg: "#23232a", fg: COLORS.textDim },
    ok: { bg: "#1d3a2a", fg: "#8cd0a4" },
    warn: { bg: "#3a2c14", fg: COLORS.brand },
    err: { bg: "#3a1c1c", fg: "#e08080" },
    info: { bg: "#1c2538", fg: "#7ea4ff" },
  };
  const t = map[kind];
  return <View style={{ backgroundColor: t.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" }}><Text style={{ color: t.fg, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 }}>{label.toUpperCase()}</Text></View>;
}

export function Spinner() {
  return <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={COLORS.brand} /></View>;
}

export function ErrorText({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <Text style={{ color: COLORS.err, marginBottom: 8 }}>{msg}</Text>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <Text style={ui.sectionTitle}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

export function Table({ columns, rows, empty = "No data" }: { columns: { key: string; label: string; width?: number; render?: (v: any, row: any) => ReactNode }[]; rows: any[]; empty?: string }) {
  if (!rows || rows.length === 0) {
    return <Card><Text style={{ color: COLORS.textDim, textAlign: "center", padding: 24 }}>{empty}</Text></Card>;
  }
  return (
    <Card style={{ padding: 0 }}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingHorizontal: 16, paddingVertical: 10 }}>
        {columns.map((c) => (
          <Text key={c.key} style={{ flex: c.width ? undefined : 1, width: c.width, color: COLORS.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontWeight: "700" }}>{c.label}</Text>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={row.id || row.key || i} style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: "#1a1a1f" }}>
          {columns.map((c) => (
            <View key={c.key} style={{ flex: c.width ? undefined : 1, width: c.width, justifyContent: "center" }}>
              {c.render ? c.render(row[c.key], row) : <Text style={{ color: COLORS.text, fontSize: 13 }}>{row[c.key] != null ? String(row[c.key]) : "—"}</Text>}
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

export function MiniBar({ values, height = 60, color = COLORS.brand }: { values: number[]; height?: number; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height }}>
      {values.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(2, (v / max) * height), backgroundColor: color, opacity: 0.85, borderRadius: 2 }} />
      ))}
    </View>
  );
}

const ui = StyleSheet.create({
  page: { padding: 24, paddingBottom: 80 },
  header: { flexDirection: "row", alignItems: "flex-end", marginBottom: 28, gap: 16 },
  headerTitle: { color: COLORS.text, fontSize: 26, fontWeight: "600" },
  headerSub: { color: COLORS.textDim, fontSize: 13, marginTop: 4 },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  stat: { padding: 16, backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12 },
  statLabel: { color: COLORS.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, fontWeight: "600" },
  statValue: { fontSize: 26, fontWeight: "600", color: COLORS.text },
  statHint: { color: COLORS.textFaint, fontSize: 11, marginTop: 6 },
  sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: "600" },
});

export { fmtNum };
