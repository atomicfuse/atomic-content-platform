import { redirect } from "next/navigation";

export default function DomainsRedirect(): never {
  redirect("/settings/domains");
}
