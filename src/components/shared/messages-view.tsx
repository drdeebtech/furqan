"use client";

import { useState, useEffect, useRef } from "react";
import { MessageCircle, Send, Inbox } from "lucide-react";
import { sendMessage, getMessages } from "./message-actions";

interface Conversation {
  id: string;
  otherUserId: string;
  otherUserName: string;
  lastMessageAt: string | null;
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  msg_type: string;
  created_at: string;
  is_read: boolean;
}

export function MessagesView({
  conversations,
  currentUserId,
  role,
}: {
  conversations: Conversation[];
  currentUserId: string;
  role: "student" | "teacher";
}) {
  const [activeConvo, setActiveConvo] = useState<string | null>(conversations[0]?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeConvoData = conversations.find((c) => c.id === activeConvo);

  useEffect(() => {
    if (!activeConvo) return;
    setLoading(true);
    getMessages(activeConvo).then((msgs) => {
      setMessages(msgs);
      setLoading(false);
    });
  }, [activeConvo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMsg.trim() || !activeConvo) return;
    setSending(true);

    const result = await sendMessage(activeConvo, newMsg.trim());
    if (result.success) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender_id: currentUserId,
          content: newMsg.trim(),
          msg_type: "text",
          created_at: new Date().toISOString(),
          is_read: false,
        },
      ]);
      setNewMsg("");
    }
    setSending(false);
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <MessageCircle size={24} className="text-gold" />
        الرسائل
      </h1>

      {conversations.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد محادثات بعد</p>
          <p className="mt-1 text-sm text-muted">
            {role === "student"
              ? "ستُنشأ محادثة تلقائياً عند حجز جلسة مع معلم"
              : "ستُنشأ محادثة تلقائياً عند تأكيد حجز طالب"}
          </p>
        </div>
      ) : (
        <div className="flex gap-4 rounded-xl border border-card-border bg-card" style={{ height: "70vh" }}>
          {/* Conversations sidebar */}
          <div className="w-64 shrink-0 overflow-y-auto border-l border-card-border">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveConvo(c.id)}
                className={`w-full border-b border-card-border px-4 py-3 text-right transition-colors ${
                  activeConvo === c.id ? "bg-gold/10" : "hover:bg-surface"
                }`}
              >
                <p className={`text-sm font-medium ${activeConvo === c.id ? "text-gold" : ""}`}>
                  {c.otherUserName}
                </p>
                {c.lastMessageAt && (
                  <p className="mt-0.5 text-xs text-muted">
                    {new Date(c.lastMessageAt).toLocaleDateString("ar-SA")}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Messages area */}
          <div className="flex flex-1 flex-col">
            {/* Header */}
            {activeConvoData && (
              <div className="border-b border-card-border px-4 py-3">
                <p className="font-medium">{activeConvoData.otherUserName}</p>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loading ? (
                <p className="py-8 text-center text-sm text-muted">جاري التحميل...</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">لا توجد رسائل — ابدأ المحادثة</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const isMine = msg.sender_id === currentUserId;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[70%] rounded-xl px-4 py-2 text-sm ${
                          isMine ? "bg-gold/10 text-foreground" : "bg-surface text-foreground"
                        }`}>
                          <p>{msg.content}</p>
                          <p className="mt-1 text-xs text-muted">
                            {new Date(msg.created_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            {/* Input */}
            {activeConvo && (
              <form onSubmit={handleSend} className="border-t border-card-border px-4 py-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    placeholder="اكتب رسالتك..."
                    className="flex-1 rounded-xl border border-input-border bg-input px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sending || !newMsg.trim()}
                    className="rounded-xl bg-gold px-4 py-2.5 text-white transition-colors hover:bg-gold-hover disabled:opacity-50"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
