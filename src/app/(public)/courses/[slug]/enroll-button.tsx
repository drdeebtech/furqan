"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";
import { enrollFree, initiateEnrollmentCheckout } from "@/lib/actions/course-enrollments";

interface Props {
  courseId: string;
  isFree: boolean;
  isEnrolled: boolean;
  isLoggedIn: boolean;
  labels: {
    enroll: string;
    buy: string;
    go: string;
    login: string;
    soon: string;
  };
}

export function EnrollButton({
  courseId,
  isFree,
  isEnrolled,
  isLoggedIn,
  labels,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isEnrolled) {
    return (
      <Link
        href="/student/courses"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        {labels.go}
        <ArrowRight size={14} />
      </Link>
    );
  }

  if (!isLoggedIn) {
    const ret = encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/courses");
    return (
      <Link
        href={`/login?next=${ret}`}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        {labels.login}
      </Link>
    );
  }

  const handle = () => {
    setError(null);
    startTransition(async () => {
      const res = isFree
        ? await enrollFree(courseId)
        : await initiateEnrollmentCheckout(courseId);
      if (!res.ok) {
        setError(res.error ?? labels.soon);
      } else {
        router.push("/student/courses");
      }
    });
  };

  return (
    <div>
      <button
        onClick={handle}
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {isPending && <Loader2 size={14} className="animate-spin" />}
        {isFree ? labels.enroll : labels.buy}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
