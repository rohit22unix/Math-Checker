import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3-vl:4b";

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

    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt:
          "You are analyzing a student's math worksheet image. Describe what you can see, summarize the worksheet, and briefly explain whether the answers appear correct or incomplete. Keep the response concise and practical.",
        stream: false,
        images: [base64Image],
      }),
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

    return NextResponse.json({
      message: "Worksheet analysis completed.",
      analysis: payload.response || "No analysis returned by Ollama.",
      model: OLLAMA_MODEL,
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
