import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
  Linking,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as DocumentPicker from "expo-document-picker";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

const STAGES = ["discovered", "shortlisted", "applied", "assessment", "interview", "offer", "rejected", "withdrawn"];
const NEXT_STAGE: Record<string, string> = {
  discovered: "shortlisted", shortlisted: "applied", applied: "assessment",
  assessment: "interview", interview: "offer",
};

interface Job {
  id: string;
  source: string;
  source_url?: string | null;
  title: string;
  company: string;
  location: string;
  raw_text: string;
  match_score?: number | null;
  match_breakdown?: {
    strengths?: string[]; gaps?: string[]; recommendation?: string; rationale?: string;
  };
  created_at: string;
  application?: { stage: string; notes?: string } | null;
}

interface Pipeline {
  by_stage: Record<string, number>;
  metrics: { applications: number; interviews: number; offers: number; response_rate_pct: number };
}

type Tab = "discover" | "pipeline" | "profile";

function scoreColor(s?: number | null): string {
  if (s == null) return theme.color.onSurfaceSecondary;
  if (s >= 85) return "#22c55e";
  if (s >= 70) return "#facc15";
  if (s >= 50) return "#fb923c";
  return "#ef4444";
}

export default function CareerScreen() {
  const [tab, setTab] = useState<Tab>("discover");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any | null>(null);

  const [showIngest, setShowIngest] = useState(false);
  const [showJob, setShowJob] = useState<Job | null>(null);

  const load = useCallback(async () => {
    try {
      const [j, p, pr, ss] = await Promise.all([
        api.careerJobsList(),
        api.careerPipeline(),
        api.careerProfileGet(),
        api.careerSyncStatus().catch(() => null),
      ]);
      setJobs(Array.isArray(j) ? j : []);
      setPipeline(p);
      setProfile(pr);
      setSyncStatus(ss);
    } catch (e) { console.warn("career load", e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onSync = async () => {
    setSyncing(true);
    try {
      const r = await api.careerSync(true, 25);
      Alert.alert("Sync done", `Pulled ${r.new_jobs} new jobs from ${r.boards_checked} boards. Scored ${r.scored}.`);
      await load();
    } catch (e: any) {
      Alert.alert("Sync failed", e?.message || "");
    } finally { setSyncing(false); }
  };

  const updateStage = async (jobId: string, stage: string) => {
    try { await api.careerApplicationSet(jobId, stage); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || ""); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Career Copilot"
        rightSlot={
          <Pressable style={styles.headerBtn} onPress={() => setShowIngest(true)} testID="career-ingest-btn">
            <Ionicons name="add" size={20} color={theme.color.onSurface} />
          </Pressable>
        }
      />

      {/* Tabs */}
      <View style={styles.tabs}>
        {(["discover", "pipeline", "profile"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
            testID={`career-tab-${t}`}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 64 }} />
        ) : tab === "discover" ? (
          <DiscoverView
            jobs={jobs}
            onOpen={setShowJob}
            onSync={onSync}
            syncing={syncing}
            syncStatus={syncStatus}
          />
        ) : tab === "pipeline" ? (
          <PipelineView pipeline={pipeline} jobs={jobs} onOpen={setShowJob} onAdvance={updateStage} />
        ) : (
          <ProfileView profile={profile} onChange={async (u) => { const np = await api.careerProfilePut(u); setProfile(np); }} />
        )}
      </ScrollView>

      {/* Ingest modal */}
      <IngestModal
        visible={showIngest}
        onClose={() => setShowIngest(false)}
        onCreated={async () => { setShowIngest(false); await load(); }}
      />

      {/* Job detail modal */}
      {showJob && (
        <JobDetailModal
          job={showJob}
          onClose={() => setShowJob(null)}
          onChanged={load}
        />
      )}
    </View>
  );
}

// =========================================================================
// Discover tab
// =========================================================================
function DiscoverView({ jobs, onOpen, onSync, syncing, syncStatus }: {
  jobs: Job[]; onOpen: (j: Job) => void; onSync: () => void; syncing: boolean; syncStatus: any;
}) {
  const sorted = useMemo(() => [...jobs].sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1)), [jobs]);
  const [applying, setApplying] = useState<string | null>(null);

  const applyToJob = async (job: Job, e: any) => {
    e?.stopPropagation?.();
    setApplying(job.id);
    try {
      const r = await api.careerJobApply(job.id);
      if (r.apply_url) {
        Alert.alert(
          "Applied! 🚀",
          "ORA generated your tailored resume and cover letter. Opening the original posting so you can complete the submission.",
          [
            { text: "OK", onPress: () => Linking.openURL(r.apply_url) },
          ],
        );
      } else {
        Alert.alert("Applied! 🚀", "Tailored resume + cover letter generated. Open the job from the list to copy them.");
      }
    } catch (err: any) {
      Alert.alert("Couldn't apply", err?.message || "");
    } finally { setApplying(null); }
  };

  return (
    <>
      <View style={styles.syncCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.syncTitle}>Hourly job radar</Text>
          <Text style={styles.syncSub}>
            {syncStatus?.last_run_at
              ? `Last sync ${new Date(syncStatus.last_run_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · ${syncStatus.new_jobs ?? 0} new`
              : "Pulls jobs from Greenhouse + Lever public boards. Add company slugs in Profile → Boards."}
          </Text>
        </View>
        <Pressable
          style={[styles.syncBtn, syncing && { opacity: 0.5 }]}
          onPress={onSync}
          disabled={syncing}
          testID="career-sync-btn"
        >
          {syncing ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : (
            <Text style={styles.syncBtnText}>Sync now</Text>
          )}
        </Pressable>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="briefcase-outline" size={36} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>No jobs yet</Text>
          <Text style={styles.emptyText}>
            Tap + to paste a LinkedIn/Naukri URL or JD text. Or sync the boards above.
          </Text>
        </View>
      ) : (
        sorted.map((j) => (
          <Pressable
            key={j.id}
            style={styles.jobCard}
            onPress={() => onOpen(j)}
            testID={`career-job-${j.id}`}
          >
            <View style={[styles.scoreBubble, { borderColor: scoreColor(j.match_score) }]}>
              <Text style={[styles.scoreText, { color: scoreColor(j.match_score) }]}>
                {j.match_score ?? "—"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.jobTitle} numberOfLines={2}>{j.title}</Text>
              <Text style={styles.jobCompany}>{j.company} · {j.location || "—"}</Text>
              {!!j.match_breakdown?.rationale && (
                <Text style={styles.jobRationale} numberOfLines={2}>{j.match_breakdown.rationale}</Text>
              )}
              <View style={styles.jobMetaRow}>
                <Text style={styles.jobMeta}>{j.source}</Text>
                {j.application && (
                  <View style={styles.stagePill}>
                    <Text style={styles.stagePillText}>{j.application.stage}</Text>
                  </View>
                )}
                {!j.application && (
                  <Pressable
                    style={[styles.applyBtn, applying === j.id && { opacity: 0.55 }]}
                    onPress={(e) => applyToJob(j, e)}
                    disabled={applying === j.id}
                    testID={`career-apply-${j.id}`}
                  >
                    {applying === j.id ? (
                      <ActivityIndicator size="small" color={theme.color.onBrand} />
                    ) : (
                      <>
                        <Ionicons name="flash" size={11} color={theme.color.onBrand} />
                        <Text style={styles.applyBtnText}>Apply</Text>
                      </>
                    )}
                  </Pressable>
                )}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        ))
      )}
    </>
  );
}

