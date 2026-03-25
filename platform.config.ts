/**
 * Organization registry — maps org slugs to their network data repos.
 *
 * The dashboard and content pipeline use this to know which GitHub repo
 * holds the YAML configs and markdown articles for each organization.
 */

export interface OrgRegistryEntry {
  name: string;
  network_repo: string;
  github_token_secret: string;
}

export const organizations: Record<string, OrgRegistryEntry> = {
  "atomic-labs": {
    name: "Atomic Labs",
    network_repo: "atomicfuse/atomic-labs-network",
    github_token_secret: "GITHUB_TOKEN_ATOMIC_LABS",
  },
};

export interface AccessEntry {
  orgs: string[];
}

export const access: Record<string, AccessEntry> = {
  "admin@atomiclabs.com": { orgs: ["atomic-labs"] },
};
