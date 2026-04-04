"use client";

import { useLang } from "@/lib/i18n/context";
import type { ReactNode } from "react";

export function PublicDirWrapper({ children }: { children: ReactNode }) {
  const { dir } = useLang();
  return <div dir={dir}>{children}</div>;
}
