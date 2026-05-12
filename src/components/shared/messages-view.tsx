"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { MessageCircle, Send, Inbox, Plus, ArrowRight } from "lucide-react";
import { sendMessage, getMessages } from "./message-actions";
import { createConversation, getContactsForRole } from "./messages-actions";
import { useToast } from "./toast";
import { useLang } from "@/lib/i18n/context";

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
  const { t, dir, lang } = useLang();
  const [conversations, setConversations] = useState(initialConvos);
  const [activeConvo, setActiveConvo] = useState<string | null>(initialConvos[0]?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, startLoadTransition] = useTransition();
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  // Mobile-only: master/detail toggle. On md+ both panels render side-by-side.
  // Default: show the active conversation on first paint (matches today's UX
  // where the first conversation is auto-selected).
  const [mobileShowList, setMobileShowList] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { success: toastSuccess, error: toastError } = useToast();
  const activeConvoData = conversations.find((c) => c.id === activeConvo);

  useEffect(() => {
    if (!activeConvo) return;
    startLoadTransition(async () => {
      const msgs = await getMessages(activeConvo);
      setMessages(msgs);
    });
  }, [activeConvo, startLoadTransition]);

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

    try {
      const result = await sendMessage(activeConvo, content);

      // Update status to delivered or failed
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, status: result.success ? "delivered" : "failed" }
            : m,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, status: "failed" } : m,
        ),
      );
    }
    setSending(false);
  }

  async function retryMessage(msgId: string, content: string) {
    if (!activeConvo) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: "sending" } : m)),
    );
    try {
      const result = await sendMessage(activeConvo, content);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, status: result.success ? "delivered" : "failed" }
            : m,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: "failed" } : m)),
      );
    }
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
        toastSuccess(t("تم إنشاء المحادثة", "Conversation created"));
      }
    } catch {
      toastError(t("فشل إنشاء المحادثة — حاول مرة أخرى", "Failed to create conversation — try again"));
    }
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageCircle size={24} className="text-gold" aria-hidden="true" />
          {t("الرسائل", "Messages")}
        </h1>
        <button
          onClick={openNewConvoDialog}
          className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gold-hover"
        >
          <Plus size={16} aria-hidden="true" />
          {t("محادثة جديدة", "New Conversation")}
        </button>
      </div>

      {/* New Conversation Dialog */}
      {showNewConvo && (
        <div className="mb-4 rounded-xl glass-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-gold">
              {role === "teacher"
                ? t("اختر طالباً لبدء محادثة", "Choose a student to start a conversation")
                : t("اختر معلماً لبدء محادثة", "Choose a teacher to start a conversation")}
            </p>
            <button onClick={() => setShowNewConvo(false)} className="text-xs text-muted hover:text-foreground">{t("إغلاق", "Close")}</button>
          </div>
          {loadingContacts ? (
            <p className="text-sm text-muted">{t("جاري التحميل...", "Loading...")}</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-muted">
              {role === "teacher"
                ? t("لديك محادثات مع جميع طلابك بالفعل", "You already have conversations with all your students")
                : t("لديك محادثات مع جميع معلميك بالفعل", "You already have conversations with all your teachers")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {contacts.map(c => (
                <button
                  key={c.id}
                  onClick={() => startConversation(c)}
                  className="rounded-lg glass px-3 py-2 text-sm transition-colors hover:border-gold/40 hover:text-gold"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {conversations.length === 0 && !showNewConvo ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">{t("لا توجد محادثات بعد", "No conversations yet")}</p>
          <p className="mt-1 text-sm text-muted">
            {t("اضغط \"محادثة جديدة\" لبدء التواصل", "Click \"New Conversation\" to start chatting")}
          </p>
        </div>
      ) : conversations.length > 0 && (
        <div className="flex gap-4 glass-card rounded-xl" style={{ height: "70vh" }}>
          {/* Conversations sidebar — full-width on mobile when toggled, fixed
              w-64 on md+. Master/detail pattern keeps mobile readable. */}
          <div
            className={`${mobileShowList ? "flex" : "hidden"} w-full shrink-0 flex-col overflow-y-auto border-l border-white/10 md:flex md:w-64`}
          >
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => { setActiveConvo(c.id); setMobileShowList(false); }}
                className={`w-full border-b border-white/10 px-4 py-3 text-right transition-colors ${
                  activeConvo === c.id ? "glass glass-gold" : "hover:bg-white/5"
                }`}
              >
                <p className={`truncate text-sm font-medium ${activeConvo === c.id ? "text-gold" : ""}`}>
                  {c.otherUserName}
                </p>
                {c.lastMessageAt && (
                  <p className="mt-0.5 text-xs text-muted">
                    {new Date(c.lastMessageAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Messages area — hidden on mobile while the list is shown. */}
          <div className={`${mobileShowList ? "hidden" : "flex"} flex-1 flex-col md:flex`}>
            {activeConvoData && (
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setMobileShowList(true)}
                  className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-gold"
                  aria-label={t("المحادثات", "Conversations")}
                >
                  <ArrowRight size={18} className={dir === "rtl" ? "" : "rotate-180"} />
                </button>
                <p className="truncate font-medium">{activeConvoData.otherUserName}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loading ? (
                <p className="py-8 text-center text-sm text-muted">{t("جاري التحميل...", "Loading...")}</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">{t("لا توجد رسائل — ابدأ المحادثة", "No messages — start the conversation")}</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const isMine = msg.sender_id === currentUserId;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[70%] rounded-xl px-4 py-2 text-sm ${
                          msg.status === "failed"
                            ? "glass glass-danger text-foreground"
                            : isMine ? "glass glass-gold text-foreground" : "glass text-foreground"
                        } ${msg.status === "sending" ? "opacity-60" : ""}`}>
                          <p>{msg.content}</p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-xs text-muted">
                              {new Date(msg.created_at).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" })}
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
                                {t("✕ فشل — اضغط لإعادة الإرسال", "✕ Failed — tap to retry")}
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
              <form onSubmit={handleSend} className="border-t border-white/10 px-4 py-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    placeholder={t("اكتب رسالتك...", "Type your message...")}
                    className="flex-1 glass-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sending || !newMsg.trim()}
                    aria-label={t("إرسال", "Send")}
                    className="glass-gold rounded-xl px-4 py-2.5 text-white transition-colors hover:bg-gold-hover disabled:opacity-50"
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
