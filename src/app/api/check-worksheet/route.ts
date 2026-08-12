import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3-vl:4b";
const ANALYSIS_TIMEOUT_MS = 35_000;
const CONTEXT_SIZE_ERROR_MESSAGE =
  "This worksheet image needs more AI processing space. Please try again. If the problem continues, use a clearer photo containing only the worksheet page.";
const TIMEOUT_ERROR_MESSAGE =
  "The local AI timed out. Please try a tighter crop of the worksheet, a clearer photo, or a page with fewer questions.";

function getOllamaConfig() {
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  const configuredUrl = process.env.OLLAMA_URL?.trim();

  const candidateUrls = Array.from(
    new Set(
      [configuredUrl, DEFAULT_OLLAMA_URL, "http://localhost:11434"].filter(
        (value): value is string => Boolean(value)
      )
    )
  );

  return { ollamaModel, candidateUrls };
}

function extractOllamaErrorMessage(payload: unknown): string {
  if (typeof payload === "string") {
    try {
      return extractOllamaErrorMessage(JSON.parse(payload));
    } catch {
      return payload;
    }
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    if (typeof record.error === "string") {
      return extractOllamaErrorMessage(record.error);
    }

    if (record.error && typeof record.error === "object") {
      return extractOllamaErrorMessage(record.error);
    }

    if (typeof record.message === "string") {
      return record.message;
    }
  }

  return "";
}

function toFriendlyOllamaErrorMessage(rawMessage: string): string {
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    normalizedMessage.includes("exceeds the available context size") ||
    normalizedMessage.includes("exceed_context_size_error")
  ) {
    return CONTEXT_SIZE_ERROR_MESSAGE;
  }

  return "The local Ollama server returned an error while analyzing the worksheet.";
}

function extractAnalysisText(payload: unknown): string {
  const record = payload as Record<string, unknown>;

  const value =
    record?.response ||
    (record?.message as Record<string, unknown> | undefined)?.content ||
    (record?.message as Record<string, unknown> | undefined)?.thinking ||
    ((record?.choices as Array<Record<string, unknown>> | undefined)?.[0]
      ?.message as Record<string, unknown> | undefined)?.content ||
    "";

  return typeof value === "string" ? value.trim() : "";
}

function extractFallbackText(payload: unknown): string {
  const candidates: string[] = [];

  function walk(value: unknown) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length >= 12) {
        candidates.push(trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }

    if (value && typeof value === "object") {
      for (const nestedValue of Object.values(value as Record<string, unknown>)) {
        walk(nestedValue);
      }
    }
  }

  walk(payload);

  // Prefer the longest non-empty textual field as a best-effort fallback.
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const formData = await request.formData();
    const file = formData.get("worksheet");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No worksheet image was provided." },
        { status: 400 }
      );
    }

    if (!file.size || file.size === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty." },
        { status: 400 }
      );
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "The uploaded image is larger than 25 MB." },
        { status: 413 }
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "The uploaded file must be an image." },
        { status: 400 }
      );
    }

    const { ollamaModel, candidateUrls } = getOllamaConfig();
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

      const prompt = `You are checking one Kumon-style math worksheet image.
    Only use content that is clearly visible.
    Ignore the name/date area, score boxes, page borders, shadows, and faint scratch work.
    Focus on the numbered problems on the page, usually (1) through (4).
    For each visible problem, identify:
    - the printed expression
    - the student's final answer only, not intermediate steps
    - one status: Correct, Incorrect, Unanswered, or Unclear
    If the final answer is not clearly isolated from the student's scratch work, mark it Unclear.
    Return very short output in this format:
    Summary: total visible problems, correct, incorrect, unanswered, unclear.
    1. problem | student answer | correct answer | status
    2. ...
    Keep the response brief.`;

    let ollamaResponse: Response | null = null;
    let selectedOllamaUrl = "";
    let lastFetchError: unknown = null;
    let lastOllamaErrorDetail = "";

    for (const ollamaUrl of candidateUrls) {
      try {
        ollamaResponse = await fetch(`${ollamaUrl}/api/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: ollamaModel,
            stream: false,
            prompt,
            images: [base64Image],
            options: {
              temperature: 0.0,
              num_ctx: 2048,
              num_predict: 320,
            },
          }),
          signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
        });

        if (ollamaResponse.ok) {
          selectedOllamaUrl = ollamaUrl;
          break;
        }

        // Non-OK from Ollama is a model-side outcome, not a host failover case.
        lastOllamaErrorDetail = await ollamaResponse.text();
        break;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return NextResponse.json(
            { error: TIMEOUT_ERROR_MESSAGE },
            { status: 504 }
          );
        }

        lastFetchError = error;
      }
    }

    if (!ollamaResponse) {
      return NextResponse.json(
        { error: "Could not reach the local Ollama server. Please make sure Ollama is running." },
        { status: 502 }
      );
    }

    if (!ollamaResponse.ok) {
      const rawMessage = extractOllamaErrorMessage(lastOllamaErrorDetail);

      return NextResponse.json(
        {
          error: rawMessage
            ? toFriendlyOllamaErrorMessage(rawMessage)
            : "The local Ollama server returned an error while analyzing the worksheet.",
        },
        { status: 502 }
      );
    }

    const payload = await ollamaResponse.json();
    let analysisText = extractAnalysisText(payload);

    if (!analysisText && selectedOllamaUrl) {
      try {
        const fallbackResponse = await fetch(`${selectedOllamaUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: ollamaModel,
            stream: false,
            options: {
              temperature: 0.0,
              num_ctx: 1024,
              num_predict: 180,
            },
            messages: [
              {
                role: "user",
                content:
                  "Describe only the clearly readable worksheet content and any visible final answers. Keep it very short.",
                images: [base64Image],
              },
            ],
          }),
          signal: AbortSignal.timeout(12_000),
        });

        if (fallbackResponse.ok) {
          const fallbackPayload = await fallbackResponse.json();
          analysisText = extractAnalysisText(fallbackPayload);
        }
      } catch {
        // Keep the original empty result behavior if fallback request fails.
      }
    }

    if (!analysisText) {
      analysisText = extractFallbackText(payload);
    }

    if (!analysisText) {
      return NextResponse.json(
        {
          analysis:
            "The local model could not extract readable worksheet text from this image. Try cropping to one worked problem at a time, improving lighting, and removing shadows. If possible, upload separate photos for top and bottom halves.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      analysis: analysisText.trim(),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("Worksheet check failed", error);

    return NextResponse.json(
      {
        error: "The server could not process the worksheet. Please try again.",
      },
      { status: 500 }
    );
  }
}
