import { NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getS3Url } from "@/lib/s3";
import { toVectorNamespace } from "@/lib/chat/namespace";
import { toErrorDetails, toErrorResponse } from "@/lib/server/errors";
import { withTimeout } from "@/lib/server/timeout";
import { createChatRecord, findExistingChatByFile } from "@/lib/db/chat-queries";
import { createRequestTimer } from "@/lib/server/request-timing";

const DB_TIMEOUT_MS = 12000;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const timer = createRequestTimer("/api/create-chat", requestId);

  try {
    console.log(`[/api/create-chat][${requestId}] request_received`);
    const authStartedAt = Date.now();
    const { userId } = await auth();
    timer.stage("auth_checked", authStartedAt, { hasUserId: Boolean(userId) });
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payloadParseStartedAt = Date.now();
    const body = await request.json();
    timer.stage("payload_parsed", payloadParseStartedAt);
    const { file_key, file_name } = body;
    if (!file_key || !file_name) {
      return NextResponse.json(
        { error: "file_key and file_name are required" },
        { status: 400 }
      );
    }

    console.log(`[/api/create-chat][${requestId}] payload_validated`, {
      file_key,
      file_name,
      userId,
    });

    // Idempotency guard: prevent duplicate indexing/chats for same uploaded file.
    const lookupStartedAt = Date.now();
    const [existingChat] = await withTimeout(
      findExistingChatByFile(userId, file_key),
      DB_TIMEOUT_MS,
      "Database timed out while checking existing chats."
    );
    timer.stage("existing_chat_lookup_completed", lookupStartedAt, {
      foundExistingChat: Boolean(existingChat),
    });

    if (existingChat) {
      console.log(`[/api/create-chat][${requestId}] existing_chat_reused`, {
        chatId: existingChat.id,
        durationMs: Date.now() - timer.startedAt,
      });
      return NextResponse.json({
        chatId: existingChat.id,
        indexingStatus: "already_exists",
        namespace: toVectorNamespace(file_key),
      });
    }

    const createStartedAt = Date.now();
    const [createdChat] = await withTimeout(
      createChatRecord({
        userId,
        fileKey: file_key,
        fileName: file_name,
        fileUrl: getS3Url(file_key),
      }),
      DB_TIMEOUT_MS,
      "Database timed out while creating the chat."
    );
    timer.stage("chat_created", createStartedAt, {
      chatId: createdChat?.id,
      persistedUserId: createdChat?.userId,
    });

    if (!createdChat?.id || !createdChat.userId) {
      throw new Error("Chat creation succeeded but user_id was not persisted.");
    }

    after(async () => {
      const startedAt = Date.now();
      console.log(`[/api/create-chat][${requestId}] background_indexing_started`, {
        chatId: createdChat.id,
      });
      try {
        // Lazy-load heavy PDF/vector indexing dependencies so this route can
        // respond quickly without waiting for large module initialization.
        const { loadS3IntoPinecone } = await import("@/lib/vector/pinecone");
        await loadS3IntoPinecone(file_key, file_name, {
          requestId,
          chatId: createdChat.id,
        });
        console.log(`[/api/create-chat][${requestId}] background_indexing_completed`, {
          chatId: createdChat.id,
          durationMs: Date.now() - startedAt,
        });
      } catch (indexError) {
        console.error(`[/api/create-chat][${requestId}] background_indexing_failed`, {
          chatId: createdChat.id,
          durationMs: Date.now() - startedAt,
          ...toErrorDetails(indexError),
        });
      }
    });

    console.log(`[/api/create-chat][${requestId}] response_sent`, {
      chatId: createdChat.id,
      durationMs: Date.now() - timer.startedAt,
    });
    timer.total("request_completed", {
      chatId: createdChat.id,
      indexingStatus: "processing",
    });

    return NextResponse.json({
      chatId: createdChat.id,
      indexingStatus: "processing",
      namespace: toVectorNamespace(file_key),
    });
  } catch (error: unknown) {
    const details = toErrorDetails(error);
    console.error(`[/api/create-chat][${requestId}] failed`, {
      durationMs: Date.now() - timer.startedAt,
      ...details,
    });
    return toErrorResponse(error, "Failed to create chat.");
  }
}
