import { AdminListSkeleton } from "@/components/shared/admin-list-skeleton";

export default function Loading() {
  return <AdminListSkeleton showStats={false} rows={10} />;
}
