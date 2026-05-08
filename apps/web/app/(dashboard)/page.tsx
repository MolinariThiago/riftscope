import { redirect } from "next/navigation";

// Root dashboard redirects to demos
export default function DashboardPage() {
  redirect("/demos");
}
