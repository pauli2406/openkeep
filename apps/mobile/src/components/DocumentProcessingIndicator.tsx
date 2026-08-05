import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { ArchiveDocument } from "../lib";
import { getDocumentProcessingLabel, isDocumentProcessing } from "../document-processing";
import { useI18n } from "../i18n";
import { createThemedStyles, useColors } from "../theme";

export function DocumentProcessingIndicator({
  document,
}: {
  document: Pick<ArchiveDocument, "status" | "latestProcessingJob">;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useI18n();

  if (!isDocumentProcessing(document)) {
    return null;
  }

  const label = getDocumentProcessingLabel(document) ?? t("common.processing");

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <View style={styles.track}>
        <View style={styles.bar} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  wrap: {
    gap: 8,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: c.accentSoft,
    backgroundColor: c.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  label: {
    color: c.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: c.accentSoft,
    overflow: "hidden",
  },
  bar: {
    width: "34%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: c.accentFill,
  },
}));
