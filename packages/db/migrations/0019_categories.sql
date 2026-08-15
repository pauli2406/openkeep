-- Browse the archive by life domain (#270/#271): categories are a first-class
-- taxonomy — seeded canonical life domains plus user-defined ones — assigned
-- per correspondent with a recorded source so manual choices always win.
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");
--> statement-breakpoint
ALTER TABLE "correspondents" ADD COLUMN "category_id" uuid;
--> statement-breakpoint
ALTER TABLE "correspondents" ADD COLUMN "category_source" varchar(16);
--> statement-breakpoint
ALTER TABLE "correspondents" ADD CONSTRAINT "correspondents_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
