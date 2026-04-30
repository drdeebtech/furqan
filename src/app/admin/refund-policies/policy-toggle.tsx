"use client";
import { useState } from "react";
import { togglePolicyActive } from "./actions";

export function PolicyToggle({ policyId, isActive }: { policyId: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  return (
    <button
      onClick={async () => { setActive(!active); await togglePolicyActive(policyId, !active); }}
      className={`glass-badge ${active ? "bg-success/10 text-success border-success/30" : "bg-error/10 text-red-400 border-error/30"}`}
    >
      {active ? "مفعّل" : "معطل"}
    </button>
  );
}
