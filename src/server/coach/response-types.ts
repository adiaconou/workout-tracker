export type CoachToolChoice = "auto" | "none";
export type CoachResponseItem = { type?: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type?: string; text?: string }>; [key: string]: unknown };
export type CoachResponse = { id: string; status?: string; output?: CoachResponseItem[]; error?: { message?: string } | null; incomplete_details?: { reason?: string } | null; requestId?: string; usage?: { input_tokens: number; output_tokens: number; total_tokens: number; input_tokens_details?: { cached_tokens: number }; output_tokens_details?: { reasoning_tokens: number } } };
export type CoachToolActivity = { name: string; status: "succeeded" | "failed" };
