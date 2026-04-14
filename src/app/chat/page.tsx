import { MessageSquareText, UploadCloud } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ChatLandingPage() {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col items-center justify-center">
      <div className="w-full rounded-2xl border border-white/10 bg-slate-900/60 p-8 text-center shadow-xl shadow-black/20 backdrop-blur md:p-12">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-slate-800/80">
          <MessageSquareText className="size-7 text-slate-200" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-100 md:text-3xl">Your AI PDF Assistant is Ready</h2>
        <p className="mx-auto mt-3 max-w-2xl text-slate-400">
          Pick a chat from the sidebar or upload a new PDF to start asking smart questions.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/">
            <Button size="lg" className="bg-slate-100 text-slate-900 hover:bg-white">
              <UploadCloud className="size-4" />
              Upload New PDF
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
