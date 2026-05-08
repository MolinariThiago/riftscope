import { redirect } from "next/navigation";

export default function DemoIndexPage({ params }: { params: { id: string } }) {
  redirect(`/demo/${params.id}/replay`);
}
