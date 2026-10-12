# Authors

The **Authors** screen (sidebar, after Groups) is the network's author library. Each author has a name, tagline,
bio, beats (what they write about), an illustrated portrait and optional links. Profiles live in the network repo
(`authors/<id>.yaml`) and sync to the sites automatically.

## Library
- Search by name, tagline, beat or site. Filter: **Exclusive**, **Not on any site**, **Incomplete profile** (no bio or portrait). Sort by **Recently updated**, **Name** or **Most sites**. The search, filter and sort stay in the page address, so the back button and shared links keep them.
- **New author** opens two choices: **Generate with AI** (optionally for a site or a beat) or **Start blank**. Nothing is saved until you click **Save author**.
- **Generate missing profiles (N)** fills in every incomplete author and saves each one (about 30 to 60 seconds per author). When it finishes it says how many need another try; they stay under **Incomplete profile**, so you can run it again.

## Profile
- **Regenerate** on any section writes a new version of just that part. It shows as an unsaved change you can **Save author** or **Discard**.
- **Generate everything** writes the whole profile in order (name, tagline, bio, beats, portrait) and shows a checklist. A part that fails is marked **Failed** without stopping the others; run that section's **Regenerate** to try it again.
- Portraits are illustrated, never photographs of made-up people. **Upload** your own photo any time (it is cropped square), or **Remove** to show initials.
- Bios are 60 to 120 words and describe the beat and voice. The AI never invents degrees, employers or awards.
- **Exclusive to**: an exclusive author is never picked automatically for other sites.
- Leaving the page with unsaved changes asks **Leave without saving?** first.
- An author still used by sites can't be deleted. The delete dialog lists those sites.

## Costs
Each text part is one short AI call; each portrait is one image (about $0.05). These costs are recorded under the source **authors**.
