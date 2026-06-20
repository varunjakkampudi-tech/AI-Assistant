import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ScrollView } from "react-native";
import { adminFetch, COLORS, fmtMoney, fmtNum, fmtDate } from "@/src/admin/api";
import { Page, Card, Section, Stat, Grid, Button, Spinner, Table, Badge, MiniBar } from "@/src/admin/ui";

type TabKey = "overview" | "providers" | "features" | "users" | "google" | "voice" | "budgets" | "keys" | "alerts" | "forecast";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "overview", label: "Executive", icon: "📊" },
  { key: "providers", label: "Providers", icon: "🏢" },
  { key: "features", label: "Features", icon: "✨" },
  { key: "users", label: "Users", icon: "👤" },
  { key: "google", label: "Google APIs", icon: "🔎" },
  { key: "voice", label: "ElevenLabs", icon: "🎙️" },
  { key: "budgets", label: "Budgets", icon: "🎯" },
  { key: "keys", label: "API Key Vault", icon: "🔐" },
  { key: "alerts", label: "Alerts", icon: "🚨" },
  { key: "forecast", label: "Forecast", icon: "📈" },
];

export default function CostIntelligence() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [days, setDays] = useState(30);

  return (
    <Page
      title="Unified Cost Intelligence"
      subtitle="Single financial control center — every provider, API, feature & user"
      actions={
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[7, 14, 30, 90].map((d) => (
            <Pressable
              key={d}
              onPress={() => setDays(d)}
              style={{
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                backgroundColor: days === d ? COLORS.brandSoft : "transparent",
                borderWidth: 1, borderColor: days === d ? COLORS.brand : COLORS.border,
              }}
              data-testid={`cost-window-${d}d`}
            >
              <Text style={{ color: days === d ? COLORS.brand : COLORS.textDim, fontSize: 12, fontWeight: "600" }}>{d}d</Text>
            </Pressable>
          ))}
        </View>
      }
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 10,
                  backgroundColor: active ? COLORS.brand : COLORS.card,
                  borderRadius: 8, borderWidth: 1,
                  borderColor: active ? COLORS.brand : COLORS.border,
                  flexDirection: "row", alignItems: "center", gap: 6,
                }}
                data-testid={`cost-tab-${t.key}`}
              >
                <Text style={{ fontSize: 13 }}>{t.icon}</Text>
                <Text style={{ color: active ? COLORS.bg : COLORS.text, fontSize: 12, fontWeight: "600" }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {tab === "overview" && <OverviewTab days={days} />}
      {tab === "providers" && <ProvidersTab days={days} />}
      {tab === "features" && <FeaturesTab days={days} />}
      {tab === "users" && <UsersTab days={days} />}
      {tab === "google" && <GoogleTab days={days} />}
      {tab === "voice" && <ElevenLabsTab days={days} />}
      {tab === "budgets" && <BudgetsTab />}
      {tab === "keys" && <KeysTab />}
      {tab === "alerts" && <AlertsTab />}
      {tab === "forecast" && <ForecastTab />}
    </Page>
  );
}

