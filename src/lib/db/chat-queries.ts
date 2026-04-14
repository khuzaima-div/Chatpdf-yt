import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chats } from "@/lib/db/schema";

export async function getUserChats(userId: string) {
  return db
    .select({
      id: chats.id,
      pdfName: chats.pdfName,
      createdAt: chats.createdAt,
    })
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.createdAt));
}

export async function findExistingChatByFile(userId: string, fileKey: string) {
  return db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.userId, userId), eq(chats.fileKey, fileKey)))
    .limit(1);
}

export async function createChatRecord(args: {
  userId: string;
  fileKey: string;
  fileName: string;
  fileUrl: string;
}) {
  const { userId, fileKey, fileName, fileUrl } = args;

  return db
    .insert(chats)
    .values({
      userId,
      fileKey,
      pdfName: fileName,
      pdfUrl: fileUrl,
    })
    .returning({ id: chats.id, userId: chats.userId });
}
