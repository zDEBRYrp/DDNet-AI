export type AiChatSettings = {
  on: boolean;
  endpoint: string;
  provider: string;
  model: string;
  systemPrompt: string;
};

export type AiChatResult = { text: string; provider: string; model: string };

const DEFAULT_ENDPOINT = "http://127.0.0.1:1337/v1";
// Keep the default on a provider/model pair that was verified against the
// bundled local G4F server.  Gemini/OpenaiChat may be listed by /v1/models but
// can currently return 429 or an empty completion without an API key.
const DEFAULT_PROVIDER = "Cloudflare";
const DEFAULT_MODEL = "llama-3.3-70b";
const DEFAULT_PROMPT = "Отвечай по-русски, дружелюбно и очень кратко. Ответ должен быть ровно 5–9 простых слов, без кавычек, пояснений и префикса имени.";

export const AI_CHAT_DEFAULTS: AiChatSettings = { on: false, endpoint: DEFAULT_ENDPOINT, provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, systemPrompt: DEFAULT_PROMPT };

function clean(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : fallback;
}

export function sanitizeAiChat(raw: unknown): AiChatSettings {
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const provider = clean(o.provider, 100, DEFAULT_PROVIDER);
  const model = clean(o.model, 100, DEFAULT_MODEL);
  // Migrate the old built-in pairs as well as fresh settings.  Without this,
  // an existing autochat.json would silently keep a provider that is listed
  // by G4F but currently returns 429/empty completions.
  const oldDefault =
    (provider.toLowerCase() === "openaichat" && model.toLowerCase() === "gpt-4o-mini") ||
    (provider.toLowerCase() === "gemini" && model.toLowerCase() === "gemini-2.0-flash");
  const staleCloudflareModel = provider.toLowerCase() === DEFAULT_PROVIDER.toLowerCase() && model.toLowerCase().startsWith("@cf/");
  return {
    on: o.on === true,
    endpoint: clean(o.endpoint, 300, DEFAULT_ENDPOINT).replace(/\/+$/u, ""),
    provider: oldDefault || staleCloudflareModel ? DEFAULT_PROVIDER : provider,
    model: oldDefault || staleCloudflareModel ? DEFAULT_MODEL : model,
    systemPrompt: clean(o.systemPrompt, 1200, DEFAULT_PROMPT),
  };
}

function compact(text: string): string {
  const oneLine = String(text ?? "").replace(/[\r\n]+/g, " ").replace(/^\s*[^:]{1,24}:\s*/u, "").trim();
  // Some G4F providers advertise text models but return an HTML audio/image
  // widget. Never pass markup or a media URL into the game chat as an answer.
  if (/<(?:audio|img|video|iframe)\b|https?:\/\/[^\s]+\.(?:mp3|wav|png|jpg|webm)(?:\?|$)/iu.test(oneLine)) return "";
  return oneLine.split(/\s+/u).filter(Boolean).slice(0, 9).join(" ").slice(0, 160);
}

function contentOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const part = value as { text?: unknown; content?: unknown };
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    return "";
  }
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => contentOf(part))
    .filter(Boolean)
    .join(" ");
}

async function requestCompletion(cfg: AiChatSettings, provider: string, model: string, name: string, message: string): Promise<AiChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${cfg.endpoint}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, provider, temperature: 0.7, max_tokens: 80, messages: [{ role: "system", content: cfg.systemPrompt }, { role: "user", content: `${name} написал: ${message}` }] }), signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = body.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
      throw new Error(`g4f ${provider}/${model} HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
    const choice = data.choices?.[0];
    const raw = choice?.message?.content ?? choice?.text ?? "";
    const answer = compact(contentOf(raw));
    if (answer === "") throw new Error(`g4f ${provider}/${model} вернул пустой ответ`);
    return { text: answer, provider, model };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`g4f ${provider}/${model}: таймаут ответа (10 с)`);
    }
    throw err;
  } finally { clearTimeout(timer); }
}

export async function askG4fDetailed(settings: AiChatSettings, name: string, message: string): Promise<AiChatResult> {
  const cfg = sanitizeAiChat(settings);
  try {
      return await requestCompletion(cfg, cfg.provider, cfg.model, name, message);
  } catch (first) {
    const fallbackSame = cfg.provider.toLowerCase() === DEFAULT_PROVIDER.toLowerCase() && cfg.model.toLowerCase() === DEFAULT_MODEL.toLowerCase();
    if (fallbackSame) throw first;
    try {
      // G4F providers are external and can fail independently.  Keep the
      // chosen pair in settings, but make a failed custom route recover with
      // the locally verified free route instead of dropping the chat reply.
      return await requestCompletion(cfg, DEFAULT_PROVIDER, DEFAULT_MODEL, name, message);
    } catch (fallback) {
      const firstText = first instanceof Error ? first.message : String(first);
      const fallbackText = fallback instanceof Error ? fallback.message : String(fallback);
      throw new Error(`${firstText}; fallback ${DEFAULT_PROVIDER}/${DEFAULT_MODEL}: ${fallbackText}`);
    }
  }
}

export async function askG4f(settings: AiChatSettings, name: string, message: string): Promise<string> {
  return (await askG4fDetailed(settings, name, message)).text;
}
