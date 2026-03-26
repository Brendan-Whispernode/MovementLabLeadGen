# Workflow: Stage 4 — Score Leads (Claude)

## Objective
Use Claude Sonnet 4.6 to score each unscored lead comment 1/2/3 and generate DM drafts for warm and hot leads.

## Required Inputs
- Unscored leads in the `leads` table (from Stage 3)

## Tools Used
- `tools/scorer.py` — `run_scoring()`, `score_batch()`
- `tools/database.py` — `get_unscored_leads()`, `update_lead_score()`

## Scoring Rubric
| Score | Label | Criteria |
|---|---|---|
| 1 | Not a lead | Generic, emoji-only, spam, unrelated, other creators |
| 2 | Warm | Mild resonance or curiosity, vague — no clear personal pain |
| 3 | Hot | Direct personal struggle — body tension, disconnection, movement avoidance, somatic pain |

## Steps

1. **Start scoring**: POST `/api/score/run`
   - Pulls all `score IS NULL` leads in batches of 20
   - Sends each batch to Claude with the scoring system prompt
   - Claude returns a JSON array with `id`, `score`, `score_reasoning`, `dm_draft`

2. **DB update**: Each result written back via `update_lead_score()`

3. **Poll from frontend**: GET `/api/score/status` returns `{running, processed, total, error}`

## Expected Outputs
- All leads scored with `score` ∈ {1, 2, 3}
- Score 2+3 leads have `score_reasoning` and `dm_draft` populated

## Edge Cases
- **Claude JSON parse failure**: `score_batch()` calls `json.loads()` directly on Claude's response. If Claude returns malformed JSON (rare), the batch will throw and be logged in `_score_state["error"]`. Re-run scoring to retry remaining unscored leads.
- **Cost awareness**: Each batch of 20 costs ~1k tokens in + ~500 tokens out. 500 leads = ~25 batches ≈ minimal cost at Sonnet 4.6 prices. Still, don't run scoring on test/junk data.
- **Only one scoring run at a time**: Like scraping, in-memory lock. Server restart clears it; safe to re-run scoring — already-scored leads are skipped.
- **DM draft quality**: Claude generates non-salesy, specific DMs. If the output feels generic, check that `comment_text` in the DB is actually meaningful — short/emoji comments won't yield great drafts.
