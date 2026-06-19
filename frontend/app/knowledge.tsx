import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as DocumentPicker from "expo-document-picker";

import { theme } from "@/src/theme";
import { api } from "@/src/api";
import ScreenHeader from "@/src/components/ScreenHeader";

interface KnowledgeDoc {
  id: string;
  title: string;
  filename: string;
  file_type: string;
  full_text_length?: number;
  chunk_count?: number;
  file_size: number;
  created_at: string;
}

interface SearchResult {
  id: string;
  title: string;
  filename: string;
  file_type: string;
  excerpt: string;
  relevance_score?: number;
}

export default function KnowledgeScreen() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [docsRes, statsRes] = await Promise.all([
        api.listDocuments(0, 50),
        api.knowledgeStats(),
      ]);
      setDocs(docsRes.documents);
      setTotal(docsRes.total);
      setStats(statsRes);
    } catch (e) {
      console.error("Failed to load knowledge vault:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const pickAndUpload = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "text/plain",
          "text/markdown",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const file = result.assets[0];
      setUploading(true);

      try {
        await api.uploadDocument(file.uri, file.name, file.mimeType || "application/octet-stream");
        load();
      } catch (e: any) {
        Alert.alert("Upload Failed", e?.message || "Could not upload document");
      } finally {
        setUploading(false);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not pick document");
    }
  }, [load]);

  const search = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await api.searchKnowledge(searchQuery.trim());
      setSearchResults(res.results);
    } catch (e) {
      console.error("Search failed:", e);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const deleteDoc = useCallback(
    async (id: string) => {
      if (Platform.OS === "web") {
        if (!confirm("Delete this document?")) return;
      } else {
        Alert.alert("Delete Document", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await api.deleteDocument(id);
              load();
            },
          },
        ]);
        return;
      }
      await api.deleteDocument(id);
      load();
    },
    [load]
  );

  const viewDoc = useCallback(async (id: string) => {
    try {
      const doc = await api.getDocument(id);
      setSelectedDoc(doc);
    } catch (e) {
      console.error("Failed to load document:", e);
    }
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };

  const fileIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case "pdf":
        return "document-text";
      case "txt":
      case "md":
        return "document";
      case "docx":
      case "doc":
        return "document-attach";
      default:
        return "document-outline";
    }
  };

  return (
    <View style={styles.root} testID="knowledge-screen">
      <ScreenHeader
        title="Knowledge Vault"
        rightSlot={
          <Pressable
            style={styles.uploadBtn}
            onPress={pickAndUpload}
            disabled={uploading}
            testID="upload-document-button"
          >
            {uploading ? (
              <ActivityIndicator size="small" color={theme.color.brand} />
            ) : (
              <Ionicons name="cloud-upload" size={22} color={theme.color.brand} />
            )}
          </Pressable>
        }
      />

      {/* Stats Banner */}
      {stats && (
        <View style={styles.statsBanner}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.total_documents}</Text>
            <Text style={styles.statLabel}>Documents</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.total_size_mb} MB</Text>
            <Text style={styles.statLabel}>Total Size</Text>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={theme.color.onSurfaceSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search your documents..."
          placeholderTextColor={theme.color.onSurfaceSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={search}
          returnKeyType="search"
          testID="knowledge-search-input"
        />
        {searchQuery.length > 0 && (
          <Pressable
            onPress={() => {
              setSearchQuery("");
              setSearchResults(null);
            }}
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={16} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        )}
        {searching && <ActivityIndicator size="small" color={theme.color.brand} />}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      ) : searchResults !== null ? (
        // Search Results
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No matching documents found.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => viewDoc(item.id)}
              testID={`search-result-${item.id}`}
            >
              <View style={styles.cardIcon}>
                <Ionicons name={fileIcon(item.file_type)} size={24} color={theme.color.brand} />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.cardExcerpt} numberOfLines={2}>
                  {item.excerpt}
                </Text>
              </View>
            </Pressable>
          )}
        />
      ) : docs.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="folder-open-outline" size={48} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>Your Knowledge Vault is Empty</Text>
          <Text style={styles.emptySubtitle}>
            Upload PDFs, text files, or documents. ORA will search them to answer your questions.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={pickAndUpload} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator color={theme.color.onBrand} />
            ) : (
              <Text style={styles.primaryBtnText}>Upload Document</Text>
            )}
          </Pressable>
        </View>
      ) : (
        // Document List
        <FlatList
          data={docs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => viewDoc(item.id)}
              testID={`doc-${item.id}`}
            >
              <View style={styles.cardIcon}>
                <Ionicons name={fileIcon(item.file_type)} size={24} color={theme.color.brand} />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.cardMeta}>
                  {item.file_type.toUpperCase()} • {formatSize(item.file_size)} •{" "}
                  {formatDate(item.created_at)}
                </Text>
              </View>
              <Pressable
                style={styles.deleteBtn}
                onPress={() => deleteDoc(item.id)}
                hitSlop={10}
                testID={`delete-doc-${item.id}`}
              >
                <Ionicons name="trash-outline" size={18} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      {/* Document Preview Modal */}
      <Modal
        visible={!!selectedDoc}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDoc(null)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {selectedDoc?.title}
              </Text>
              <Pressable onPress={() => setSelectedDoc(null)} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <View style={styles.modalMeta}>
              <Text style={styles.metaText}>
                {selectedDoc?.file_type?.toUpperCase()} •{" "}
                {selectedDoc?.full_text_length?.toLocaleString()} characters •{" "}
                {selectedDoc?.chunk_count} chunks
              </Text>
            </View>
            <View style={styles.modalContent}>
              <Text style={styles.contentText} numberOfLines={50}>
                {selectedDoc?.content?.slice(0, 3000)}
                {selectedDoc?.content?.length > 3000 ? "..." : ""}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  uploadBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  statsBanner: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xl,
  },
  statItem: { alignItems: "center" },
  statValue: { color: theme.color.brand, fontFamily: theme.font.display, fontSize: 20 },
  statLabel: { color: theme.color.onSurfaceSecondary, fontSize: 11 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  searchInput: { flex: 1, color: theme.color.onSurface, fontSize: 14, paddingVertical: 4 },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: { flex: 1 },
  cardTitle: { color: theme.color.onSurface, fontSize: 15, fontWeight: "500" },
  cardMeta: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  cardExcerpt: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 4, lineHeight: 16 },
  deleteBtn: { padding: theme.spacing.sm },
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
  emptyText: { color: theme.color.onSurfaceSecondary, fontSize: 14 },
  primaryBtn: {
    backgroundColor: theme.color.brand,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    marginTop: theme.spacing.md,
  },
  primaryBtnText: { color: theme.color.onBrand, fontWeight: "600" },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: "80%",
    padding: theme.spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  modalTitle: { flex: 1, color: theme.color.onSurface, fontFamily: theme.font.display, fontSize: 20 },
  modalMeta: { marginTop: theme.spacing.sm },
  metaText: { color: theme.color.onSurfaceSecondary, fontSize: 12 },
  modalContent: {
    marginTop: theme.spacing.lg,
    maxHeight: 400,
  },
  contentText: { color: theme.color.onSurface, fontSize: 13, lineHeight: 20 },
});
