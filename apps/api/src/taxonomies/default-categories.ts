import slugify from "slugify";

/**
 * The canonical life domains every archive starts with. Builtin categories
 * can be renamed but not deleted — the deterministic assignment below and
 * the intelligence prompt rely on the slugs staying resolvable.
 */
export const DEFAULT_CATEGORIES = [
  "Housing",
  "Insurance",
  "Finance",
  "Health",
  "Taxes & Authorities",
  "Work",
  "Mobility",
  "Shopping",
  "Subscriptions",
  "Legal",
  "Family & Education",
  "Other",
] as const;

export const categorySlug = (name: string): string =>
  slugify(name, { lower: true, strict: true, trim: true }).slice(0, 255);

export const createDefaultCategoryValues = () =>
  DEFAULT_CATEGORIES.map((name) => ({
    name,
    slug: categorySlug(name),
    builtin: true,
  }));

/**
 * Deterministic fallback: the dominant document type names the life domain.
 * Keyed by canonical document type name (see DEFAULT_DOCUMENT_TYPES), valued
 * by builtin category slug. Types without an entry stay uncategorized until
 * the LLM or the user decides.
 */
export const DOCUMENT_TYPE_CATEGORY_SLUGS: Record<string, string> = {
  "Utility Bill": "housing",
  Insurance: "insurance",
  Statement: "finance",
  "Portfolio Statement": "finance",
  "Trade Confirmation": "finance",
  "Financial Information": "finance",
  Invoice: "shopping",
  Receipt: "shopping",
  Order: "shopping",
  "Delivery Note": "shopping",
  Giftcard: "shopping",
  Medical: "health",
  "Tax Document": "taxes-and-authorities",
  "Tax Statement": "taxes-and-authorities",
  Notice: "taxes-and-authorities",
  Payslip: "work",
  Contract: "legal",
  Legal: "legal",
  Ticket: "mobility",
  Travel: "mobility",
};
