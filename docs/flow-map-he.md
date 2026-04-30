# מפת זרימה - מערכת Atomic Content Network

**עדכון אחרון:** 2026-04-30 (אחרי השלמת המעבר Pages → Workers + KV + R2)

מסמך זה מתאר **כל פעולה** במערכת. לכל פעולה יש:
- **תקציר 2 דקות:** מה הקלט, העיבוד, והפלט.
- **הסבר 5 דקות:** הלוגיקה העמוקה.
- **טבלת בקרה תפעולית:** שחזור, ניטור, מקרי קצה, סיכונים.

הדפים מנווטים מלמעלה למטה — קרא את "ארכיטקטורה - מבט על" קודם, אחר כך צלול לזרימה הספציפית שמעניינת אותך. ה[**מקרא הטכני**](#מקרא-טכני) בסוף המסמך — אם נתקלת במונח שלא ברור, חפש שם.

---

## תוכן עניינים

1. [ארכיטקטורה - מבט על](#ארכיטקטורה---מבט-על)
2. [זרימות אוטומטיות (קורות מאחורי הקלעים)](#חלק-1-זרימות-אוטומטיות)
   - [1.1 בקשת דף באתר חי](#11-בקשת-דף-באתר-חי-user--worker)
   - [1.2 בקשת תמונה (asset)](#12-בקשת-תמונה-r2-asset)
   - [1.3 סנכרון תוכן ל-KV (`sync-kv.yml`)](#13-סנכרון-תוכן-ל-kv-sync-kvyml)
   - [1.4 פרסום מתוזמן (Scheduled Publisher)](#14-פרסום-מתוזמן-scheduled-publisher)
3. [זרימות שמופעלות ע"י משתמש](#חלק-2-זרימות-שמופעלות-עי-משתמש)
   - [2.1 יצירת כתבה חדשה (Generate)](#21-יצירת-כתבה-חדשה-generate)
   - [2.2 סקירת תור כתבות (Review Queue)](#22-סקירת-תור-כתבות-review-queue)
   - [2.3 עריכת קונפיגורציה של אתר/קבוצה/Override](#23-עריכת-קונפיגורציה)
   - [2.4 צפייה ב-Worker Preview](#24-צפייה-ב-worker-preview)
   - [2.5 פרסום ל-production (Publish)](#25-פרסום-ל-production)
   - [2.6 יצירת אתר חדש (Wizard)](#26-יצירת-אתר-חדש-wizard) ⚠️ דורש שכתוב
4. [זרימות תפעוליות](#חלק-3-זרימות-תפעוליות)
   - [3.1 Re-seed ידני של KV](#31-re-seed-ידני-של-kv)
   - [3.2 Audit סביבה (audit-environment.ts)](#32-audit-סביבה)
   - [3.3 Rollback של Phase 7](#33-rollback-של-phase-7)
5. [מקרא טכני](#מקרא-טכני)

---

## ארכיטקטורה - מבט על

```
                    ┌──────────────────────────────────┐
   coolnews.dev ───►│  Cloudflare Workers              │
                    │  atomic-site-worker (production) │
                    │                                  │
                    │  ┌─── middleware.ts              │
                    │  │   hostname → KV lookup        │
                    │  │   זיהוי האתר לפי hostname     │
                    │  │                               │
                    │  │   ┌── Astro pages (SSR)       │
                    │  │   │  homepage / article / ... │
                    │  │   │                           │
                    │  │   └── /<siteId>/assets/* ────►├── R2: atl-assets-prod
                    │  │                               │
                    │  └── reads CONFIG_KV ───────────►├── KV: a69cb2c5...
                    └──────────────────────────────────┘
                                  ▲
                                  │ sync-kv.yml writes
                                  │
                    ┌──────────────────────────────────┐
                    │  GitHub: atomic-labs-network     │
                    │                                  │
                    │  main:    sites/, org.yaml,      │
                    │           groups/, overrides/    │
                    │  staging/<domain>: שינויי תוכן   │
                    └──────────────────────────────────┘
                                  ▲
                                  │ commits
                                  │
                    ┌──────────────────────────────────┐
                    │  Dashboard (Next.js, CloudGrid)  │
                    │  + Content Pipeline (cron)       │
                    │  → קוראים/כותבים ל-GitHub        │
                    └──────────────────────────────────┘
```

**מהותית:** המערכת **לא בונה אתרים סטטיים** יותר. ה-Worker רץ בכל בקשה, קורא קונפיגורציה+תוכן מ-KV, ומגיש תמונות מ-R2. שינוי ביוגרפיה של אתר → commit ל-GitHub → `sync-kv.yml` כותב ל-KV → השינוי מופיע באתר תוך ~60 שניות **בלי build, בלי deploy.**

---

# חלק 1: זרימות אוטומטיות

## 1.1 בקשת דף באתר חי (User → Worker)

**טריגר:** גולש מקליד `coolnews.dev` בדפדפן או לוחץ על קישור.

### הסבר 2 דקות
- **קלט:** בקשת HTTP מהדפדפן (HTTP request).
- **עיבוד:** ה-DNS מפנה את הבקשה ל-Cloudflare. ה-Worker `atomic-site-worker` מתעורר בקצה של Cloudflare (ה-edge), קורא מי הגולש מבקש (איזה hostname + path), שולף את הקונפיגורציה של האתר מ-KV, מרנדר את הדף עם Astro SSR (Server-Side Rendering), ומחזיר HTML.
- **פלט:** דף HTML מלא חזרה לדפדפן בתוך ~50-300ms (תלוי ב-cache).

### הסבר 5 דקות (הלוגיקה העמוקה)
1. **DNS Resolution:** הדפדפן שואל "איפה coolnews.dev?". התשובה (IP של Cloudflare edge) ניתנת מאחר ו-`coolnews.dev` מוגדר כ-Workers Custom Domain (`pattern: "coolnews.dev", custom_domain: true` ב-`emit-env-configs.ts`). Cloudflare מחזיק את ה-DNS אוטומטית.
2. **Edge POP:** הבקשה מגיעה לשרת Cloudflare הקרוב גיאוגרפית. ה-Worker מועלה לזיכרון תוך פחות מ-50ms (Workers Startup Time).
3. **Middleware (`src/middleware.ts`):**
   - אם הנתיב הוא `/_ping` → מחזיר 200 OK מיד (health check).
   - אם הנתיב מתחיל ב-`/<siteId>/assets/...` → מדלג על חיפוש KV וקופץ ישר ל-handler של ה-asset (זרימה 1.2).
   - אחרת: מחפש את ה-hostname ב-KV (`site:coolnews.dev` → `{siteId: "coolnews-atl"}`), אז שולף `site-config:coolnews-atl` → ResolvedConfig מלא (תיאור האתר, theme, ads, tracking, …).
4. **Astro page handler:** ה-page המתאים (homepage / `[slug].astro`) רץ עם הקונפיגורציה. הוא קורא מאמר מ-KV (`article:coolnews-atl:<slug>`), פותר את ה-shared pages, מטמיע פלייסהולדרים של מודעות (Server Islands), ומחזיר HTML.
5. **Cache headers:** המידלוור מחיל headers לפי סוג הנתיב:
   - הומפייג: `max-age=30, s-maxage=60` (טריות גבוהה)
   - מאמר: `max-age=60, s-maxage=300` (פחות שינויים)
   - 404: `private, no-store` (לא לקאש שגיאות!)
   - Server Island: `private, no-store` (תמיד טרי כי יש בו ad placements)
6. **תשובה לדפדפן:** ה-HTML מתקבל. בקשה חוזרת תוך ה-cache window תהיה `MISS` בשרת אבל `HIT` ב-Cloudflare edge → אפילו יותר מהיר.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | אוטומטי - גולש פותח קישור |
| **איפה נשמר?** | התשובה לא נשמרת אצלנו. הקלט (KV+R2) הוא אצל Cloudflare. |
| **שחזור באמצע?** | אין מצב כזה - בקשה אטומית. אם ה-Worker נכשל, הגולש מקבל 5xx. |
| **בעלים של המידע?** | KV: לוגית - הצוות העריכה (דרך `staging/<domain>` → main). פיזית - Cloudflare. |
| **איך יודעים שהצליח?** | סטטוס 200 ב-response. ניטור: `wrangler tail atomic-site-worker --format pretty`, או Cloudflare Workers Metrics dashboard (5xx rate, p95). |
| **קנה מידה (50K כתבות)?** | KV מותאם לקריאות - תומך מיליוני קריאות ביום. מאמר אחד = key אחד ב-KV; 50K מאמרים = 50K keys. אין הגבלה משמעותית. |
| **ריסק מרכזי?** | KV "Eventually consistent" - אחרי שכותבים מאמר חדש, הוא יכול להגיע לחלק מ-edges רק תוך 60 שניות. **תרופה:** Cache headers קצרים בהומפייג (s-maxage=60), כך שגם אם נדבק בקאש - תוך דקה הכל מתעדכן. |
| **גנריות הקוד?** | ה-Worker אגנוסטי לאתר ספציפי. כל מה שתלוי באתר נטען מ-KV בזמן בקשה. הוספת אתר חדש = רק `seed-kv` חדש, אפס שינויי קוד. |
| **כישלון?** | אם KV לא מגיב → 500. אם hostname לא מוכר → 404 עם הודעה ברורה. אם מאמר לא קיים → 404 (לא 200 ריק). הכל לוג ב-`wrangler tail`. |
| **אימות פורמט?** | TypeScript types ב-`@atomic-platform/shared-types/ResolvedConfig`. אם KV מחזיר structure לא תקין - ה-runtime יקרוס בצורה מבוקרת ויחזיר 500. |
| **שחזור ידני?** | קוד ה-Worker זמין ב-git (`packages/site-worker/`). KV ניתן ל-re-seed דרך `pnpm seed:kv`. R2 ניתן לשחזור מ-`atomic-labs-network/sites/<id>/assets/`. |

---

## 1.2 בקשת תמונה (R2 Asset)

**טריגר:** דפדפן מבקש תמונה (`<img src="/coolnews-atl/assets/logo.png">`).

### הסבר 2 דקות
- **קלט:** בקשת GET ל-`coolnews.dev/coolnews-atl/assets/logo.png`.
- **עיבוד:** ה-Worker מזהה שמדובר בנתיב asset, מדלג על חיפוש KV, קורא את הקובץ ישר מ-R2 (cloud storage של Cloudflare), ומחזיר עם cache headers ארוכים.
- **פלט:** התמונה (image/png) עם cache של 24 שעות + ETag לבדיקה זולה אם השתנתה.

### הסבר 5 דקות
1. **בידוק נתיב:** ה-middleware מזהה שהנתיב תואם `/^\/[a-z0-9-]+\/assets\//` ומדלג על חיפוש KV (חיסכון ב-latency על כל תמונה).
2. **קריאה מ-R2:** Astro endpoint (`src/pages/[siteId]/assets/[...path].ts`) ממיר את הנתיב למפתח R2 (`coolnews-atl/assets/logo.png`) וקורא דרך ה-binding `env.ASSET_BUCKET.get(key)`.
3. **404 על miss:** אם לא קיים → מחזיר 404 עם `cache-control: private, no-store` (כדי שלא נדבק בקאש שגיאה).
4. **תשובה אם קיים:** ה-Worker מחזיר את הקובץ עם:
   - `content-type` נשלף אוטומטית מ-R2 metadata
   - `etag` מ-R2 (hash של הקובץ)
   - `cache-control: public, max-age=86400` (24 שעות)
5. **בקשה חוזרת:** הדפדפן/CDN שולחים את ה-ETag ב-`If-None-Match`. אם לא השתנה → 304 (Not Modified) **בלי שום body**, מהיר מאוד.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | אוטומטי - דפדפן מבקש תמונה כחלק מטעינת דף |
| **איפה נשמר?** | R2 bucket: `atl-assets-prod` (production), `atl-assets-staging` (staging). |
| **בעלים של המידע?** | המקור הקנוני: `atomic-labs-network/sites/<id>/assets/`. R2 הוא עותק derivat שנבנה ע"י `seed-kv.ts`. |
| **איך יודעים שהצליח?** | סטטוס 200 + cache HIT ratio ב-Cloudflare Analytics. בדיקה ידנית: `curl -I coolnews.dev/coolnews-atl/assets/logo.png`. |
| **קנה מידה?** | R2 ללא הגבלה מעשית. עלות: ~$0.015 לכל GB אחסון לחודש, חינם על request. |
| **ריסק מרכזי?** | אם seed-kv העלה לbucket לא נכון (staging במקום prod) - תמונות חדשות של coolnews.dev יחזירו 404. **תרופה:** `sync-kv.yml` מעביר עכשיו `R2_BUCKET` בהתאם ל-branch (תוקן בקומיט הבונוס בPR `chore/retire-deploy-workflow`). |
| **כישלון?** | 404 עם `private, no-store` (לא 500). הדפדפן מציג alt text או placeholder. |
| **אימות פורמט?** | R2 לא אוכף סכימה. ה-Worker פשוט מעביר את ה-bytes כמו שהם. אבל `seed-kv.ts` מעלה רק קבצי תמונה אמיתיים מהדיסק (תיקיית `sites/<id>/assets/`). |
| **שחזור ידני?** | `pnpm seed:kv <site>` יעלה את כל ה-assets שוב. לוקח ~30 שניות לאתר. |
| **מקרי קצה?** | Path traversal (`../../../etc/passwd`) - חסום בקוד (regex `path.includes('..')` → 400). מפתחות עם תווים בעייתיים - URL-encoded ע"י הדפדפן. |

---

## 1.3 סנכרון תוכן ל-KV (`sync-kv.yml`)

**טריגר:** push ל-branch ב-`atomic-labs-network` שנוגע ב-`sites/`, `groups/`, `overrides/`, `org.yaml`, או `network.yaml`.

### הסבר 2 דקות
- **קלט:** commit לרפו של הרשת (במייל, או ע"י הדשבורד, או ידני).
- **עיבוד:** GitHub Actions מזהה אילו אתרים הושפעו, ולכל אתר רץ `pnpm seed:kv`. הסקריפט מאחד קונפיגורציה (org → groups → overrides → site), קורא את כל המאמרים, מעלה תמונות ל-R2, וכותב הכל ל-KV.
- **פלט:** KV מעודכן. תוך 60 שניות מה-commit האתר רואה את השינוי.

### הסבר 5 דקות
1. **טריגר ב-GitHub Actions:** `on: push: branches: [main, 'staging/**']` עם `paths` סינון. push לקובץ לא רלוונטי (כמו README) **לא** מפעיל את ה-workflow.
2. **שלב `detect`:** סקריפט Python+bash שמסתכל על `git diff` בין הקומיט הנוכחי לקודם. שולף את שמות התיקיות `sites/<X>/...`, מתרגם לרשימת siteIds. אם השתנה `org.yaml` או קובץ ב-`groups/` או `overrides/` → רץ על **כל** האתרים שמושפעים (קבוצה X משפיעה על כל האתרים שהם חברים בה).
3. **Matrix run:** GitHub Actions מריץ עבודה במקביל לכל אתר ברשימה (עד ~10 במקביל).
4. **`pnpm seed:kv`:** לכל אתר:
   - קורא `org.yaml` + `groups/<g>.yaml` + `overrides/config/*.yaml` + `sites/<id>/site.yaml`.
   - מאחד עם **5-Layer Resolution** (org → groups → overrides לפי priority → site).
   - קורא כל הכתבות (`sites/<id>/articles/*.md`), מבצע markdown→HTML, משכתב URLs יחסיים (`/assets/foo.png` → `/<siteId>/assets/foo.png`).
   - קורא shared pages (about, privacy, ...) ומאחד עם override ל-site אם קיים.
   - מעלה את כל הקבצים תחת `sites/<id>/assets/` ל-R2 ב-`wrangler r2 object put` (לולאה).
   - בונה bulk JSON עם כל המפתחות + ערכים, וקורא ל-`wrangler kv bulk put`.
5. **Branch routing:**
   - push ל-`staging/<domain>` → KV staging (`4673c82c...`) + R2 staging (`atl-assets-staging`).
   - push ל-`main` → KV prod (`a69cb2c5...`) + R2 prod (`atl-assets-prod`).
   - הצימוד הזה קריטי: אם KV עובר ל-prod ו-R2 לסטייג'ינג, התמונות יחזירו 404 בייצור.
6. **רישום סטטוס:** מפתח `sync-status:<siteId>` ב-KV נכתב עם ה-SHA, התאריך, ו-ok flag. שיטה לבדוק "האם ה-KV עדכני?".

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | אוטומטי על push. ידני: `gh workflow run sync-kv.yml -f site=coolnews-atl`. |
| **איפה נשמר?** | KV של Cloudflare + R2 + מפתח `sync-status:<id>` בתור audit log. |
| **שחזור באמצע?** | אם הסקריפט נכשל באמצע (למשל אחרי R2 לפני KV), הוא יכול לרוץ מחדש בבטחה - הוא idempotent (כתיבת אותם ערכים אינה משנה את התוצאה). |
| **בעלים של המידע?** | המקור: רפו `atomic-labs-network`. KV/R2 הם derivat - כל מה שכתוב שם נבנה מהרפו. אם KV מתאפס - `pnpm seed:kv` יבנה הכל מחדש מ-git. |
| **איך יודעים שהצליח?** | GitHub Actions UI (✓ ירוק). ב-KV: `sync-status:<id>` עם `ok: true`. בדיקה: `wrangler kv key get "sync-status:coolnews-atl"`. |
| **קנה מידה?** | סקריפט עובד על אתר אחד בכל פעם. אתר עם 1000 כתבות = ~10 שניות. עם 50K כתבות = ~5 דקות. אפשר להאיץ עם batch sizes או concurrent uploads (אופטימיזציה עתידית). |
| **ריסק מרכזי?** | "Stub config bug" - אם ה-checkout בלוקאלי לא מכיל את `sites/<id>/site.yaml` (למשל התקלקלות ב-checkout), seed-kv היה כותב stub config ריק ל-KV, והאתר היה נראה ריק. **תרופה:** עדכון ב-Phase 8 - seed-kv זורק שגיאה אם site.yaml חסר במקום לכתוב stub. |
| **גנריות?** | ה-script אגנוסטי לתוכן. `org.yaml` יכול להוסיף שדות חדשים, `site.yaml` יכול לכלול `theme.foo` חדש - הכל מועתק ל-ResolvedConfig. אם רוצים להוסיף שדה חדש שמשתמש ב-Worker → תוסיפו את השדה ל-`shared-types/SiteConfig.ts` ולקוד שצורך אותו. |
| **כישלון?** | GitHub Actions מסמן את ה-job כ-failed. הצוות מקבל מייל. שום דבר לא נשבר ב-KV - הערכים הקודמים נשמרים. ה-`sync-status` יישאר עם ה-SHA הישן → indicator לעיכוב. |
| **אימות פורמט?** | YAML parsing: שגיאת syntax = exception → workflow נכשל. סכימה: TypeScript types - אם site.yaml חסרה שדה חובה, הקוד יקרוס בקריאה. |
| **שחזור ידני?** | מקומי: `cd packages/site-worker && CLOUDFLARE_ACCOUNT_ID=... pnpm seed:kv <site> [hostnames]`. דרישה: `wrangler login` (OAuth). |
| **מקרי קצה?** | אתר ללא articles directory - seed-kv מתעלם בלא שגיאה. אתר ללא assets - skip. גודל מאמר > 25MB (מגבלת KV) - יכשל; מענה: לא מציבים מאמרים כאלה. |

---

## 1.4 פרסום מתוזמן (Scheduled Publisher)

**טריגר:** Cron של CloudGrid כל שעה, בכל יום.

### הסבר 2 דקות
- **קלט:** `GET /scheduled-publish` ל-content-pipeline (פנימי).
- **עיבוד:** הסרוויס בודק שהתאריך/שעה מותר לפי `scheduler/config.yaml` ב-network repo. אז עובר על כל האתרים ברשימת `dashboard-index.yaml`, ולכל אחד מחליט כמה כתבות לכתוב היום (`articles_per_day`), אם השעה מותרת. לכל אתר שצריך - מפעיל את אותה מכונת היצירה כמו ב-Generate הידני.
- **פלט:** כתבות חדשות committed ל-`staging/<domain>` של אתרים רלוונטיים. סנכרון אוטומטי ל-KV דרך 1.3.

### הסבר 5 דקות
1. **CloudGrid cron:** `0 * * * * UTC` ב-`cloudgrid.yaml` של ה-platform repo. כל שעה, CloudGrid שולח HTTP GET ל-content-pipeline.
2. **שלב 1: שער עולמי (Layer 1):**
   - ה-pipeline קורא `scheduler/config.yaml` מ-main של network repo: `{ enabled: true, run_at_hours: [14], timezone: "America/New_York" }`.
   - אם `enabled: false` → יוצא מיד.
   - אם השעה הנוכחית (לפי timezone) לא ב-`run_at_hours` → יוצא.
3. **שלב 2: רשימת אתרים:** קורא `dashboard-index.yaml` מ-main, סינן אתרים פעילים (`active: true`).
4. **שלב 3: סדירות לפי אתר (Layer 2):**
   - לכל אתר: קורא `sites/<domain>/site.yaml` מ-`staging/<domain>` (עם fallback ל-main).
   - בודק `brief.schedule.preferred_days` - אם היום בשבוע לא בה → דלג.
   - חישוב: `articles_per_day` (ברירת מחדל) או `ceil(articles_per_week / preferred_days.length)`.
5. **שלב 4: יצירה:** לכל אתר רלוונטי, רץ אותו זרם של זרימה 2.1 (Generate) - עם `branch: staging/<domain>` כדי שייכתב ב-GitHub.
6. **שלב 5: ":Run Now" override:** אם `?force=true` בכתובת (משמש בכפתור "Run Now" בדשבורד), הוא עוקף את Layer 1 בלבד; Layer 2 (per-site) עדיין מופעל.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | אוטומטי (CloudGrid cron). ידני: כפתור "Run Now" בדשבורד `/scheduler`. |
| **איפה נשמר?** | תוצרים נשמרים ב-GitHub branches `staging/<domain>`. Logs - ב-CloudGrid. |
| **שחזור באמצע?** | אם הסרוויס נופל באמצע - חלק מהאתרים יקבלו כתבות, חלק לא. ה-cron הבא יתפוס את אלה שלא קיבלו. אין השפעה רעה - רק מאמר אחד או שניים שנדחים בשעה. |
| **בעלים?** | בעלי ה-config: `scheduler/config.yaml` נערך ע"י admin בדשבורד. בעלי per-site: עורך האתר דרך `Site Identity → Content Brief`. |
| **איך יודעים שהצליח?** | CloudGrid logs. כל אתר שיצר כתבה ידווח ב-log עם `articleSlug`. אינדיקציה משנית: כתבות חדשות במאגר `staging/<domain>`. |
| **קנה מידה?** | רץ סדרתית על כל אתר. 50 אתרים × ~30 שניות לכתבה = 25 דקות. אם נצטרך > שעה - נצטרך מקבילה (כרגע לא נדרש). |
| **ריסק מרכזי?** | יצירת מאמר כפול (אם הסרוויס רץ פעמיים בטעות) - כיסוי ע"י סקריפט "checkDuplicates" שמסנן לפי כותרות דומות. |
| **גנריות?** | מנוע היצירה אגנוסטי לאתר (קורא brief, מייצר תוכן בהתאם). הוספת אתר חדש = אפס שינוי קוד. |
| **כישלון?** | שגיאה ביצירת כתבה אחת לא מפילה את הריצה - log error, ממשיך לאתר הבא. שגיאה ב-API חיצוני (Anthropic) - מנסה שוב עד 3 פעמים. |
| **שחזור ידני?** | `curl https://content-pipeline-app.apps.cloudgrid.io/scheduled-publish?force=true` (כשעובדים מ-CloudGrid). מ-localhost: דשבורד "Run Now". |
| **מקרי קצה?** | אתר חדש בלי brief מלא - skip. שעון קיץ/חורף (DST) - timezone של ה-pipeline קובע. |

---

# חלק 2: זרימות שמופעלות ע"י משתמש

## 2.1 יצירת כתבה חדשה (Generate)

**טריגר:** משתמש לוחץ "Generate" בדשבורד באתר ספציפי (`/sites/<domain>` → Site Settings → Content Brief → Generate).

### הסבר 2 דקות
- **קלט:** מספר כתבות לייצר (1-N), אופציונלית כותרת מוצעת.
- **עיבוד:** הדשבורד שולח לcontent-pipeline. הסרוויס שואל את ה-Content Aggregator על נושאים פופולריים, גורד content (scraping) ממקורות, מייצר טקסט ב-Claude API לפי ה-brief של האתר, מציון איכות (quality score), ושומר ל-`staging/<domain>` ב-GitHub.
- **פלט:** הודעת toast "X כתבות נוצרו". בתוך ~60 שניות הכתבות מופיעות ב-Worker Preview (אחרי `sync-kv.yml`).

### הסבר 5 דקות
1. **HTTP call (סינכרוני אבל ארוך):** הדשבורד קורא ל-`POST /api/agent/generate` עם `{domain, count, branch: 'staging/<domain>'}`. הקריאה הזו פותחת חיבור ארוך (long polling) - עד 5 דקות.
2. **Pipeline בתוך content-pipeline:**
   - **א. Content Aggregator query:** API call ל-`content-aggregator-cloudgrid` עם `vertical` של האתר → רשימת נושאים פופולריים.
   - **ב. Filter:** מסנן נושאים שכבר יש כתבות עליהם באתר (תוך הצלבה עם הכתבות הקיימות ב-`sites/<domain>/articles/`).
   - **ג. Scrape:** עבור כל נושא, מבצע fetch למקור, חולץ טקסט.
   - **ד. Generate:** קוראים ל-Anthropic SDK עם prompt שכולל:
     - ה-brief של האתר (vertical, audience, tone, content guidelines)
     - הטקסט המקורי
     - הוראות פורמט (Markdown + frontmatter)
   - **ה. Quality scoring:** קוראים שוב ל-Claude עם prompt בדיקת איכות → ציון 0-100 ב-5 קטגוריות (SEO, Tone, Length, Accuracy, Keywords). ציון < threshold → status: `review` (לסקירה ידנית). אחרת: `published`.
   - **ו. Image generation (אופציונלי):** Gemini API לייצור hero image. נשמר זמנית, מועלה כחלק מה-commit.
   - **ז. Commit ל-GitHub:** Octokit API call - commit אחד עם כל הקבצים (`articles/<slug>.md` + `assets/images/<slug>.png`).
3. **תגובת UI:** הודעה "X כתבות נוצרו (Y published, Z to review)". URL פרסום: `workerPreviewUrl(domain)`.
4. **שלב 2 (אוטומטי):** ה-commit ל-`staging/<domain>` מפעיל `sync-kv.yml` (זרימה 1.3). תוך 60 שניות הכתבה ב-KV.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | משתמש לוחץ "Generate". |
| **איפה נשמר?** | זמנית: זיכרון של content-pipeline. סופי: `atomic-labs-network/sites/<domain>/articles/<slug>.md` ב-branch `staging/<domain>`. |
| **שחזור באמצע?** | אם content-pipeline נופל אחרי Generate אבל לפני Commit - הכתבה אבודה. אבל הקריאה ל-Anthropic עוד לא נחתכה לאחור (no rollback). אסטרטגיה: idempotent slugs (אם slug כבר קיים, לא דורסים). |
| **בעלים?** | התוכן עצמו: רפו network על branch staging. הנהלת התהליך: content-pipeline service. |
| **איך יודעים שהצליח?** | UI: progress bar עם 8 שלבים. Toast עם סיכום. בדיקה: PR או branch ב-GitHub. |
| **קנה מידה?** | יצירת 5 כתבות = ~3-5 דקות. למעבר על 50 אתרים בו זמנית - עומס גבוה על Anthropic API. ה-rate limit של Anthropic מטפל בזה (queueing). |
| **ריסק מרכזי?** | תוכן באיכות נמוכה מתפרסם ישירות לייצור. **תרופה:** quality score + Review Queue. כתבות מתחת לסף → לסקירה ידנית. |
| **גנריות?** | ה-pipeline מכיר רק `brief` ו-`vertical`. הוספת vertical חדש = הוספת רשומה ב-list ולא יותר. |
| **כישלון?** | אם Anthropic לא מגיב → 503. Retry עד 3 פעמים. אחרי 3 - error לדשבורד. אם GitHub commit נכשל → log + retry. אם הכל נכשל - הודעה למשתמש. |
| **אימות פורמט?** | Anthropic מחזיר טקסט. הקוד מנסה לחלץ frontmatter+body. אם אין frontmatter → דחיה. אם יש field חסר → שגיאה ספציפית. |
| **שחזור ידני?** | `git checkout staging/<domain>` ב-network repo, יצירת קובץ `.md` ידנית, push. `sync-kv.yml` יסנכרן. |
| **מקרי קצה?** | כותרת זהה לקיימת - מוסיף `-2` ל-slug. כתבה מאוד ארוכה (>30K tokens) - חיתוך ל-MAX_LENGTH ב-prompt. |

---

## 2.2 סקירת תור כתבות (Review Queue)

**טריגר:** משתמש פותח `/review` בדשבורד.

### הסבר 2 דקות
- **קלט:** משתמש מסמן כתבות בתור הסקירה כ-Approve או Reject.
- **עיבוד:** עבור Approve - שינוי `status: review` ל-`status: published` בfrontmatter. עבור Reject - מחיקת הקובץ. הכל ב-batch אחד ל-GitHub. אם האתר Live → merge ל-main באופן אוטומטי.
- **פלט:** Toast עם סיכום (`coolnews-atl: 3 approved, 1 rejected`). Worker Preview יציג את הכתבות תוך 60 שניות.

### הסבר 5 דקות
1. **טעינת תור:** `getReviewQueue()` ב-`actions/review.ts` קורא `dashboard-index.yaml` ולכל אתר עם `staging_branch` קורא את כל המאמרים. מסנן `status === 'review'`. מחזיר רשימה עם metadata + `stagingBaseUrl` (URL של Worker preview).
2. **UI:** ReviewQueueClient מציג כל כתבה עם quality score breakdown (`SEO 75, Tone 60, Length 85, Accuracy 40, Keywords 45`) + סיבה (מ-Anthropic). כפתורים Approve/Reject לכל כתבה + bulk actions.
3. **applyReviewDecisions:** המשתמש לוחץ "Apply" - הדשבורד שולח את כל ההחלטות בbatch אחד.
4. **קיבוץ לפי domain:** הסקריפט מקבץ אישורים/דחיות לפי אתר.
5. **לכל אתר:**
   - **מאושרים:** עבור כל slug, קורא את הקובץ, משנה `status: published`, מעדכן `reviewer_notes`. Commit אחד עם כל הקבצים.
   - **דחויים:** מחיקה של הקבצים מ-`staging/<domain>` ב-`deleteFilesFromBranch` (Git Data API).
   - **Build trigger:** `triggerWorkflowViaPush` יוצר commit ריק כדי להפעיל את `sync-kv.yml`.
   - **אם Live/Ready:** merge `staging/<domain>` ל-main, מה שמפעיל `sync-kv.yml` שכותב גם ל-prod KV.
6. **Revalidate:** Next.js revalidatePath של `/review` ו-`/sites/<domain>` כדי שהדפים יתרעננו.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | משתמש לוחץ "Apply". |
| **איפה נשמר?** | תוצאות הסקירה (frontmatter) - בקובץ ה-Markdown של הכתבה. דחיות - הקובץ נמחק. שינויים אלה מסונכרנים ל-KV דרך 1.3. |
| **שחזור באמצע?** | אם הסקריפט קורס לאחר אישור 5 כתבות מתוך 10 - אלה המאושרות יהיו ב-git, אלה שנשארו יישארו `status: review`. בריצה הבאה ימשיך מאיפה שעצר (אין state מקומי). |
| **בעלים?** | המאמרים: עורך התוכן (admin). פעולת הסקירה - רישום ב-frontmatter (`reviewer_notes: "Approved via review queue."`). |
| **איך יודעים שהצליח?** | Toast עם סיכום. בדיקה: GitHub commits log. לאחר 60 שניות - הכתבה תופיע ב-Worker Preview. |
| **קנה מידה?** | סקירה של 100 כתבות = 100 קבצים ב-batch אחד. Octokit מטפל בזה כ-bulk commit. |
| **ריסק מרכזי?** | אם משתמש "ירשע" אישור - הכתבה תפורסם בייצור. **תרופה:** רק users עם הרשאות (NextAuth) רואים את `/review`. |
| **גנריות?** | הקוד אגנוסטי לאתר. תומך ב-N אתרים בלי שינוי. |
| **כישלון?** | שגיאת GitHub - error ל-toast עם תיאור. שאר ההחלטות ב-batch ייגמרו (per-domain isolation). |
| **שחזור ידני?** | יכולת ידנית: עריכת frontmatter ב-GitHub UI מ-`status: review` ל-`status: published`, push, וזה זהה לאישור דרך הדשבורד. |

---

## 2.3 עריכת קונפיגורציה (אתר / קבוצה / Override / Org)

**טריגר:** משתמש שומר שינויים ב-Site Settings → Config / Groups / Overrides / Settings → Org.

### הסבר 2 דקות
- **קלט:** טופס קונפיגורציה (tracking IDs, ad placements, theme, …).
- **עיבוד:** הדשבורד שולח לpathway של GitHub. אתר → commit ל-`staging/<domain>`. קבוצה/Override/Org → commit ל-main של network repo. `sync-kv.yml` מסנכרן את כל האתרים שהושפעו.
- **פלט:** Toast "נשמר". האתרים הרלוונטיים מתעדכנים תוך 60 שניות.

### הסבר 5 דקות
1. **UI:** `UnifiedConfigForm` (קומפוננטה אחת) שמתפעלת ארבעה מצבים: `org / group / override / site`. תפריטים זהים, לוגיקה שונה לכל מצב (במיוחד עבור `override` שמציג `MergeModeSelector`).
2. **שמירה:**
   - **Site:** `POST /api/sites/save` → commit ל-`staging/<domain>`/`sites/<domain>/site.yaml`. אם האתר Live - מתבצע גם merge ל-main.
   - **Group:** `PUT /api/groups/<id>` → commit ל-main של `groups/<id>.yaml`.
   - **Override:** `PUT /api/overrides/<id>` → commit ל-main של `overrides/config/<id>.yaml`.
   - **Org:** `PUT /api/settings/org` → commit ל-main של `org.yaml`.
3. **השפעה:**
   - שינוי ב-Site = משפיע רק על אותו אתר.
   - שינוי ב-Group = משפיע על **כל** האתרים שהם חברים בקבוצה.
   - שינוי ב-Override = משפיע על האתרים שתואמים ל-`targets` של ה-override.
   - שינוי ב-Org = משפיע על **כולם**.
4. **`sync-kv.yml`:** מזהה אילו אתרים השתנו (גם בעקיפין, דרך קבוצה/override) ומריץ matrix sync. כל אתר רץ ב-parallel.
5. **תוצאה:** KV מתעדכן (staging או prod, תלוי ב-branch). הקריאה הבאה ל-Worker מחזירה את הקונפיגורציה החדשה. הומפייג עם `s-maxage=60` → תוך דקה הכל מתחדש.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | משתמש לוחץ Save. |
| **איפה נשמר?** | `atomic-labs-network` repository. תיקייה תלויה בסוג: `org.yaml` / `groups/<id>.yaml` / `overrides/config/<id>.yaml` / `sites/<domain>/site.yaml`. |
| **שחזור באמצע?** | Commit אטומי - או שהוא נכנס או שלא. אין מצב "חצי שמור". |
| **בעלים?** | היררכיה: admin עורך את org.yaml, manager עורך groups, editor עורך site. הרשאות ב-NextAuth. |
| **איך יודעים שהצליח?** | Toast "Saved". בדיקה עמוקה: GitHub commit עם הודעה ברורה. הראייה הסופית: Worker Preview/Live מציג את השינוי. |
| **קנה מידה?** | קבוצה עם 50 אתרים = 50 sync jobs במקביל ב-GitHub Actions matrix. ~5 דקות סך הכל. |
| **ריסק מרכזי?** | שגיאה ב-override (priority גבוה מדי, target לא נכון) יכולה לגרום לכל ה-sites להציג קונפיגורציה לא צפויה. **תרופה:** בדיקה מקדימה ב-Worker Preview לפני merge ל-main. |
| **גנריות?** | קונפיגורציה היא YAML גנרי - אפשר להוסיף שדות חדשים מבלי שינוי קוד (כל עוד ה-Worker יודע לצרוך אותם). |
| **כישלון?** | שגיאת syntax (YAML) - הסקריפט נכשל ב-`sync-kv.yml`, אזהרה במייל. ה-KV לא מתעדכן - האתר ממשיך עם הקונפיגורציה הישנה. |
| **שחזור ידני?** | עריכה ב-GitHub UI ישירה של ה-YAML. `sync-kv.yml` יקלוט את ה-commit. |
| **מקרי קצה?** | Override `priority: 0` (הכי נמוך) מתחת ל-`site.yaml` תמיד; site מנצח. שני overrides עם אותו priority - האחרון בא"ב מנצח (טעון תיעוד). |

---

## 2.4 צפייה ב-Worker Preview

**טריגר:** משתמש לוחץ על כפתור "Worker Preview" בדף האתר/Review Queue.

### הסבר 2 דקות
- **קלט:** קליק על קישור.
- **עיבוד:** הדפדפן פותח URL מהצורה `https://atomic-site-worker-staging.dev1-953.workers.dev/?_atl_site=<domain>`. ה-Worker מזהה את הפרמטר, קורא את ה-config של אותו אתר מ-staging KV, ומגיש את הדף.
- **פלט:** עמוד אינטרנט שנראה בדיוק כמו האתר האמיתי - אבל מבוסס על הטיוטה הנוכחית בstaging branch.

### הסבר 5 דקות
1. **בניית URL:** `workerPreviewUrl(domain, path)` ב-`src/lib/constants.ts`:
   ```ts
   `${WORKER_STAGING_URL}${path}?_atl_site=${encodeURIComponent(siteId)}`
   ```
2. **Preview Override:** ב-`src/lib/preview-override.ts` של ה-Worker - הקוד קורא את ה-query param `_atl_site` רק אם ה-hostname הוא `*.workers.dev` או localhost (לא בדומיינים אמיתיים, מסיבות אבטחה).
3. **הפצת הקשר per-tab:** ה-middleware מזריק סקריפט inline קטן (`<script data-atl-preview>`) לכל תגובת HTML ב-preview. הסקריפט מאזין ל-click events על קישורים פנימיים (`<a>`) ומוסיף `?_atl_site=<domain>` לכל URL פנימי — כך הקשר ה-preview נשמר **בתוך הטאב בלבד** (דרך ה-URL), ולא דרך cookie שמשותף בין כל הטאבים.
4. **למה לא cookie?** הגישה הקודמת השתמשה ב-cookie (`atl_preview_site`). הבעיה: cookies הם per-domain, לא per-tab. פתיחת אתר B בטאב שני דרסה את ה-cookie, וחזרה לטאב הראשון (אתר A) הניבה 404 (ה-Worker חיפש תוכן של B). הפתרון — `_atl_site` ב-URL של כל קישור — מבודד כל טאב.
5. **המשך כרגיל:** מאותה נקודה ה-Worker מתנהג כאילו הגענו ל-host של האתר - קורא KV, מגיש דף.
6. **ניקוי:** `?_atl_site=clear` מוחק cookie ישן (legacy cleanup) וחוזר להתנהגות רגילה.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | משתמש לוחץ. |
| **איפה נשמר?** | רק ב-URL (פרמטר `_atl_site` בכל קישור פנימי). שום דבר ב-KV/R2, שום cookie. |
| **שחזור באמצע?** | אין state - בקשה אטומית. |
| **בעלים?** | תוכן ה-staging - העורך. URL ה-Worker - DevOps. |
| **איך יודעים שהצליח?** | הדף נטען עם ה-title של האתר הנכון (לא של אתר אחר). |
| **ריסק מרכזי?** | משתמש זדוני יכול לראות תוכן של אתר שאינו שלו אם הוא יודע את ה-domain. **תרופה:** הגישה לדשבורד עצמו דורשת auth. ה-cookie מוגבל ל-`*.workers.dev` - לא חולף לדומיינים בייצור. |
| **גנריות?** | עובד עם כל אתר seeded. אפס שינוי קוד. |
| **כישלון?** | אם ה-domain לא ב-KV → הודעת שגיאה ברורה (`siteId "X" has no config in KV`). אם ה-Worker down → 5xx. |
| **מקרי קצה?** | תווים מיוחדים בdomain - URL-encoded. Domain עם נקודה (`example.com`) - תקף ב-regex של הוולידציה. |

---

## 2.5 פרסום ל-production

**טריגר:** משתמש לוחץ "Publish to Production" ב-Staging tab של אתר Live/Ready.

### הסבר 2 דקות
- **קלט:** קליק.
- **עיבוד:** הדשבורד מבצע `git merge staging/<domain> → main` ב-network repo. ה-merge מפעיל `sync-kv.yml` על main, שכותב לprod KV ולprod R2.
- **פלט:** האתר החי (`coolnews.dev`) מציג את הטיוטה החדשה תוך ~60 שניות.

### הסבר 5 דקות
1. **`publishStagingToProduction(domain)`** ב-`actions/wizard.ts`:
   - קורא ל-GitHub API: `PUT /repos/atomicfuse/atomic-labs-network/merges` עם `head: staging/<domain>, base: main, commit_message: "publish: staging/<domain> → main"`.
   - ה-API מבצע fast-forward אם אפשרי, אחרת merge commit.
2. **Trigger sync-kv:** ה-merge יוצר commit על main → `sync-kv.yml` מזהה (תזכורת: branches: [main, 'staging/**']) → רץ. ב-main הוא משתמש ב-KV הprod ו-R2 הprod.
3. **Reset staging branch:** `git reset staging/<domain> → main` כדי שב-staging המבנה זהה ל-main, עד שהעורך יבצע שינויים חדשים.
4. **Cache invalidation:** אין צורך - ה-Worker עם s-maxage קצר יחדש את הקאש תוך דקה.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | משתמש לוחץ. |
| **איפה נשמר?** | merge commit ב-main של network repo + KV/R2 prod מתעדכנים. |
| **שחזור באמצע?** | אם merge הצליח אבל sync-kv נכשל - ה-content לא בייצור. תרופה: re-run של ה-workflow ידנית מ-GitHub UI. |
| **בעלים?** | החלטת publish - editor עם הרשאת publish. |
| **איך יודעים שהצליח?** | GitHub Actions ✓. בדיקה ידנית: `curl coolnews.dev` ולוודא שיש את הכתבה החדשה. |
| **קנה מידה?** | אתר עם 1000 כתבות - sync של ~10 דקות. במקרה הזה אולי כדאי לפרסם רק את ה-deltas. אבל כיום זה מקובל. |
| **ריסק מרכזי?** | פרסום של כתבה לא בודקה (סולחה ל-Review Queue) → תוכן באיכות נמוכה בייצור. **תרופה:** ה-Pipeline מסמן `status: review` לקבעות שלא עוברות סף איכות. רק `status: published` נכנס ל-build. אם יש כתבה ב-review במהלך publish - היא תועבר ל-prod אבל **לא תוצג** באתר (Worker מסנן לפי status). |
| **גנריות?** | עובד עם כל אתר עם branch `staging/<domain>`. |
| **כישלון?** | merge conflict - הדשבורד מציג שגיאה ומציע פתרון. shutdown ב-network repo - retry. |
| **שחזור ידני?** | `git merge staging/<domain> --no-ff` + push דרך terminal. שווה למה שהדשבורד עושה. |
| **מקרי קצה?** | branches diverged בגלל commits ידניים - הדשבורד מציע "git pull --rebase" קודם. |

---

## 2.6 יצירת אתר חדש (Wizard)

**טריגר:** משתמש לוחץ "+ New Site" בדשבורד (`/wizard`).

### הסבר 2 דקות
- **קלט:** טופס בן 7 שלבים (זהות, ייעוד, קבוצות, תמה, brief תוכן, preview, סיכום).
- **עיבוד:** השלבים 0-4 הם state בלבד בדפדפן (sync, ללא קריאה לרשת). שלב 5 ("Deploy Staging") קורא לserver action שיוצר branch ב-GitHub, שומר site.yaml + skill.md + לוגו, ומפעיל את `sync-kv.yml`. הדפדפן עושה polling ל-Worker עד שמופיע 200 (סימן ש-KV התעדכן).
- **פלט:** preview iframe חי בתוך הדשבורד תוך ~30-60 שניות. האתר עדיין לא בייצור — לזה צריך עוד שני שלבים נפרדים אחרי ה-wizard.

### הסבר 5 דקות (הלוגיקה העמוקה)

**שלב 0-4 — איסוף נתונים (sync, client-only):**
- React state ב-`WizardPage`. אין HTTP calls עד שלוחצים "Deploy Staging".
- אין persistence — refresh = לאבד הכל. Trade-off מקובל ל-wizard חד-פעמי.

**שלב 5 — Preview → "Deploy Staging" (server action בקריאה אחת אטומית):**
הקוד: `services/dashboard/src/actions/wizard.ts:93` (`createSiteAndBuildStaging`). הפעולה רצה כ-await מבחינת ה-client אבל בפנים מבצעת רצף I/O אסינכרוני:
1. **(אופציונלי) Niche bundle** — קריאה אסינכרונית ל-Content Aggregator (`~200ms`).
2. **(אופציונלי) לוגו ב-Gemini** — אם המשתמש לא העלה לוגו ידנית. אסינכרוני, `~5-10 שניות`.
3. **בניית `site.yaml` + `skill.md`** — בזיכרון. סינכרוני, `<10ms`.
4. **`createBranch(staging/<projectName>)`** — קריאה ל-GitHub API. `~300ms`.
5. **`commitSiteFiles(...)`** — Git Data API (blobs + tree + commit + ref). אטומי, מאפשר commit של הרבה קבצים. **לא מפעיל GitHub Actions**. `~1-2s`.
6. **`triggerWorkflowViaPush`** — Contents API push לקובץ זעיר `.build-trigger`. **כן** מפעיל Actions (כי הוא עובר דרך ה-webhook plumbing). `~500ms`.
7. **`updateSiteInIndex` / `addSitesToIndex`** — commit ל-`dashboard-index.yaml` ב-main. `~500ms`.
8. **return `{stagingUrl, siteFolder}`** — סופי, חוזר ל-client.

**זמן כולל של ה-server action: `~3-15 שניות`** (עיקר הזמן בלוגו של Gemini).

**שלב async ברקע — `sync-kv.yml`:**
אחרי `triggerWorkflowViaPush`, GitHub Actions רץ בלי שום מעורבות של הדשבורד:
- שלב `detect` (~5s): מזהה את האתר החדש דרך diff.
- שלב `sync` (~20-50s): `pnpm seed:kv <projectName> [hostnames]` → קורא 5 שכבות YAML, מעלה את הלוגו ל-`atl-assets-staging`, ו-bulk PUT ל-staging KV.

**שלב polling בדפדפן:**
בעוד GitHub Actions רץ, הדפדפן עושה HEAD requests ל-Worker preview URL כל 5 שניות:
- לפני שה-KV מסנכרן: `404` (כי ה-middleware fails closed כשאין `site:<hostname>`).
- אחרי הסנכרון: `200` ← זה האות להצלחה.
- timeout: 120 שניות. אם נגמר הזמן → "Sync is taking longer than usual", ה-URL עדיין מוצג.

**שלב 6 — StepGoLive (אינפורמטיבי בלבד):**
מציג את ה-slug, name, vertical, ה-URL החי. שני כפתורים: "Back to Dashboard" / "View Site Details". **שום קריאת backend.** ה-wizard מסתיים.

### זרימות נפרדות אחרי ה-wizard (להבאת האתר לייצור)

האתר עדיין לא בייצור אחרי ה-wizard. צריך שני שלבים נוספים בדף ה-Site Detail:

1. **חיבור Custom Domain** — Site Detail → Identity tab → Custom Domain panel:
   - `attachCustomDomain(domain, customDomain, zoneId)` ב-`actions/wizard.ts:460`.
   - מעדכן `dashboard-index.yaml` עם `custom_domain` + `status: "Live"`.
   - **קורא ל-`registerWorkerCustomDomain`** — CF API call. רושם את הדומיין ב-prod Worker. CF יוצר את ה-DNS record אוטומטית.
   - Seeds `prod KV: site:<customDomain>` → `{siteId: <projectName>}`.
   - אסינכרוני, `~2-5s`.

2. **Go Live** — Site Detail → Staging tab → "Go Live":
   - `goLive(domain)` ב-`actions/wizard.ts:349`.
   - merge `staging/<projectName>` → main → fires `sync-kv.yml` שוב, **הפעם ב-main** → כותב ל-prod KV + `atl-assets-prod`.
   - מאתחל את branch ה-staging ל-main (ready לעריכות הבאות).
   - מעדכן `status: "Ready"`.

### בקרה תפעולית

| שאלה | תשובה |
|---|---|
| **מה מניע?** | משתמש בdashboard לוחץ "Deploy Staging" |
| **sync או async?** | server action **sync** מבחינת ה-client (await). פנימית: רצף 8 קריאות I/O אסינכרוניות. אחר כך - sync-kv.yml רץ async ברקע, dashboard polling עד הצלחה |
| **איפה נשמר?** | branch `staging/<projectName>` ב-network repo + רשומה ב-`dashboard-index.yaml` (main) + staging KV + staging R2 |
| **שחזור באמצע?** | אם server action נכשל אחרי commit + לפני trigger → קבצים ב-git אבל sync-kv לא רץ. תיקון: `gh workflow run sync-kv.yml -f site=<projectName>` ידנית. אם ה-polling timeout - הקבצים והרשומות תקינים, רק ה-KV מתעכב |
| **בעלים של המידע?** | יוצר האתר ראשי. הדשבורד הוא הכלי, GitHub הוא ה-source of truth |
| **איך יודעים שהצליח?** | iframe חי שמוצג בסיום ה-wizard עם עמוד הבית של האתר החדש |
| **קנה מידה?** | יצירת אתר היא פעולה חד-פעמית. אין צורך בקנה מידה גבוה |
| **ריסק מרכזי?** | Logo generation של Gemini נכשל → המשתמש מקבל אתר ללא לוגו. **תרופה:** non-fatal, ניתן להעלות ידנית אחרי דרך Site Identity → Edit Assets |
| **גנריות?** | site.yaml structure + brief schema הם גנריים. הוספת שדה חדש דורש עדכון ה-schema ב-shared-types וה-resolver ב-Worker |
| **כישלון?** | כל שלב מטופל בנפרד. שגיאה ב-Gemini = warn + continue. שגיאה ב-GitHub = throw → toast שגיאה למשתמש. שגיאה ב-sync-kv = polling timeout + הודעה ידידותית |
| **אימות פורמט?** | `WizardFormData` TypeScript interface. ולידציה client-side לפני "Deploy Staging" |
| **שחזור ידני?** | עריכת `sites/<projectName>/site.yaml` ב-GitHub UI ידנית, push ל-branch `staging/<projectName>` (יצירה ידנית), עריכת `dashboard-index.yaml`. כל פעולת ה-wizard ניתנת לשחזור ב-CLI/UI |
| **מקרי קצה?** | projectName שכבר קיים: ה-wizard ידרוס את הקבצים אבל לא יפיל את הריצה (idempotent). domain עם תווים לא-ASCII: לא נתמך, צריך slugify לפני שמירה |

### באג ידוע — `attachCustomDomain` ↔ `emit-env-configs.ts`

`attachCustomDomain` רושם את הדומיין דרך CF API runtime. זה עובד מיד. **אבל** ה-source of truth (`packages/site-worker/scripts/emit-env-configs.ts`) לא יודע על זה. ב-`pnpm deploy:production` הבא, wrangler יסנכרן את ה-routes לפי הקוד — ובגלל שהדומיין החדש לא ברשימה, הוא **עלול להישמט**, וה-DNS יישבר.

**תרופה (לא יושמה עדיין):** `attachCustomDomain` צריך גם לעדכן את `emit-env-configs.ts` (commit + push) ולהפעיל deploy אוטומטי.

📋 משימה ממתינה — ראה צ'יפ "Wire attachCustomDomain to emit-env-configs.ts" בדשבורד.

---

# חלק 3: זרימות תפעוליות

## 3.1 Re-seed ידני של KV

**טריגר:** מפתח רוצה לרענן KV (למשל אחרי שגיאה ידנית, או בדיקות).

```bash
cd packages/site-worker
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
  pnpm seed:kv coolnews-atl coolnews.dev coolnews-atl.pages.dev
```

- **טריגר:** ידני, terminal.
- **קלט:** siteId + רשימת hostnames + אופציונלית `KV_NAMESPACE_ID` ל-prod.
- **עיבוד:** זהה ל-`sync-kv.yml` (אותו סקריפט).
- **פלט:** KV מעודכן עם הקונפיגורציה הנוכחית של ה-checkout המקומי.

### מקרים שדורשים את זה
- KV נמחק בטעות.
- צריך לבדוק שינוי לפני commit.
- Cross-branch: `NETWORK_DATA_PATH=/tmp/worktree-other-branch pnpm seed:kv ...`.

## 3.2 Audit סביבה

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm test:audit
```

- בודק: KV namespaces קיימים, R2 buckets קיימים, Workers דרופלוייז'ם, bindings נכונים, GitHub secrets מוגדרים, latest sync-kv ירוק.
- פלט: `pass: 6 warn: 0 fail: 2` עם פירוט.

## 3.3 Rollback של Phase 7

אם משהו נשבר אחרי cutover של coolnews.dev:

```bash
# הסר את הroute מ-emit-env-configs.ts:
#   routes: []  ← במקום routes: [{ pattern: 'coolnews.dev', custom_domain: true }]
# Redeploy:
pnpm deploy:production
# ה-Worker משחרר את coolnews.dev. יש לחזור ל-Pages או DNS אחר ידנית
# (אבל ה-Pages projects נמחקו ב-Phase 8b - יצירה מחדש דרך CF dashboard).
```

⚠️ **rollback מלא דורש re-create של Pages projects** - לא טריוויאלי. כיום הסתמכות על Worker היא יחידה.

---

# מקרא טכני

מונחים שאדם לא טכני יזדקק להבנה שלהם:

| מונח | פירוש פשוט |
|---|---|
| **API call** | קריאה משירות אחד לשירות אחר דרך אינטרנט. כמו טלפון. |
| **async (אסינכרוני)** | פעולה שלוקחת זמן ולא מחכים שתסתיים מיד. שולחים בקשה, עוברים הלאה, מקבלים תשובה אחר כך. |
| **sync (סינכרוני)** | פעולה שמחכים לה. השרת לא משחרר את הלקוח עד שהפעולה הסתיימה. |
| **HTTP request** | בקשה מהדפדפן לשרת. כל URL שמקלידים = HTTP request. |
| **Scraping** | קריאת תוכן מאתר אחר באופן אוטומטי. כמו לקרוא עיתון אבל ע"י מחשב. |
| **KV (Key-Value Store)** | מאגר נתונים פשוט: מפתח → ערך. כמו מילון. במערכת שלנו - הוא מחזיק את הקונפיגורציות וה-content של כל האתרים. |
| **R2 (Object Storage)** | אחסון קבצים בענן של Cloudflare. בעיקר לתמונות במערכת שלנו. |
| **Worker** | קוד שרץ בקצה של רשת Cloudflare (קרוב לגולש). מהיר במיוחד, חיוב לפי מספר בקשות. |
| **Edge** | השרתים של Cloudflare ברחבי העולם. כשמישהו ב-NY טוען את האתר, השרת ב-NY מגיב. |
| **Cache** | זיכרון זמני שמאחסן תשובות לבקשות. אם 100 משתמשים מבקשים את אותו דף - השרת בונה אותו פעם אחת והשאר מקבלים מהקאש. |
| **DNS** | מערכת שמתרגמת שמות (`coolnews.dev`) לכתובות IP (`188.114.97.7`). |
| **Custom Domain** | דומיין שאתה מחזיק (כמו `coolnews.dev`) שמופנה למערכת שלנו. |
| **Cron** | משימה שרצה אוטומטית לפי לוח זמנים (כל שעה, כל יום, וכו'). |
| **CI (Continuous Integration)** | אוטומציה שרצה על כל commit ל-GitHub. במערכת שלנו: `sync-kv.yml`. |
| **GitHub Actions** | פלטפורמת CI של GitHub. מריצה workflow files. |
| **commit** | שמירת שינוי ב-Git. כמו "save" עם תיאור. |
| **branch** | ענף נפרד של הקוד. שינויים בענף לא משפיעים על הראשי עד merge. |
| **merge** | מיזוג של ענף אחד לתוך אחר. |
| **YAML** | פורמט קובץ קונפיגורציה. קל לקריאה. דוגמה: `site_name: Cool News`. |
| **Markdown** | פורמט טקסט עם עיצוב פשוט. הכתבות שלנו ב-Markdown. |
| **frontmatter** | כותרת בראש קובץ Markdown עם metadata (title, status, וכו'). |
| **SSR (Server-Side Rendering)** | בניית HTML על השרת ולא בדפדפן. מהיר יותר לטעינה ראשונית. |
| **Server Island** | חלק קטן בדף שנבנה כל פעם מחדש (כמו מודעה), בעוד שאר הדף בקאש. |
| **Eventually consistent** | מערכת שלוקחת זמן (שניות) להתסנכרן. אחרי כתיבה, חלק מהקוראים יקראו ערך ישן עד הסנכרון. |
| **idempotent** | פעולה שמותר להריץ אותה כמה פעמים - התוצאה תהיה זהה. |
| **rate limit** | הגבלה על מספר בקשות בזמן (Anthropic: ~50/דקה לחשבון). |
| **rollback** | חזרה למצב קודם. |
| **fail closed** | במקרה של שגיאה - לחזיר 404, לא להחזיר תוכן ברירת מחדל. |
| **5-Layer Resolution** | אופן בנייה של קונפיגורציה: org → groups → overrides → site, איחוד מצורף. |

---

## נספח: סיכום מהיר ל-2 דקות

המערכת שלנו מנהלת רשת אתרים מבוססי-תוכן (40+ אתרים). הארכיטקטורה הראשית:

1. **תוכן ב-GitHub:** כל האתרים, התצורות, והכתבות נמצאים ברפו `atomic-labs-network`.
2. **דשבורד שלי (Next.js):** משתמש לקריאה/כתיבה לרפו דרך GitHub API. גם מנהל סינכרון content-pipeline.
3. **Pipeline (Node service):** יוצר כתבות חדשות אוטומטית (Anthropic + Gemini) או על דרישה.
4. **CI על כל commit (`sync-kv.yml`):** מתרגם את ה-YAML+Markdown ל-KV+R2 של Cloudflare.
5. **Worker יחיד (Cloudflare):** מקבל את כל הבקשות לכל האתרים. בכל בקשה: hostname → KV → דף.
6. **Custom Domain:** `coolnews.dev` מופנה אוטומטית ל-Worker.

**ההישג הגדול:** עריכת כתבה → מופיעה באתר תוך 60 שניות בלי build, בלי deploy, בלי Pages.
