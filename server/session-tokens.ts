import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const ACCESS_ISSUER = "workout-tracker-api";
const ACCESS_AUDIENCE = "workout-tracker-app";
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export type AccessClaims = JWTPayload & {
  sub: string;
  email: string;
  sid: string;
};

function secretKey(secret: string) {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(secret);
}

export async function issueAccessToken(
  secret: string,
  user: { id: string; email: string },
  sessionId: string,
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(ACCESS_ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL_SECONDS)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(secret: string, token: string) {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    issuer: ACCESS_ISSUER,
    audience: ACCESS_AUDIENCE,
    algorithms: ["HS256"],
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.sid !== "string"
  ) {
    throw new Error("The access token is missing required claims.");
  }
  return payload as AccessClaims;
}

export function generateRefreshToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

export async function hashRefreshToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

export function refreshExpiration(now = Date.now()) {
  return new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString();
}

export const accessTokenExpiresIn = ACCESS_TTL_SECONDS;

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
