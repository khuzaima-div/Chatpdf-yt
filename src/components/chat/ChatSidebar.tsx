import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserChats } from "@/lib/db/chat-queries";

type Props = {
  userId?: string | null;
  activeChatId?: number;
};

export default async function ChatSidebar({ userId, activeChatId }: Props) {
  if (!userId) {
    return (
      <aside className="hidden w-80 border-r border-white/10 bg-slate-950/45 backdrop-blur md:flex md:flex-col">
        <div className="border-b border-white/10 p-4">
          <h2 className="text-lg font-semibold text-slate-100">Your Chats</h2>
          <p className="mt-1 text-sm text-slate-400">Sign in to view your chats.</p>
        </div>
      </aside>
    );
  }

  let userChats: Awaited<ReturnType<typeof getUserChats>> = [];
  try {
    userChats = await getUserChats(userId);
  } catch (error) {
    console.error("[ChatSidebar] Failed to load user chats:", error);
    return (
      <aside className="hidden w-80 border-r border-white/10 bg-slate-950/45 backdrop-blur md:flex md:flex-col">
        <div className="border-b border-white/10 p-4">
          <h2 className="text-lg font-semibold text-slate-100">Your Chats</h2>
          <p className="mt-1 text-sm text-rose-300">Could not load chats right now.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden w-80 border-r border-white/10 bg-slate-950/45 backdrop-blur md:flex md:flex-col">
      <div className="border-b border-white/10 p-4">
        <h2 className="text-lg font-semibold text-slate-100">Your Chats</h2>
        <p className="mt-1 text-sm text-slate-400">Continue learning from your PDFs</p>
        <Link href="/" className="mt-3 block">
          <Button className="w-full bg-slate-100 text-slate-900 hover:bg-white">
            <Plus className="size-4" />
            New PDF Chat
          </Button>
        </Link>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {userChats.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/20 bg-slate-900/30 p-4 text-sm text-slate-400">
            No chats yet. Upload your first PDF to begin.
          </div>
        ) : (
          userChats.map((chat) => {
            const isActive = chat.id === activeChatId;

            return (
              <Link
                key={chat.id}
                href={`/chat/${chat.id}`}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-gradient-to-r from-indigo-500 to-cyan-500 text-white shadow-lg shadow-indigo-900/25"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                <FileText className="size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{chat.pdfName}</p>
                  <p className={`text-xs ${isActive ? "text-slate-100/85" : "text-slate-500"}`}>
                    {new Date(chat.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
}
