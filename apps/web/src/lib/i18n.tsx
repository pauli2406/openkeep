import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

export type AppLanguage = "en" | "de";

type TranslationKey =
  | "root.loading"
  | "root.nav.dashboard"
  | "root.nav.documents"
  | "root.nav.review"
  | "root.nav.search"
  | "root.nav.upload"
  | "root.nav.settings"
  | "root.nav.logout"
  | "root.menu.open"
  | "root.menu.close"
  | "login.description"
  | "login.email"
  | "login.password"
  | "login.signIn"
  | "login.signingIn"
  | "login.needSetup"
  | "login.goToSetup"
  | "setup.title"
  | "setup.description"
  | "setup.displayName"
  | "setup.yourName"
  | "setup.email"
  | "setup.password"
  | "setup.passwordMin"
  | "setup.confirmPassword"
  | "setup.createAccount"
  | "setup.creatingAccount"
  | "setup.alreadySetup"
  | "setup.signIn"
  | "setup.errorPasswordLength"
  | "setup.errorPasswordsMatch"
  | "settings.title"
  | "settings.subtitle"
  | "settings.userProfile"
  | "settings.accountInfo"
  | "settings.displayName"
  | "settings.email"
  | "settings.role"
  | "settings.owner"
  | "settings.user"
  | "settings.languagePreferences"
  | "settings.languagePreferencesDescription"
  | "settings.uiLanguage"
  | "settings.aiProcessingLanguage"
  | "settings.aiChatLanguage"
  | "settings.english"
  | "settings.german"
  | "settings.saving"
  | "settings.savePreferences"
  | "settings.preferencesSaved"
  | "settings.preferencesSaveFailed"
  | "settings.unknown"
  | "settings.failedToFetchTokens"
  | "settings.failedToCreateToken"
  | "settings.failedToDeleteToken"
  | "settings.apiTokensTitle"
  | "settings.apiTokensDescription"
  | "settings.createToken"
  | "settings.tokenCreated"
  | "settings.tokenCreatedDescription"
  | "settings.tokenShownOnce"
  | "settings.done"
  | "settings.createApiToken"
  | "settings.createApiTokenDescription"
  | "settings.name"
  | "settings.expiryOptional"
  | "settings.createTokenFailed"
  | "settings.cancel"
  | "settings.creating"
  | "settings.create"
  | "settings.loadTokensFailed"
  | "settings.noApiTokens"
  | "settings.lastUsed"
  | "settings.neverUsed"
  | "settings.expires"
  | "settings.noExpiry"
  | "settings.delete"
  | "settings.deleteConfirm"
  | "settings.yes"
  | "settings.no"
  | "settings.tokenNamePlaceholder"
  | "settings.taxonomyManagement"
  | "settings.taxonomyManagementDescription"
  | "settings.tags"
  | "settings.tagsDescription"
  | "settings.correspondents"
  | "settings.correspondentsDescription"
  | "settings.documentTypes"
  | "settings.documentTypesDescription"
  | "settings.failedToLoadTags"
  | "settings.failedToLoadCorrespondents"
  | "settings.failedToLoadDocumentTypes"
  | "settings.failedToCreateTag"
  | "settings.failedToCreateCorrespondent"
  | "settings.failedToCreateDocumentType"
  | "settings.failedToUpdateTag"
  | "settings.failedToUpdateCorrespondent"
  | "settings.failedToUpdateDocumentType"
  | "settings.failedToDeleteTag"
  | "settings.failedToDeleteCorrespondent"
  | "settings.failedToDeleteDocumentType"
  | "settings.failedToMergeTag"
  | "settings.failedToMergeCorrespondent"
  | "settings.failedToMergeDocumentType"
  | "settings.add"
  | "settings.save"
  | "settings.edit"
  | "settings.merge"
  | "settings.nameSuffix"
  | "settings.mergeInto"
  | "settings.selectTarget"
  | "settings.confirmMerge"
  | "settings.createItemPlaceholder"
  | "settings.createItemFailed"
  | "settings.loadItemsFailed"
  | "settings.noItemsCreated"
  | "settings.updateItemFailed"
  | "settings.archivePortability"
  | "settings.archivePortabilityDescription"
  | "settings.exportSnapshot"
  | "settings.dryRunEnabled"
  | "settings.dryRunDisabled"
  | "settings.scanWatchFolder"
  | "settings.exportArchiveFailed"
  | "settings.snapshotJson"
  | "settings.replace"
  | "settings.snapshotPlaceholder"
  | "settings.importSnapshot"
  | "settings.importArchiveFailed"
  | "settings.lastImportResult"
  | "settings.watchFolderScan"
  | "settings.path"
  | "settings.imported"
  | "settings.duplicates"
  | "settings.unsupported"
  | "settings.failures"
  | "settings.planned"
  | "settings.total"
  | "settings.currentScanResults"
  | "settings.itemOne"
  | "settings.itemOther"
  | "settings.reason"
  | "settings.destination"
  | "settings.openDocument"
  | "settings.inspectExtractedFields"
  | "settings.currentScanIssues"
  | "settings.code"
  | "settings.recentScans"
  | "settings.liveScan"
  | "settings.failedToScanWatchFolder"
  | "settings.failedToLoadScanResultDetails"
  | "settings.failedToExportArchive"
  | "settings.failedToImportArchive"
  | "settings.failedToFetchStatus"
  | "settings.processingActivity"
  | "settings.processingActivityDescription"
  | "settings.failedToLoadProcessingStatus"
  | "settings.ocrQueue"
  | "settings.embedQueue"
  | "settings.totalDocs"
  | "settings.documentsByStatus"
  | "settings.recentJobs"
  | "settings.noProcessingJobs"
  | "settings.loadingExtractedFields"
  | "settings.failedToLoadExtractedFields"
  | "settings.noExtractedFieldsYet"
  | "settings.keyFieldExtractionUnavailable"
  | "settings.foundValues"
  | "settings.noKeyFieldsFound"
  | "settings.missingKeyFields"
  | "settings.noneMissing"
  | "settings.confidence"
  | "settings.threshold"
  | "settings.secondsAgo"
  | "settings.minutesAgo"
  | "settings.hoursAgo"
  | "settings.aiProviders"
  | "settings.aiProvidersDescription"
  | "settings.loadingProviderConfiguration"
  | "settings.unableToLoadProviderConfiguration"
  | "settings.chatModel"
  | "settings.active"
  | "settings.noChatProviderConfigured"
  | "settings.chatProviders"
  | "settings.configured"
  | "settings.notConfigured"
  | "settings.embeddingProviders"
  | "settings.available"
  | "settings.parseProviders"
  | "settings.fallback"
  | "settings.processingMode"
  | "settings.pendingReview"
  | "settings.failedToFetchHealth"
  | "settings.failedToFetchProviders"
  | "settings.failedToFetchReadiness"
  | "settings.systemHealth"
  | "settings.systemHealthDescription"
  | "settings.checkingHealth"
  | "settings.unableToReachServer"
  | "settings.server"
  | "settings.runningReadinessChecks"
  | "settings.readinessChecks"
  | "settings.ok"
  | "settings.fail"
  | "upload.remove"
  | "upload.titleOverrideOptional"
  | "upload.autoDetectedFromContent"
  | "upload.clearAll"
  | "upload.uploading"
  | "upload.file"
  | "upload.files"
  | "upload.complete"
  | "upload.documentWas"
  | "upload.documentsWere"
  | "upload.uploadedSuccessfully"
  | "upload.failed"
  | "upload.viewDocuments"
  | "upload.uploadMore"
  | "dashboard.noTasksInView"
  | "dashboard.correspondent"
  | "dashboard.document"
  | "dashboard.whatToDo"
  | "dashboard.amount"
  | "dashboard.deadline"
  | "dashboard.action"
  | "dashboard.unfiled"
  | "dashboard.documentFallback"
  | "dashboard.overdueDays"
  | "dashboard.daysLeft"
  | "dashboard.saving"
  | "dashboard.done"
  | "dashboard.failedToCompleteTask"
  | "dashboard.loadingAtlas"
  | "dashboard.failedToLoadInsights"
  | "dashboard.retry"
  | "dashboard.eyebrow"
  | "dashboard.description"
  | "dashboard.totalDocuments"
  | "dashboard.pendingReview"
  | "dashboard.documentTypes"
  | "dashboard.correspondents"
  | "dashboard.intakeTrend"
  | "dashboard.rhythm"
  | "dashboard.openTimeline"
  | "dashboard.largestClusters"
  | "dashboard.openGalaxyView"
  | "dashboard.deadlines"
  | "dashboard.upcomingTasks"
  | "documentDetail.loadDoc"
  | "documentDetail.loadText"
  | "documentDetail.loadHistory"
  | "documentDetail.backToDocuments"
  | "documentDetail.notFound"
  | "documentDetail.returnToDocuments"
  | "documentDetail.documents"
  | "documentDetail.pendingReview"
  | "documentDetail.reviewResolved"
  | "documentDetail.preview"
  | "documentDetail.ocrText"
  | "documentDetail.intelligence"
  | "documentDetail.details"
  | "documentDetail.history"
  | "documentDetail.previewUnavailable"
  | "documentDetail.downloadFile"
  | "documentDetail.loadPreviewFailed"
  | "documentDetail.loadDocumentTextFailed"
  | "documentDetail.noOcr"
  | "documentDetail.documentPreviewTitle"
  | "documentDetail.loadingContent"
  | "documentDetail.browserNoVideo"
  | "documentDetail.browserNoAudio"
  | "documentDetail.unsupportedPreviewPrefix"
  | "documentDetail.unsupportedPreviewSuffix"
  | "documentDetail.failedToLoadTags"
  | "documentDetail.failedToLoadCorrespondents"
  | "documentDetail.failedToLoadDocumentTypes"
  | "documentDetail.failedToLoadDocumentPreview"
  | "documentDetail.failedToFetchProviders"
  | "documentDetail.failedToUpdateDocument"
  | "documentDetail.generatedSummary"
  | "documentDetail.titleCandidate"
  | "documentDetail.provider"
  | "documentDetail.typeSpecificFields"
  | "documentDetail.noExtractedFields"
  | "documentDetail.source"
  | "documentDetail.location"
  | "documentDetail.pageWord"
  | "documentDetail.lineWord"
  | "documentDetail.taggingCorrespondent"
  | "documentDetail.correspondent"
  | "documentDetail.strategy"
  | "documentDetail.validation"
  | "documentDetail.warnings"
  | "documentDetail.errors"
  | "documentDetail.runId"
  | "documentDetail.providerOrder"
  | "documentDetail.documentHistory"
  | "documentDetail.noAuditEvents"
  | "documentDetail.metadata"
  | "documentDetail.edit"
  | "documentDetail.save"
  | "documentDetail.failedToSaveChanges"
  | "documentDetail.savingWillLock"
  | "documentDetail.lockedFieldsSticky"
  | "documentDetail.changedFieldsSticky"
  | "documentDetail.title"
  | "documentDetail.selectCorrespondent"
  | "documentDetail.noCorrespondent"
  | "documentDetail.addNewCorrespondent"
  | "documentDetail.add"
  | "documentDetail.createCorrespondentHelp"
  | "documentDetail.failedToCreateCorrespondent"
  | "documentDetail.savingWillLockField"
  | "documentDetail.unknown"
  | "documentDetail.documentType"
  | "documentDetail.selectDocumentType"
  | "documentDetail.noDocumentType"
  | "documentDetail.unclassified"
  | "documentDetail.issueDate"
  | "documentDetail.currency"
  | "documentDetail.unlock"
  | "documentDetail.documentIntelligence"
  | "documentDetail.noAgentIntelligence"
  | "documentDetail.routing"
  | "documentDetail.type"
  | "documentDetail.subtype"
  | "documentDetail.model"
  | "documentDetail.pipeline"
  | "documentDetail.framework"
  | "documentDetail.status"
  | "documentDetail.system"
  | "documentDetail.noTags"
  | "documentDetail.taxonomyOptionsLoadFailed"
  | "documentDetail.manualOverrides"
  | "documentDetail.none"
  | "documentDetail.removed"
  | "documentDetail.lockedField"
  | "documentDetail.lockedFields"
  | "documentDetail.stickyOverrideHint"
  | "documentDetail.clear"
  | "documentDetail.failedToClearOverride"
  | "documentDetail.confidence"
  | "documentDetail.processingStatus"
  | "documentDetail.embeddingStatus"
  | "documentDetail.ocrProvider"
  | "documentDetail.embeddingModel"
  | "documentDetail.created"
  | "documentDetail.processed"
  | "documentDetail.documentClass"
  | "documentDetail.requiredFields"
  | "documentDetail.missingFields"
  | "documentDetail.threshold"
  | "documentDetail.resolveReview"
  | "documentDetail.requeue"
  | "documentDetail.failedToResolveReview"
  | "documentDetail.failedToRequeue"
  | "documentDetail.actions"
  | "documentDetail.reprocessDocument"
  | "documentDetail.failedToReprocessDocument"
  | "documentDetail.downloadOriginal"
  | "documentDetail.downloadSearchable"
  | "documentDetail.deleteDocument"
  | "documentDetail.cannotDeleteWhileProcessing"
  | "documentDetail.failedToDeleteDocument"
  | "documentDetail.lastProcessingError"
  | "documentDetail.reprocessDialogTitle"
  | "documentDetail.reprocessDialogDescription"
  | "documentDetail.selectProvider"
  | "documentDetail.active"
  | "documentDetail.fallback"
  | "documentDetail.lastProcessedWith"
  | "documentDetail.cancel"
  | "documentDetail.reprocessing"
  | "documentDetail.reprocess"
  | "documentDetail.deleteDialogTitle"
  | "documentDetail.deleteDialogDescription"
  | "documentDetail.deleting"
  | "documentDetail.deletePermanently"
  | "documentDetail.dueDate"
  | "documentDetail.expiryDate"
  | "documentDetail.amount"
  | "documentDetail.referenceNumber"
  | "documentDetail.holderName"
  | "documentDetail.issuingAuthority"
  | "documentDetail.tags"
  | "documentDetail.filterTags"
  | "documentDetail.selectedTags"
  | "documentDetail.searchAddTag"
  | "documentDetail.matchingTags"
  | "documentDetail.createTag"
  | "documentDetail.savingWillLockAmountFields"
  | "documentDetail.savingWillLockTagSelection"
  | "documentDetail.failedToCreateTag"
  | "documentDetail.allMatchingTagsSelected"
  | "documentDetail.noTagsMatchFilter"
  | "documentDetail.noTagsAvailable"
  | "documentDetail.askAboutDocument"
  | "documentDetail.clearHistory"
  | "documentDetail.referencedExcerpts"
  | "documentDetail.searchingChunks"
  | "documentDetail.failedToAnswer"
  | "documentDetail.askQuestionPlaceholder"
  | "documentDetail.ask";

