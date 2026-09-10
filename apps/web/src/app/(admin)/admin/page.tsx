import { redirect } from "next/navigation";

export default function AdminLandingPage() {
  redirect("/admin/users");
}
