import { type NextRequest, NextResponse } from "next/server";
import {
  searchTeachers,
  TeacherSearchParamsSchema,
} from "@/lib/supabase/teacher-search";

export async function GET(request: NextRequest) {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = TeacherSearchParamsSchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid search parameters" }, { status: 400 });
  }

  try {
    const result = await searchTeachers(parsed.data);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[/api/teachers/search]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
