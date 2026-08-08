export type WorkerEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  ALLOWED_USER_EMAILS?: string;
  OWNER_EMAIL?: string;
  AUTH_SESSION_SECRET?: string;
  GOOGLE_WEB_CLIENT_ID?: string;
  OPENAI_API_KEY?: string;
  OPENAI_DEFAULT_MODEL?: string;
  OPENAI_API_BASE_URL?: string;
};

export type ApiUser = {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
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
