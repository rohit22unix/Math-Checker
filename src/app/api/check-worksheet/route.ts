import { NextResponse } from "next/server";

import {
  ANALYSIS_TIMEOUT_MS,
  callOllamaChat,
  getOllamaConfig,
} from "@/lib/ollama-config";
import {
  formatGradedReport,
  gradeProblems,
  mergeExtractedProblems,
  mergeWorkSteps,
  parseExtractedProblems,
  parseWorkSteps,
  problemsNeedingWorkStepPass,
  type ExtractedProblem,
} from "@/lib/worksheet-grading";
import { splitWorksheetIntoQuadrants } from "@/lib/worksheet-image";

export const GRADING_VERSION_MARKER = "Graded by Math-Checker (server-side)";

export const runtime = "nodejs";

const CONTEXT_SIZE_ERROR_MESSAGE =
  "This worksheet image needs more AI processing space. Please try again. If the problem continues, use a clearer photo containing only the worksheet page.";
const TIMEOUT_ERROR_MESSAGE =
  "The local AI timed out. Please try a tighter crop of the worksheet, a clearer photo, or a page with fewer questions.";
const EXTRACTION_PROMPT = `Read this Kumon math worksheet image with four numbered problems: (1) top-left, (2) top-right, (3) bottom-left, (4) bottom-right.

You MUST return a JSON array with exactly 4 objects, one per problem number 1 through 4.
If handwriting is hard to read, still include the problem with your best guess or "unclear" for missing fields.

Each object needs:
- number: 1, 2, 3, or 4
- printed_expression: plain text like "3/8 / (7/9 * 9/14)" — never LaTeX
- last_operation_before_answer: plain text like "3/8 * 2/1"
- written_final_answer: plain fraction like "3/4"

Use plain fractions only (example: 3/4). No LaTeX, no decimals, no grading.
Return ONLY JSON:
[{"number":1,"printed_expression":"3/8 / (7/9 * 9/14)","last_operation_before_answer":"3/8 * 2/1","written_final_answer":"3/4"},{"number":2,...},{"number":3,...},{"number":4,...}]`;

const QUADRANT_EXTRACTION_PROMPT = (number: number) => `This image is a close crop of Kumon worksheet problem (${number}).

Read the printed expression and the student's handwritten work and final answer.

Return ONLY one JSON object:
{"number":${number},"printed_expression":"3/8 / (7/9 * 9/14)","last_operation_before_answer":"3/8 * 2/1","written_final_answer":"3/4"}

Use plain fractions only. No LaTeX. No markdown.`;

const WORK_STEP_PROMPT = `Look at this Kumon worksheet again.

For each numbered problem (1) through (4), read the student's last line of work immediately before the final equals sign and answer. Examples: "3/8 x 2/1", "1/2 x 8/5", "1/2 - 3/8".

Return ONLY valid JSON, no markdown:
[{"number":1,"last_operation_before_answer":"3/8 * 2/1"}]`;

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
  rawAnalysis: string,
  keepAlive: string,
  fastMode: boolean
) {
  let extracted = rawAnalysis ? parseExtractedProblems(rawAnalysis) : [];

  if (!extracted.length && rawAnalysis && isLegacyModelGradingOutput(rawAnalysis)) {
    return {
      extracted: [],
      needsAppUpdate: true,
    };
  }

  if (extracted.length && problemsNeedingWorkStepPass(extracted).length > 0) {
    try {
      const workStepResponse = await callOllamaChat({
        ollamaUrl,
        model: ollamaModel,
        prompt: WORK_STEP_PROMPT,
        base64Image,
        keepAlive,
        fastMode,
        purpose: "extraction",
      });

      if (workStepResponse.ok) {
        const workStepPayload = await workStepResponse.json();
        const workStepText = extractAnalysisText(workStepPayload);
        const workSteps = workStepText ? parseWorkSteps(workStepText) : [];

        if (workSteps.length) {
          extracted = mergeWorkSteps(extracted, workSteps);
        }
      }
    } catch {
      // Keep first-pass extraction if the work-step request fails.
    }
  }

  return { extracted, needsAppUpdate: false };
}

async function extractMissingQuadrants(
  ollamaUrl: string,
  ollamaModel: string,
  imageBuffer: Buffer,
  existing: ExtractedProblem[],
  keepAlive: string,
  fastMode: boolean
) {
  const foundNumbers = new Set(existing.map((problem) => problem.number));
  const missingNumbers = [1, 2, 3, 4].filter((number) => !foundNumbers.has(number));

  if (!missingNumbers.length) {
    return existing;
  }

  const quadrants = await splitWorksheetIntoQuadrants(imageBuffer);
  const quadrantResults: ExtractedProblem[] = [...existing];

  for (const quadrant of quadrants) {
    if (!missingNumbers.includes(quadrant.number)) {
      continue;
    }

    try {
      const response = await callOllamaChat({
        ollamaUrl,
        model: ollamaModel,
        prompt: QUADRANT_EXTRACTION_PROMPT(quadrant.number),
        base64Image: quadrant.base64Image,
        keepAlive,
        fastMode,
        purpose: "extraction",
      });

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const text = extractAnalysisText(payload);
      const parsed = text ? parseExtractedProblems(text) : [];

      if (parsed.length) {
        quadrantResults.push(...parsed);
      }
    } catch {
      // Try the remaining quadrants.
    }
  }

  return mergeExtractedProblems(quadrantResults);
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

    const { ollamaModel, candidateUrls, keepAlive, fastMode } = getOllamaConfig();
    const arrayBuffer = await file.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const base64Image = imageBuffer.toString("base64");

    let ollamaResponse: Response | null = null;
    let selectedOllamaUrl = "";
    let lastOllamaErrorDetail = "";

    for (const ollamaUrl of candidateUrls) {
      try {
        ollamaResponse = await callOllamaChat({
          ollamaUrl,
          model: ollamaModel,
          prompt: EXTRACTION_PROMPT,
          base64Image,
          keepAlive,
          fastMode,
          purpose: "extraction",
        });

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
          rawAnalysis,
          keepAlive,
          fastMode
        )
      : { extracted: [], needsAppUpdate: false };

    if (!extracted.length && selectedOllamaUrl && !needsAppUpdate) {
      const retryResponse = await callOllamaChat({
        ollamaUrl: selectedOllamaUrl,
        model: ollamaModel,
        prompt: `${EXTRACTION_PROMPT}\n\nRespond with JSON only. Include all 4 problems. Use plain fractions like 3/4, never LaTeX.`,
        base64Image,
        keepAlive,
        fastMode,
        purpose: "extraction",
      });

      if (retryResponse.ok) {
        const retryPayload = await retryResponse.json();
        rawAnalysis = extractAnalysisText(retryPayload);
        ({ extracted, needsAppUpdate } = await extractWorksheetProblems(
          selectedOllamaUrl,
          ollamaModel,
          base64Image,
          rawAnalysis,
          keepAlive,
          fastMode
        ));
      }
    }

    if (extracted.length > 0 && extracted.length < 4 && selectedOllamaUrl) {
      extracted = await extractMissingQuadrants(
        selectedOllamaUrl,
        ollamaModel,
        imageBuffer,
        extracted,
        keepAlive,
        fastMode
      );

      if (problemsNeedingWorkStepPass(extracted).length > 0) {
        ({ extracted } = await extractWorksheetProblems(
          selectedOllamaUrl,
          ollamaModel,
          base64Image,
          JSON.stringify(extracted),
          keepAlive,
          fastMode
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
