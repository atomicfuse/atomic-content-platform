# Unify Site Page Tabs — Design Spec

## Summary

Refactor the site detail page to: (1) replace bespoke Tracking/Scripts/Ads sub-tabs with a single Config sub-tab using `UnifiedConfigForm`, and (2) collapse Content Agent + Quality into the Content Brief sub-tab.

## Tab Structure After

```
Top-level: Staging & Preview | Content | Site Identity | Email
                                          ↓
                              Identity | Content Brief | Groups | Config
```

Removed tabs: Tracking, Scripts & Vars, Ads Config, Quality (sub-tabs), Content Agent (top-level).

## Design Decisions

1. **Generation UI**: Minimal — number input + Generate button + inline status (running/done/error). Strip pipeline visualization, per-article results, recent history.
2. **Inheritance data**: Enhance `/api/sites/site-config` to return org + group + override configs alongside site config. UnifiedConfigForm diffs layers for badges.
3. **Save behavior**: Each sub-tab saves independently via its own Save button.

## Changes

### 1. SiteDetailTabs.tsx
- Remove "Content Agent" top-level tab (was rendering ContentGenerationPanel)
- Keep: Staging & Preview, Content, Site Identity, Email

### 2. ContentAgentTab.tsx → SiteIdentityTabs.tsx (rename)
- Remove sub-tabs: Tracking, Scripts & Vars, Ads Config, Quality
- Keep sub-tabs: Identity, Content Brief, Groups
- Add sub-tab: Config (renders UnifiedConfigForm with mode="site")
- Each sub-tab gets its own Save button (independent saves)

### 3. Content Brief sub-tab (expanded)
Sections in order:
1. Topics (existing)
2. Articles per day (existing)
3. Preferred days (existing)
4. Content guidelines (existing)
5. Generate Articles — number input (default: articles_per_day), Generate button, inline status
6. Quality — threshold slider (0-100) + 5 criteria weight sliders + total indicator

### 4. Config sub-tab (new)
- Renders `UnifiedConfigForm` with `mode="site"` + resolved config + inheritance chain
- Sections: Tracking, Scripts, Script Variables, Ads Config, ads.txt (CLS Heights hidden for site mode per existing logic)
- Inheritance badges: "From org", "From group: {id}", "Site override"
- Save button calls a new or enhanced endpoint for site config updates

### 5. API: /api/sites/site-config enhancement
- Current: returns raw site YAML from staging branch
- New: also returns `inheritanceChain: { org, groups[], overrides[] }` with resolved configs per layer
- UnifiedConfigForm uses this to compute inheritance badges

### 6. Delete dead code
- `ContentGenerationPanel.tsx` — replaced by inline minimal generate in Content Brief
- Bespoke tracking/scripts/ads form code removed from old ContentAgentTab
- Any imports/references cleaned up

## Out of Scope
- No API schema changes
- No visual redesign beyond tab restructuring
- Staging & Preview, Content, Email tabs untouched
