import { ensureEntitySchema } from "../infrastructure/d1/entity-schema";
import {
  accessTokenExpiresIn,
  generateRefreshToken,
  hashRefreshToken,
  issueAccessToken,
  refreshExpiration,
  verifyAccessToken,
} from "./session-tokens";
import type { ApiUser, GoogleIdentityClaims, WorkerEnv } from "./types";

type UserRow = {
  id: string;
  ownerEmail: string;
  displayName: string;
  photoUrl: string | null;
};

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizedPhotoUrl(value?: string | null) {
  const photoUrl = value?.trim() ?? "";
  return /^https:\/\/\S+$/i.test(photoUrl) ? photoUrl : null;
}

function configuredOwner(env: WorkerEnv) {
  const owner = env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) throw new Error("OWNER_EMAIL is not configured.");
  return owner;
}

function sessionSecret(env: WorkerEnv) {
  if (!env.AUTH_SESSION_SECRET) throw new Error("AUTH_SESSION_SECRET is not configured.");
  return env.AUTH_SESSION_SECRET;
}

export async function ensureAppUser(
  env: WorkerEnv,
  email: string,
  displayName?: string | null,
  photoUrl?: string | null,
) {
  await ensureEntitySchema(env.DB);
  const ownerEmail = normalizedEmail(email);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(`SELECT id, owner_email AS ownerEmail,
    display_name AS displayName, photo_url AS photoUrl
    FROM app_users WHERE owner_email = ?`)
    .bind(ownerEmail)
    .first<UserRow>();
  if (existing) {
    const nextName = displayName?.trim() || existing.displayName;
    const nextPhotoUrl = normalizedPhotoUrl(photoUrl) ?? existing.photoUrl;
    if (nextName !== existing.displayName || nextPhotoUrl !== existing.photoUrl) {
      await env.DB.prepare(`UPDATE app_users SET display_name = ?, photo_url = ?,
        updated_at = ? WHERE id = ?`)
        .bind(nextName, nextPhotoUrl, now, existing.id).run();
      return { ...existing, displayName: nextName, photoUrl: nextPhotoUrl };
    }
    return existing;
  }

  const user = {
    id: crypto.randomUUID(),
    ownerEmail,
    displayName: displayName?.trim() || ownerEmail,
    photoUrl: normalizedPhotoUrl(photoUrl),
  };
  await env.DB.prepare(`INSERT INTO app_users (
    id, owner_email, display_name, photo_url, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(user.id, user.ownerEmail, user.displayName, user.photoUrl, now, now)
    .run();
  return user;
}

export async function authenticateRequest(
  request: Request,
  env: WorkerEnv,
): Promise<ApiUser | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    try {
      const claims = await verifyAccessToken(
        sessionSecret(env),
        authorization.slice("Bearer ".length),
      );
      const session = await env.DB.prepare(`SELECT s.id, u.id AS userId,
        u.owner_email AS ownerEmail, u.display_name AS displayName, u.photo_url AS photoUrl
        FROM auth_sessions s INNER JOIN app_users u ON u.id = s.user_id
        WHERE s.id = ? AND u.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`)
        .bind(claims.sid, claims.sub, new Date().toISOString())
        .first<{ id: string; userId: string; ownerEmail: string; displayName: string; photoUrl: string | null }>();
      if (!session || normalizedEmail(session.ownerEmail) !== normalizedEmail(claims.email)) {
        return null;
      }
      return {
        id: session.userId,
        email: session.ownerEmail,
        displayName: session.displayName,
        photoUrl: session.photoUrl,
        provider: "session",
        sessionId: session.id,
      };
    } catch {
      return null;
    }
  }

  const email = request.headers.get("oai-authenticated-user-email");
  if (!email || normalizedEmail(email) !== configuredOwner(env)) return null;
  const fullNameEncoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let displayName = email;
  if (encodedName && fullNameEncoding === "percent-encoded-utf-8") {
    try {
      displayName = decodeURIComponent(encodedName);
    } catch {
      displayName = email;
    }
  }
  const user = await ensureAppUser(env, email, displayName);
  return {
    id: user.id,
    email: user.ownerEmail,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
    provider: "chatgpt",
    sessionId: null,
  };
}

export async function linkGoogleIdentity(
  env: WorkerEnv,
  claims: GoogleIdentityClaims,
) {
  const email = normalizedEmail(claims.email);
  if (email !== configuredOwner(env)) {
    throw new Error("This Google account is not authorized for this workout tracker.");
  }
  const now = new Date().toISOString();
  const user = await ensureAppUser(env, email, claims.name, claims.picture);
  const identity = await env.DB.prepare(`SELECT id, user_id AS userId
    FROM auth_identities WHERE provider = 'google' AND provider_subject = ?`)
    .bind(claims.sub)
    .first<{ id: string; userId: string }>();
  if (identity && identity.userId !== user.id) {
    throw new Error("This Google identity is linked to a different account.");
  }
  if (identity) {
    await env.DB.prepare(`UPDATE auth_identities SET email = ?, email_verified = 1,
      last_seen_at = ? WHERE id = ?`)
      .bind(email, now, identity.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO auth_identities (
      id, user_id, provider, provider_subject, email, email_verified,
      created_at, last_seen_at
    ) VALUES (?, ?, 'google', ?, ?, 1, ?, ?)`)
      .bind(crypto.randomUUID(), user.id, claims.sub, email, now, now).run();
  }
  return user;
}

