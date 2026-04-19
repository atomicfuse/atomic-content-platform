# Implementation Plan: Unify Site Page Tabs

**Spec:** `docs/superpowers/specs/2026-04-18-unify-site-page-tabs-design.md`

## Steps

### Step 1: Enhance `/api/sites/site-config` to return inheritance chain

**File:** `services/dashboard/src/app/api/sites/site-config/route.ts`

- After reading the site config, also read:
  - `org.yaml` via `readFileContent("org.yaml")`
  - Each group in `site.groups[]` via `readFileContent("groups/{id}.yaml")`
- Return: `{ config: <site config>, inheritance: { org: <parsed org>, groups: <parsed group configs[]> } }`
- This gives the frontend everything needed for inheritance badges

### Step 2: Create `SiteConfigTab` component

**New file:** `services/dashboard/src/components/site-detail/SiteConfigTab.tsx`

- Client component that:
  1. Fetches `/api/sites/site-config?domain=X` (gets site config + inheritance chain)
  2. Normalizes the site config into `UnifiedConfigFields` using the same normalizer functions from the group page
  3. Renders `UnifiedConfigForm` with `mode="site"`
  4. Has its own Save button that calls `/api/sites/save` with only config fields (tracking, scripts, scripts_vars, ads_config, ads_txt, theme, legal)
- Extract the normalizer functions (normalizeTracking, normalizeScripts, normalizeAdsConfig, normalizeAdsTxt) into a shared util since they're duplicated between group page and this new component

### Step 3: Create shared config normalizers

**New file:** `services/dashboard/src/lib/config-normalizers.ts`

- Move `normalizeTracking`, `normalizeScripts`, `normalizeAdsConfig`, `normalizeAdsTxt` from `groups/[groupId]/page.tsx` into this shared file
- Update the group page to import from the shared file
- SiteConfigTab will also import from here

### Step 4: Refactor ContentAgentTab → 4 sub-tabs

**File:** `services/dashboard/src/components/site-detail/ContentAgentTab.tsx`

- Remove sub-tabs: `tracking`, `scripts`, `ads`, `quality`
- Remove all state for: tracking, scripts, scriptVars, adsConfig, orgConfig, InheritanceIndicator
- Remove `hasCustomValue` function
- Keep sub-tabs: `identity`, `brief`, `groups`
- Add sub-tab: `config` → renders `<SiteConfigTab domain={domain} />`
- Content Brief sub-tab: append Quality section (threshold + weights) and Generate Articles section (minimal: number input + button + status)
- Each sub-tab (identity, brief, groups) keeps its own save button
- The `handleSave` function only sends identity + brief + groups fields
- Remove the shared "Save All Changes" button at the bottom

### Step 5: Add minimal Generate Articles section to Content Brief

Inline in ContentAgentTab.tsx's brief sub-tab content:

- Number input defaulting to `articlesPerDay`, range 1-50
- "Generate" button
- Calls `POST /api/agent/generate` with `{ siteDomain: domain, branch: stagingBranch, count }`
- Inline status: idle → "Generating..." spinner → "Done! Created X articles" or "Error: message"
- No pipeline visualization, no per-article results, no history

### Step 6: Move Quality section into Content Brief sub-tab

- Move the quality threshold slider and criteria weights sliders into the Content Brief sub-tab content, after the Generate Articles section
- Both quality and brief fields save together via the brief's Save button
- Keep exact same slider UI

### Step 7: Update SiteDetailTabs

**File:** `services/dashboard/src/app/sites/[domain]/SiteDetailTabs.tsx`

- Remove `agentTab` prop from interface
- Remove "Content Agent" tab item
- Only: Staging & Preview, Content, Site Identity, Email

### Step 8: Update site detail page.tsx

**File:** `services/dashboard/src/app/sites/[domain]/page.tsx`

- Remove `ContentGenerationPanel` import and `agentTab` prop
- Pass `stagingBranch` to ContentAgentTab (already done)
- Remove any unused imports

### Step 9: Delete dead code

- Delete `services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx`
- Verify no other imports reference it
- Remove any unused imports from ContentAgentTab (TrackingForm, ScriptsEditor, ScriptVariablesEditor, AdsConfigForm, InheritanceIndicator)

### Step 10: Typecheck and verify

- Run `cd services/dashboard && pnpm typecheck`
- Fix any type errors
- Manual verification: site page has Config tab, Content Brief has generate + quality, no dead tabs

## Review Checkpoints

- After Step 3: shared normalizers extracted, group page still works
- After Step 6: full ContentAgentTab refactor complete
- After Step 9: all dead code removed
- After Step 10: clean typecheck
