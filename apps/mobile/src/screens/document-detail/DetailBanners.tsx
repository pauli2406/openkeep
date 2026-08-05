import { Text, View } from "react-native";
import { DocumentProcessingIndicator } from "../../components/DocumentProcessingIndicator";
import { Button, Pill } from "../../components/ui";
import { isDocumentProcessing } from "../../document-processing";
import { useI18n } from "../../i18n";
import { reviewReasonLabel } from "../../review-reasons";
import { createThemedStyles } from "../../theme";
import { text } from "../../typography";
import type { ArchiveDocument } from "../../lib";

/**
 * The review banner and the processing-error banner, as tinted rows rather than
 * cards. (#114)
 */
export function DetailBanners({
  document,
  offlineReadOnly,
  busy,
  onResolve,
  onRequeue,
}: {
  document: ArchiveDocument;
  offlineReadOnly: boolean;
  busy: boolean;
  onResolve: () => void;
  onRequeue: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  return (
    <>
      {/* The detail query keeps polling while a document is in the pipeline; say so. */}
      {isDocumentProcessing(document) ? (
        <View style={styles.processing}>
          <DocumentProcessingIndicator document={document} />
        </View>
      ) : null}

      {document.reviewStatus === "pending" ? (
        <View style={styles.review}>
          <Text style={styles.reviewTitle}>{t("documentDetail.overview.needsReview")}</Text>
          {document.reviewReasons.length > 0 ? (
            <View style={styles.pills}>
              {document.reviewReasons.map((reason) => (
                <Pill key={reason} label={reviewReasonLabel(reason, t)} tone="warn" />
              ))}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={t("documentDetail.overview.resolve")}
              size="sm"
              disabled={offlineReadOnly}
              loading={busy}
              onPress={onResolve}
            />
            <Button
              label={t("documentDetail.overview.requeue")}
              variant="secondary"
              size="sm"
              disabled={offlineReadOnly}
              loading={busy}
              onPress={onRequeue}
            />
          </View>
        </View>
      ) : null}

      {document.lastProcessingError ? (
        <View style={styles.error}>
          <Text style={styles.errorTitle}>{t("documentDetail.overview.processingError")}</Text>
          <Text style={styles.errorBody} numberOfLines={4}>
            {document.lastProcessingError}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const useStyles = createThemedStyles((c) => ({
  processing: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  review: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.amberSoft,
  },
  reviewTitle: {
    ...text.metaStrong,
    color: c.amber,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  error: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.redSoft,
  },
  errorTitle: {
    ...text.metaStrong,
    color: c.red,
  },
  errorBody: {
    ...text.small,
    color: c.red,
  },
}));
