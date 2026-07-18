export type WorkerEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  OWNER_EMAIL?: string;
  AUTH_SESSION_SECRET?: string;
  GOOGLE_WEB_CLIENT_ID?: string;
};

export type ApiUser = {
  id: string;
  email: string;
  displayName: string;
  provider: "chatgpt" | "google" | "session";
  sessionId: string | null;
};

export type GoogleIdentityClaims = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
};
