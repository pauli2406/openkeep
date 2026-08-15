-- Documents arrive by email (#253/#254): each polled message is recorded once,
-- keyed by its RFC 5322 Message-ID, with its outcome — imported, skipped, or
-- rejected — so the poller is idempotent and "why did my forward not arrive"
-- is answerable.
CREATE TABLE "ingested_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"from_address" text DEFAULT '' NOT NULL,
	"subject" text,
	"received_at" timestamp with time zone,
	"status" varchar(32) NOT NULL,
	"reason" text,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingested_emails_message_id_idx" ON "ingested_emails" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "ingested_emails_created_at_idx" ON "ingested_emails" USING btree ("created_at");
