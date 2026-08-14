-- Cross-process state (#256): the API reports on work the worker process did,
-- e.g. when the mailbox was last polled. One row per key.
CREATE TABLE "app_state" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
