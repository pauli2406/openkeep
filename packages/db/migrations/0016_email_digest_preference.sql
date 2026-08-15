-- Email digest is opt-in per user (#251): off by default, toggled via preferences.
ALTER TABLE "users" ADD COLUMN "email_digest_enabled" boolean DEFAULT false NOT NULL;
