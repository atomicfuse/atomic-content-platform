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
- Choose the portrait style above the portrait buttons: **Realistic** (default) or **Illustrated**. Each new portrait gets a different look (age, hair, skin tone, clothing, background). **Upload** your own photo any time (JPG, PNG or WebP; it is cropped square), or **Remove** to show initials.
- Bios are 60 to 120 words and describe the beat and voice. The AI never invents degrees, employers or awards.
- **Exclusive to**: an exclusive author is never picked automatically for other sites.
- Leaving the page with unsaved changes asks **Leave without saving?** first.
- An author still used by sites can't be deleted. The delete dialog lists those sites.

## Costs
Each text part is one short AI call; each portrait is one image (about $0.01). These costs are recorded under the source **authors**.

## Best fit
Each author has up to three **Best fit** site categories (the same categories sites use). **Regenerate** suggests them from the author's beats; **Generate everything** and **Generate missing profiles** fill them in too. The profile lists sites in those categories that don't use the author yet under **Good match for**, and the library can be filtered by **Best fit**.

## Authors on a site
Every site has its own author. On a site, the **Content Agent → Authors** tab sets who writes for it:
- **Create author for this site** writes a new author for the site (bio, Best fit, realistic portrait), exclusive to it. About a minute. It's added to the library when you click **Save authors**.
- **Add author** lists the library with the best fits first ("Good fit", "Close fit"). An author exclusive to another site asks first; assigning them makes them exclusive to this site too.
- A site can have several authors. Give an author topics and they write those; an author with no topics writes on every topic. Several authors can share a topic and take turns. If every author has topics, topics nobody chose are split among them when you save, and the split is kept. You can change authors and topics any time.
- New articles are credited to the authors who cover the article's topic, taking turns. Older articles keep the name they were published with.
- Until a site has authors, its articles use the site's previous author name.

On the **Authors** screen, **Give every site an author** does this for all sites at once (sites that already have authors and Grid sites are skipped).
