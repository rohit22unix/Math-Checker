import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    grading: "server-side-v2",
    marker: "Graded by Math-Checker (server-side)",
  });
}
