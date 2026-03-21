export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  type: "user" | "api-token";
  tokenId?: string;
}

