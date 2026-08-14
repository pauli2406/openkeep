-- Deadlines that announce themselves (#249/#250): the server persists the fact
-- that a deadline entered a warning window, exactly once per document+window+
-- due date, so delivery channels can each deliver exactly once.
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" varchar(64) DEFAULT 'deadline' NOT NULL,
	"window" varchar(32) NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"email_delivered_at" timestamp with time zone,
	"desktop_delivered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_document_window_due_idx" ON "notifications" USING btree ("document_id","window","due_date");
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");
