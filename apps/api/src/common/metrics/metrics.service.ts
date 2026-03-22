import { Injectable } from "@nestjs/common";
import { reviewReasons, type ReviewReason } from "@openkeep/types";

type LabelValue = string | number | boolean;

interface DurationMetric {
  count: number;
  sum: number;
  labels?: Record<string, LabelValue>;
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

  incrementParseJobsTotal(provider: string, outcome: string): void {
    this.incrementCounter("openkeep_parse_jobs_total", { provider, outcome });
  }

  incrementParseFallbackUsageTotal(): void {
    this.incrementCounter("openkeep_parse_fallback_usage_total");
  }

  observeOcrDuration(seconds: number): void {
    this.observeDuration("openkeep_ocr_duration_seconds", seconds);
  }

  observeParseDuration(provider: string, seconds: number): void {
    this.observeDuration("openkeep_parse_duration_seconds", seconds, { provider });
  }

  observeMetadataExtractionDuration(seconds: number): void {
    this.observeDuration("openkeep_metadata_extraction_duration_seconds", seconds);
  }

  observeChunkGenerationDuration(seconds: number): void {
    this.observeDuration("openkeep_chunk_generation_duration_seconds", seconds);
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
      "# HELP openkeep_parse_jobs_total Total parse jobs by provider and outcome.",
      "# TYPE openkeep_parse_jobs_total counter",
      ...this.counterLines("openkeep_parse_jobs_total"),
      "# HELP openkeep_parse_fallback_usage_total Total parse fallback executions.",
      "# TYPE openkeep_parse_fallback_usage_total counter",
      `${this.metricLine("openkeep_parse_fallback_usage_total")}`,
      "# HELP openkeep_ocr_duration_seconds OCR duration summary.",
      "# TYPE openkeep_ocr_duration_seconds summary",
      ...this.durationLines("openkeep_ocr_duration_seconds"),
      "# HELP openkeep_parse_duration_seconds Parse duration summary by provider.",
      "# TYPE openkeep_parse_duration_seconds summary",
      ...this.durationLines("openkeep_parse_duration_seconds"),
      "# HELP openkeep_metadata_extraction_duration_seconds Metadata extraction duration summary.",
      "# TYPE openkeep_metadata_extraction_duration_seconds summary",
      ...this.durationLines("openkeep_metadata_extraction_duration_seconds"),
      "# HELP openkeep_chunk_generation_duration_seconds Chunk generation duration summary.",
      "# TYPE openkeep_chunk_generation_duration_seconds summary",
      ...this.durationLines("openkeep_chunk_generation_duration_seconds"),
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

  private observeDuration(
    name: string,
    seconds: number,
    labels?: Record<string, LabelValue>,
  ): void {
    const key = this.serializeKey(name, labels);
    const metric = this.durations.get(key) ?? { count: 0, sum: 0, labels };
    metric.count += 1;
    metric.sum += seconds;
    this.durations.set(key, metric);
  }

  private metricLine(name: string, labels?: Record<string, LabelValue>): string {
    const key = this.serializeKey(name, labels);
    const value = this.counters.get(key) ?? 0;
    return `${name}${this.renderLabels(labels)} ${value}`;
  }

  private durationLines(name: string): string[] {
    const matching = [...this.durations.entries()]
      .filter(([key]) => key.startsWith(`${name}|`))
      .flatMap(([, value]) => [
        `${name}_count${this.renderLabels(value.labels)} ${value.count}`,
        `${name}_sum${this.renderLabels(value.labels)} ${Number(value.sum.toFixed(6))}`,
      ]);

    if (matching.length > 0) {
      return matching;
    }

    return [`${name}_count 0`, `${name}_sum 0`];
  }

  private counterLines(name: string): string[] {
    return [...this.counters.entries()]
      .filter(([key]) => key.startsWith(`${name}|`))
      .map(([key, value]) => {
        const labels = JSON.parse(key.slice(name.length + 1)) as Record<string, LabelValue>;
        return `${name}${this.renderLabels(labels)} ${value}`;
      });
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
