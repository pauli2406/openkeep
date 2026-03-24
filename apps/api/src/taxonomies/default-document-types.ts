import type { ReviewEvidenceField } from "@openkeep/types";
import slugify from "slugify";

export const DEFAULT_DOCUMENT_TYPES = [
  {
    name: "Invoice",
    requiredFields: [
      "correspondent",
      "issueDate",
      "dueDate",
      "amount",
      "currency",
      "referenceNumber",
    ],
  },
  {
    name: "Receipt",
    requiredFields: ["correspondent", "issueDate", "amount", "currency"],
  },
  {
    name: "Contract",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Giftcard",
    requiredFields: ["correspondent", "amount", "currency"],
  },
  {
    name: "Letter",
    requiredFields: ["correspondent", "issueDate"],
  },
  {
    name: "Statement",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
  },
  {
    name: "Insurance",
    requiredFields: ["correspondent", "issueDate", "dueDate", "referenceNumber"],
  },
  {
    name: "Tax Document",
    requiredFields: ["correspondent", "issueDate", "dueDate", "referenceNumber"],
  },
  {
    name: "Tax Statement",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
  },
  {
    name: "Payslip",
    requiredFields: ["correspondent", "issueDate", "amount", "currency"],
  },
  {
    name: "Portfolio Statement",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
  },
  {
    name: "Trade Confirmation",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
  },
  {
    name: "Financial Information",
    requiredFields: ["correspondent", "issueDate"],
  },
  {
    name: "Utility Bill",
    requiredFields: [
      "correspondent",
      "issueDate",
      "dueDate",
      "amount",
      "currency",
      "referenceNumber",
    ],
  },
  {
    name: "Medical",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Certificate",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Warranty",
    requiredFields: ["correspondent", "issueDate", "referenceNumber", "expiryDate"],
  },
  {
    name: "Manual",
    requiredFields: [],
  },
  {
    name: "Form",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Notice",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "ID",
    requiredFields: [
      "holderName",
      "issuingAuthority",
      "referenceNumber",
      "issueDate",
      "expiryDate",
    ],
  },
  {
    name: "Travel",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Ticket",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Order",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
  },
  {
    name: "Delivery Note",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Legal",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
  },
  {
    name: "Report",
    requiredFields: ["correspondent", "issueDate"],
  },
] as const satisfies ReadonlyArray<{
  name: string;
  requiredFields: readonly ReviewEvidenceField[];
}>;

export const DEFAULT_DOCUMENT_TYPE_NAMES = DEFAULT_DOCUMENT_TYPES.map((type) => type.name);

export const createDefaultDocumentTypeValues = () =>
  DEFAULT_DOCUMENT_TYPES.map(({ name, requiredFields }) => ({
    name,
    slug: slugify(name, {
      lower: true,
      strict: true,
      trim: true,
    }).slice(0, 255),
    description: null,
    requiredFields: [...requiredFields],
  }));