// =========================================================================
// Pipeline tab
// =========================================================================
function PipelineView({ pipeline, jobs, onOpen, onAdvance }: {
  pipeline: Pipeline | null; jobs: Job[];
  onOpen: (j: Job) => void; onAdvance: (id: string, stage: string) => void;
}) {
  const grouped: Record<string, Job[]> = {};
  for (const s of STAGES) grouped[s] = [];
  for (const j of jobs) {
    const s = j.application?.stage || "discovered";
    grouped[s].push(j);
  }
  return (
    <>
      {pipeline && (
        <View style={styles.metricsRow}>
          <View style={styles.metricBox}><Text style={styles.metricN}>{pipeline.metrics.applications}</Text><Text style={styles.metricL}>Applied</Text></View>
          <View style={styles.metricBox}><Text style={styles.metricN}>{pipeline.metrics.interviews}</Text><Text style={styles.metricL}>Interviews</Text></View>
          <View style={styles.metricBox}><Text style={[styles.metricN, { color: theme.color.brand }]}>{pipeline.metrics.offers}</Text><Text style={styles.metricL}>Offers</Text></View>
          <View style={styles.metricBox}><Text style={styles.metricN}>{pipeline.metrics.response_rate_pct}%</Text><Text style={styles.metricL}>Resp rate</Text></View>
        </View>
      )}

      {STAGES.map((stage) => (
        <View key={stage} style={styles.stageBlock}>
          <Text style={styles.stageHead}>{stage} ({grouped[stage].length})</Text>
          {grouped[stage].length === 0 ? (
            <Text style={styles.stageEmpty}>—</Text>
          ) : (
            grouped[stage].map((j) => (
              <View key={j.id} style={styles.pipeRow} testID={`pipe-row-${j.id}`}>
                <Pressable style={{ flex: 1 }} onPress={() => onOpen(j)}>
                  <Text style={styles.pipeTitle} numberOfLines={1}>{j.title}</Text>
                  <Text style={styles.pipeMeta} numberOfLines={1}>{j.company} · score {j.match_score ?? "—"}</Text>
                </Pressable>
                {NEXT_STAGE[stage] && (
                  <Pressable
                    style={styles.advanceBtn}
                    onPress={() => onAdvance(j.id, NEXT_STAGE[stage])}
                    testID={`advance-${j.id}`}
                  >
                    <Text style={styles.advanceText}>→ {NEXT_STAGE[stage]}</Text>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </View>
      ))}
    </>
  );
}

// =========================================================================
// Profile tab
// =========================================================================
function ProfileView({ profile, onChange }: {
  profile: any; onChange: (updates: Record<string, any>) => Promise<void>;
}) {
  const [name, setName] = useState(profile?.name || "");
  const [headline, setHeadline] = useState(profile?.headline || "");
  const [summary, setSummary] = useState(profile?.summary || "");
  const [skills, setSkills] = useState((profile?.skills || []).join(", "));
  const [certs, setCerts] = useState((profile?.certifications || []).join(", "));
  const [titles, setTitles] = useState((profile?.filters?.titles || []).join(", "));
  const [locations, setLocations] = useState((profile?.filters?.locations || []).join(", "));
  const [years, setYears] = useState(String(profile?.years_experience || ""));
  const [location, setLocation] = useState(profile?.location || "");
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [autoApply, setAutoApply] = useState<boolean>(!!profile?.auto_apply_enabled);
  const [minScore, setMinScore] = useState<string>(String(profile?.auto_apply_min_score ?? 75));
  const [autoBusy, setAutoBusy] = useState(false);
  const resumeFile = profile?.resume_filename;
  const resumeWhen = profile?.resume_uploaded_at;

  const pickResume = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "text/plain",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (r.canceled || !r.assets?.length) return;
      const f = r.assets[0];
      setParsing(true);
      const res = await api.careerParseResume(
        f.uri,
        f.name || "resume.pdf",
        f.mimeType || "application/pdf",
      );
      const np = res.profile;
      // Hydrate UI fields with extracted data
      setName(np?.name || name);
      setHeadline(np?.headline || headline);
      setSummary(np?.summary || summary);
      setLocation(np?.location || location);
      setYears(String(np?.years_experience || years));
      setSkills((np?.skills || []).join(", "));
      setCerts((np?.certifications || []).join(", "));
      Alert.alert(
        "Resume parsed",
        `Auto-filled: ${(res.extracted_fields || []).join(", ")}\n\nReview and tap “Save profile”.`,
      );
    } catch (e: any) {
      Alert.alert("Couldn't parse", e?.message || "");
    } finally { setParsing(false); }
  };

  const toggleAutoApply = async (next: boolean) => {
    setAutoBusy(true);
    try {
      await api.careerAutoApplyToggle(next, parseInt(minScore, 10) || 75);
      setAutoApply(next);
    } catch (e: any) {
      Alert.alert("Couldn't update", e?.message || "");
    } finally { setAutoBusy(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onChange({
        name: name.trim(),
        headline: headline.trim(),
        summary: summary.trim(),
        location: location.trim(),
        years_experience: parseInt(years, 10) || 0,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        certifications: certs.split(",").map((s) => s.trim()).filter(Boolean),
        filters: {
          ...(profile?.filters || {}),
          titles: titles.split(",").map((s) => s.trim()).filter(Boolean),
          locations: locations.split(",").map((s) => s.trim()).filter(Boolean),
        },
        auto_apply_min_score: parseInt(minScore, 10) || 75,
      });
      Alert.alert("Saved", "Resume profile updated.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || "");
    } finally { setSaving(false); }
  };

  if (!profile) return null;
  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* Resume upload card */}
      <View style={styles.resumeCard} testID="career-resume-card">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
          <Ionicons name="document-attach" size={26} color={theme.color.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.resumeTitle}>Upload résumé</Text>
            <Text style={styles.resumeSub} numberOfLines={1}>
              {resumeFile
                ? `Last: ${resumeFile}${resumeWhen ? ` · ${new Date(resumeWhen).toLocaleDateString()}` : ""}`
                : "PDF · DOCX · TXT. We extract name, skills, experience and more."}
            </Text>
          </View>
          <Pressable
            style={[styles.uploadBtn, parsing && { opacity: 0.6 }]}
            onPress={pickResume}
            disabled={parsing}
            testID="career-upload-resume"
          >
            {parsing ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : (
              <>
                <Ionicons name="cloud-upload-outline" size={14} color={theme.color.onBrand} />
                <Text style={styles.uploadText}>{resumeFile ? "Replace" : "Upload"}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {/* Auto-apply card */}
      <View style={styles.autoCard} testID="career-auto-apply-card">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
          <Ionicons name="flash" size={22} color={theme.color.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.resumeTitle}>One-click & auto-apply</Text>
            <Text style={styles.resumeSub}>
              Tap “Apply” on the Discover tab and ORA generates a tailored resume + cover letter and marks the job as applied.
              Toggle this on to apply automatically when a match scores above your threshold.
            </Text>
          </View>
          <Switch
            value={autoApply}
            onValueChange={toggleAutoApply}
            disabled={autoBusy}
            trackColor={{ false: theme.color.surfaceTertiary, true: theme.color.brand }}
            thumbColor={autoApply ? theme.color.onBrand : "#888"}
            testID="career-auto-apply-toggle"
          />
        </View>
        {autoApply && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Text style={styles.fieldLabel}>Min match score</Text>
            <TextInput
              style={[styles.field, { width: 70, paddingVertical: 6, textAlign: "center" }]}
              value={minScore}
              onChangeText={(v) => setMinScore(v.replace(/[^0-9]/g, "").slice(0, 3))}
              keyboardType="number-pad"
              testID="career-auto-min-score"
            />
            <Pressable
              style={styles.miniBtn}
              onPress={() => toggleAutoApply(true)}
              testID="career-auto-min-save"
            >
              <Text style={styles.miniBtnText}>Save</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Field label="Name" value={name} onChangeText={setName} testID="career-name" />
      <Field label="Headline" value={headline} onChangeText={setHeadline} testID="career-headline" />
      <Field label="Summary" value={summary} onChangeText={setSummary} multiline testID="career-summary" />
      <View style={{ flexDirection: "row", gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}><Field label="Years exp" value={years} onChangeText={setYears} keyboardType="number-pad" testID="career-years" /></View>
        <View style={{ flex: 2 }}><Field label="Location" value={location} onChangeText={setLocation} testID="career-location" /></View>
      </View>
      <Field label="Skills (comma-separated)" value={skills} onChangeText={setSkills} multiline testID="career-skills" />
      <Field label="Certifications (comma-separated)" value={certs} onChangeText={setCerts} multiline testID="career-certs" />

      <Text style={styles.sectionLabel}>Job radar filters</Text>
      <Field label="Titles to match (e.g. DevOps, AWS, SRE)" value={titles} onChangeText={setTitles} testID="career-titles" />
      <Field label="Locations (e.g. Hyderabad, Remote, Bangalore)" value={locations} onChangeText={setLocations} testID="career-locations" />

      <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="career-save">
        {saving ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.saveText}>Save profile</Text>}
      </Pressable>
    </View>
  );
}

function Field({ label, ...rest }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.field, rest.multiline && { minHeight: 70 }]}
        placeholderTextColor={theme.color.onSurfaceSecondary}
        {...rest}
      />
    </View>
  );
}

// =========================================================================
// Ingest modal
// =========================================================================
function IngestModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async () => {
    setWorking(true);
    try {
      if (mode === "url") {
        if (!url.trim()) { Alert.alert("Paste a URL first"); setWorking(false); return; }
        await api.careerJobIngestUrl(url.trim());
      } else {
        if (!title.trim() || !text.trim()) { Alert.alert("Title and JD text are required"); setWorking(false); return; }
        await api.careerJobManual({ title, company, location: "", raw_text: text });
      }
      setUrl(""); setTitle(""); setCompany(""); setText("");
      onCreated();
    } catch (e: any) {
      Alert.alert("Couldn't add", e?.message || "");
    } finally { setWorking(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Add a job</Text>
            <Pressable onPress={onClose}><Ionicons name="close" size={22} color={theme.color.onSurface} /></Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable style={[styles.tab, mode === "url" && styles.tabActive]} onPress={() => setMode("url")}>
              <Text style={[styles.tabText, mode === "url" && styles.tabTextActive]}>From URL</Text>
            </Pressable>
            <Pressable style={[styles.tab, mode === "text" && styles.tabActive]} onPress={() => setMode("text")}>
              <Text style={[styles.tabText, mode === "text" && styles.tabTextActive]}>Paste JD text</Text>
            </Pressable>
          </View>

          {mode === "url" ? (
            <>
              <Field label="Job posting URL" value={url} onChangeText={setUrl} placeholder="LinkedIn / Naukri / company page" autoCapitalize="none" testID="ingest-url" />
              <Text style={styles.help}>ORA fetches and parses the JD, then scores it against your resume.</Text>
            </>
          ) : (
            <>
              <Field label="Title" value={title} onChangeText={setTitle} testID="ingest-title" />
              <Field label="Company" value={company} onChangeText={setCompany} testID="ingest-company" />
              <Field label="Full JD text" value={text} onChangeText={setText} multiline testID="ingest-text" />
            </>
          )}

          <Pressable
            style={[styles.saveBtn, working && { opacity: 0.6 }]}
            onPress={submit}
            disabled={working}
            testID="ingest-submit"
          >
            {working ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.saveText}>Add &amp; score</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// =========================================================================
// Job detail modal — score, tailored resume, cover letter, interview kit
// =========================================================================
function JobDetailModal({ job, onClose, onChanged }: { job: Job; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Record<string, any>>({});

  const loadArtifact = async (kind: string) => {
    try {
      const a = await api.careerArtifact(job.id, kind);
      setArtifacts((s) => ({ ...s, [kind]: a }));
    } catch { /* not generated yet */ }
  };

  React.useEffect(() => {
    ["resume", "cover_letter", "interview_kit"].forEach(loadArtifact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  const generate = async (kind: "resume" | "cover_letter" | "interview_kit") => {
    setBusy(kind);
    try {
      const a = await api.careerGenerate(job.id, kind);
      setArtifacts((s) => ({ ...s, [kind]: a }));
    } catch (e: any) {
      Alert.alert("Generation failed", e?.message || "");
    } finally { setBusy(null); }
  };

  const rescore = async () => {
    setBusy("score");
    try { await api.careerJobRescore(job.id); await onChanged(); }
    catch (e: any) { Alert.alert("Rescore failed", e?.message || ""); }
    finally { setBusy(null); }
  };

  const setStage = async (stage: string) => {
    try { await api.careerApplicationSet(job.id, stage); await onChanged(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || ""); }
  };

  const remove = async () => {
    Alert.alert("Delete job?", "This removes the JD + tailored artifacts.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { await api.careerJobDelete(job.id); await onChanged(); onClose(); } },
    ]);
  };

  const resume = artifacts.resume?.payload;
  const cover = artifacts.cover_letter?.payload;
  const kit = artifacts.interview_kit?.payload;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.color.surface }]}>
        <View style={styles.detailHead}>
          <Pressable onPress={onClose}><Ionicons name="chevron-back" size={24} color={theme.color.onSurface} /></Pressable>
          <Text style={styles.detailTitle} numberOfLines={1}>{job.title}</Text>
          <Pressable onPress={remove}><Ionicons name="trash-outline" size={20} color={theme.color.onSurfaceSecondary} /></Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.detailMeta}>{job.company} · {job.location || "—"}</Text>
          {!!job.source_url && (
            <Pressable onPress={() => Linking.openURL(job.source_url!)} testID="open-jd-link">
              <Text style={styles.link}>Open original posting →</Text>
            </Pressable>
          )}

          {/* Score block */}
          <View style={styles.scoreBlock}>
            <View style={[styles.bigScore, { borderColor: scoreColor(job.match_score) }]}>
              <Text style={[styles.bigScoreText, { color: scoreColor(job.match_score) }]}>{job.match_score ?? "—"}</Text>
              <Text style={styles.bigScoreLbl}>match</Text>
            </View>
            <View style={{ flex: 1 }}>
              {!!job.match_breakdown?.recommendation && (
                <Text style={styles.recText}>
                  ORA says: <Text style={{ color: theme.color.brand, fontWeight: "700" }}>{job.match_breakdown.recommendation.toUpperCase()}</Text>
                </Text>
              )}
              {!!job.match_breakdown?.rationale && (
                <Text style={styles.rationale}>{job.match_breakdown.rationale}</Text>
              )}
              <Pressable style={styles.rescoreBtn} onPress={rescore} disabled={busy === "score"} testID="rescore-btn">
                {busy === "score" ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : <Text style={styles.rescoreText}>Rescore</Text>}
              </Pressable>
            </View>
          </View>

          {/* Strengths / gaps */}
          {(job.match_breakdown?.strengths?.length ?? 0) > 0 && (
            <View>
              <Text style={[styles.sectionLabel, { color: "#22c55e" }]}>Strengths</Text>
              {job.match_breakdown!.strengths!.map((s, i) => <Text key={i} style={styles.bullet}>✓ {s}</Text>)}
            </View>
          )}
          {(job.match_breakdown?.gaps?.length ?? 0) > 0 && (
            <View>
              <Text style={[styles.sectionLabel, { color: "#ef4444" }]}>Gaps</Text>
              {job.match_breakdown!.gaps!.map((s, i) => <Text key={i} style={styles.bullet}>• {s}</Text>)}
            </View>
          )}

          {/* Stage chips */}
          <Text style={styles.sectionLabel}>Pipeline stage</Text>
          <View style={styles.stageRow}>
            {STAGES.map((s) => (
              <Pressable
                key={s}
                style={[styles.stageChip, job.application?.stage === s && styles.stageChipActive]}
                onPress={() => setStage(s)}
                testID={`stage-${s}`}
              >
                <Text style={[styles.stageChipText, job.application?.stage === s && { color: theme.color.onBrand }]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          {/* Generators */}
          {[
            { kind: "resume" as const, label: "Tailored resume", icon: "document-text", data: resume },
            { kind: "cover_letter" as const, label: "Cover letter", icon: "mail", data: cover },
            { kind: "interview_kit" as const, label: "Interview prep kit", icon: "school", data: kit },
          ].map(({ kind, label, icon, data }) => (
            <View key={kind} style={styles.artCard}>
              <View style={styles.artHead}>
                <Ionicons name={icon as any} size={18} color={theme.color.brand} />
                <Text style={styles.artTitle}>{label}</Text>
                <Pressable
                  style={[styles.genBtn, busy === kind && { opacity: 0.6 }]}
                  onPress={() => generate(kind)}
                  disabled={busy === kind}
                  testID={`gen-${kind}`}
                >
                  {busy === kind ? <ActivityIndicator color={theme.color.onBrand} size="small" /> : (
                    <Text style={styles.genText}>{data ? "Regenerate" : "Generate"}</Text>
                  )}
                </Pressable>
              </View>
              {data && (
                <View style={{ marginTop: theme.spacing.sm, gap: 6 }}>
                  {kind === "resume" && (
                    <>
                      {!!data.summary && <Text style={styles.artBody}>{data.summary}</Text>}
                      {Array.isArray(data.top_skills) && <Text style={styles.artBody}>🛠 {data.top_skills.join(" · ")}</Text>}
                      {Array.isArray(data.experience_bullets) && data.experience_bullets.map((b: string, i: number) => (
                        <Text key={i} style={styles.bullet}>• {b}</Text>
                      ))}
                    </>
                  )}
                  {kind === "cover_letter" && (
                    <>
                      {!!data.subject && <Text style={styles.artSubject}>Subject: {data.subject}</Text>}
                      {!!data.body && <Text style={styles.artBody}>{data.body}</Text>}
                    </>
                  )}
                  {kind === "interview_kit" && (
                    <>
                      <Text style={styles.subSection}>Topics to revise</Text>
                      <Text style={styles.bullet}>{(data.topics_to_revise || []).join(" · ")}</Text>
                      {[["Technical", data.technical], ["Scenarios", data.scenario], ["Managerial", data.managerial]].map(([label, arr]: any) => (
                        <View key={label} style={{ marginTop: theme.spacing.sm }}>
                          <Text style={styles.subSection}>{label} ({(arr || []).length})</Text>
                          {(arr || []).slice(0, 5).map((q: any, i: number) => (
                            <View key={i} style={{ marginVertical: 4 }}>
                              <Text style={styles.qText}>Q. {q.q}</Text>
                              <Text style={styles.aText}>A. {q.a}</Text>
                            </View>
                          ))}
                          {(arr || []).length > 5 && <Text style={styles.more}>+ {(arr || []).length - 5} more...</Text>}
                        </View>
                      ))}
                    </>
                  )}
                </View>
              )}
            </View>
          ))}

          {/* JD raw */}
          <Text style={styles.sectionLabel}>Job description</Text>
          <Text style={styles.rawJd}>{job.raw_text}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// =========================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  tabs: {
    flexDirection: "row", gap: 4,
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md,
  },
  tab: {
    flex: 1, paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
  },
  tabActive: { backgroundColor: theme.color.brand },
  tabText: { color: theme.color.onSurface, fontSize: 12, textTransform: "capitalize", fontWeight: "500" },
  tabTextActive: { color: theme.color.onBrand, fontWeight: "700" },

  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg },
  sectionLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 },

  syncCard: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.color.brandTertiary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.brandSecondary,
  },
  syncTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  syncSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  syncBtn: {
    paddingHorizontal: theme.spacing.md, paddingVertical: 8,
    borderRadius: theme.radius.pill, backgroundColor: theme.color.brand, minWidth: 84, alignItems: "center",
  },
  syncBtnText: { color: theme.color.onBrand, fontWeight: "600", fontSize: 12 },

  jobCard: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  scoreBubble: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, alignItems: "center", justifyContent: "center",
  },
  scoreText: { fontFamily: theme.font.display, fontSize: 16, fontWeight: "700" },
  jobTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  jobCompany: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  jobRationale: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 6, fontStyle: "italic" },
  jobMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: theme.spacing.sm },
  jobMeta: { color: theme.color.onSurfaceSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  stagePill: { backgroundColor: theme.color.brand, paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  stagePillText: { color: theme.color.onBrand, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  applyBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: theme.color.brand,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  applyBtnText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  resumeCard: {
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.lg, padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.brandSecondary,
  },
  resumeTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  resumeSub: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  uploadBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: theme.color.brand,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill,
  },
  uploadText: { color: theme.color.onBrand, fontSize: 12, fontWeight: "700" },
  autoCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg, padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  miniBtn: {
    backgroundColor: theme.color.brand, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  miniBtnText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "700" },

  metricsRow: { flexDirection: "row", gap: theme.spacing.sm },
  metricBox: {
    flex: 1, alignItems: "center", padding: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  metricN: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 20 },
  metricL: { color: theme.color.onSurfaceSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginTop: 2 },

  stageBlock: { gap: 6 },
  stageHead: { color: theme.color.onSurface, fontSize: 13, fontWeight: "600", textTransform: "capitalize" },
  stageEmpty: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontStyle: "italic" },
  pipeRow: {
    flexDirection: "row", gap: theme.spacing.sm, alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
  },
  pipeTitle: { color: theme.color.onSurface, fontSize: 13, fontWeight: "500" },
  pipeMeta: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  advanceBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand },
  advanceText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "600" },

  fieldLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  field: {
    backgroundColor: theme.color.surfaceSecondary, color: theme.color.onSurface,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md, fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  saveBtn: {
    backgroundColor: theme.color.brand, paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill, alignItems: "center", marginTop: theme.spacing.md,
  },
  saveText: { color: theme.color.onBrand, fontWeight: "700" },

  empty: { alignItems: "center", paddingTop: theme.spacing.xxxl, gap: theme.spacing.sm },
  emptyTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "500" },
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 12, textAlign: "center", paddingHorizontal: 24 },

  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.color.surface, padding: theme.spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: theme.spacing.md },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 18 },
  help: { color: theme.color.onSurfaceSecondary, fontSize: 11 },

  detailHead: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.divider,
  },
  detailTitle: { flex: 1, color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 16 },
  detailMeta: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  link: { color: theme.color.brand, fontSize: 13, textDecorationLine: "underline" },

  scoreBlock: { flexDirection: "row", gap: theme.spacing.md, alignItems: "center", marginVertical: theme.spacing.md },
  bigScore: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  bigScoreText: { fontFamily: theme.font.display, fontSize: 30, fontWeight: "700" },
  bigScoreLbl: { color: theme.color.onSurfaceSecondary, fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  recText: { color: theme.color.onSurface, fontSize: 14, marginBottom: 4 },
  rationale: { color: theme.color.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  rescoreBtn: { marginTop: 8, alignSelf: "flex-start", backgroundColor: theme.color.surfaceSecondary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  rescoreText: { color: theme.color.onSurface, fontSize: 11, fontWeight: "600" },

  bullet: { color: theme.color.onSurface, fontSize: 12, lineHeight: 18 },

  stageRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stageChip: { paddingHorizontal: theme.spacing.sm, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border },
  stageChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  stageChipText: { color: theme.color.onSurface, fontSize: 11, textTransform: "capitalize" },

  artCard: {
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
  },
  artHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  artTitle: { flex: 1, color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  genBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand, minWidth: 80, alignItems: "center" },
  genText: { color: theme.color.onBrand, fontSize: 11, fontWeight: "600" },
  artBody: { color: theme.color.onSurface, fontSize: 13, lineHeight: 19 },
  artSubject: { color: theme.color.brand, fontSize: 12, fontWeight: "600" },
  subSection: { color: theme.color.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginTop: 6 },
  qText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "600" },
  aText: { color: theme.color.onSurfaceSecondary, fontSize: 11, lineHeight: 17, marginTop: 2 },
  more: { color: theme.color.brand, fontSize: 11, fontStyle: "italic", marginTop: 4 },

  rawJd: { color: theme.color.onSurfaceSecondary, fontSize: 11, lineHeight: 16 },
});
