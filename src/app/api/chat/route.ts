import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";
import { getEmbeddingsClient } from "@/lib/ai/embeddings";
import { getPineconeClient } from "@/lib/vector/pinecone";
import { toVectorNamespace } from "@/lib/chat/namespace";
import { toErrorDetails, toErrorResponse } from "@/lib/server/errors";
import { withTimeout } from "@/lib/server/timeout";
import { createRequestTimer } from "@/lib/server/request-timing";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DB_TIMEOUT_MS = 12000;
const VECTOR_TIMEOUT_MS = 15000;
const OPENAI_TIMEOUT_MS = 25000;

function buildContextFromMatches(matches: Array<{ metadata?: Record<string, unknown> }>) {
  return matches
    .map((match, index) => {
      const text =
        typeof match.metadata?.text === "string" ? match.metadata.text.trim() : "";
      const pageNumber =
        typeof match.metadata?.pageNumber === "number"
          ? ` (page ${match.metadata.pageNumber})`
          : "";

      if (!text) return "";
      return `[Chunk ${index + 1}${pageNumber}]\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function generateAnswer(question: string, context: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const systemPrompt = `
You are an AI assistant for a ChatPDF system.

Your job is to help users understand their uploaded PDF clearly.

Rules:
1. If user greets (hello, hi), respond naturally and friendly like a human assistant.
2. If the question is related to the PDF, use ONLY the provided context.
3. Explain in simple, clear, human-friendly language. Do not copy text directly; always explain.
4. If answer is partially available, combine available context and give the best possible explanation.
5. If answer is NOT in the PDF context, reply exactly: "This information is not available in the document."
6. Keep answers short, useful, and easy to understand.
7. Do NOT repeatedly say "I don't know".
`.trim();

  const userPrompt = `Context:\n${context || "No relevant chunks found."}\n\nQuestion:\n${question}`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), OPENAI_TIMEOUT_MS);
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: abortController.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI chat request failed: ${errText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() || "I could not generate an answer.";
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const timer = createRequestTimer("/api/chat", requestId);
  try {
    // Fail fast with actionable errors for missing runtime configuration.
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured" },
        { status: 500 }
      );
    }
    if (!process.env.PINECONE_API_KEY) {
      return NextResponse.json(
        { error: "PINECONE_API_KEY is not configured" },
        { status: 500 }
      );
    }
    if (!process.env.PINECONE_INDEX_NAME) {
      return NextResponse.json(
        { error: "PINECONE_INDEX_NAME is not configured" },
        { status: 500 }
      );
    }

    const authStartedAt = Date.now();
    const { userId } = await auth();
    timer.stage("auth_checked", authStartedAt, { hasUserId: Boolean(userId) });
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payloadParseStartedAt = Date.now();
    const body = (await request.json()) as { chatId?: number; message?: string };
    timer.stage("payload_parsed", payloadParseStartedAt);
    const chatId = Number(body.chatId);
    const question = String(body.message ?? "").trim();

    if (!chatId || Number.isNaN(chatId) || !question) {
      return NextResponse.json(
        { error: "chatId and message are required" },
        { status: 400 }
      );
    }

    const loadChatStartedAt = Date.now();
    const [chat] = await withTimeout(
      db
        .select()
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
        .limit(1),
      DB_TIMEOUT_MS,
      "Database timed out while loading chat."
    );
    timer.stage("chat_loaded", loadChatStartedAt, { chatFound: Boolean(chat) });

    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const saveUserMessageStartedAt = Date.now();
    await withTimeout(
      db.insert(messages).values({
        chatId: chat.id,
        content: question,
        role: "user",
      }),
      DB_TIMEOUT_MS,
      "Database timed out while saving your message."
    );
    timer.stage("user_message_saved", saveUserMessageStartedAt);

    const embedStartedAt = Date.now();
    const embeddings = getEmbeddingsClient();
    const [queryVector] = await withTimeout(
      embeddings.embedDocuments([question]),
      VECTOR_TIMEOUT_MS,
      "Embedding request timed out."
    );
    timer.stage("question_embedded", embedStartedAt);

    const pinecone = getPineconeClient();
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    const namespace = toVectorNamespace(chat.fileKey);

    const vectorSearchStartedAt = Date.now();
    const searchResults = await withTimeout(
      index.namespace(namespace).query({
        topK: 5,
        vector: queryVector,
        includeMetadata: true,
      }),
      VECTOR_TIMEOUT_MS,
      "Vector search timed out."
    );
    timer.stage("vector_search_completed", vectorSearchStartedAt, {
      matchCount: searchResults.matches?.length ?? 0,
    });

    const context = buildContextFromMatches(
      (searchResults.matches ?? []) as Array<{ metadata?: Record<string, unknown> }>
    );
    const answerStartedAt = Date.now();
    const answer = await generateAnswer(question, context);
    timer.stage("openai_answer_generated", answerStartedAt);

    const saveSystemMessageStartedAt = Date.now();
    await withTimeout(
      db.insert(messages).values({
        chatId: chat.id,
        content: answer,
        role: "system",
      }),
      DB_TIMEOUT_MS,
      "Database timed out while saving AI response."
    );
    timer.stage("assistant_message_saved", saveSystemMessageStartedAt);

    const loadMessagesStartedAt = Date.now();
    const chatMessages = await withTimeout(
      db
        .select({
          id: messages.id,
          content: messages.content,
          role: messages.role,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.chatId, chat.id))
        .orderBy(asc(messages.createdAt)),
      DB_TIMEOUT_MS,
      "Database timed out while loading conversation history."
    );
    timer.stage("conversation_loaded", loadMessagesStartedAt, {
      messageCount: chatMessages.length,
    });
    timer.total("request_completed", { chatId });

    return NextResponse.json({
      answer,
      messages: chatMessages,
    });
  } catch (error) {
    console.error(`[/api/chat][${requestId}] failed`, toErrorDetails(error));
    // Never leak secrets, but return a helpful message for debugging missing config.
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Failed to process chat request." }, { status: 500 });
  }
}
