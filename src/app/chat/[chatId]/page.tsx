import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import ChatClient from "@/components/chat/ChatClient";

type Props = {
  params: Promise<{ chatId: string }>;
};

export default async function ChatPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) notFound();

  const { chatId } = await params;
  const numericChatId = Number(chatId);
  if (Number.isNaN(numericChatId)) notFound();

  const [chat] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, numericChatId))
    .limit(1);

  if (!chat || chat.userId !== userId) {
    notFound();
  }

  const chatMessages = await db
    .select({
      id: messages.id,
      content: messages.content,
      role: messages.role,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.chatId, numericChatId))
    .orderBy(asc(messages.createdAt));

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-lg shadow-black/20 backdrop-blur md:p-5">
        <h2 className="truncate text-lg font-semibold text-slate-100 md:text-xl">{chat.pdfName}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Ask anything about this PDF. Answers will be grounded in your uploaded document.
        </p>
      </div>
      <ChatClient chatId={numericChatId} initialMessages={chatMessages} />
    </div>
  );
}
