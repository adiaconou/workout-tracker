export function profileDisplayName(displayName: string, email: string) {
  const name = displayName.trim();
  return name && name.toLowerCase() !== email.trim().toLowerCase() ? name : email.trim();
}

export function profileInitials(displayName: string, email: string) {
  const display = profileDisplayName(displayName, email);
  const source = display.includes("@") ? display.split("@")[0] ?? "" : display;
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

export function safeProfilePhotoUrl(photoUrl?: string | null) {
  const value = photoUrl?.trim() ?? "";
  return /^https:\/\/\S+$/i.test(value) ? value : null;
}
