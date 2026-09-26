export type AiChatSettings = {
  on: boolean;
  endpoint: string;
  model: string;
  systemPrompt: string;
};

const DEFAULT_ENDPOINT = "http://127.0.0.1:1337/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_PROMPT = "Отвечай по-русски, дружелюбно и очень кратко. Ответ должен быть ровно 5–9 простых слов, без кавычек, пояснений и префикса имени.";

export const AI_CHAT_DEFAULTS: AiChatSettings = { on: false, endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL, systemPrompt: DEFAULT_PROMPT };

function clean(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : fallback;
}

export function sanitizeAiChat(raw: unknown): AiChatSettings {
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { on: o.on === true, endpoint: clean(o.endpoint, 300, DEFAULT_ENDPOINT).replace(/\/+$/u, ""), model: clean(o.model, 100, DEFAULT_MODEL), systemPrompt: clean(o.systemPrompt, 1200, DEFAULT_PROMPT) };
}

function compact(text: string): string {
  const oneLine = String(text ?? "").replace(/[\r\n]+/g, " ").replace(/^\s*[^:]{1,24}:\s*/u, "").trim();
  return oneLine.split(/\s+/u).filter(Boolean).slice(0, 9).join(" ").slice(0, 160);
}

export async function askG4f(settings: AiChatSettings, name: string, message: string): Promise<string> {
  const cfg = sanitizeAiChat(settings);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const res = await fetch(`${cfg.endpoint}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: cfg.model, temperature: 0.7, max_tokens: 80, messages: [{ role: "system", content: cfg.systemPrompt }, { role: "user", content: `${name} написал: ${message}` }] }), signal: controller.signal });
    if (!res.ok) throw new Error(`g4f HTTP ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
    const choice = data.choices?.[0];
    const raw = choice?.message?.content ?? choice?.text ?? "";
    const answer = compact(typeof raw === "string" ? raw : "");
    if (answer === "") throw new Error("g4f вернул пустой ответ");
    return answer;
  } finally { clearTimeout(timer); }
}
