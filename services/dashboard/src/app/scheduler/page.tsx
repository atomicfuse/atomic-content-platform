import { redirect } from "next/navigation";

export default function SchedulerRedirect(): never {
  redirect("/settings/scheduler");
}
