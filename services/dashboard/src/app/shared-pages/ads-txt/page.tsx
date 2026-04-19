"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface Profile {
  name: string;
  content: string;
}

export default function AdsTxtPage(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newProfileModal, setNewProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileContent, setNewProfileContent] = useState("");
  const [sites, setSites] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/ads-txt/profiles").then((r) => r.json()) as Promise<Profile[]>,
      fetch("/api/ads-txt/assignments").then((r) => r.json()) as Promise<Record<string, string>>,
      fetch("/api/sites/list").then((r) => (r.ok ? r.json() : [])) as Promise<Array<{ domain: string }>>,
    ])
      .then(([profilesData, assignmentsData, sitesData]) => {
        setProfiles(profilesData);
        setAssignments(assignmentsData);
        // Use full sites list; fall back to assignment keys if sites API returned nothing
        const sitesDomains = sitesData.length > 0
          ? sitesData.map((s) => s.domain)
          : Object.keys(assignmentsData);
        setSites(sitesDomains);
      })
      .catch(() => toast("Failed to load data", "error"));
  }, [toast]);

  const saveProfile = async (): Promise<void> => {
    if (!editingProfile) return;
    setSaving(true);
    try {
      await fetch(`/api/ads-txt/profiles/${editingProfile.name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setProfiles((prev) =>
        prev.map((p) => (p.name === editingProfile.name ? { ...p, content: editContent } : p)),
      );
      toast("Profile saved", "success");
    } catch {
      toast("Failed to save", "error");
    }
    setSaving(false);
  };

  const createProfile = async (): Promise<void> => {
    const name = newProfileName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!name) {
      toast("Enter a valid profile name", "error");
      return;
    }
    try {
      await fetch("/api/ads-txt/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: newProfileContent }),
      });
      setProfiles((prev) => [...prev, { name, content: newProfileContent }]);
      setNewProfileModal(false);
      setNewProfileName("");
      setNewProfileContent("");
      toast("Profile created", "success");
    } catch {
      toast("Failed to create profile", "error");
    }
  };

  const deleteProfile = async (name: string): Promise<void> => {
    try {
      await fetch(`/api/ads-txt/profiles/${name}`, { method: "DELETE" });
      setProfiles((prev) => prev.filter((p) => p.name !== name));
      if (editingProfile?.name === name) setEditingProfile(null);
      toast("Profile deleted", "success");
    } catch {
      toast("Failed to delete", "error");
    }
  };

  const updateAssignment = async (domain: string, profile: string): Promise<void> => {
    const newAssignments = { ...assignments };
    if (profile === "default" || !profile) {
      delete newAssignments[domain];
    } else {
      newAssignments[domain] = profile;
    }
    try {
      await fetch("/api/ads-txt/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAssignments),
      });
      setAssignments(newAssignments);
    } catch {
      toast("Failed to update assignment", "error");
    }
  };

  const profilesTab = (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={(): void => setNewProfileModal(true)}>
          + Create Profile
        </Button>
      </div>
      <div className="grid gap-3">
        {profiles.map((profile) => (
          <div
            key={profile.name}
            className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{profile.name}</h3>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(): void => {
                    setEditingProfile(profile);
                    setEditContent(profile.content);
                  }}
                >
                  Edit
                </Button>
                {profile.name !== "default" && (
                  <Button variant="ghost" size="sm" onClick={(): void => { deleteProfile(profile.name); }}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
            {editingProfile?.name === profile.name ? (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e): void => setEditContent(e.target.value)}
                  className="w-full h-48 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:ring-2 focus:ring-cyan/50 resize-y"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={(): void => setEditingProfile(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={saving} onClick={saveProfile}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <pre className="text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap max-h-24 overflow-hidden">
                {profile.content.slice(0, 200)}
                {profile.content.length > 200 ? "..." : ""}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const assignmentsTab = (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Assign an ads.txt profile to each site. Sites without an assignment use the default profile.
      </p>
      {sites.length > 0 ? (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-secondary)]">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Site
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Profile
                </th>
              </tr>
            </thead>
            <tbody>
              {sites.map((domain) => (
                <tr key={domain} className="border-b border-[var(--border-secondary)] last:border-0">
                  <td className="px-4 py-3 text-sm text-[var(--text-primary)]">{domain}</td>
                  <td className="px-4 py-3">
                    <select
                      value={assignments[domain] ?? "default"}
                      onChange={(e): void => { updateAssignment(domain, e.target.value); }}
                      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                    >
                      {profiles.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">No sites found. Add site domains in the assignments to get started.</p>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={(): void => router.push("/shared-pages")}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold">ads.txt Profiles</h1>
      </div>

      <Tabs
        tabs={[
          { id: "profiles", label: "Profiles", content: profilesTab },
          { id: "assignments", label: "Assignments", content: assignmentsTab },
        ]}
      />

      <Modal
        open={newProfileModal}
        onClose={(): void => setNewProfileModal(false)}
        title="Create Profile"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Profile Name
            </label>
            <input
              value={newProfileName}
              onChange={(e): void => setNewProfileName(e.target.value)}
              placeholder="e.g. premium, taboola-only"
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Content
            </label>
            <textarea
              value={newProfileContent}
              onChange={(e): void => setNewProfileContent(e.target.value)}
              placeholder="google.com, pub-1234567890, DIRECT, f08c47fec0942fa0"
              className="w-full h-48 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] font-mono placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 resize-y"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={(): void => setNewProfileModal(false)}>
              Cancel
            </Button>
            <Button onClick={createProfile}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
