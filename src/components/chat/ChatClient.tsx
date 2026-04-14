"use client";

import { Bot, Loader2, Send, User } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type Message = {
  id: number;
  content: string;
  role: "user" | "system";
  createdAt: Date | string;
};

type Props = {
  chatId: number;
  initialMessages: Message[];
};

export default function ChatClient({ chatId, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [question, setQuestion] = useState("");
  const [isSending, setIsSending] = useState(false);

  const hasMessages = useMemo(() => messages.length > 0, [messages.length]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setQuestion("");

    const optimisticUserMessage: Message = {
      id: Date.now(),
      content: trimmed,
      role: "user",
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticUserMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: trimmed }),
      });

      if (!response.ok) {
        throw new Error("Failed to send question");
      }

      const data = (await response.json()) as { messages: Message[] };
      setMessages(data.messages);
    } catch (error) {
      console.error(error);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMessage.id));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl shadow-black/20 backdrop-blur md:p-6">
        {!hasMessages && (
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-slate-100 p-2 text-slate-900">
              <Bot className="size-4" />
            </div>
            <div className="max-w-3xl rounded-2xl border border-white/10 bg-slate-800/80 p-3 text-sm text-slate-200 md:text-base">
              Ask your first question about this PDF. I will answer from document context.
            </div>
          </div>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={`flex items-start gap-3 ${isUser ? "justify-end" : ""}`}
            >
              {!isUser && (
                <div className="rounded-full bg-slate-100 p-2 text-slate-900">
                  <Bot className="size-4" />
                </div>
              )}

              <div
                className={`max-w-3xl rounded-2xl p-3 text-sm md:text-base ${
                  isUser
                    ? "bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-lg shadow-indigo-900/30"
                    : "border border-white/10 bg-slate-800/80 text-slate-200"
                }`}
              >
                {message.content}
              </div>

              {isUser && (
                <div className="rounded-full bg-slate-700 p-2 text-slate-200">
                  <User className="size-4" />
                </div>
              )}
            </div>
          );
        })}

        {isSending && (
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-slate-100 p-2 text-slate-900">
              <Bot className="size-4" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-800/80 p-3 text-sm text-slate-200">
              <Loader2 className="size-4 animate-spin" />
              Thinking...
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 rounded-2xl border border-white/10 bg-slate-900/70 p-3 shadow-lg shadow-black/20 backdrop-blur md:p-4"
      >
        <div className="flex items-center gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            type="text"
            placeholder="Ask a question about this PDF..."
            className="h-10 w-full rounded-lg border border-white/10 bg-slate-800/80 px-3 text-sm text-slate-100 outline-none ring-cyan-400/50 transition placeholder:text-slate-400 focus:ring-2"
            disabled={isSending}
          />
          <Button
            type="submit"
            disabled={isSending}
            className="bg-gradient-to-r from-indigo-500 to-cyan-500 text-white hover:from-indigo-400 hover:to-cyan-400"
          >
            <Send className="size-4" />
            Send
          </Button>
        </div>
      </form>
    </>
  );
}
