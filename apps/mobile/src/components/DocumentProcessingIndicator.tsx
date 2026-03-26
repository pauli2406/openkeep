import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { ArchiveDocument } from "../lib";
import { getDocumentProcessingLabel, isDocumentProcessing } from "../document-processing";
import { useI18n } from "../i18n";
import { colors } from "../theme";

export function DocumentProcessingIndicator({
  document,
}: {
  document: Pick<ArchiveDocument, "status" | "latestProcessingJob">;
}) {
  const { t } = useI18n();

  if (!isDocumentProcessing(document)) {
    return null;
  }

  const label = getDocumentProcessingLabel(document) ?? t("common.processing");

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <View style={styles.track}>
        <View style={styles.bar} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  label: {
    color: colors.primaryDeep,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    overflow: "hidden",
  },
  bar: {
    width: "34%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
});
