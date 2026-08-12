export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3-vl:2b-instruct";
export const DEFAULT_KEEP_ALIVE = "30m";
export const ANALYSIS_TIMEOUT_MS = 120_000;

export function getOllamaConfig() {
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  const configuredUrl = process.env.OLLAMA_URL?.trim();
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE?.trim() || DEFAULT_KEEP_ALIVE;
  const fastMode = process.env.OLLAMA_FAST_MODE === "true";

  const candidateUrls = Array.from(
    new Set(
      [configuredUrl, DEFAULT_OLLAMA_URL, "http://localhost:11434"].filter(
        (value): value is string => Boolean(value)
      )
    )
  );

  return { ollamaModel, candidateUrls, keepAlive, fastMode };
}

export function getOllamaOptions(fastMode = false) {
  if (fastMode) {
    return {
      temperature: 0.0,
      num_ctx: 2048,
      num_predict: 180,
    };
  }

  return {
    temperature: 0.0,
    num_ctx: 3072,
    num_predict: 220,
  };
}

export async function callOllamaChat(params: {
  ollamaUrl: string;
  model: string;
  prompt: string;
  base64Image?: string;
  keepAlive?: string;
  fastMode?: boolean;
  timeoutMs?: number;
}): Promise<Response> {
  const message: {
    role: "user";
    content: string;
    images?: string[];
  } = {
    role: "user",
    content: params.prompt,
  };

  if (params.base64Image) {
    message.images = [params.base64Image];
  }

  return fetch(`${params.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      stream: false,
      keep_alive: params.keepAlive || DEFAULT_KEEP_ALIVE,
      options: getOllamaOptions(params.fastMode),
      messages: [message],
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? ANALYSIS_TIMEOUT_MS),
  });
}

export async function getOllamaProcessorStatus(ollamaUrl: string): Promise<string> {
  try {
    const response = await fetch(`${ollamaUrl}/api/ps`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return "unknown";
    }

    const payload = (await response.json()) as {
      models?: Array<{ size?: number; size_vram?: number }>;
    };

    const model = payload.models?.[0];

    if (!model?.size || model.size_vram === undefined) {
      return "cpu";
    }

    const gpuPercent = Math.round((model.size_vram / model.size) * 100);

    if (gpuPercent >= 80) {
      return "gpu";
    }

    if (gpuPercent <= 5) {
      return "cpu";
    }

    return `hybrid ${100 - gpuPercent}% CPU / ${gpuPercent}% GPU`;
  } catch {
    return "unknown";
  }
}

export async function warmOllamaModel(): Promise<{
  ok: boolean;
  model: string;
  ollamaUrl: string;
  processor: string;
  error?: string;
}> {
  const { ollamaModel, candidateUrls, keepAlive } = getOllamaConfig();

  for (const ollamaUrl of candidateUrls) {
    try {
      const response = await callOllamaChat({
        ollamaUrl,
        model: ollamaModel,
        prompt: "Reply with OK.",
        keepAlive,
        timeoutMs: 60_000,
      });

      if (response.ok) {
        const processor = await getOllamaProcessorStatus(ollamaUrl);

        return { ok: true, model: ollamaModel, ollamaUrl, processor };
      }
    } catch {
      // Try the next Ollama host.
    }
  }

  return {
    ok: false,
    model: ollamaModel,
    ollamaUrl: candidateUrls[0] || DEFAULT_OLLAMA_URL,
    processor: "offline",
    error: "Could not warm the local Ollama model.",
  };
}
