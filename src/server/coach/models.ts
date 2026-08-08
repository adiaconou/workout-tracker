export type AssistantModelOption = {
  id: string;
  label: string;
  created: number;
  reasoningEfforts: string[];
};

export const fallbackAssistantModelIds = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"];

export function fallbackAssistantModels() {
  return fallbackAssistantModelIds.map((id, index) => assistantModelOption(id, fallbackAssistantModelIds.length - index));
}

export function assistantModelOption(id: string, created: number): AssistantModelOption {
  return { id, label: assistantModelLabel(id), created, reasoningEfforts: reasoningEffortsForModel(id) };
}

export function reasoningEffortsForModel(model: string) {
  const minorVersion = /^gpt-5\.(\d+)(?:-|$)/u.exec(model)?.[1];
  if (minorVersion && Number(minorVersion) >= 6) return ["auto", "none", "low", "medium", "high", "xhigh", "max"];
  if (minorVersion && Number(minorVersion) >= 4) return ["auto", "none", "low", "medium", "high", "xhigh"];
  if (/^gpt-5(?:-|$)/u.test(model)) return ["auto", "minimal", "low", "medium", "high"];
  if (/^o\d(?:-|$)/u.test(model)) return ["auto", "low", "medium", "high"];
  return ["auto"];
}

export function isCompatibleAssistantModel(model: string) {
  if (!/^(?:gpt-|o\d|chat-latest$)/u.test(model)) return false;
  return !/(?:audio|image|realtime|tts|whisper|transcrib|moderation|embedding|sora|search|computer-use|codex)/iu.test(model);
}

function assistantModelLabel(model: string) {
  return model.split("-").map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase()}${part.slice(1)}`).join(" ");
}