// ============================================================
function OverviewTab({ days }: { days: number }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { adminFetch(`/api/admin/intel/overview?days=${days}`).then(setData); }, [days]);
  if (!data) return <Spinner />;
  const margin = data.profit.margin_pct;
  const marginTone: any = margin > 30 ? "ok" : margin > 0 ? "warn" : "err";

  const catEntries = Object.entries(data.costs.by_category) as [string, number][];
  const drivers = data.top_cost_drivers || [];

  return (
    <>
      <Section title="Financial Pulse">
        <Grid cols={4}>
          <Stat label="Revenue (Window)" value={fmtMoney(data.revenue.window)} hint={`MRR ${fmtMoney(data.revenue.mrr)}`} />
          <Stat label="Cost (Window)" value={fmtMoney(data.costs.window)} tone="warn" hint={`Burn ${fmtMoney(data.costs.burn_rate_daily)}/day`} />
          <Stat label="Profit" value={fmtMoney(data.profit.value)} tone={marginTone} hint={`${margin}% margin`} />
          <Stat label="Runway" value={data.runway_days != null ? `${data.runway_days}d` : "∞"} hint="at current burn" />
        </Grid>
        <Grid cols={4}>
          <Stat label="MRR" value={fmtMoney(data.revenue.mrr)} />
          <Stat label="ARR" value={fmtMoney(data.revenue.arr)} />
          <Stat label="Cost This Month" value={fmtMoney(data.costs.month)} />
          <Stat label="Paying / Free" value={`${Object.entries(data.plan_distribution || {}).filter(([k]) => k !== "free").reduce((a, [, n]) => a + (n as number), 0)} / ${data.plan_distribution.free || 0}`} />
        </Grid>
      </Section>

      <Section title={`Daily Cost vs Revenue · last ${days} days`}>
        <Card>
          <View style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, backgroundColor: COLORS.brand }} />
              <Text style={{ color: COLORS.textDim, fontSize: 11 }}>Cost</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, backgroundColor: COLORS.ok }} />
              <Text style={{ color: COLORS.textDim, fontSize: 11 }}>Revenue</Text>
            </View>
          </View>
          <MiniBar values={data.series.map((d: any) => d.cost)} height={80} color={COLORS.brand} />
          <View style={{ height: 8 }} />
          <MiniBar values={data.series.map((d: any) => d.revenue)} height={40} color={COLORS.ok} />
        </Card>
      </Section>

      <Section title="Spend by Category">
        <Grid cols={3}>
          {catEntries.map(([cat, val]) => (
            <Stat key={cat} label={cat.toUpperCase()} value={fmtMoney(val)} />
          ))}
        </Grid>
      </Section>

      <Section title="Top Cost Drivers">
        <Table
          rows={drivers}
          columns={[
            { key: "provider", label: "Provider", render: (v) => <Badge label={v} kind="info" /> },
            { key: "requests", label: "Requests", width: 110 },
            { key: "tokens", label: "Tokens", width: 130 },
            { key: "users", label: "Users", width: 80 },
            { key: "cost_usd", label: "Cost", width: 120, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
          ]}
        />
      </Section>
    </>
  );
}

