# Workflow 06 — Market Intelligence & Content Strategy

## Objective
Synthesize scored leads in the database into actionable market intelligence and content strategy using Claude. Identify the exact language, pain points, emotional signals, and behaviors of your target audience — then generate content hooks, pillars, and fully-formed video concepts that speak directly to them.

## When to Run
- After you have at least 30–50 score 2+3 leads in the database (more data = richer insights)
- After each new batch of scraping + scoring to refresh with new data
- When targeting a specific competitor: run with a single orbit scope to isolate that audience

## Required Inputs
- Scored leads in the `leads` table (score 2 or 3)
- Server running (`workflows/00_run_server.md`)

## Steps

### 1. Open the Insights tab
Navigate to `http://localhost:8000` → click **Insights**

### 2. Select scope
- **All leads** — analyzes your entire database for broad patterns (recommended for content strategy)
- **Specific orbit** — analyzes only the leads from one Virlo search run (useful for competitor-specific audience analysis)

### 3. Run analysis
Click **Run Analysis →**

Claude will process all qualifying leads in a single API call (~5–15 seconds for typical dataset sizes). The analysis runs in the background; the tab will update automatically when complete.

### 4. Review market intelligence
Scroll through the results:

- **Who They Are** — a synthesized profile of your target audience
- **Pain Points** — ranked by intensity with pull quotes from real comments
- **Their Language** — exact phrases they use; click any pill to copy for use in captions/hooks
- **What They've Tried** — solutions they've attempted and why they didn't work; use this to position against alternatives
- **Questions They Ask** — their top objections and curiosities; each is a content idea
- **Emotional Signals** — the feelings driving their behavior

### 5. Use the content strategy section
- **Content Hooks** — pick hooks that resonate; each includes the psychological angle and a copy button
- **Content Pillars** — 4–6 recurring themes to anchor your content calendar
- **Video Concepts** — fully fleshed-out briefs; click "Copy full brief" to paste into your notes or send to an editor

## Output
- Analysis stored in `analyses` table (persists across sessions)
- Past analyses accessible via the history row at the top of the Insights tab
- All phrases, hooks, and concept briefs are copyable directly from the UI

## Edge Cases
- **Not enough scored leads**: if fewer than 5 score 2+3 leads exist for the selected scope, the analysis will still run but results will be thin — run more scrape+score cycles first
- **Re-running**: each run creates a new analysis entry; past analyses are preserved in history
- **Orbit-scoped analysis**: the scope dropdown only shows completed orbit jobs; running orbits will not appear

## Feeding Output Back Into the System
The "Their Language" phrases are directly usable in:
- Virlo keyword searches (Stage 1) — use the exact phrases your audience uses to find more posts
- DM drafts — update your scoring system prompt to incorporate high-resonance phrases
- Caption hooks — copy directly into your content planning
