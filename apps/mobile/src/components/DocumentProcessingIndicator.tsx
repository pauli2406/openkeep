import { Text, View } from "react-native";
import type { ArchiveDocument } from "../lib";
import { documentRowState, isDocumentProcessing } from "../document-processing";
import { useI18n } from "../i18n";
import { createThemedStyles, radii } from "../theme";
import { text } from "../typography";
import { PulsingDot } from "./ui";

/**
 * A document still in the pipeline: the web client's info badge, with a dot that
 * breathes where the web has a spinner.
 */
export function DocumentProcessingIndicator({
  document,
}: {
  document: Pick<ArchiveDocument, "status" | "latestProcessingJob">;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  if (!isDocumentProcessing(document)) {
    return null;
  }

  const label =
    documentRowState(document) === "queued" ? t("documents.queued") : t("documents.processing");

  return (
    <View style={styles.badge}>
      <PulsingDot style={styles.dot} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: c.infoSoft,
  },
  dot: {
    width: 6,
    height: 6,
    backgroundColor: c.info,
    borderRadius: radii.pill,
  },
  label: {
    ...text.smallStrong,
    color: c.info,
  },
}));
