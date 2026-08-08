import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { GoogleIdentityClaims } from "../types";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export function validateGoogleClaims(
  payload: JWTPayload,
  audience: string,
): GoogleIdentityClaims {
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!GOOGLE_ISSUERS.has(String(payload.iss))) {
    throw new Error("Google issued an unexpected token issuer.");
  }
  if (!tokenAudiences.includes(audience)) {
    throw new Error("Google issued the token for a different application.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("The Google account identifier is missing.");
  }
  if (typeof payload.email !== "string" || !payload.email) {
    throw new Error("The Google account email is missing.");
  }
  if (payload.email_verified !== true) {
    throw new Error("The Google account email is not verified.");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: true,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

export async function verifyGoogleIdToken(idToken: string, audience: string) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    algorithms: ["RS256"],
    audience,
    issuer: [...GOOGLE_ISSUERS],
  });
  return validateGoogleClaims(payload, audience);
}
