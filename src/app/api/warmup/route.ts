import { NextResponse } from "next/server";

import { warmOllamaModel } from "@/lib/ollama-config";

export const runtime = "nodejs";

export async function POST() {
  const result = await warmOllamaModel();

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Could not reach the configured Ollama server." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    status: "ready",
    model: result.model,
    ollamaUrl: result.ollamaUrl,
    processor: result.processor,
  });
}
