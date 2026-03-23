import slugify from "slugify";

export const DEFAULT_DOCUMENT_TYPE_NAMES = [
  "Invoice",
  "Receipt",
  "Contract",
  "Letter",
  "Statement",
  "Insurance",
  "Tax Document",
  "Payslip",
  "Utility Bill",
  "Medical",
  "Certificate",
  "Warranty",
  "Manual",
  "Form",
  "Notice",
  "ID",
  "Travel",
  "Ticket",
  "Order",
  "Delivery Note",
  "Legal",
  "Report",
] as const;

export const createDefaultDocumentTypeValues = () =>
  DEFAULT_DOCUMENT_TYPE_NAMES.map((name) => ({
    name,
    slug: slugify(name, {
      lower: true,
      strict: true,
      trim: true,
    }).slice(0, 255),
    description: null,
  }));
