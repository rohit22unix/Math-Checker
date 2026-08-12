import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3-vl:4b-instruct";
const ANALYSIS_TIMEOUT_MS = 180_000;

function getOllamaConfig() {
  const ollamaUrl =
    process.env.OLLAMA_URL?.trim() ||
    process.env.OLLAMA_BASE_URL?.trim() ||
    DEFAULT_OLLAMA_URL;
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;

  return { ollamaUrl, ollamaModel };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("worksheet");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No worksheet image was provided." },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "The uploaded file must be an image." },
        { status: 400 }
      );
    }

    const { ollamaUrl, ollamaModel } = getOllamaConfig();
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    const ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        options: {
          temperature: 0.0,
          num_ctx: 8192,
          num_predict: 640,
        },
        messages: [
          {
            role: "user",
            content:
              "You are analyzing a student's math worksheet image. Describe what you can see, summarize the worksheet, and briefly explain whether the answers appear correct or incomplete. Keep the response concise and practical.",
            images: [base64Image],
          },
        ],
      }),
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();
      return NextResponse.json(
        {
          error: `Ollama request failed: ${errorText || ollamaResponse.statusText}`,
        },
        { status: 502 }
      );
    }

    const payload = await ollamaResponse.json();
    const message = payload?.message as Record<string, unknown> | undefined;
    const analysis =
      (typeof message?.content === "string" ? message.content : "") ||
      (typeof payload?.response === "string" ? payload.response : "") ||
      "No analysis returned by Ollama.";

    return NextResponse.json({
      message: "Worksheet analysis completed.",
      analysis,
      model: ollamaModel,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
  } catch (error) {
    console.error("Worksheet upload failed", error);

    return NextResponse.json(
      {
        error:
          "The server could not process the worksheet upload. Make sure Ollama is installed and the model is available.",
      },
      { status: 500 }
    );
  }
}
