import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BookingForm } from "./booking-form";

interface Props {
  searchParams: Promise<{ teacher?: string }>;
}

export default async function NewBookingPage({ searchParams }: Props) {
  const { teacher: teacherId } = await searchParams;

  if (!teacherId) redirect("/student/teachers");

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch teacher profile + name in parallel
  const [tpRes, profileRes] = await Promise.all([
    supabase
      .from("teacher_profiles")
      .select("teacher_id, hourly_rate, specialties, recitation_standards, bio")
      .eq("teacher_id", teacherId)
      .eq("is_archived", false)
      .eq("is_accepting", true)
      .single<{
        teacher_id: string;
        hourly_rate: number;
        specialties: string[];
        recitation_standards: string[];
        bio: string | null;
      }>(),

    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", teacherId)
      .single<{ full_name: string | null }>(),
  ]);

  if (!tpRes.data) redirect("/student/teachers");

  const teacher = {
    id: tpRes.data.teacher_id,
    name: profileRes.data?.full_name ?? "معلم",
    hourlyRate: Number(tpRes.data.hourly_rate),
    specialties: tpRes.data.specialties,
    recitationStandards: tpRes.data.recitation_standards,
    bio: tpRes.data.bio,
  };

  return (
    <div dir="rtl" className="mx-auto max-w-2xl px-4 py-8">
      <BookingForm teacher={teacher} studentId={user.id} />
    </div>
  );
}
