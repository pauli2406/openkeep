ALTER TABLE "document_types"
ADD COLUMN "required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

ALTER TABLE "documents"
ADD COLUMN "expiry_date" date;
--> statement-breakpoint

ALTER TABLE "documents"
ADD COLUMN "holder_name" varchar(255);
--> statement-breakpoint

ALTER TABLE "documents"
ADD COLUMN "issuing_authority" varchar(255);
--> statement-breakpoint

UPDATE "document_types"
SET "required_fields" = CASE "slug"
  WHEN 'invoice' THEN '["correspondent","issueDate","dueDate","amount","currency","referenceNumber"]'::jsonb
  WHEN 'receipt' THEN '["correspondent","issueDate","amount","currency"]'::jsonb
  WHEN 'contract' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'letter' THEN '["correspondent","issueDate"]'::jsonb
  WHEN 'statement' THEN '["correspondent","issueDate","amount","currency","referenceNumber"]'::jsonb
  WHEN 'insurance' THEN '["correspondent","issueDate","dueDate","referenceNumber"]'::jsonb
  WHEN 'tax-document' THEN '["correspondent","issueDate","dueDate","referenceNumber"]'::jsonb
  WHEN 'payslip' THEN '["correspondent","issueDate","amount","currency"]'::jsonb
  WHEN 'utility-bill' THEN '["correspondent","issueDate","dueDate","amount","currency","referenceNumber"]'::jsonb
  WHEN 'medical' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'certificate' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'warranty' THEN '["correspondent","issueDate","referenceNumber","expiryDate"]'::jsonb
  WHEN 'manual' THEN '[]'::jsonb
  WHEN 'form' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'notice' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'id' THEN '["holderName","issuingAuthority","referenceNumber","issueDate","expiryDate"]'::jsonb
  WHEN 'travel' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'ticket' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'order' THEN '["correspondent","issueDate","amount","currency","referenceNumber"]'::jsonb
  WHEN 'delivery-note' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'legal' THEN '["correspondent","issueDate","referenceNumber"]'::jsonb
  WHEN 'report' THEN '["correspondent","issueDate"]'::jsonb
  ELSE "required_fields"
END;
