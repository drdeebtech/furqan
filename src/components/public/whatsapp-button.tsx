"use client";

import { MessageCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { CONTACT } from "@/lib/contact";

export function WhatsAppButton() {
  const { t } = useLang();

  return (
    <a
      href={CONTACT.whatsappUrlWithMessage}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 left-6 z-50 flex items-center gap-2 glass-success glass-pill px-4 py-3 text-sm font-medium text-white transition-colors"
      aria-label="WhatsApp"
    >
      <MessageCircle size={20} />
      <span className="hidden sm:inline">{t("تحدث معنا", "Chat with us")}</span>
    </a>
  );
}
