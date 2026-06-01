"use client";
import { useState } from "react";
import { togglePolicyActive } from "./actions";
import { useToast } from "@/components/shared/toast";

export function PolicyToggle({ policyId, isActive }: { policyId: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  const toast = useToast();
  return (
    <button
      onClick={async () => {
        setActive(!active);
        const res = await togglePolicyActive(policyId, !active);
        if (res?.error) {
          setActive(active);
          toast.error(res.error);
        }
      }}
      className={`glass-badge ${active ? "bg-success/10 text-success border-success/30" : "bg-error/10 text-red-400 border-error/30"}`}
    >
      {active ? "مفعّل" : "معطل"}
    </button>
  );
}
