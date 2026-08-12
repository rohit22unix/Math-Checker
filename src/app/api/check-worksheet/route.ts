import { NextResponse } from "next/server";

import {
  formatGradedReport,
  gradeProblems,
  mergeWorkSteps,
  parseExtractedProblems,
  parseWorkSteps,
} from "@/lib/worksheet-grading";

export const GRADING_VERSION_MARKER = "Graded by Math-Checker (server-side)";

export const runtime = "nodejs";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3-vl:4b-instruct";
const ANALYSIS_TIMEOUT_MS = 180_000;
const OLLAMA_OPTIONS = {
  temperature: 0.0,
  num_ctx: 8192,
  num_predict: 640,
};
const CONTEXT_SIZE_ERROR_MESSAGE =
  "This worksheet image needs more AI processing space. Please try again. If the problem continues, use a clearer photo containing only the worksheet page.";
const TIMEOUT_ERROR_MESSAGE =
  "The local AI timed out. Please try a tighter crop of the worksheet, a clearer photo, or a page with fewer questions.";
const EXTRACTION_PROMPT = `Read this Kumon-style math worksheet image.

For each numbered problem (1) through (4), extract:
- printed_expression: the printed problem exactly as shown
- last_operation_before_answer: the student's last operation line before the final answer (e.g. "3/8 x 2/1" or "1/2 - 3/8"). Ignore scratch cancellations.
- written_final_answer: the fraction written after the last equals sign

Rules:
- Ignore name/date boxes, score tables, borders, and shadows.
- Do not grade or compute answers.
- For handwritten digits, look carefully at 4 vs 9, 1 vs 7, and 6 vs 0.
- If the final digit is ambiguous, write "unclear".

Return ONLY a valid JSON array with no markdown:
[{"number":1,"printed_expression":"...","last_operation_before_answer":"...","written_final_answer":"..."}]`;

const WORK_STEP_PROMPT = `Look at this Kumon worksheet again.

For each numbered problem (1) through (4), read the student's last line of work immediately before the final equals sign and answer. Examples: "3/8 x 2/1", "1/2 x 8/5", "1/2 - 3/8".

Return ONLY valid JSON, no markdown:
[{"number":1,"last_operation_before_answer":"3/8 x 2/1"}]`;

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
  const message = record?.message as Record<string, unknown> | undefined;

  const value =
    message?.content ||
    record?.response ||
    record?.thinking ||
    message?.thinking ||
    ((record?.choices as Array<Record<string, unknown>> | undefined)?.[0]
      ?.message as Record<string, unknown> | undefined)?.content ||
    "";

  return typeof value === "string" ? value.trim() : "";
}

function isLegacyModelGradingOutput(text: string): boolean {
  return (
    /Summary:\s*\d+\s*,\s*\d+/i.test(text) &&
    !text.includes(GRADING_VERSION_MARKER)
  );
}

async function extractWorksheetProblems(
  ollamaUrl: string,
  ollamaModel: string,
  base64Image: string,
  rawAnalysis: string
) {
  let extracted = rawAnalysis ? parseExtractedProblems(rawAnalysis) : [];

  if (!extracted.length && rawAnalysis && isLegacyModelGradingOutput(rawAnalysis)) {
    return {
      extracted: [],
      needsAppUpdate: true,
    };
  }

  try {
    const workStepResponse = await callOllamaChat(
      ollamaUrl,
      ollamaModel,
      base64Image,
      WORK_STEP_PROMPT
    );

    if (workStepResponse.ok) {
      const workStepPayload = await workStepResponse.json();
      const workStepText = extractAnalysisText(workStepPayload);
      const workSteps = workStepText ? parseWorkSteps(workStepText) : [];

      if (workSteps.length && extracted.length) {
        extracted = mergeWorkSteps(extracted, workSteps);
      }
    }
  } catch {
    // Keep first-pass extraction if the work-step request fails.
  }

  return { extracted, needsAppUpdate: false };
}

async function callOllamaChat(
  ollamaUrl: string,
  model: string,
  base64Image: string,
  prompt: string
): Promise<Response> {
  return fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      options: OLLAMA_OPTIONS,
      messages: [
        {
          role: "user",
          content: prompt,
          images: [base64Image],
        },
      ],
    }),
    signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
  });
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

    let ollamaResponse: Response | null = null;
    let selectedOllamaUrl = "";
    let lastOllamaErrorDetail = "";

    for (const ollamaUrl of candidateUrls) {
      try {
        ollamaResponse = await callOllamaChat(
          ollamaUrl,
          ollamaModel,
          base64Image,
          EXTRACTION_PROMPT
        );

        if (ollamaResponse.ok) {
          selectedOllamaUrl = ollamaUrl;
          break;
        }

        lastOllamaErrorDetail = await ollamaResponse.text();
        break;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return NextResponse.json(
            { error: TIMEOUT_ERROR_MESSAGE },
            { status: 504 }
          );
        }
      }
    }

    if (!ollamaResponse) {
      return NextResponse.json(
        {
          error:
            "Could not reach the local Ollama server. Please make sure Ollama is running.",
        },
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
    let rawAnalysis = extractAnalysisText(payload);
    let { extracted, needsAppUpdate } = selectedOllamaUrl
      ? await extractWorksheetProblems(
          selectedOllamaUrl,
          ollamaModel,
          base64Image,
          rawAnalysis
        )
      : { extracted: [], needsAppUpdate: false };

    if (!extracted.length && selectedOllamaUrl && !needsAppUpdate) {
      const retryResponse = await callOllamaChat(
        selectedOllamaUrl,
        ollamaModel,
        base64Image,
        `${EXTRACTION_PROMPT}\n\nImportant: respond with JSON only. Do not grade problems.`
      );

      if (retryResponse.ok) {
        const retryPayload = await retryResponse.json();
        rawAnalysis = extractAnalysisText(retryPayload);
        ({ extracted, needsAppUpdate } = await extractWorksheetProblems(
          selectedOllamaUrl,
          ollamaModel,
          base64Image,
          rawAnalysis
        ));
      }
    }

    if (needsAppUpdate) {
      return NextResponse.json(
        {
          analysis:
            "This result came from an older app build on your machine. Run: git pull origin cursor/fix-vision-worksheet-analysis && npm install && npm run build && npm run start -- --hostname 0.0.0.0",
          gradingVersion: "legacy",
        },
        { status: 200 }
      );
    }

    const analysisText =
      extracted.length > 0 ? formatGradedReport(gradeProblems(extracted)) : null;

    if (!analysisText) {
      return NextResponse.json(
        {
          analysis:
            "The local model did not return structured worksheet data. Please restart the app to pick up the latest version, then try again with a clear photo.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      analysis: analysisText.trim(),
      durationMs: Date.now() - startedAt,
      gradingVersion: "server-side-v2",
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
