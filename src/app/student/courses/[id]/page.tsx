import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CourseLesson } from "@/types/database";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourseLandingRedirect({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Find the first ready lesson and redirect there
  const { data: lessons } = await supabase
    .from("course_lessons")
    .select("id, video_status, order_index")
    .eq("course_id", id)
    .order("order_index", { ascending: true })
    .returns<Pick<CourseLesson, "id" | "video_status" | "order_index">[]>();

  if (!lessons || lessons.length === 0) notFound();

  const firstReady = lessons.find((l) => l.video_status === "ready") ?? lessons[0];
  redirect(`/student/courses/${id}/lesson/${firstReady.id}`);
}