const messages: Record<AppLanguage, Record<TranslationKey, string>> = {
  en: {
    "root.loading": "Loading...",
    "root.nav.dashboard": "Dashboard",
    "root.nav.documents": "Documents",
    "root.nav.review": "Review",
    "root.nav.search": "Search",
    "root.nav.upload": "Upload",
    "root.nav.settings": "Settings",
    "root.nav.logout": "Logout",
    "root.menu.open": "Open menu",
    "root.menu.close": "Close menu",
    "login.description": "Sign in to your document archive",
    "login.email": "Email",
    "login.password": "Password",
    "login.signIn": "Sign in",
    "login.signingIn": "Signing in...",
    "login.needSetup": "Need to set up?",
    "login.goToSetup": "Go to setup",
    "setup.title": "Create your account",
    "setup.description": "Set up the initial owner account for your OpenKeep archive",
    "setup.displayName": "Display name",
    "setup.yourName": "Your name",
    "setup.email": "Email",
    "setup.password": "Password",
    "setup.passwordMin": "Minimum 12 characters",
    "setup.confirmPassword": "Confirm password",
    "setup.createAccount": "Create account",
    "setup.creatingAccount": "Creating account...",
    "setup.alreadySetup": "Already set up?",
    "setup.signIn": "Sign in",
    "setup.errorPasswordLength": "Password must be at least 12 characters",
    "setup.errorPasswordsMatch": "Passwords do not match",
    "settings.title": "Settings",
    "settings.subtitle": "Manage your account and system configuration",
    "settings.userProfile": "User Profile",
    "settings.accountInfo": "Your account information",
    "settings.displayName": "Display Name",
    "settings.email": "Email",
    "settings.role": "Role",
    "settings.owner": "Owner",
    "settings.user": "User",
    "settings.languagePreferences": "Language Preferences",
    "settings.languagePreferencesDescription": "Choose the app language and how AI should process and answer.",
    "settings.uiLanguage": "UI language",
    "settings.aiProcessingLanguage": "AI processing language",
    "settings.aiChatLanguage": "AI chat answer language",
    "settings.english": "English",
    "settings.german": "German",
    "settings.saving": "Saving...",
    "settings.savePreferences": "Save preferences",
    "settings.preferencesSaved": "Preferences saved.",
    "settings.preferencesSaveFailed": "Failed to save preferences.",
    "settings.unknown": "Unknown",
    "settings.failedToFetchTokens": "Failed to fetch tokens",
    "settings.failedToCreateToken": "Failed to create token",
    "settings.failedToDeleteToken": "Failed to delete token",
    "settings.apiTokensTitle": "API Tokens",
    "settings.apiTokensDescription": "Manage API tokens for programmatic access",
    "settings.createToken": "Create Token",
    "settings.tokenCreated": "Token Created",
    "settings.tokenCreatedDescription": "Copy this token now. It will not be shown again.",
    "settings.tokenShownOnce": "This token will only be shown once. Store it securely.",
    "settings.done": "Done",
    "settings.createApiToken": "Create API Token",
    "settings.createApiTokenDescription": "Create a new token for API access",
    "settings.name": "Name",
    "settings.expiryOptional": "Expiry date (optional)",
    "settings.createTokenFailed": "Failed to create token. Please try again.",
    "settings.cancel": "Cancel",
    "settings.creating": "Creating...",
    "settings.create": "Create",
    "settings.loadTokensFailed": "Failed to load tokens.",
    "settings.noApiTokens": "No API tokens created yet",
    "settings.lastUsed": "Last used",
    "settings.neverUsed": "Never used",
    "settings.expires": "Expires",
    "settings.noExpiry": "No expiry",
    "settings.delete": "Delete",
    "settings.deleteConfirm": "Delete?",
    "settings.yes": "Yes",
    "settings.no": "No",
    "settings.tokenNamePlaceholder": "e.g. CI/CD Pipeline",
    "settings.taxonomyManagement": "Taxonomy Management",
    "settings.taxonomyManagementDescription": "Curate AI-generated labels for tags, correspondents, and document types.",
    "settings.tags": "Tags",
    "settings.tagsDescription": "Lightweight categories used across the archive.",
    "settings.correspondents": "Correspondents",
    "settings.correspondentsDescription": "Organizations and people detected as senders or counterparties.",
    "settings.documentTypes": "Document Types",
    "settings.documentTypesDescription": "Stable type labels such as invoice, contract, or statement.",
    "settings.failedToLoadTags": "Failed to load tags",
    "settings.failedToLoadCorrespondents": "Failed to load correspondents",
    "settings.failedToLoadDocumentTypes": "Failed to load document types",
    "settings.failedToCreateTag": "Failed to create tag",
    "settings.failedToCreateCorrespondent": "Failed to create correspondent",
    "settings.failedToCreateDocumentType": "Failed to create document type",
    "settings.failedToUpdateTag": "Failed to update tag",
    "settings.failedToUpdateCorrespondent": "Failed to update correspondent",
    "settings.failedToUpdateDocumentType": "Failed to update document type",
    "settings.failedToDeleteTag": "Failed to delete tag",
    "settings.failedToDeleteCorrespondent": "Failed to delete correspondent",
    "settings.failedToDeleteDocumentType": "Failed to delete document type",
    "settings.failedToMergeTag": "Failed to merge tag",
    "settings.failedToMergeCorrespondent": "Failed to merge correspondent",
    "settings.failedToMergeDocumentType": "Failed to merge document type",
    "settings.add": "Add",
    "settings.save": "Save",
    "settings.edit": "Edit",
    "settings.merge": "Merge",
    "settings.nameSuffix": "name",
    "settings.mergeInto": "Merge Into",
    "settings.selectTarget": "Select target",
    "settings.confirmMerge": "Confirm Merge",
    "settings.createItemPlaceholder": "Enter a name",
    "settings.createItemFailed": "Failed to create item.",
    "settings.loadItemsFailed": "Failed to load items.",
    "settings.noItemsCreated": "No items created yet.",
    "settings.updateItemFailed": "Failed to update item.",
    "settings.archivePortability": "Archive Portability",
    "settings.archivePortabilityDescription": "Export snapshots, restore them, and trigger watch-folder ingestion.",
    "settings.exportSnapshot": "Export Snapshot",
    "settings.dryRunEnabled": "Dry Run Enabled",
    "settings.dryRunDisabled": "Dry Run Disabled",
    "settings.scanWatchFolder": "Scan Watch Folder",
    "settings.exportArchiveFailed": "Failed to export archive.",
    "settings.snapshotJson": "Snapshot JSON",
    "settings.replace": "Replace",
    "settings.snapshotPlaceholder": "Export a snapshot or paste one here for import",
    "settings.importSnapshot": "Import Snapshot",
    "settings.importArchiveFailed": "Failed to import archive.",
    "settings.lastImportResult": "Last Import Result",
    "settings.watchFolderScan": "Watch Folder Scan",
    "settings.path": "Path",
    "settings.imported": "Imported",
    "settings.duplicates": "Duplicates",
    "settings.unsupported": "Unsupported",
    "settings.failures": "Failures",
    "settings.planned": "Planned",
    "settings.total": "Total",
    "settings.currentScanResults": "Current scan results",
    "settings.itemOne": "item",
    "settings.itemOther": "items",
    "settings.reason": "Reason",
    "settings.destination": "Destination",
    "settings.openDocument": "Open document",
    "settings.inspectExtractedFields": "Inspect extracted fields",
    "settings.currentScanIssues": "Current scan issues",
    "settings.code": "Code",
    "settings.recentScans": "Recent scans",
    "settings.liveScan": "Live scan",
    "settings.failedToScanWatchFolder": "Failed to scan watch folder.",
    "settings.failedToLoadScanResultDetails": "Failed to load scan result details",
    "settings.failedToExportArchive": "Failed to export archive",
    "settings.failedToImportArchive": "Failed to import archive",
    "settings.failedToFetchStatus": "Failed to fetch status",
    "settings.processingActivity": "Processing Activity",
    "settings.processingActivityDescription": "Queue depths, document status breakdown, and recent jobs",
    "settings.failedToLoadProcessingStatus": "Failed to load processing status.",
    "settings.ocrQueue": "OCR Queue",
    "settings.embedQueue": "Embed Queue",
    "settings.totalDocs": "Total Docs",
    "settings.documentsByStatus": "Documents by Status",
    "settings.recentJobs": "Recent Jobs",
    "settings.noProcessingJobs": "No processing jobs yet.",
    "settings.loadingExtractedFields": "Loading extracted fields...",
    "settings.failedToLoadExtractedFields": "Failed to load extracted fields.",
    "settings.noExtractedFieldsYet": "No extracted fields available yet.",
    "settings.keyFieldExtractionUnavailable": "Key field extraction is not available for this document yet.",
    "settings.foundValues": "Found values",
    "settings.noKeyFieldsFound": "No key fields found yet.",
    "settings.missingKeyFields": "Missing key fields",
    "settings.noneMissing": "None missing.",
    "settings.confidence": "Confidence",
    "settings.threshold": "Threshold",
    "settings.secondsAgo": "s ago",
    "settings.minutesAgo": "m ago",
    "settings.hoursAgo": "h ago",
    "settings.aiProviders": "AI & Providers",
    "settings.aiProvidersDescription": "Configured AI providers for chat, embeddings, and document parsing",
    "settings.loadingProviderConfiguration": "Loading provider configuration...",
    "settings.unableToLoadProviderConfiguration": "Unable to load provider configuration",
    "settings.chatModel": "Chat Model",
    "settings.active": "active",
    "settings.noChatProviderConfigured": "No chat provider configured. Set `ACTIVE_CHAT_PROVIDER` with matching provider credentials, or configure any supported chat provider key.",
    "settings.chatProviders": "Chat Providers",
    "settings.configured": "configured",
    "settings.notConfigured": "not configured",
    "settings.embeddingProviders": "Embedding Providers",
    "settings.available": "available",
    "settings.parseProviders": "Parse Providers",
    "settings.fallback": "fallback",
    "settings.processingMode": "Processing Mode",
    "settings.pendingReview": "Pending Review",
    "settings.failedToFetchHealth": "Failed to fetch health",
    "settings.failedToFetchProviders": "Failed to fetch providers",
    "settings.failedToFetchReadiness": "Failed to fetch readiness",
    "settings.systemHealth": "System Health",
    "settings.systemHealthDescription": "Server status and readiness checks",
    "settings.checkingHealth": "Checking health...",
    "settings.unableToReachServer": "Unable to reach server",
    "settings.server": "Server",
    "settings.runningReadinessChecks": "Running readiness checks...",
    "settings.readinessChecks": "Readiness Checks",
    "settings.ok": "ok",
    "settings.fail": "fail",
    "upload.remove": "Remove",
    "upload.titleOverrideOptional": "Title override (optional)",
    "upload.autoDetectedFromContent": "Auto-detected from content",
    "upload.clearAll": "Clear all",
    "upload.uploading": "Uploading...",
    "upload.file": "file",
    "upload.files": "files",
    "upload.complete": "Upload complete",
    "upload.documentWas": "document was",
    "upload.documentsWere": "documents were",
    "upload.uploadedSuccessfully": "uploaded successfully",
    "upload.failed": "failed",
    "upload.viewDocuments": "View documents",
    "upload.uploadMore": "Upload more",
    "dashboard.noTasksInView": "No tasks in view",
    "dashboard.correspondent": "Correspondent",
    "dashboard.document": "Document",
    "dashboard.whatToDo": "What to do",
    "dashboard.amount": "Amount",
    "dashboard.deadline": "Deadline",
    "dashboard.action": "Action",
    "dashboard.unfiled": "Unfiled",
    "dashboard.documentFallback": "Document",
    "dashboard.overdueDays": "d overdue",
    "dashboard.daysLeft": "d left",
    "dashboard.saving": "Saving...",
    "dashboard.done": "Done",
    "dashboard.failedToCompleteTask": "Failed to complete task",
    "dashboard.loadingAtlas": "Loading dashboard atlas",
    "dashboard.failedToLoadInsights": "Failed to load dashboard insights. Please try again.",
    "dashboard.retry": "Retry",
    "dashboard.eyebrow": "Document Atlas",
    "dashboard.description": "A high-level reading room for your archive: who sends documents, what is due next, and how the archive has shifted over the last year.",
    "dashboard.totalDocuments": "Total Documents",
    "dashboard.pendingReview": "Pending Review",
    "dashboard.documentTypes": "Document Types",
    "dashboard.correspondents": "Correspondents",
    "dashboard.intakeTrend": "Intake Trend",
    "dashboard.rhythm": "12-month rhythm",
    "dashboard.openTimeline": "Open timeline",
    "dashboard.largestClusters": "Largest clusters",
    "dashboard.openGalaxyView": "Open galaxy view",
    "dashboard.deadlines": "Deadlines",
    "dashboard.upcomingTasks": "Upcoming tasks",
    "documentDetail.loadDoc": "Failed to load document",
    "documentDetail.loadText": "Failed to load document text",
    "documentDetail.loadHistory": "Failed to load document history",
    "documentDetail.backToDocuments": "Back to Documents",
    "documentDetail.notFound": "Document not found",
    "documentDetail.returnToDocuments": "Return to Documents",
    "documentDetail.documents": "Documents",
    "documentDetail.pendingReview": "Pending Review",
    "documentDetail.reviewResolved": "Review Resolved",
    "documentDetail.preview": "Preview",
    "documentDetail.ocrText": "OCR Text",
    "documentDetail.intelligence": "Intelligence",
    "documentDetail.details": "Details",
    "documentDetail.history": "History",
    "documentDetail.previewUnavailable": "Preview not available",
    "documentDetail.downloadFile": "Download File",
    "documentDetail.loadPreviewFailed": "Failed to load document preview.",
    "documentDetail.loadDocumentTextFailed": "Failed to load document text.",
    "documentDetail.noOcr": "No OCR text available for this document.",
    "documentDetail.documentPreviewTitle": "Document Preview",
    "documentDetail.loadingContent": "Loading content...",
    "documentDetail.browserNoVideo": "Your browser does not support video playback.",
    "documentDetail.browserNoAudio": "Your browser does not support audio playback.",
    "documentDetail.unsupportedPreviewPrefix": "This file type",
    "documentDetail.unsupportedPreviewSuffix": "can't be previewed in the browser. Download the file to view it.",
    "documentDetail.failedToLoadTags": "Failed to load tags",
    "documentDetail.failedToLoadCorrespondents": "Failed to load correspondents",
    "documentDetail.failedToLoadDocumentTypes": "Failed to load document types",
    "documentDetail.failedToLoadDocumentPreview": "Failed to load document preview",
    "documentDetail.failedToFetchProviders": "Failed to fetch providers",
    "documentDetail.failedToUpdateDocument": "Failed to update document",
    "documentDetail.generatedSummary": "Generated Summary",
    "documentDetail.titleCandidate": "Title candidate",
    "documentDetail.provider": "Provider",
    "documentDetail.typeSpecificFields": "Type-specific Fields",
    "documentDetail.noExtractedFields": "No extracted fields available.",
    "documentDetail.source": "Source:",
    "documentDetail.location": "Location:",
    "documentDetail.pageWord": "Page",
    "documentDetail.lineWord": "line",
    "documentDetail.taggingCorrespondent": "Tagging & Correspondent",
    "documentDetail.correspondent": "Correspondent",
    "documentDetail.strategy": "Strategy",
    "documentDetail.validation": "Validation",
    "documentDetail.warnings": "Warnings",
    "documentDetail.errors": "Errors",
    "documentDetail.runId": "Run ID",
    "documentDetail.providerOrder": "Provider order",
    "documentDetail.documentHistory": "Document History",
    "documentDetail.noAuditEvents": "No audit events recorded for this document yet.",
    "documentDetail.metadata": "Metadata",
    "documentDetail.edit": "Edit",
    "documentDetail.save": "Save",
    "documentDetail.failedToSaveChanges": "Failed to save changes.",
    "documentDetail.savingWillLock": "Saving will lock",
    "documentDetail.lockedFieldsSticky": "Already locked fields stay overridden until you clear them.",
    "documentDetail.changedFieldsSticky": "Only the fields you change will become sticky manual overrides.",
    "documentDetail.title": "Title",
    "documentDetail.selectCorrespondent": "Select correspondent",
    "documentDetail.noCorrespondent": "No correspondent",
    "documentDetail.addNewCorrespondent": "Add a new correspondent",
    "documentDetail.add": "Add",
    "documentDetail.createCorrespondentHelp": "Create a new correspondent here if it is not in the list.",
    "documentDetail.failedToCreateCorrespondent": "Failed to create correspondent.",
    "documentDetail.savingWillLockField": "Saving will lock this field.",
    "documentDetail.unknown": "Unknown",
    "documentDetail.documentType": "Document Type",
    "documentDetail.selectDocumentType": "Select document type",
    "documentDetail.noDocumentType": "No document type",
    "documentDetail.unclassified": "Unclassified",
    "documentDetail.issueDate": "Issue Date",
    "documentDetail.currency": "Currency",
    "documentDetail.unlock": "Unlock",
    "documentDetail.documentIntelligence": "Document Intelligence",
    "documentDetail.noAgentIntelligence": "No agent intelligence available for this document yet.",
    "documentDetail.routing": "Routing",
    "documentDetail.type": "Type:",
    "documentDetail.subtype": "Subtype:",
    "documentDetail.model": "Model:",
    "documentDetail.pipeline": "Pipeline",
    "documentDetail.framework": "Framework",
    "documentDetail.status": "Status",
    "documentDetail.system": "System",
    "documentDetail.noTags": "No tags",
    "documentDetail.taxonomyOptionsLoadFailed": "Failed to load taxonomy options for manual overrides.",
    "documentDetail.manualOverrides": "Manual Overrides",
    "documentDetail.none": "None",
    "documentDetail.removed": "Removed",
    "documentDetail.lockedField": "field locked",
    "documentDetail.lockedFields": "fields locked",
    "documentDetail.stickyOverrideHint": "Edits to supported fields create sticky manual overrides that survive reprocessing.",
    "documentDetail.clear": "Clear",
    "documentDetail.failedToClearOverride": "Failed to clear manual override.",
    "documentDetail.confidence": "Confidence",
    "documentDetail.processingStatus": "Processing Status",
    "documentDetail.embeddingStatus": "Embedding Status",
    "documentDetail.ocrProvider": "OCR Provider",
    "documentDetail.embeddingModel": "Embedding Model",
    "documentDetail.created": "Created",
    "documentDetail.processed": "Processed",
    "documentDetail.documentClass": "Document Class",
    "documentDetail.requiredFields": "Required Fields:",
    "documentDetail.missingFields": "Missing Fields:",
    "documentDetail.threshold": "threshold",
    "documentDetail.resolveReview": "Resolve Review",
    "documentDetail.requeue": "Requeue",
    "documentDetail.failedToResolveReview": "Failed to resolve review.",
    "documentDetail.failedToRequeue": "Failed to requeue document.",
    "documentDetail.actions": "Actions",
    "documentDetail.reprocessDocument": "Reprocess Document",
    "documentDetail.failedToReprocessDocument": "Failed to reprocess document.",
    "documentDetail.downloadOriginal": "Download Original",
    "documentDetail.downloadSearchable": "Download Searchable PDF",
    "documentDetail.deleteDocument": "Delete Document",
    "documentDetail.cannotDeleteWhileProcessing": "Documents cannot be deleted while processing is in progress.",
    "documentDetail.failedToDeleteDocument": "Failed to delete document.",
    "documentDetail.lastProcessingError": "Last Processing Error",
    "documentDetail.reprocessDialogTitle": "Reprocess Document",
    "documentDetail.reprocessDialogDescription": "Choose the OCR provider to use for reprocessing.",
    "documentDetail.selectProvider": "Select provider",
    "documentDetail.active": "active",
    "documentDetail.fallback": "fallback",
    "documentDetail.lastProcessedWith": "Last processed with:",
    "documentDetail.cancel": "Cancel",
    "documentDetail.reprocessing": "Reprocessing...",
    "documentDetail.reprocess": "Reprocess",
    "documentDetail.deleteDialogTitle": "Delete Document",
    "documentDetail.deleteDialogDescription": "This permanently deletes the document, its OCR output, embeddings, and generated files. This action cannot be undone.",
    "documentDetail.deleting": "Deleting...",
    "documentDetail.deletePermanently": "Delete Permanently",
    "documentDetail.dueDate": "Due Date",
    "documentDetail.expiryDate": "Expiry Date",
    "documentDetail.amount": "Amount",
    "documentDetail.referenceNumber": "Reference Number",
    "documentDetail.holderName": "Holder Name",
    "documentDetail.issuingAuthority": "Issuing Authority",
    "documentDetail.tags": "Tags",
    "documentDetail.filterTags": "Filter tags...",
    "documentDetail.selectedTags": "Selected tags",
    "documentDetail.searchAddTag": "Search to add an existing tag or create a new one.",
    "documentDetail.matchingTags": "Matching tags",
    "documentDetail.createTag": "Create tag",
    "documentDetail.savingWillLockAmountFields": "Saving will lock the amount fields you changed.",
    "documentDetail.savingWillLockTagSelection": "Saving will lock the tag selection.",
    "documentDetail.failedToCreateTag": "Failed to create tag.",
    "documentDetail.allMatchingTagsSelected": "All matching tags are already selected.",
    "documentDetail.noTagsMatchFilter": "No tags match the current filter.",
    "documentDetail.noTagsAvailable": "No tags available.",
    "documentDetail.askAboutDocument": "Ask about this document",
    "documentDetail.clearHistory": "Clear history",
    "documentDetail.referencedExcerpts": "Referenced excerpts",
    "documentDetail.searchingChunks": "Searching document chunks...",
    "documentDetail.failedToAnswer": "Failed to answer",
    "documentDetail.askQuestionPlaceholder": "Ask a question about this document...",
    "documentDetail.ask": "Ask",
  },
  de: {
    "root.loading": "Wird geladen...",
    "root.nav.dashboard": "Dashboard",
    "root.nav.documents": "Dokumente",
    "root.nav.review": "Prufung",
    "root.nav.search": "Suche",
    "root.nav.upload": "Hochladen",
    "root.nav.settings": "Einstellungen",
    "root.nav.logout": "Abmelden",
    "root.menu.open": "Menu offnen",
    "root.menu.close": "Menu schliessen",
    "login.description": "Melde dich bei deinem Dokumentenarchiv an",
    "login.email": "E-Mail",
    "login.password": "Passwort",
    "login.signIn": "Anmelden",
    "login.signingIn": "Anmeldung lauft...",
    "login.needSetup": "Noch nicht eingerichtet?",
    "login.goToSetup": "Zur Einrichtung",
    "setup.title": "Konto erstellen",
    "setup.description": "Richte das erste Owner-Konto fur dein OpenKeep-Archiv ein",
    "setup.displayName": "Anzeigename",
    "setup.yourName": "Dein Name",
    "setup.email": "E-Mail",
    "setup.password": "Passwort",
    "setup.passwordMin": "Mindestens 12 Zeichen",
    "setup.confirmPassword": "Passwort bestatigen",
    "setup.createAccount": "Konto erstellen",
    "setup.creatingAccount": "Konto wird erstellt...",
    "setup.alreadySetup": "Bereits eingerichtet?",
    "setup.signIn": "Anmelden",
    "setup.errorPasswordLength": "Das Passwort muss mindestens 12 Zeichen lang sein",
    "setup.errorPasswordsMatch": "Die Passworte stimmen nicht uberein",
    "settings.title": "Einstellungen",
    "settings.subtitle": "Verwalte dein Konto und die Systemkonfiguration",
    "settings.userProfile": "Benutzerprofil",
    "settings.accountInfo": "Deine Kontoinformationen",
    "settings.displayName": "Anzeigename",
    "settings.email": "E-Mail",
    "settings.role": "Rolle",
    "settings.owner": "Owner",
    "settings.user": "Benutzer",
    "settings.languagePreferences": "Spracheinstellungen",
    "settings.languagePreferencesDescription": "Wahle die App-Sprache und wie die KI verarbeiten und antworten soll.",
    "settings.uiLanguage": "App-Sprache",
    "settings.aiProcessingLanguage": "KI-Verarbeitungssprache",
    "settings.aiChatLanguage": "Antwortsprache der KI im Chat",
    "settings.english": "Englisch",
    "settings.german": "Deutsch",
    "settings.saving": "Wird gespeichert...",
    "settings.savePreferences": "Einstellungen speichern",
    "settings.preferencesSaved": "Einstellungen gespeichert.",
    "settings.preferencesSaveFailed": "Einstellungen konnten nicht gespeichert werden.",
    "settings.unknown": "Unbekannt",
    "settings.failedToFetchTokens": "Token konnten nicht geladen werden",
    "settings.failedToCreateToken": "Token konnte nicht erstellt werden",
    "settings.failedToDeleteToken": "Token konnte nicht geloscht werden",
    "settings.apiTokensTitle": "API-Token",
    "settings.apiTokensDescription": "Verwalte API-Token fur den programmatischen Zugriff",
    "settings.createToken": "Token erstellen",
    "settings.tokenCreated": "Token erstellt",
    "settings.tokenCreatedDescription": "Kopiere dieses Token jetzt. Es wird nicht erneut angezeigt.",
    "settings.tokenShownOnce": "Dieses Token wird nur einmal angezeigt. Bewahre es sicher auf.",
    "settings.done": "Fertig",
    "settings.createApiToken": "API-Token erstellen",
    "settings.createApiTokenDescription": "Erstelle ein neues Token fur den API-Zugriff",
    "settings.name": "Name",
    "settings.expiryOptional": "Ablaufdatum (optional)",
    "settings.createTokenFailed": "Token konnte nicht erstellt werden. Bitte versuche es erneut.",
    "settings.cancel": "Abbrechen",
    "settings.creating": "Wird erstellt...",
    "settings.create": "Erstellen",
    "settings.loadTokensFailed": "Token konnten nicht geladen werden.",
    "settings.noApiTokens": "Noch keine API-Token erstellt",
    "settings.lastUsed": "Zuletzt verwendet",
    "settings.neverUsed": "Nie verwendet",
    "settings.expires": "Lauft ab",
    "settings.noExpiry": "Kein Ablaufdatum",
    "settings.delete": "Loschen",
    "settings.deleteConfirm": "Loschen?",
    "settings.yes": "Ja",
    "settings.no": "Nein",
    "settings.tokenNamePlaceholder": "z. B. CI/CD Pipeline",
    "settings.taxonomyManagement": "Taxonomie-Verwaltung",
    "settings.taxonomyManagementDescription": "Pflege KI-generierte Bezeichnungen fur Tags, Korrespondenzen und Dokumenttypen.",
    "settings.tags": "Tags",
    "settings.tagsDescription": "Leichte Kategorien, die im gesamten Archiv verwendet werden.",
    "settings.correspondents": "Korrespondenzen",
    "settings.correspondentsDescription": "Organisationen und Personen, die als Absender oder Gegenparteien erkannt wurden.",
    "settings.documentTypes": "Dokumenttypen",
    "settings.documentTypesDescription": "Stabile Typbezeichnungen wie Rechnung, Vertrag oder Abrechnung.",
    "settings.failedToLoadTags": "Tags konnten nicht geladen werden",
    "settings.failedToLoadCorrespondents": "Korrespondenzen konnten nicht geladen werden",
    "settings.failedToLoadDocumentTypes": "Dokumenttypen konnten nicht geladen werden",
    "settings.failedToCreateTag": "Tag konnte nicht erstellt werden",
    "settings.failedToCreateCorrespondent": "Korrespondenz konnte nicht erstellt werden",
    "settings.failedToCreateDocumentType": "Dokumenttyp konnte nicht erstellt werden",
    "settings.failedToUpdateTag": "Tag konnte nicht aktualisiert werden",
    "settings.failedToUpdateCorrespondent": "Korrespondenz konnte nicht aktualisiert werden",
    "settings.failedToUpdateDocumentType": "Dokumenttyp konnte nicht aktualisiert werden",
    "settings.failedToDeleteTag": "Tag konnte nicht geloscht werden",
    "settings.failedToDeleteCorrespondent": "Korrespondenz konnte nicht geloscht werden",
    "settings.failedToDeleteDocumentType": "Dokumenttyp konnte nicht geloscht werden",
    "settings.failedToMergeTag": "Tag konnte nicht zusammengefuhrt werden",
    "settings.failedToMergeCorrespondent": "Korrespondenz konnte nicht zusammengefuhrt werden",
    "settings.failedToMergeDocumentType": "Dokumenttyp konnte nicht zusammengefuhrt werden",
    "settings.add": "Hinzufugen",
    "settings.save": "Speichern",
    "settings.edit": "Bearbeiten",
    "settings.merge": "Zusammenfuhren",
    "settings.nameSuffix": "Name",
    "settings.mergeInto": "Zusammenfuhren in",
    "settings.selectTarget": "Ziel auswahlen",
    "settings.confirmMerge": "Zusammenfuhren bestatigen",
    "settings.createItemPlaceholder": "Name eingeben",
    "settings.createItemFailed": "Element konnte nicht erstellt werden.",
    "settings.loadItemsFailed": "Elemente konnten nicht geladen werden.",
    "settings.noItemsCreated": "Noch keine Elemente erstellt.",
    "settings.updateItemFailed": "Element konnte nicht aktualisiert werden.",
    "settings.archivePortability": "Archiv-Portabilitat",
    "settings.archivePortabilityDescription": "Exportiere Schnappschusse, stelle sie wieder her und starte die Watch-Folder-Verarbeitung.",
    "settings.exportSnapshot": "Schnappschuss exportieren",
    "settings.dryRunEnabled": "Testlauf aktiviert",
    "settings.dryRunDisabled": "Testlauf deaktiviert",
    "settings.scanWatchFolder": "Watch Folder scannen",
    "settings.exportArchiveFailed": "Archiv-Export fehlgeschlagen.",
    "settings.snapshotJson": "Schnappschuss-JSON",
    "settings.replace": "Ersetzen",
    "settings.snapshotPlaceholder": "Exportiere einen Schnappschuss oder fuge hier einen fur den Import ein",
    "settings.importSnapshot": "Schnappschuss importieren",
    "settings.importArchiveFailed": "Archiv-Import fehlgeschlagen.",
    "settings.lastImportResult": "Letztes Importergebnis",
    "settings.watchFolderScan": "Watch-Folder-Scan",
    "settings.path": "Pfad",
    "settings.imported": "Importiert",
    "settings.duplicates": "Duplikate",
    "settings.unsupported": "Nicht unterstutzt",
    "settings.failures": "Fehler",
    "settings.planned": "Geplant",
    "settings.total": "Gesamt",
    "settings.currentScanResults": "Aktuelle Scan-Ergebnisse",
    "settings.itemOne": "Eintrag",
    "settings.itemOther": "Eintrage",
    "settings.reason": "Grund",
    "settings.destination": "Ziel",
    "settings.openDocument": "Dokument offnen",
    "settings.inspectExtractedFields": "Extrahierte Felder prufen",
    "settings.currentScanIssues": "Aktuelle Scan-Probleme",
    "settings.code": "Code",
    "settings.recentScans": "Letzte Scans",
    "settings.liveScan": "Live-Scan",
    "settings.failedToScanWatchFolder": "Watch Folder konnte nicht gescannt werden.",
    "settings.failedToLoadScanResultDetails": "Details des Scan-Ergebnisses konnten nicht geladen werden",
    "settings.failedToExportArchive": "Archiv konnte nicht exportiert werden",
    "settings.failedToImportArchive": "Archiv konnte nicht importiert werden",
    "settings.failedToFetchStatus": "Status konnte nicht geladen werden",
    "settings.processingActivity": "Verarbeitungsaktivitat",
    "settings.processingActivityDescription": "Queue-Tiefen, Dokumentstatus-Aufschlusselung und letzte Jobs",
    "settings.failedToLoadProcessingStatus": "Verarbeitungsstatus konnte nicht geladen werden.",
    "settings.ocrQueue": "OCR-Queue",
    "settings.embedQueue": "Embedding-Queue",
    "settings.totalDocs": "Dokumente gesamt",
    "settings.documentsByStatus": "Dokumente nach Status",
    "settings.recentJobs": "Letzte Jobs",
    "settings.noProcessingJobs": "Noch keine Verarbeitungsjobs.",
    "settings.loadingExtractedFields": "Extrahierte Felder werden geladen...",
    "settings.failedToLoadExtractedFields": "Extrahierte Felder konnten nicht geladen werden.",
    "settings.noExtractedFieldsYet": "Noch keine extrahierten Felder verfugbar.",
    "settings.keyFieldExtractionUnavailable": "Die Extraktion von Schlusselfeldern ist fur dieses Dokument noch nicht verfugbar.",
    "settings.foundValues": "Gefundene Werte",
    "settings.noKeyFieldsFound": "Noch keine Schlusselfelder gefunden.",
    "settings.missingKeyFields": "Fehlende Schlusselfelder",
    "settings.noneMissing": "Keine fehlend.",
    "settings.confidence": "Konfidenz",
    "settings.threshold": "Schwelle",
    "settings.secondsAgo": "s her",
    "settings.minutesAgo": "m her",
    "settings.hoursAgo": "h her",
    "settings.aiProviders": "KI & Anbieter",
    "settings.aiProvidersDescription": "Konfigurierte KI-Anbieter fur Chat, Embeddings und Dokumentverarbeitung",
    "settings.loadingProviderConfiguration": "Anbieterkonfiguration wird geladen...",
    "settings.unableToLoadProviderConfiguration": "Anbieterkonfiguration konnte nicht geladen werden",
    "settings.chatModel": "Chat-Modell",
    "settings.active": "aktiv",
    "settings.noChatProviderConfigured": "Kein Chat-Anbieter konfiguriert. Setze `ACTIVE_CHAT_PROVIDER` mit passenden Zugangsdaten oder konfiguriere einen unterstutzten Chat-Anbieter.",
    "settings.chatProviders": "Chat-Anbieter",
    "settings.configured": "konfiguriert",
    "settings.notConfigured": "nicht konfiguriert",
    "settings.embeddingProviders": "Embedding-Anbieter",
    "settings.available": "verfugbar",
    "settings.parseProviders": "Parse-Anbieter",
    "settings.fallback": "Fallback",
    "settings.processingMode": "Verarbeitungsmodus",
    "settings.pendingReview": "Prufung ausstehend",
    "settings.failedToFetchHealth": "Health-Status konnte nicht geladen werden",
    "settings.failedToFetchProviders": "Anbieter konnten nicht geladen werden",
    "settings.failedToFetchReadiness": "Readiness konnte nicht geladen werden",
    "settings.systemHealth": "Systemzustand",
    "settings.systemHealthDescription": "Serverstatus und Readiness-Prufungen",
    "settings.checkingHealth": "Health wird gepruft...",
    "settings.unableToReachServer": "Server konnte nicht erreicht werden",
    "settings.server": "Server",
    "settings.runningReadinessChecks": "Readiness-Prufungen laufen...",
    "settings.readinessChecks": "Readiness-Prufungen",
    "settings.ok": "ok",
    "settings.fail": "fehler",
    "upload.remove": "Entfernen",
    "upload.titleOverrideOptional": "Titeluberschreibung (optional)",
    "upload.autoDetectedFromContent": "Automatisch aus dem Inhalt erkannt",
    "upload.clearAll": "Alle entfernen",
    "upload.uploading": "Wird hochgeladen...",
    "upload.file": "Datei",
    "upload.files": "Dateien",
    "upload.complete": "Upload abgeschlossen",
    "upload.documentWas": "Dokument wurde",
    "upload.documentsWere": "Dokumente wurden",
    "upload.uploadedSuccessfully": "erfolgreich hochgeladen",
    "upload.failed": "fehlgeschlagen",
    "upload.viewDocuments": "Dokumente ansehen",
    "upload.uploadMore": "Mehr hochladen",
    "dashboard.noTasksInView": "Keine Aufgaben in Ansicht",
    "dashboard.correspondent": "Korrespondenz",
    "dashboard.document": "Dokument",
    "dashboard.whatToDo": "Aufgabe",
    "dashboard.amount": "Betrag",
    "dashboard.deadline": "Frist",
    "dashboard.action": "Aktion",
    "dashboard.unfiled": "Nicht zugeordnet",
    "dashboard.documentFallback": "Dokument",
    "dashboard.overdueDays": "T uberfallig",
    "dashboard.daysLeft": "T verbleibend",
    "dashboard.saving": "Wird gespeichert...",
    "dashboard.done": "Erledigt",
    "dashboard.failedToCompleteTask": "Aufgabe konnte nicht abgeschlossen werden",
    "dashboard.loadingAtlas": "Dashboard-Atlas wird geladen",
    "dashboard.failedToLoadInsights": "Dashboard-Einblicke konnten nicht geladen werden. Bitte versuche es erneut.",
    "dashboard.retry": "Erneut versuchen",
    "dashboard.eyebrow": "Dokumentenatlas",
    "dashboard.description": "Ein hochrangiger Leseraum fur dein Archiv: wer Dokumente sendet, was als Nächstes fallig ist und wie sich das Archiv im letzten Jahr verschoben hat.",
    "dashboard.totalDocuments": "Dokumente gesamt",
    "dashboard.pendingReview": "Prufung ausstehend",
    "dashboard.documentTypes": "Dokumenttypen",
    "dashboard.correspondents": "Korrespondenzen",
    "dashboard.intakeTrend": "Dokumenteneingang",
    "dashboard.rhythm": "Rhythmus der letzten 12 Monate",
    "dashboard.openTimeline": "Zeitachse offnen",
    "dashboard.largestClusters": "Grosste Cluster",
    "dashboard.openGalaxyView": "Galaxieansicht offnen",
    "dashboard.deadlines": "Fristen",
    "dashboard.upcomingTasks": "Bevorstehende Aufgaben",
    "documentDetail.loadDoc": "Dokument konnte nicht geladen werden",
    "documentDetail.loadText": "Dokumenttext konnte nicht geladen werden",
    "documentDetail.loadHistory": "Dokumentverlauf konnte nicht geladen werden",
    "documentDetail.backToDocuments": "Zuruck zu Dokumenten",
    "documentDetail.notFound": "Dokument nicht gefunden",
    "documentDetail.returnToDocuments": "Zu Dokumenten zuruckkehren",
    "documentDetail.documents": "Dokumente",
    "documentDetail.pendingReview": "Prufung ausstehend",
    "documentDetail.reviewResolved": "Prufung abgeschlossen",
    "documentDetail.preview": "Vorschau",
    "documentDetail.ocrText": "OCR-Text",
    "documentDetail.intelligence": "Intelligenz",
    "documentDetail.details": "Details",
    "documentDetail.history": "Verlauf",
    "documentDetail.previewUnavailable": "Vorschau nicht verfugbar",
    "documentDetail.downloadFile": "Datei herunterladen",
    "documentDetail.loadPreviewFailed": "Dokumentvorschau konnte nicht geladen werden.",
    "documentDetail.loadDocumentTextFailed": "Dokumenttext konnte nicht geladen werden.",
    "documentDetail.noOcr": "Kein OCR-Text fur dieses Dokument verfugbar.",
    "documentDetail.documentPreviewTitle": "Dokumentvorschau",
    "documentDetail.loadingContent": "Inhalt wird geladen...",
    "documentDetail.browserNoVideo": "Dein Browser unterstutzt keine Videowiedergabe.",
    "documentDetail.browserNoAudio": "Dein Browser unterstutzt keine Audiowiedergabe.",
    "documentDetail.unsupportedPreviewPrefix": "Dieser Dateityp",
    "documentDetail.unsupportedPreviewSuffix": "kann im Browser nicht angezeigt werden. Lade die Datei herunter, um sie anzusehen.",
    "documentDetail.failedToLoadTags": "Tags konnten nicht geladen werden",
    "documentDetail.failedToLoadCorrespondents": "Korrespondenzen konnten nicht geladen werden",
    "documentDetail.failedToLoadDocumentTypes": "Dokumenttypen konnten nicht geladen werden",
    "documentDetail.failedToLoadDocumentPreview": "Dokumentvorschau konnte nicht geladen werden",
    "documentDetail.failedToFetchProviders": "Anbieter konnten nicht geladen werden",
    "documentDetail.failedToUpdateDocument": "Dokument konnte nicht aktualisiert werden",
    "documentDetail.generatedSummary": "Generierte Zusammenfassung",
    "documentDetail.titleCandidate": "Titelvorschlag",
    "documentDetail.provider": "Anbieter",
    "documentDetail.typeSpecificFields": "Typspezifische Felder",
    "documentDetail.noExtractedFields": "Keine extrahierten Felder verfugbar.",
    "documentDetail.source": "Quelle:",
    "documentDetail.location": "Position:",
    "documentDetail.pageWord": "Seite",
    "documentDetail.lineWord": "Zeile",
    "documentDetail.taggingCorrespondent": "Tags & Korrespondenz",
    "documentDetail.correspondent": "Korrespondenz",
    "documentDetail.strategy": "Strategie",
    "documentDetail.validation": "Validierung",
    "documentDetail.warnings": "Warnungen",
    "documentDetail.errors": "Fehler",
    "documentDetail.runId": "Lauf-ID",
    "documentDetail.providerOrder": "Anbieter-Reihenfolge",
    "documentDetail.documentHistory": "Dokumentverlauf",
    "documentDetail.noAuditEvents": "Fur dieses Dokument wurden noch keine Audit-Ereignisse aufgezeichnet.",
    "documentDetail.metadata": "Metadaten",
    "documentDetail.edit": "Bearbeiten",
    "documentDetail.save": "Speichern",
    "documentDetail.failedToSaveChanges": "Anderungen konnten nicht gespeichert werden.",
    "documentDetail.savingWillLock": "Speichern sperrt",
    "documentDetail.lockedFieldsSticky": "Bereits gesperrte Felder bleiben uberschrieben, bis du sie leerst.",
    "documentDetail.changedFieldsSticky": "Nur geanderte Felder werden zu dauerhaften manuellen Uberschreibungen.",
    "documentDetail.title": "Titel",
    "documentDetail.selectCorrespondent": "Korrespondenz auswahlen",
    "documentDetail.noCorrespondent": "Keine Korrespondenz",
    "documentDetail.addNewCorrespondent": "Neue Korrespondenz hinzufugen",
    "documentDetail.add": "Hinzufugen",
    "documentDetail.createCorrespondentHelp": "Erstelle hier eine neue Korrespondenz, falls sie nicht in der Liste steht.",
    "documentDetail.failedToCreateCorrespondent": "Korrespondenz konnte nicht erstellt werden.",
    "documentDetail.savingWillLockField": "Speichern sperrt dieses Feld.",
    "documentDetail.unknown": "Unbekannt",
    "documentDetail.documentType": "Dokumenttyp",
    "documentDetail.selectDocumentType": "Dokumenttyp auswahlen",
    "documentDetail.noDocumentType": "Kein Dokumenttyp",
    "documentDetail.unclassified": "Nicht klassifiziert",
    "documentDetail.issueDate": "Ausstellungsdatum",
    "documentDetail.currency": "Wahrung",
    "documentDetail.unlock": "Entsperren",
    "documentDetail.documentIntelligence": "Dokumentintelligenz",
    "documentDetail.noAgentIntelligence": "Fur dieses Dokument ist noch keine Agentenintelligenz verfugbar.",
    "documentDetail.routing": "Routing",
    "documentDetail.type": "Typ:",
    "documentDetail.subtype": "Untertyp:",
    "documentDetail.model": "Modell:",
    "documentDetail.pipeline": "Pipeline",
    "documentDetail.framework": "Framework",
    "documentDetail.status": "Status",
    "documentDetail.system": "System",
    "documentDetail.noTags": "Keine Tags",
    "documentDetail.taxonomyOptionsLoadFailed": "Taxonomieoptionen fur manuelle Uberschreibungen konnten nicht geladen werden.",
    "documentDetail.manualOverrides": "Manuelle Uberschreibungen",
    "documentDetail.none": "Keine",
    "documentDetail.removed": "Entfernt",
    "documentDetail.lockedField": "Feld gesperrt",
    "documentDetail.lockedFields": "Felder gesperrt",
    "documentDetail.stickyOverrideHint": "Bearbeitungen an unterstutzten Feldern erzeugen manuelle Uberschreibungen, die eine Neuverarbeitung uberstehen.",
    "documentDetail.clear": "Leeren",
    "documentDetail.failedToClearOverride": "Manuelle Uberschreibung konnte nicht entfernt werden.",
    "documentDetail.confidence": "Konfidenz",
    "documentDetail.processingStatus": "Verarbeitungsstatus",
    "documentDetail.embeddingStatus": "Embedding-Status",
    "documentDetail.ocrProvider": "OCR-Anbieter",
    "documentDetail.embeddingModel": "Embedding-Modell",
    "documentDetail.created": "Erstellt",
    "documentDetail.processed": "Verarbeitet",
    "documentDetail.documentClass": "Dokumentenklasse",
    "documentDetail.requiredFields": "Pflichtfelder:",
    "documentDetail.missingFields": "Fehlende Felder:",
    "documentDetail.threshold": "Schwelle",
    "documentDetail.resolveReview": "Prufung abschliessen",
    "documentDetail.requeue": "Neu einreihen",
    "documentDetail.failedToResolveReview": "Prufung konnte nicht abgeschlossen werden.",
    "documentDetail.failedToRequeue": "Dokument konnte nicht neu eingereiht werden.",
    "documentDetail.actions": "Aktionen",
    "documentDetail.reprocessDocument": "Dokument neu verarbeiten",
    "documentDetail.failedToReprocessDocument": "Dokument konnte nicht neu verarbeitet werden.",
    "documentDetail.downloadOriginal": "Original herunterladen",
    "documentDetail.downloadSearchable": "Durchsuchbares PDF herunterladen",
    "documentDetail.deleteDocument": "Dokument loschen",
    "documentDetail.cannotDeleteWhileProcessing": "Dokumente konnen nicht geloscht werden, wahrend die Verarbeitung lauft.",
    "documentDetail.failedToDeleteDocument": "Dokument konnte nicht geloscht werden.",
    "documentDetail.lastProcessingError": "Letzter Verarbeitungsfehler",
    "documentDetail.reprocessDialogTitle": "Dokument neu verarbeiten",
    "documentDetail.reprocessDialogDescription": "Wahle den OCR-Anbieter fur die Neuverarbeitung aus.",
    "documentDetail.selectProvider": "Anbieter auswahlen",
    "documentDetail.active": "aktiv",
    "documentDetail.fallback": "Fallback",
    "documentDetail.lastProcessedWith": "Zuletzt verarbeitet mit:",
    "documentDetail.cancel": "Abbrechen",
    "documentDetail.reprocessing": "Neuverarbeitung lauft...",
    "documentDetail.reprocess": "Neu verarbeiten",
    "documentDetail.deleteDialogTitle": "Dokument loschen",
    "documentDetail.deleteDialogDescription": "Dies loscht das Dokument, seine OCR-Ausgabe, Embeddings und generierten Dateien dauerhaft. Diese Aktion kann nicht ruckgangig gemacht werden.",
    "documentDetail.deleting": "Wird geloscht...",
    "documentDetail.deletePermanently": "Dauerhaft loschen",
    "documentDetail.dueDate": "Falligkeitsdatum",
    "documentDetail.expiryDate": "Ablaufdatum",
    "documentDetail.amount": "Betrag",
    "documentDetail.referenceNumber": "Referenznummer",
    "documentDetail.holderName": "Name des Inhabers",
    "documentDetail.issuingAuthority": "Ausstellende Behorde",
    "documentDetail.tags": "Tags",
    "documentDetail.filterTags": "Tags filtern...",
    "documentDetail.selectedTags": "Ausgewahlte Tags",
    "documentDetail.searchAddTag": "Suche nach bestehenden Tags oder erstelle einen neuen.",
    "documentDetail.matchingTags": "Passende Tags",
    "documentDetail.createTag": "Tag erstellen",
    "documentDetail.savingWillLockAmountFields": "Speichern sperrt die geanderten Betragsfelder.",
    "documentDetail.savingWillLockTagSelection": "Speichern sperrt die Tag-Auswahl.",
    "documentDetail.failedToCreateTag": "Tag konnte nicht erstellt werden.",
    "documentDetail.allMatchingTagsSelected": "Alle passenden Tags sind bereits ausgewahlt.",
    "documentDetail.noTagsMatchFilter": "Keine Tags entsprechen dem aktuellen Filter.",
    "documentDetail.noTagsAvailable": "Keine Tags verfugbar.",
    "documentDetail.askAboutDocument": "Fragen zu diesem Dokument",
    "documentDetail.clearHistory": "Verlauf leeren",
    "documentDetail.referencedExcerpts": "Referenzierte Auszuge",
    "documentDetail.searchingChunks": "Dokumentabschnitte werden durchsucht...",
    "documentDetail.failedToAnswer": "Antwort konnte nicht erzeugt werden",
    "documentDetail.askQuestionPlaceholder": "Eine Frage zu diesem Dokument stellen...",
    "documentDetail.ask": "Fragen",
  },
};

type I18nContextValue = {
  language: AppLanguage;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("de")) {
    return "de";
  }

  return "en";
}

export function I18nProvider({
  language,
  children,
}: {
  language?: AppLanguage | null;
  children: ReactNode;
}) {
  const activeLanguage = language ?? detectBrowserLanguage();
  const value = useMemo<I18nContextValue>(() => ({
    language: activeLanguage,
    t: (key) => messages[activeLanguage][key],
  }), [activeLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return context;
}
