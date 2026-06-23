# Round-Robin Topic Rotation

When the scheduler generates articles for a site with multiple topics, it uses **round-robin rotation** to distribute articles fairly across all topics. This replaces the older per-topic schedule model where each topic had its own `articles_per_week` and `preferred_days`.

## How It Works

### Single source of truth: site-level schedule

Scheduling is controlled entirely at the site level via `brief.schedule`:

```yaml
# site.yaml
schedule:
  articles_per_day: 3
  preferred_days:
    - Monday
    - Thursday
```

Topics no longer have their own schedule. Each topic only defines **what** content to fetch (via filters or a bundle), not **when** or **how many**.

### Round-robin selection

When the scheduler fires for a site, it:

1. Reads the site's `topicRotation.nextIndex` from MongoDB (starts at 0 on the first run).
2. Picks the next N topics starting at that index, wrapping around if needed. N = `articles_per_day`.
3. Generates **1 article per selected topic**.
4. Saves the new `nextIndex` back to MongoDB so the next run continues where this one left off.

### Example: 5 topics, 3 articles/day, Mondays only

```
Topics: [Tech, Travel, Food, Sports, Music]

Week 1 (Mon):  nextIndex=0 → Tech, Travel, Food       → save nextIndex=3
Week 2 (Mon):  nextIndex=3 → Sports, Music, Tech       → save nextIndex=1
Week 3 (Mon):  nextIndex=1 → Travel, Food, Sports      → save nextIndex=4
Week 4 (Mon):  nextIndex=4 → Music, Tech, Travel       → save nextIndex=2
Week 5 (Mon):  nextIndex=2 → Food, Sports, Music       → save nextIndex=0
```

Over 5 weeks, every topic gets exactly 3 articles — perfectly fair distribution.

### Distribution table

```
         Tech  Travel  Food  Sports  Music
Week 1     *      *      *
Week 2     *                   *       *
Week 3            *      *     *
Week 4     *      *                    *
Week 5                   *     *       *
─────────────────────────────────────────
Total      3      3      3     3       3
```

## What triggers it

Round-robin only applies to **scheduler-triggered** runs (cron or "Run Now"). These paths are unchanged:

| Trigger | Topic selection |
|---------|----------------|
| **Scheduler** (cron / Run Now) | Round-robin from `nextIndex` |
| **Manual per-topic** ("Generate" button on a topic) | That specific topic only |
| **Manual all-topics** ("Generate N Articles" on a site) | All topics, distribute evenly |

## MongoDB state

The rotation state is stored in the `site_stats` collection alongside existing stats:

```
db.site_stats.findOne({ _id: "travelnights" })
```

```json
{
  "_id": "travelnights",
  "lastRunAt": "2026-06-23T18:00:12Z",
  "totalCreated": 347,
  "schedule": {
    "articlesPerDay": 2,
    "preferredDays": ["Monday", "Thursday"],
    "weeklyTarget": 4
  },
  "topicRotation": {
    "nextIndex": 2,
    "lastServed": ["Tech News", "Travel Tips"],
    "updatedAt": "2026-06-23T18:00:45Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `topicRotation.nextIndex` | number | Index into the site's `topics_v2` array for the next run. Wraps via modulo. |
| `topicRotation.lastServed` | string[] | Topic names served in the most recent run. |
| `topicRotation.updatedAt` | Date | When the rotation was last advanced. |

On the first scheduler run after deploy, `topicRotation` is `null` — the agent defaults to `nextIndex=0` (starts from the first topic).

## Edge cases

- **`articles_per_day` > number of topics** — topics repeat in the same run. E.g. 2 topics and 3 articles/day: `[A, B, A]`. Topic A gets 2 articles, B gets 1. The next run starts at the new `nextIndex`, so B will be first next time.
- **Topic added or removed** — `nextIndex` is clamped via modulo (`nextIndex % topics.length`). If a topic is removed and `nextIndex` now exceeds the array length, it wraps to a valid position. No manual reset needed.
- **MongoDB write fails** — the `saveTopicRotation` call is non-fatal (`.catch()`). Articles are still generated; the worst case is topics repeat on the next run.
- **`topicRotation` is null** — first run defaults to `nextIndex=0`. This is the cold-start path for all sites.

## Configuring a site's schedule

Open the site's detail page in the dashboard → **Content Agent** tab. The schedule fields are:

- **Articles Per Day** — how many articles to generate on each preferred day.
- **Preferred Days** — which days of the week the scheduler should run for this site.

These are site-level settings. Individual topics no longer have scheduling fields.

## Code map

```
services/content-pipeline/
  src/stats/types.ts                  -- TopicRotation interface on SiteStats
  src/stats/topic-rotation.ts         -- selectTopicsRoundRobin (pure), readTopicRotation, saveTopicRotation
  src/stats/__tests__/topic-rotation.test.ts  -- 7 unit tests for round-robin logic
  src/agents/content-generation/agent.ts      -- runPerTopicGeneration: round-robin path
  src/stats/schedule.ts               -- buildScheduleFromBrief: uses site-level schedule only

services/dashboard/
  src/lib/site-stats.ts               -- buildScheduleFromBrief (dashboard copy): site-level only
  src/app/api/site-stats/route.ts     -- loads briefs for schedule enrichment
```

## Migration from per-topic schedules

- **Existing `topics_v2[*].schedule` in YAML** — these fields remain in site configs but are ignored. No manual editing needed. New topics created via the dashboard won't have a `schedule` field.
- **MongoDB self-corrects** — the next scheduler run for each site writes the correct `schedule` snapshot from `brief.schedule`. No manual migration.
- **Sites missing `brief.schedule`** — sites set up before site-level scheduling may lack this field. These sites are skipped by the scheduler. Add a schedule via the Content Agent tab.
