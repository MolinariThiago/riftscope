import { redirect } from "next/navigation";

// Legacy URL — Análisis 2D is now served directly from /demos so the user
// lands on the demo library every time they click it. Keeping this route
// alive prevents broken bookmarks.
export default function ReviewRedirectPage(): never {
  redirect("/demos");
}
