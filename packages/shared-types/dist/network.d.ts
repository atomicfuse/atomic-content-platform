/**
 * Network-level manifest describing the content platform instance.
 * Corresponds to the top-level `network.yaml`.
 */
export interface NetworkManifest {
    /** Semantic version of the platform schema/tooling. */
    platform_version: string;
    /** GitHub repository identifier for the platform source. */
    platform_repo: string;
    /** Unique slug identifying this network instance. */
    network_id: string;
    /** Human-readable display name for the network. */
    network_name: string;
    /** ISO-8601 date string when the network was created. */
    created: string;
}
//# sourceMappingURL=network.d.ts.map