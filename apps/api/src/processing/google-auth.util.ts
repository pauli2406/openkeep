import { createSign } from "crypto";

interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

const base64UrlEncode = (value: string | Buffer) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

export const getGoogleCloudAccessToken = async (config: {
  accessToken?: string;
  serviceAccountJson?: string;
}): Promise<string> => {
  if (config.accessToken) {
    return config.accessToken;
  }

  if (!config.serviceAccountJson) {
    throw new Error("Google Cloud credentials are not configured");
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const serviceAccount = JSON.parse(config.serviceAccountJson) as GoogleServiceAccount;
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.client_email,
      sub: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );

  const unsignedAssertion = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedAssertion);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsignedAssertion}.${base64UrlEncode(signature)}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token request failed with status ${response.status}`);
  }

  const result = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!result.access_token) {
    throw new Error("Google OAuth token response did not include an access token");
  }

  cachedToken = {
    accessToken: result.access_token,
    expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000,
  };

  return result.access_token;
};
