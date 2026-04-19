import { redirect } from "next/navigation";

export default function EmailRedirect(): never {
  redirect("/settings/email");
}
