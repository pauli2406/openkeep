---
title: Agentic Document Intelligence
description: LangGraph-based metadata extraction, routing, validation, and frontend exposure.
---

# Agentic Document Intelligence

This document describes the current agentic metadata extraction pipeline.

## Entry Point

The current extraction entry point is `HybridMetadataExtractor`.

Behavior:

- if no supported LLM provider is configured, it uses deterministic extraction
- if at least one of OpenAI, Gemini, or Mistral is configured, it delegates to `AgenticDocumentIntelligenceService`

## Framework Choice

The agentic pipeline is implemented with LangGraph.

Current internal pipeline marker:

- framework: `langgraph-ready`
- version: `v1`

The design goal is orchestrated, bounded intelligence rather than free-form autonomous behavior.

## Supported LLM Providers

The current provider order inside the agentic pipeline is:

1. `mistral`
2. `gemini`
3. `openai`

`LlmService` supports explicit fallback order resolution and returns provider/model metadata together with completion results.

## Workflow Shape

The `AgenticDocumentIntelligenceService` builds a LangGraph state graph with nodes for:

- routing
- title and summary generation
- typed metadata extraction
- correspondent resolution
- tagging
- normalization and validation

The final result is converted into the shared `MetadataExtractionResult` shape expected by the rest of the processing pipeline.

## Routing Stage

The routing stage determines the likely document type and stores:

- selected document type
- subtype when present
- confidence
- reasoning hints
- provider and model metadata

This data is later exposed to the frontend through `metadata.intelligence.routing`.

## Supported Document Types

Current document type registry entries:

- `invoice`
- `receipt`
- `contract`
- `tax_document`
- `utility_bill`
- `bank_statement`
- `payslip`
- `insurance_document`
- `generic_letter`

The registry defines:

- canonical names
- aliases
- summaries
- required fields
- relevant fields
- label hints for dates, references, and similar extraction targets

## Type-Specific Extraction

The typed extraction stage uses dedicated modules under:

- `apps/api/src/processing/type-specific-extractors/`

This keeps extraction logic structured per document family instead of relying on one generic prompt path.

## Correspondent Resolution

Correspondent resolution is not a separate ad-hoc step in the UI. It is part of the extraction workflow.

The pipeline feeds extracted or candidate correspondent data into `CorrespondentResolutionService`, which returns:

- resolved correspondent name
- confidence
- match strategy metadata

That metadata is preserved under `metadata.correspondentExtraction` and `metadata.intelligence.correspondentResolution`.

## Tagging

The tagging stage produces normalized tag suggestions and confidence metadata.

These are surfaced through `metadata.intelligence.tagging`.

## Validation and Normalization

The final validation stage normalizes extracted fields and produces:

- normalized field values
- warnings
- errors
- duplicate signals

This stage is also responsible for shaping data that will later affect:

- confidence
- review reasons
- review evidence

## Final Output Shape

The agentic pipeline returns the standard extraction fields expected elsewhere in the backend, including:

- title
- summary
- issue date
- due date
- expiry date
- amount and currency
- reference number
- holder name
- issuing authority
- correspondent name
- document type name
- tags
- confidence
- review reasons

It also writes detailed intelligence metadata into `metadata.intelligence`.

## Frontend Exposure

The web app currently exposes agentic output in several places:

- explorer row badges and summaries
- review queue badges and summaries
- document detail intelligence tab

The document detail page currently exposes:

- routing
- generated summary
- type-specific fields
- field confidence and provenance
- tagging and correspondent resolution
- validation warnings and errors
- pipeline metadata and durations

## Design Constraints

Current design constraints intentionally keep the system predictable:

- agent stages are fixed and orchestrated
- extracted data is normalized before it is trusted
- review remains explicit and separate from processing
- manual overrides still outrank automated output

## Related Documents

- [Architecture Overview](./architecture-overview.md)
- [API and Data Flows](./api-and-data-flows.md)
- [Backend Notes](../backend.md)
