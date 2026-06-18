# Rollback point — "From luck to control" deploy (2026-06-18)

The version that was live **before** the "from luck to control" build (Sprints 0-4:
odds meters, GloryScore, the "almost" loss screen + swap-and-replay, the variance
schedule, the corrected 2026 ratings, and the how-it-works guide) is preserved at:

- **tag:** `rollback-pre-control-2026-06-18`
- **branch:** `rollback-pre-control`
- **commit:** `5faeb74` — "Bust browser cache on daily content files"

## If testers give the new version negative feedback, revert production to the old one:

```
git fetch origin
git checkout main
git reset --hard rollback-pre-control-2026-06-18
git push --force origin main
```

GitHub Pages redeploys the old version within ~1 minute.

לחזרה לגרסה הישנה: להריץ את ארבע הפקודות למעלה מתוך clone של ה-repo. ה-production יחזור לעצמו תוך דקה. ה-tag וה-branch נשמרים על ה-remote לתמיד, גם אם חוזרים אחורה.
