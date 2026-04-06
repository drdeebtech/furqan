"use client";

import { useState, useEffect, useRef } from "react";
import { MessageCircle, Send, Inbox, Plus } from "lucide-react";
import { sendMessage, getMessages } from "./message-actions";
import { createConversation, getContactsForRole } from "./messages-actions";
import { useToast } from "./toast";

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
  status?: "sending" | "delivered" | "failed";
}

interface Contact {
  id: string;
  name: string;
}

export function MessagesView({
  conversations: initialConvos,
  currentUserId,
  role,
}: {
  conversations: Conversation[];
  currentUserId: string;
  role: "student" | "teacher";
}) {
  const [conversations, setConversations] = useState(initialConvos);
  const [activeConvo, setActiveConvo] = useState<string | null>(initialConvos[0]?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { success: toastSuccess, error: toastError } = useToast();
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

    const tempId = crypto.randomUUID();
    const content = newMsg.trim();

    // Optimistic: add message with "sending" status
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        sender_id: currentUserId,
        content,
        msg_type: "text",
        created_at: new Date().toISOString(),
        is_read: false,
        status: "sending",
      },
    ]);
    setNewMsg("");

    const result = await sendMessage(activeConvo, content);

    // Update status to delivered or failed
    setMessages((prev) =>
      prev.map((m) =>
        m.id === tempId
          ? { ...m, status: result.success ? "delivered" : "failed" }
          : m,
      ),
    );
    setSending(false);
  }

  async function retryMessage(msgId: string, content: string) {
    if (!activeConvo) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: "sending" } : m)),
    );
    const result = await sendMessage(activeConvo, content);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, status: result.success ? "delivered" : "failed" }
          : m,
      ),
    );
  }

  async function openNewConvoDialog() {
    setShowNewConvo(true);
    setLoadingContacts(true);
    const c = await getContactsForRole(role);
    setContacts(c);
    setLoadingContacts(false);
  }

  async function startConversation(contact: Contact) {
    // Check if conversation already exists locally
    const existing = conversations.find(cv => cv.otherUserId === contact.id);
    if (existing) {
      setActiveConvo(existing.id);
      setShowNewConvo(false);
      return;
    }

    try {
      const result = await createConversation(contact.id, role);
      if (result.error) {
        toastError(result.error);
        return;
      }
      if (result.conversationId) {
        const newConvo: Conversation = {
          id: result.conversationId,
          otherUserId: contact.id,
          otherUserName: contact.name,
          lastMessageAt: null,
        };
        // Only add if not already in list
        setConversations(prev => {
          if (prev.some(c => c.id === result.conversationId)) return prev;
          return [newConvo, ...prev];
        });
        setActiveConvo(result.conversationId);
        setShowNewConvo(false);
        toastSuccess("تم إنشاء المحادثة");
      }
    } catch {
      toastError("فشل إنشاء المحادثة — حاول مرة أخرى");
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageCircle size={24} className="text-gold" />
          الرسائل
        </h1>
        <button
          onClick={openNewConvoDialog}
          className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-gold-hover"
        >
          <Plus size={16} />
          محادثة جديدة
        </button>
      </div>

      {/* New Conversation Dialog */}
      {showNewConvo && (
        <div className="mb-4 rounded-xl border border-gold/30 bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-gold">اختر {role === "teacher" ? "طالباً" : "معلماً"} لبدء محادثة</p>
            <button onClick={() => setShowNewConvo(false)} className="text-xs text-muted hover:text-foreground">إغلاق</button>
          </div>
          {loadingContacts ? (
            <p className="text-sm text-muted">جاري التحميل...</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-muted">لديك محادثات مع جميع {role === "teacher" ? "طلابك" : "معلميك"} بالفعل</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {contacts.map(c => (
                <button
                  key={c.id}
                  onClick={() => startConversation(c)}
                  className="rounded-lg border border-card-border bg-surface px-3 py-2 text-sm transition-colors hover:border-gold/40 hover:text-gold"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {conversations.length === 0 && !showNewConvo ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد محادثات بعد</p>
          <p className="mt-1 text-sm text-muted">
            اضغط &quot;محادثة جديدة&quot; لبدء التواصل
          </p>
        </div>
      ) : conversations.length > 0 && (
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
            {activeConvoData && (
              <div className="border-b border-card-border px-4 py-3">
                <p className="font-medium">{activeConvoData.otherUserName}</p>
              </div>
            )}

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
                          msg.status === "failed"
                            ? "border border-error/30 bg-error/5 text-foreground"
                            : isMine ? "bg-gold/10 text-foreground" : "bg-surface text-foreground"
                        } ${msg.status === "sending" ? "opacity-60" : ""}`}>
                          <p>{msg.content}</p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-xs text-muted">
                              {new Date(msg.created_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {isMine && msg.status === "sending" && (
                              <span className="h-3 w-3 animate-spin rounded-full border border-muted/30 border-t-muted" />
                            )}
                            {isMine && msg.status === "delivered" && (
                              <span className="text-xs text-green-400">✓</span>
                            )}
                            {isMine && !msg.status && (
                              <span className="text-xs text-green-400">✓</span>
                            )}
                            {isMine && msg.status === "failed" && (
                              <button
                                onClick={() => retryMessage(msg.id, msg.content)}
                                className="text-xs text-error hover:text-error/80"
                              >
                                ✕ فشل — اضغط لإعادة الإرسال
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

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
