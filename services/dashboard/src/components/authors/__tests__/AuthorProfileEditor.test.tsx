import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace }) }));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));

import { AuthorProfileEditor } from "../AuthorProfileEditor";
import type { AuthorListItem } from "@/lib/authors/types";

const ELLA: AuthorListItem = {
  id: "ella-hughes", name: "Ella Hughes", tagline: "Royals writer", bio: "Old bio.", beats: ["Royals"],
  portrait: null, links: {}, exclusive_sites: [], created_at: "t", updated_at: "t", sites: [],
};

function respond(map: Record<string, unknown>): void {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/authors/generate")) {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      const v = map[part];
      return v instanceof Error
        ? new Response(JSON.stringify({ status: "error", message: v.message }), { status: 502 })
        : new Response(JSON.stringify({ status: "ok", value: v }), { status: 200 });
    }
    if (init?.method === "PUT") return new Response(JSON.stringify({ author: { ...ELLA, ...JSON.parse(String(init.body)).author } }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => { push.mockClear(); toast.mockClear(); });
afterEach(cleanup);

describe("AuthorProfileEditor", () => {
  it("regenerating the bio shows it as an unsaved change; Save sends it; Discard restores", async () => {
    respond({ bio: "A brand new bio." });
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate bio" }));
    expect(await screen.findByDisplayValue("A brand new bio.")).toBeTruthy();
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(within(bar).getByText(/bio/)).toBeTruthy();
    await userEvent.click(within(bar).getByRole("button", { name: "Discard" }));
    expect(screen.getByDisplayValue("Old bio.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Regenerate bio" }));
    await screen.findByDisplayValue("A brand new bio.");
    await userEvent.click(within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", { name: "Save author" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Author saved", "success"));
    const put = vi.mocked(global.fetch).mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body)).author.bio).toBe("A brand new bio.");
  });

  it("a failed portrait shows its error with Retry; other sections are unaffected", async () => {
    respond({ portrait: new Error("Portrait failed: OpenAI 500") });
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate portrait" }));
    expect(await screen.findByText("Portrait failed: OpenAI 500")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry portrait" })).toBeTruthy();
    expect(screen.getByDisplayValue("Old bio.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  });

  it("asks before leaving through a link with unsaved changes", async () => {
    respond({ tagline: "Palace watcher" });
    render(<><a href="/sites">Sites</a><AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} /></>);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate tagline" }));
    await screen.findByDisplayValue("Palace watcher");
    await userEvent.click(screen.getByRole("link", { name: "Sites" }));
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    // replace: the page's Back-guard history entry becomes /sites, so Back from there returns here in one press.
    expect(replace).toHaveBeenCalledWith("/sites");
  });

  it("Generate everything shows a checklist of parts", async () => {
    respond({ name: "Maya Ortiz", tagline: "Coffee writer", bio: "Bio text.", beats: ["Coffee", "Brewing"], portrait: { kind: "generated", path: "/authors/assets/maya-ortiz-a.webp" } });
    render(<AuthorProfileEditor author={null} mode="create" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate everything" }));
    const list = await screen.findByRole("list", { name: "Generation progress" });
    await waitFor(() => expect(within(list).getAllByText("Done")).toHaveLength(5));
    expect(screen.getByDisplayValue("Maya Ortiz")).toBeTruthy();
  });

  it("Generate everything applies each part as it lands, can't start twice, and keeps edits made during the run", async () => {
    let releasePortrait: () => void = () => undefined;
    const portraitGate = new Promise<void>((r) => { releasePortrait = r; });
    const values: Record<string, unknown> = { name: "Ella Hughes", tagline: "Palace watcher", bio: "New bio.", beats: ["Royals", "Fashion"] };
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      if (String(url).includes("/api/authors/generate") && part === "portrait") {
        await portraitGate;
        return new Response(JSON.stringify({ status: "ok", value: { kind: "generated", path: "/authors/assets/ella-hughes-a.webp" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "ok", value: values[part] }), { status: 200 });
    }) as unknown as typeof fetch;
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate everything" }));
    expect(await screen.findByDisplayValue("New bio.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Generate everything" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Website"), "https://ella.example");
    releasePortrait();
    const list = screen.getByRole("list", { name: "Generation progress" });
    await waitFor(() => expect(within(list).getAllByText("Done")).toHaveLength(5));
    expect(screen.getByDisplayValue("https://ella.example")).toBeTruthy();
    expect(screen.getByDisplayValue("New bio.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Generate everything" }) as HTMLButtonElement).disabled).toBe(false);
    expect(vi.mocked(global.fetch).mock.calls).toHaveLength(5);
  });

  it("after a save the bar clears even when the server tidied the values (trimmed bio)", async () => {
    global.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse(String(init!.body)).author as { bio: string };
      return new Response(JSON.stringify({ author: { ...ELLA, ...sent, bio: sent.bio.trim() } }), { status: 200 });
    }) as unknown as typeof fetch;
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.type(screen.getByLabelText("Bio"), " More.  ");
    await userEvent.click(within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", { name: "Save author" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Author saved", "success"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull());
    expect(screen.getByDisplayValue("Old bio. More.")).toBeTruthy();
  });

  it("a portrait uploaded before the first save is named for the id the author will get", async () => {
    const forms: FormData[] = [];
    global.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      forms.push(init!.body as FormData);
      return new Response(JSON.stringify({ portrait: { kind: "uploaded", path: "/authors/assets/ann-lee-2-0123456789.webp" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const { container } = render(<AuthorProfileEditor author={null} mode="create" sites={[]} takenNames={["Ann Lee"]} takenIds={["ann-lee"]} />);
    await userEvent.type(screen.getByLabelText("Name"), "Ann Lee");
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.accept).toBe("image/jpeg,image/png,image/webp");
    await userEvent.upload(picker, new File(["x"], "me.png", { type: "image/png" }));
    await waitFor(() => expect(forms).toHaveLength(1));
    expect(forms[0]!.get("authorId")).toBe("ann-lee-2");
  });

  it("portrait style: Realistic by default; switching to Illustrated is what Regenerate and Generate everything send", async () => {
    const styles: unknown[] = [];
    global.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as { part: string; portraitStyle?: string };
      if (b.part === "portrait") styles.push(b.portraitStyle);
      const value = b.part === "portrait" ? { kind: "generated", path: "/authors/assets/ella-hughes-0123456789.webp" } : b.part === "beats" ? ["A", "B"] : "x";
      return new Response(JSON.stringify({ status: "ok", value }), { status: 200 });
    }) as unknown as typeof fetch;
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    const group = screen.getByRole("radiogroup", { name: "Portrait style" });
    expect((within(group).getByRole("radio", { name: "Realistic" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate portrait" }));
    await waitFor(() => expect(styles).toEqual(["realistic"]));
    await userEvent.click(within(group).getByRole("radio", { name: "Illustrated" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate everything" }));
    await waitFor(() => expect(styles).toEqual(["realistic", "illustrated"]));
  });

  it("a new name on an author with a generated portrait suggests a matching portrait", async () => {
    const withPortrait: AuthorListItem = { ...ELLA, portrait: { kind: "generated", path: "/authors/assets/ella-hughes-0123456789.webp" } };
    respond({ name: "Ngozi Adeyemi", portrait: { kind: "generated", path: "/authors/assets/ella-hughes-abcdef0123.webp" } });
    render(<AuthorProfileEditor author={withPortrait} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate name" }));
    await screen.findByDisplayValue("Ngozi Adeyemi");
    const hint = screen.getByText(/portrait was made for the previous name/i);
    await userEvent.click(within(hint.parentElement!).getByRole("button", { name: "Make a matching portrait" }));
    await waitFor(() => expect(screen.queryByText(/portrait was made for the previous name/i)).toBeNull());
    const portraitCall = vi.mocked(global.fetch).mock.calls.find(([, i]) => String(i?.body).includes('"part":"portrait"'))!;
    expect(JSON.parse(String(portraitCall[1]!.body)).draft.name).toBe("Ngozi Adeyemi");
  });

  it("delete shows it's working (Deleting…, buttons locked) until the server answers", async () => {
    let answer: () => void = () => undefined;
    global.fetch = vi.fn(() => new Promise<Response>((r) => { answer = () => r(new Response(JSON.stringify({ ok: true }), { status: 200 })); })) as unknown as typeof fetch;
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete author" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const busy = screen.getByRole("button", { name: /Deleting/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    answer();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/authors"));
  });
});