export async function createNativeSession(
  env: WorkerEnv,
  user: UserRow,
  deviceName: string,
) {
  const now = new Date().toISOString();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = await hashRefreshToken(refreshToken);
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO auth_sessions (
    id, user_id, refresh_token_hash, device_name, expires_at, revoked_at,
    created_at, rotated_at, last_used_at
  ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
    .bind(
      sessionId,
      user.id,
      refreshTokenHash,
      deviceName.trim().slice(0, 120) || "Android device",
      refreshExpiration(),
      now,
      now,
      now,
    )
    .run();
  const accessToken = await issueAccessToken(
    sessionSecret(env),
    { id: user.id, email: user.ownerEmail },
    sessionId,
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenExpiresIn,
    user: {
      id: user.id,
      email: user.ownerEmail,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
    },
  };
}

export async function rotateNativeSession(env: WorkerEnv, refreshToken: string) {
  const oldHash = await hashRefreshToken(refreshToken);
  const now = new Date().toISOString();
  const session = await env.DB.prepare(`SELECT s.id, s.user_id AS userId,
    u.owner_email AS ownerEmail, u.display_name AS displayName, u.photo_url AS photoUrl
    FROM auth_sessions s INNER JOIN app_users u ON u.id = s.user_id
    WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`)
    .bind(oldHash, now)
    .first<{ id: string; userId: string; ownerEmail: string; displayName: string; photoUrl: string | null }>();
  if (!session) return null;

  const nextRefreshToken = generateRefreshToken();
  const nextHash = await hashRefreshToken(nextRefreshToken);
  const result = await env.DB.prepare(`UPDATE auth_sessions SET refresh_token_hash = ?,
    rotated_at = ?, last_used_at = ? WHERE id = ? AND refresh_token_hash = ?
    AND revoked_at IS NULL`)
    .bind(nextHash, now, now, session.id, oldHash).run();
  if (Number(result.meta.changes ?? 0) !== 1) return null;

  const accessToken = await issueAccessToken(
    sessionSecret(env),
    { id: session.userId, email: session.ownerEmail },
    session.id,
  );
  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresIn: accessTokenExpiresIn,
    user: {
      id: session.userId,
      email: session.ownerEmail,
      displayName: session.displayName,
      photoUrl: session.photoUrl,
    },
  };
}

export async function revokeNativeSession(env: WorkerEnv, sessionId: string) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ?,
    last_used_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(now, now, sessionId).run();
  return Number(result.meta.changes ?? 0) === 1;
}
