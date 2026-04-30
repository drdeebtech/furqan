import { AdminListSkeleton } from "@/components/shared/admin-list-skeleton";

export default function Loading() {
  return <AdminListSkeleton rows={8} showStats={false} />;
}
