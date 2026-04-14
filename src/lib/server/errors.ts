import { NextResponse } from "next/server";
import { TimeoutError } from "./timeout";

export function toErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  return { raw: error };
}

export function toErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof TimeoutError) {
    return NextResponse.json({ error: error.message }, { status: 504 });
  }

  if (error instanceof Error && error.message.includes("429")) {
    return NextResponse.json(
      { error: "OpenAI quota exceeded. Please add billing or credits and retry." },
      { status: 429 }
    );
  }

  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
