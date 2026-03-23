CREATE TABLE "correspondent_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "correspondent_id" uuid NOT NULL REFERENCES "correspondents"("id") ON DELETE cascade,
  "alias" varchar(255) NOT NULL,
  "normalized_alias" varchar(255) NOT NULL,
  "source" varchar(32) NOT NULL DEFAULT 'import',
  "confidence" numeric(3, 2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "correspondent_aliases_correspondent_idx"
  ON "correspondent_aliases" ("correspondent_id");

CREATE UNIQUE INDEX "correspondent_aliases_normalized_alias_idx"
  ON "correspondent_aliases" ("normalized_alias");