// ============================================================
function ProvidersTab({ days }: { days: number }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { adminFetch(`/api/admin/intel/providers?days=${days}`).then(setData); }, [days]);
  if (!data) return <Spinner />;

  return (
    <>
      {data.categories.map((cat: any) => (
        <Section key={cat.category} title={`${cat.category.toUpperCase()}  ·  ${fmtMoney(cat.cost_usd)} · ${cat.requests} requests`}>
          <Table
            rows={cat.providers}
            columns={[
              { key: "provider", label: "Provider", render: (v) => <Badge label={v} kind="info" /> },
              { key: "requests", label: "Requests", width: 110 },
              { key: "tokens", label: "Tokens", width: 120 },
              { key: "users", label: "Users", width: 80 },
              { key: "errors", label: "Errors", width: 80 },
              { key: "cost_usd", label: "Cost", width: 110, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
            ]}
          />
        </Section>
      ))}

      <Section title="All Tracked Providers">
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {data.catalog.map((p: any) => (
              <View
                key={p.provider}
                style={{
                  backgroundColor: p.tracked ? COLORS.brandSoft : COLORS.card,
                  borderColor: p.tracked ? COLORS.brand : COLORS.border,
                  borderWidth: 1, borderRadius: 6,
                  paddingHorizontal: 10, paddingVertical: 6,
                }}
              >
                <Text style={{ color: p.tracked ? COLORS.brand : COLORS.textDim, fontSize: 11, fontWeight: "600" }}>
                  {p.provider}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>
    </>
  );
}

// ============================================================
function FeaturesTab({ days }: { days: number }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { adminFetch(`/api/admin/intel/features?days=${days}`).then(setData); }, [days]);
  if (!data) return <Spinner />;
  return (
    <Section title={`Feature Profitability · ${days} days`}>
      <Table
        rows={data.items}
        columns={[
          { key: "feature", label: "Feature", render: (v) => <Badge label={v} kind="warn" /> },
          { key: "requests", label: "Requests", width: 110 },
          { key: "users", label: "Users", width: 80 },
          { key: "cost_usd", label: "Cost", width: 110, render: (v) => <Text style={{ color: COLORS.text, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
          { key: "avg_cost", label: "Avg/req", width: 110, render: (v) => <Text style={{ color: COLORS.textDim }}>{fmtMoney(v)}</Text> },
          { key: "revenue_attributed", label: "Revenue", width: 110, render: (v) => <Text style={{ color: COLORS.ok }}>{fmtMoney(v)}</Text> },
          { key: "profit", label: "Profit", width: 100, render: (v) => <Text style={{ color: v >= 0 ? COLORS.ok : COLORS.err, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
          { key: "margin_pct", label: "Margin", width: 100, render: (v) => <Badge label={`${v}%`} kind={v >= 30 ? "ok" : v >= 0 ? "warn" : "err"} /> },
        ]}
      />
    </Section>
  );
}

// ============================================================
function UsersTab({ days }: { days: number }) {
  const [data, setData] = useState<any | null>(null);
  const [sort, setSort] = useState<"cost" | "profit" | "risk">("cost");
  useEffect(() => { adminFetch(`/api/admin/intel/users/top?days=${days}&sort=${sort}&limit=50`).then(setData); }, [days, sort]);
  if (!data) return <Spinner />;
  return (
    <Section title={`User Profitability · sorted by ${sort}`} right={
      <View style={{ flexDirection: "row", gap: 6 }}>
        {(["cost", "profit", "risk"] as const).map((s) => (
          <Pressable key={s} onPress={() => setSort(s)} style={{
            paddingHorizontal: 12, paddingVertical: 6,
            backgroundColor: sort === s ? COLORS.brandSoft : "transparent",
            borderWidth: 1, borderColor: sort === s ? COLORS.brand : COLORS.border, borderRadius: 6,
          }} data-testid={`sort-${s}`}>
            <Text style={{ color: sort === s ? COLORS.brand : COLORS.textDim, fontSize: 11, fontWeight: "600" }}>{s.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
    }>
      <Table
        rows={data.items}
        columns={[
          { key: "email", label: "User" },
          { key: "plan", label: "Plan", width: 90, render: (v) => <Badge label={v || "free"} kind={v === "premium" ? "ok" : v === "pro" ? "info" : "neutral"} /> },
          { key: "requests", label: "Req", width: 70 },
          { key: "cost_usd", label: "Cost", width: 100, render: (v) => <Text style={{ color: COLORS.text, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
          { key: "revenue_window", label: "Revenue", width: 100, render: (v) => <Text style={{ color: COLORS.ok }}>{fmtMoney(v)}</Text> },
          { key: "profit", label: "Profit", width: 100, render: (v) => <Text style={{ color: v >= 0 ? COLORS.ok : COLORS.err, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
          { key: "margin_pct", label: "Margin", width: 90, render: (v) => <Text style={{ color: v >= 30 ? COLORS.ok : v >= 0 ? COLORS.warn : COLORS.err }}>{v}%</Text> },
          { key: "risk_score", label: "Risk", width: 80, render: (v) => <Badge label={`${v}`} kind={v >= 75 ? "err" : v >= 50 ? "warn" : "ok"} /> },
          { key: "power_score", label: "Power", width: 80, render: (v) => <Badge label={`${v}`} kind={v >= 75 ? "info" : "neutral"} /> },
        ]}
      />
    </Section>
  );
}

// ============================================================
function GoogleTab({ days }: { days: number }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { adminFetch(`/api/admin/intel/google?days=${days}`).then(setData); }, [days]);
  if (!data) return <Spinner />;
  return (
    <>
      <Section title="Google API Services">
        <Table
          rows={data.items}
          columns={[
            { key: "service", label: "Service" },
            { key: "requests", label: "Requests", width: 110 },
            { key: "users", label: "Users", width: 80 },
            { key: "cost_usd", label: "Cost", width: 110, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
            { key: "quota_pct", label: "Quota", width: 100, render: (v) => <Badge label={`${v}%`} kind={v >= 90 ? "err" : v >= 75 ? "warn" : "ok"} /> },
            { key: "status", label: "Status", width: 90, render: (v) => <Badge label={v} kind={v === "ok" ? "ok" : v === "warn" ? "warn" : "err"} /> },
          ]}
          empty="No Google API usage tracked yet — ORA logs Gmail, Calendar and Maps calls automatically."
        />
      </Section>
      <Section title="Google API Keys">
        <Table
          rows={data.keys}
          columns={[
            { key: "name", label: "Key Name" },
            { key: "project", label: "Project", width: 160 },
            { key: "api_key_masked", label: "Key", width: 200 },
            { key: "enabled", label: "Status", width: 100, render: (v) => <Badge label={v ? "enabled" : "disabled"} kind={v ? "ok" : "neutral"} /> },
          ]}
          empty="No Google API keys saved. Add one in the API Key Vault tab."
        />
      </Section>
    </>
  );
}

// ============================================================
function ElevenLabsTab({ days }: { days: number }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { adminFetch(`/api/admin/intel/elevenlabs?days=${days}`).then(setData); }, [days]);
  if (!data) return <Spinner />;
  return (
    <>
      <Section title="ElevenLabs · Voice Cost Tracking">
        <Grid cols={4}>
          <Stat label="Characters" value={fmtNum(data.characters)} hint={`~${data.minutes_estimated} min`} />
          <Stat label="Total Spend" value={fmtMoney(data.cost_total)} />
          <Stat label="Projected Monthly" value={fmtMoney(data.projected_monthly_cost)} tone="warn" />
          <Stat label="Budget Remaining" value={data.budget_amount ? fmtMoney(data.budget_remaining) : "No budget"} tone={data.budget_amount && data.budget_remaining < 10 ? "err" : "ok"} hint={data.budget_amount ? `of ${fmtMoney(data.budget_amount)}` : "Set one in Budgets tab"} />
        </Grid>
      </Section>
      <Section title="Daily ElevenLabs Spend">
        <Card>
          <MiniBar values={data.series.map((s: any) => s.cost)} height={80} />
        </Card>
      </Section>
      <Section title="By Voice (model)">
        <Table
          rows={data.by_voice}
          columns={[
            { key: "voice", label: "Model" },
            { key: "requests", label: "Calls", width: 100 },
            { key: "characters", label: "Characters", width: 130 },
            { key: "cost_usd", label: "Cost", width: 110, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
          ]}
        />
      </Section>
      <Section title="Top Users">
        <Table
          rows={data.by_user}
          columns={[
            { key: "user_id", label: "User ID" },
            { key: "requests", label: "Calls", width: 100 },
            { key: "characters", label: "Characters", width: 130 },
            { key: "cost_usd", label: "Cost", width: 110, render: (v) => <Text style={{ color: COLORS.brand, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
          ]}
        />
      </Section>
    </>
  );
}

// ============================================================
function BudgetsTab() {
  const [items, setItems] = useState<any[] | null>(null);
  const [scope, setScope] = useState("provider");
  const [key, setKey] = useState("");
  const [amt, setAmt] = useState("100");

  const load = async () => setItems((await adminFetch("/api/admin/intel/budgets")).items);
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await adminFetch("/api/admin/intel/budgets", {
        method: "PUT",
        body: JSON.stringify({ scope, key: key.trim(), monthly_usd: parseFloat(amt) || 0, alert_pct: [50, 75, 90, 100], enabled: true }),
      });
      setKey(""); setAmt("100");
      await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const del = async (b: any) => {
    try { await adminFetch(`/api/admin/intel/budgets/${b.scope}/${encodeURIComponent(b.key || "")}`, { method: "DELETE" }); await load(); } catch {}
  };

  if (!items) return <Spinner />;
  return (
    <>
      <Section title="Configure Budget">
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <ScopePicker value={scope} onChange={setScope} />
            <TextInput value={key} onChangeText={setKey} placeholder={scope === "global" ? "(leave empty)" : `${scope} key`} placeholderTextColor={COLORS.textFaint} style={inputStyle} data-testid="budget-key-input" />
            <TextInput value={amt} onChangeText={setAmt} keyboardType="numeric" placeholder="$ monthly" placeholderTextColor={COLORS.textFaint} style={inputStyle} data-testid="budget-amt-input" />
            <Button label="Save Budget" onPress={save} testID="budget-save-btn" />
          </View>
          <Text style={{ color: COLORS.textFaint, fontSize: 11, marginTop: 8 }}>
            Examples: provider=elevenlabs / feature=voice / user={"<user_id>"} / plan=pro / category=ai
          </Text>
        </Card>
      </Section>
      <Section title="Active Budgets">
        <Table
          rows={items}
          columns={[
            { key: "scope", label: "Scope", width: 110, render: (v) => <Badge label={v} kind="info" /> },
            { key: "key", label: "Target" },
            { key: "monthly_usd", label: "Limit", width: 110, render: (v) => <Text style={{ color: COLORS.text }}>{fmtMoney(v)}</Text> },
            { key: "spent_usd", label: "Spent", width: 110, render: (v) => <Text style={{ color: COLORS.text }}>{fmtMoney(v)}</Text> },
            { key: "spent_pct", label: "%", width: 100, render: (v) => <Badge label={`${v}%`} kind={v >= 100 ? "err" : v >= 90 ? "warn" : v >= 75 ? "warn" : "ok"} /> },
            { key: "status", label: "Status", width: 110, render: (v) => <Badge label={v} kind={v === "exceeded" ? "err" : v === "alert" ? "warn" : v === "warn" ? "warn" : "ok"} /> },
            { key: "actions", label: "", width: 100, render: (_v, row) => <Button label="Delete" kind="ghost" small onPress={() => del(row)} testID={`budget-del-${row.scope}-${row.key}`} /> },
          ]}
          empty="No budgets configured — set one above to start protecting spend."
        />
      </Section>
    </>
  );
}

function ScopePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = ["global", "provider", "feature", "user", "plan", "category"];
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {opts.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={{
          paddingHorizontal: 10, paddingVertical: 8,
          backgroundColor: value === o ? COLORS.brand : COLORS.card,
          borderWidth: 1, borderColor: value === o ? COLORS.brand : COLORS.border,
          borderRadius: 6,
        }}>
          <Text style={{ color: value === o ? COLORS.bg : COLORS.textDim, fontSize: 11, fontWeight: "600" }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ============================================================
function KeysTab() {
  const [data, setData] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [quota, setQuota] = useState("");

  const load = async () => setData(await adminFetch("/api/admin/intel/keys"));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name || !apiKey) { Alert.alert("Required", "Name & API key are required"); return; }
    try {
      await adminFetch("/api/admin/intel/keys", {
        method: "POST",
        body: JSON.stringify({ name, provider, api_key: apiKey, quota_monthly_usd: parseFloat(quota) || null, enabled: true }),
      });
      setName(""); setApiKey(""); setQuota("");
      await load();
    } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const toggle = async (k: any) => {
    try { await adminFetch(`/api/admin/intel/keys/${k.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !k.enabled }) }); await load(); } catch {}
  };

  const rotate = async (k: any) => {
    const next = prompt ? (window.prompt as any)(`New API key for ${k.name}:`) : "";
    if (!next) return;
    try { await adminFetch(`/api/admin/intel/keys/${k.id}/rotate`, { method: "POST", body: JSON.stringify({ api_key: next }) }); await load(); } catch (e: any) { Alert.alert("Failed", e?.message || ""); }
  };

  const remove = async (k: any) => {
    try { await adminFetch(`/api/admin/intel/keys/${k.id}`, { method: "DELETE" }); await load(); } catch {}
  };

  if (!data) return <Spinner />;
  return (
    <>
      <Section title="Add API Key">
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <TextInput value={name} onChangeText={setName} placeholder="Key label (e.g. Production OpenAI)" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { flex: 1, minWidth: 240 }]} data-testid="key-name-input" />
            <ProviderPicker value={provider} onChange={setProvider} providers={data.providers} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <TextInput value={apiKey} onChangeText={setApiKey} placeholder="API key (encrypted at rest)" placeholderTextColor={COLORS.textFaint} style={[inputStyle, { flex: 1, minWidth: 280 }]} secureTextEntry data-testid="key-secret-input" />
            <TextInput value={quota} onChangeText={setQuota} keyboardType="numeric" placeholder="Monthly $ quota (optional)" placeholderTextColor={COLORS.textFaint} style={inputStyle} data-testid="key-quota-input" />
            <Button label="Save Key" onPress={create} testID="key-save-btn" />
          </View>
        </Card>
      </Section>

      <Section title="Stored Keys (encrypted)">
        <Table
          rows={data.items}
          columns={[
            { key: "name", label: "Name" },
            { key: "provider", label: "Provider", width: 130, render: (v) => <Badge label={v} kind="info" /> },
            { key: "api_key_masked", label: "Key", width: 200 },
            { key: "last_used", label: "Last used", width: 160, render: (v) => <Text style={{ color: COLORS.textDim, fontSize: 11 }}>{v ? fmtDate(v) : "—"}</Text> },
            { key: "spent_month", label: "Spent (mo)", width: 110, render: (v) => <Text style={{ color: COLORS.brand }}>{fmtMoney(v)}</Text> },
            { key: "quota_pct", label: "Quota", width: 100, render: (v) => v != null ? <Badge label={`${v}%`} kind={v >= 90 ? "err" : v >= 75 ? "warn" : "ok"} /> : <Text style={{ color: COLORS.textFaint }}>—</Text> },
            { key: "health", label: "Status", width: 110, render: (v) => <Badge label={v} kind={v === "healthy" ? "ok" : v === "warning" ? "warn" : v === "critical" ? "err" : "neutral"} /> },
            {
              key: "actions", label: "", width: 220, render: (_v, row) => (
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <Button label={row.enabled ? "Disable" : "Enable"} kind="ghost" small onPress={() => toggle(row)} testID={`key-toggle-${row.id}`} />
                  <Button label="Rotate" kind="warn" small onPress={() => rotate(row)} testID={`key-rotate-${row.id}`} />
                  <Button label="Delete" kind="danger" small onPress={() => remove(row)} testID={`key-del-${row.id}`} />
                </View>
              )
            },
          ]}
          empty="No API keys stored. Save one above to start tracking spend per key."
        />
      </Section>
    </>
  );
}

function ProviderPicker({ value, onChange, providers }: { value: string; onChange: (v: string) => void; providers: string[] }) {
  return (
    <View style={[inputStyle, { paddingVertical: 0, paddingHorizontal: 0, minWidth: 200 }]}>
      <select
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        style={{ backgroundColor: "transparent", color: COLORS.text, border: "none", padding: "10px 12px", outline: "none", width: "100%" }}
        data-testid="provider-picker"
      >
        {providers.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </View>
  );
}

// ============================================================
function AlertsTab() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { adminFetch("/api/admin/intel/alerts").then((d) => setItems(d.items)); }, []);
  if (!items) return <Spinner />;
  if (items.length === 0) {
    return <Card><Text style={{ color: COLORS.textDim, textAlign: "center", padding: 24 }}>✓ All clear — no active alerts</Text></Card>;
  }
  return (
    <Section title={`Active Alerts · ${items.length}`}>
      {items.map((a, i) => (
        <Card key={i} style={{ marginBottom: 8, borderLeftWidth: 3, borderLeftColor: a.severity === "critical" ? COLORS.err : a.severity === "warning" ? COLORS.warn : COLORS.brand }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Badge label={a.severity} kind={a.severity === "critical" ? "err" : a.severity === "warning" ? "warn" : "info"} />
            <Badge label={a.type} kind="neutral" />
            <Text style={{ color: COLORS.textFaint, fontSize: 10 }}>{fmtDate(a.created_at)}</Text>
          </View>
          <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: "600", marginBottom: 4 }}>{a.title}</Text>
          <Text style={{ color: COLORS.textDim, fontSize: 12 }}>{a.detail}</Text>
        </Card>
      ))}
    </Section>
  );
}

// ============================================================
function ForecastTab() {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { adminFetch("/api/admin/intel/forecast").then(setData); }, []);
  if (!data) return <Spinner />;
  const profitTone: any = data.expected_profit_monthly > 0 ? "ok" : "err";
  return (
    <>
      <Section title="Projected Spend">
        <Grid cols={4}>
          <Stat label="Tomorrow" value={fmtMoney(data.tomorrow)} />
          <Stat label="Next 7 days" value={fmtMoney(data.weekly)} />
          <Stat label="Next 30 days" value={fmtMoney(data.monthly)} tone="warn" />
          <Stat label="Next 12 months" value={fmtMoney(data.yearly)} tone="warn" />
        </Grid>
        <Grid cols={4}>
          <Stat label="Daily Avg (7d)" value={fmtMoney(data.daily_avg_7d)} />
          <Stat label="Daily Avg (14d)" value={fmtMoney(data.daily_avg_14d)} hint={`Growth ${data.growth_rate_pct}%`} />
          <Stat label="Expected Margin" value={`${data.expected_margin_pct}%`} tone={profitTone} />
          <Stat label="Runway" value={data.runway_days ? `${data.runway_days}d` : "∞"} hint="at projected burn" />
        </Grid>
      </Section>

      <Section title="14-day Cost Trend">
        <Card>
          <MiniBar values={data.series_14d} height={80} />
        </Card>
      </Section>

      <Section title="Provider Growth · last 7d vs prior 7d">
        <Table
          rows={data.provider_growth}
          columns={[
            { key: "provider", label: "Provider", render: (v) => <Badge label={v} kind="info" /> },
            { key: "prior", label: "Prior 7d", width: 130, render: (v) => <Text style={{ color: COLORS.textDim }}>{fmtMoney(v)}</Text> },
            { key: "recent", label: "Last 7d", width: 130, render: (v) => <Text style={{ color: COLORS.text, fontWeight: "600" }}>{fmtMoney(v)}</Text> },
            { key: "growth_pct", label: "Change", width: 130, render: (v) => <Badge label={`${v > 0 ? "+" : ""}${v}%`} kind={v > 50 ? "err" : v > 0 ? "warn" : "ok"} /> },
          ]}
        />
      </Section>
    </>
  );
}

const inputStyle: any = { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, minWidth: 180 };
