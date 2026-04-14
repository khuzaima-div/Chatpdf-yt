import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import ChatSidebar from "@/components/chat/ChatSidebar";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.10),transparent_30%),linear-gradient(145deg,#020617_0%,#0b1220_55%,#111827_100%)]">
      <ChatSidebar userId={userId} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-white/10 bg-slate-950/40 px-4 backdrop-blur md:px-6">
          <div>
            <h1 className="text-base font-semibold text-slate-100 md:text-lg">ChatPDF Workspace</h1>
            <p className="text-xs text-slate-400 md:text-sm">Ask questions and explore your documents</p>
          </div>
          <UserButton />
        </header>
        <section className="flex-1 p-4 md:p-6">{children}</section>
      </main>
    </div>
  );
}
