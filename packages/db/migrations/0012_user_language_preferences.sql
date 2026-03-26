ALTER TABLE "users"
ADD COLUMN "ui_language" varchar(8) NOT NULL DEFAULT 'en',
ADD COLUMN "ai_processing_language" varchar(8) NOT NULL DEFAULT 'en',
ADD COLUMN "ai_chat_language" varchar(8) NOT NULL DEFAULT 'en';
