import { Injectable } from "@nestjs/common";
import { reviewReasons, type ReviewReason } from "@openkeep/types";

type LabelValue = string | number | boolean;

interface DurationMetric {
  count: number;
  sum: number;
}

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, DurationMetric>();

  incrementUploadsTotal(): void {
    this.incrementCounter("openkeep_uploads_total");
  }

  incrementProcessingJobsTotal(outcome: string): void {
    this.incrementCounter("openkeep_processing_jobs_total", { outcome });
  }

  incrementProcessingRetriesTotal(): void {
    this.incrementCounter("openkeep_processing_retries_total");
  }

  observeOcrDuration(seconds: number): void {
    this.observeDuration("openkeep_ocr_duration_seconds", seconds);
  }

  observeMetadataExtractionDuration(seconds: number): void {
    this.observeDuration("openkeep_metadata_extraction_duration_seconds", seconds);
  }

  renderPrometheus(dynamic: {
    documentsPendingReview: number;
    documentsPendingReviewByReason: Array<{ reason: ReviewReason; count: number }>;
    queueDepth: number;
  }): string {
    const pendingByReason = new Map(
      dynamic.documentsPendingReviewByReason.map((item) => [item.reason, item.count]),
    );
    const lines: string[] = [
      "# HELP openkeep_uploads_total Total uploaded documents.",
      "# TYPE openkeep_uploads_total counter",
      `${this.metricLine("openkeep_uploads_total")}`,
      "# HELP openkeep_processing_jobs_total Total processing jobs by outcome.",
      "# TYPE openkeep_processing_jobs_total counter",
      this.metricLine("openkeep_processing_jobs_total", { outcome: "completed" }),
      this.metricLine("openkeep_processing_jobs_total", { outcome: "failed" }),
      this.metricLine("openkeep_processing_jobs_total", { outcome: "retry" }),
      "# HELP openkeep_processing_retries_total Total automatic processing retries.",
      "# TYPE openkeep_processing_retries_total counter",
      `${this.metricLine("openkeep_processing_retries_total")}`,
      "# HELP openkeep_ocr_duration_seconds OCR duration summary.",
      "# TYPE openkeep_ocr_duration_seconds summary",
      ...this.durationLines("openkeep_ocr_duration_seconds"),
      "# HELP openkeep_metadata_extraction_duration_seconds Metadata extraction duration summary.",
      "# TYPE openkeep_metadata_extraction_duration_seconds summary",
      ...this.durationLines("openkeep_metadata_extraction_duration_seconds"),
      "# HELP openkeep_documents_pending_review Documents waiting for review.",
      "# TYPE openkeep_documents_pending_review gauge",
      `openkeep_documents_pending_review ${dynamic.documentsPendingReview}`,
      "# HELP openkeep_documents_pending_review_by_reason Documents waiting for review by reason.",
      "# TYPE openkeep_documents_pending_review_by_reason gauge",
      ...reviewReasons.map(
        (reason) =>
          `openkeep_documents_pending_review_by_reason{reason="${reason}"} ${pendingByReason.get(reason) ?? 0}`,
      ),
      "# HELP openkeep_document_processing_queue_depth Pending processing jobs in queue.",
      "# TYPE openkeep_document_processing_queue_depth gauge",
      `openkeep_document_processing_queue_depth{queue="document.process"} ${dynamic.queueDepth}`,
    ];

    return `${lines.filter(Boolean).join("\n")}\n`;
  }

  private incrementCounter(
    name: string,
    labels?: Record<string, LabelValue>,
    value = 1,
  ): void {
    const key = this.serializeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  private observeDuration(name: string, seconds: number): void {
    const metric = this.durations.get(name) ?? { count: 0, sum: 0 };
    metric.count += 1;
    metric.sum += seconds;
    this.durations.set(name, metric);
  }

  private metricLine(name: string, labels?: Record<string, LabelValue>): string {
    const key = this.serializeKey(name, labels);
    const value = this.counters.get(key) ?? 0;
    return `${name}${this.renderLabels(labels)} ${value}`;
  }

  private durationLines(name: string): string[] {
    const value = this.durations.get(name) ?? { count: 0, sum: 0 };
    return [
      `${name}_count ${value.count}`,
      `${name}_sum ${Number(value.sum.toFixed(6))}`,
    ];
  }

  private renderLabels(labels?: Record<string, LabelValue>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return "";
    }

    const values = Object.entries(labels).map(
      ([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`,
    );
    return `{${values.join(",")}}`;
  }

  private serializeKey(name: string, labels?: Record<string, LabelValue>): string {
    return `${name}|${JSON.stringify(labels ?? {})}`;
  }
}
