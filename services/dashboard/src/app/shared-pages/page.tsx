import { redirect } from "next/navigation";

export default function SharedPagesRedirect(): never {
  redirect("/overrides/shared-pages");
}
