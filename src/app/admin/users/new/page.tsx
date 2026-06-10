import type { Metadata } from "next";
import { CreateUserForm } from "./create-user-form";

export const metadata: Metadata = { title: "إنشاء مستخدم جديد" };

export default async function CreateUserPage() {
  return <CreateUserForm />;
}
