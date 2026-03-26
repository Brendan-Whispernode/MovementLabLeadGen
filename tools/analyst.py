import json
import os
from anthropic import AsyncAnthropic

import tools.database as db

client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

SYSTEM_PROMPT = """You are a market intelligence analyst for a mobility-focused fitness coaching business.

The business sells a mobility program targeting people in their 30s and 40s who:
- Work desk jobs and have become stiff from prolonged sitting
- Have tight hips, stiff necks, shoulder tension, lower back pain, or spinal stiffness
- May be former athletes who still do traditional lifting, which makes them stiffer
- Are seeking relief from chronic physical tension and want to feel free in their body again

You will receive a list of real Instagram comments left on competitor content in this niche. Your job is to synthesize these into a structured market intelligence and content strategy report.

Your output must be a valid JSON object with this exact structure:

{
  "audience_profile": "2-3 sentence narrative of who these people are — their lifestyle, their relationship to their body, and what they're seeking",

  "pain_points": [
    {
      "label": "short descriptive label",
      "intensity": "high|medium|low",
      "body_area": "hips|lower_back|neck|shoulders|spine|full_body|other",
      "quotes": ["exact phrase from a comment", "another exact phrase"]
    }
  ],

  "their_language": ["exact phrase or word they use", "another phrase", ...],

  "tried_and_failed": [
    {
      "solution": "what they tried",
      "why_it_failed": "why it didn't work for them (infer from context)"
    }
  ],

  "questions_they_ask": ["verbatim or paraphrased question from the comments", ...],

  "emotional_signals": ["frustration", "embarrassment", "fear of aging", ...],

  "content_hooks": [
    {
      "hook": "the exact opening line — punchy, written for the first 3 seconds of a Reel",
      "angle": "reframe|curiosity|identity|fear|aspiration|social_proof",
      "why_it_works": "1 sentence on the psychological mechanism"
    }
  ],

  "content_pillars": [
    {
      "name": "pillar name",
      "rationale": "why this pillar resonates with this specific audience",
      "content_types": ["reel", "carousel", "story"],
      "post_frequency": "suggested posting frequency"
    }
  ],

  "video_concepts": [
    {
      "title": "working title for the video",
      "format": "e.g. Reel — talking head + demo, or Carousel, or Reel — POV",
      "hook_line": "the exact first spoken or on-screen line — designed for 3-second hook",
      "visual_open": "specific visual suggestion for the opening shot",
      "problem": "the specific pain or belief this addresses",
      "solution": "what you teach or show — be specific",
      "payoff": "the transformation or result the viewer will feel/get",
      "cta": "what to tell them to do at the end (save, comment, follow, etc.)",
      "caption_hook": "the first line of the caption — must stop the scroll",
      "hashtag_angle": "3-5 word description of the hashtag strategy"
    }
  ]
}

Guidelines:
- pain_points: list at least 5, ranked by frequency/intensity in the data
- their_language: list 15-25 exact phrases — these are gold for captions and hooks
- tried_and_failed: list everything you can infer from comments (stretching, yoga, PT, foam rolling, etc.)
- content_hooks: generate 8-10 hooks across different angles
- content_pillars: identify 4-6 recurring themes that could anchor a content strategy
- video_concepts: generate 5-7 fully fleshed-out concepts — make them specific and immediately actionable
- All content ideas must use the actual language patterns from the comments, not generic fitness language
- Video concepts should feel like a brief you'd hand to a video editor — specific and detailed

Return ONLY the JSON object. No markdown fences, no explanation."""


_analyze_state: dict = {"running": False, "error": None, "latest_id": None}


def get_analyze_status() -> dict:
    return dict(_analyze_state)


async def run_analysis(scope: str = "all", scope_label: str = "All leads"):
    global _analyze_state
    if _analyze_state["running"]:
        return

    _analyze_state = {"running": True, "error": None, "latest_id": None}

    try:
        leads = db.get_leads_for_analysis(scope=scope, min_score=2)
        if not leads:
            _analyze_state["error"] = "No scored leads found for this scope (need score 2+3 leads)"
            return

        comments_block = "\n\n".join(
            f"{i+1}. [Score {lead['score']}] @{lead.get('creator_handle') or 'unknown'} — {lead['comment_text']}"
            for i, lead in enumerate(leads)
        )

        user_message = (
            f"Analyze these {len(leads)} Instagram comments from competitor posts in the mobility/body freedom niche. "
            f"Generate the full market intelligence and content strategy report.\n\n"
            f"{comments_block}"
        )

        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        raw = response.content[0].text.strip()
        result = json.loads(raw)

        analysis_id = db.save_analysis(
            scope=scope,
            scope_label=scope_label,
            comment_count=len(leads),
            result_json=json.dumps(result),
        )
        _analyze_state["latest_id"] = analysis_id

    except Exception as e:
        _analyze_state["error"] = str(e)
    finally:
        _analyze_state["running"] = False
