# Queue Migration — Edge Cases Test Plan

Covers edge cases for the BullMQ queue migration not exercised by existing tests.

## Edge Cases

### 1. processGenerateJob: all results are "skipped" (no created, no error)
All articles come back as "skipped" (duplicates). `results.length > 0` but zero created, zero errors. Should NOT throw — this is normal completion (not a retry scenario).

### 2. processGenerateJob: runContentGeneration returns empty results array
`results: []` with `totalSourced > 0`. Agent sourced items but produced zero output (e.g., all filtered by quality). Should return normally.

### 3. processGenerateJob: single error among many successes
1 error + 4 created. Partial success should return result (not throw).

### 4. processSchedulerRun: getChildrenValues returns empty object
No children completed (all failed permanently). All domains in `enqueuedDomains` should appear as errors in history.

### 5. processSchedulerRun: child result has null values in getChildrenValues
BullMQ can return null for a child key. The processor should skip nulls gracefully.

### 6. processSchedulerRun: history file has malformed JSON
`readFile` returns garbage. Should start with empty history (not crash).

### 7. processSchedulerRun: history append respects MAX_ENTRIES cap
When existing history has 50 entries, new entry prepends and oldest is dropped.

### 8. processSchedulerRun: commitFile fails (GitHub API error)
History write fails. The error should propagate (parent job fails), but the run data is not lost (BullMQ retries the parent).

### 9. createSchedulerFlow: zero sites (all filtered)
Should still call flowProducer.add with empty children array.

### 10. createSchedulerFlow: forced flag propagates correctly
`forced: true` should set `triggeredBy: "scheduled-forced"` on children.

### 11. processSchedulerRun: mixed status classification
Child returns: some created, some errors, created < requested. Should map to "partial" status.

### 12. processSchedulerRun: child with all duplicates (0 created, 0 errors, totalSourced > 0)
Should map to "no_content" status with duplicates message.

### 13. buildRunId: determinism within same hour
Two calls within same hour produce identical IDs.
