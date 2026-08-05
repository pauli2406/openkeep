import { Text, View } from "react-native";
import type { ArchiveDocument } from "../lib";
import { documentRowState, isDocumentProcessing } from "../document-processing";
import { useI18n } from "../i18n";
import { createThemedStyles, radii } from "../theme";
import { text } from "../typography";
import { PulsingDot } from "./ui";

/**
 * A document still in the pipeline. This used to be an uppercase pill over an
 * indeterminate bar, with hardcoded English labels; #120 makes it the same
 * pulsing dot and lower-case line the row treatment uses, so the two never
 * disagree about what "processing" looks like.
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

  const label = documentRowState(document) === "queued" ? t("state.queued") : t("state.processing");

  return (
    <View style={styles.wrap}>
      <PulsingDot style={styles.dot} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
  },
  dot: {
    backgroundColor: c.accent,
    borderRadius: radii.pill,
  },
  label: {
    ...text.meta,
    color: c.dim,
  },
}));
