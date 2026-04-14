import json
import os
from anthropic import AsyncAnthropic

import tools.database as db

client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

SYSTEM_PROMPT = """You are a lead scoring assistant for a somatic movement / body freedom coaching business.

Your job: read Instagram comments and identify people who are potential clients — people who are struggling with body image, feeling stuck in their bodies, dealing with chronic pain or tension, wanting more freedom/ease/connection in their physical experience.

Score each comment 1, 2, or 3:

SCORE 1 — Not a lead. Generic comments, emojis only, unrelated topics, spam, other creators promoting themselves, or nothing suggesting personal struggle or desire for change.

SCORE 2 — Warm lead. Shows some interest or mild resonance with the topic, but vague. May be asking general questions, expressing mild curiosity, or tangentially relating to themes of body/movement/freedom without clear personal pain or desire.

SCORE 3 — Hot lead. Expresses personal struggle, pain, or desire directly related to body freedom themes: chronic tension, feeling disconnected from their body, struggling with body image, wanting to feel more at home in their skin, somatic symptoms, emotional holding in the body, movement avoidance, etc. These people are in the problem space and would resonate with an authentic outreach.

KEYWORD RESPONDER — A special case within Score 2. When a comment is clearly a response to a creator's call-to-action (e.g. the creator wrote "comment PROGRESS for my free guide" and the commenter wrote just "PROGRESS", "I want this", "send me the link", "me please", "how do I get this", etc.), set lead_type to "keyword_responder". These people showed interest but are not expressing personal pain. Write a curiosity-style DM that gently references the free resource they asked for and opens a conversation. For all other leads, set lead_type to "organic".

For Score 2 and 3, also write:
- score_reasoning: 1–2 sentences on WHY this score (what signals led you there)
- dm_draft: a short, warm, human DM written as a direct message (not a comment reply). Open by referencing the post they were commenting on — e.g. "Hey, I saw you commented on @[creator]'s post about [brief topic]..." then naturally transition into acknowledging what they said. Warm, direct, non-salesy. No product mention. Sounds like a real person who noticed something — not a pitch. Max 3 sentences.
- dm_draft_follow: a casual, zero-pitch, community-building DM. Open with "Hey [first name if obvious from username, otherwise @username]!" — then mention you saw them comment on @[creator]'s post about [topic]. Say you're building content around exactly this, you're not selling anything, just creating and would love a follow as you grow. Optionally end with one genuine question about what kind of content would help them most. Max 3 sentences. Zero sales intent — sounds like someone building a community, not pitching a product.

For Score 1: score_reasoning, dm_draft, and dm_draft_follow should all be null.

Return a JSON array with one object per comment:
[
  {
    "id": <lead id from input>,
    "score": 1|2|3,
    "score_reasoning": "..." or null,
    "dm_draft": "..." or null,
    "dm_draft_follow": "..." or null,
    "lead_type": "organic" | "keyword_responder"
  }
]

Return ONLY the JSON array. No markdown fences, no explanation."""


async def score_batch(leads: list[dict]) -> list[dict]:
    """Score a batch of leads. Returns list of {id, score, score_reasoning, dm_draft}."""
    comments_block = "\n\n".join(
        f"ID {lead['id']}:\n"
        f"Post creator: @{lead.get('creator_handle') or 'unknown'}\n"
        f"Commenter: @{lead['commenter_username']}\n"
        f"Comment: {lead['comment_text']}"
        for lead in leads
    )
    user_message = f"Score these {len(leads)} Instagram comments:\n\n{comments_block}"

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    return json.loads(raw)


# In-memory state for the current scoring run
_score_state: dict = {"running": False, "processed": 0, "total": 0, "error": None}


def get_score_status() -> dict:
    return dict(_score_state)


async def run_scoring():
    global _score_state
    if _score_state["running"]:
        return

    total = db.count_unscored_leads()
    _score_state = {"running": True, "processed": 0, "total": total, "error": None}

    try:
        batch_size = 20
        while True:
            batch = db.get_unscored_leads(limit=batch_size)
            if not batch:
                break

            results = await score_batch(batch)

            for result in results:
                db.update_lead_score(
                    result["id"],
                    result["score"],
                    result.get("score_reasoning"),
                    result.get("dm_draft"),
                    result.get("lead_type"),
                    dm_draft_follow=result.get("dm_draft_follow"),
                )
            _score_state["processed"] += len(batch)

    except Exception as e:
        _score_state["error"] = str(e)
    finally:
        _score_state["running"] = False


FOLLOW_DRAFT_PROMPT = """You are writing casual, community-building Instagram DMs for a somatic movement creator.

For each lead provided, write a single dm_draft_follow — a warm, non-salesy DM that:
- Opens with "Hey [first name if obvious from username, otherwise @username]!"
- References the specific post and topic they commented on (use @creator handle if provided)
- Says you're building content around exactly this, not selling anything, just creating and would love a follow as you grow
- Optionally ends with one genuine question about what kind of content would help them
- Maximum 3 sentences. Zero sales intent. Sounds like a real person building a community.

Return a JSON array:
[{"id": <lead id>, "dm_draft_follow": "..."}]

Return ONLY the JSON array. No markdown fences, no explanation."""


async def generate_follow_drafts_batch(leads: list[dict]) -> list[dict]:
    comments_block = "\n\n".join(
        f"ID {lead['id']}:\n"
        f"Post creator: @{lead.get('creator_handle') or 'unknown'}\n"
        f"Commenter: @{lead['commenter_username']}\n"
        f"Comment: {lead['comment_text']}"
        for lead in leads
    )
    user_message = f"Generate follow DM drafts for these {len(leads)} leads:\n\n{comments_block}"

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=FOLLOW_DRAFT_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    return json.loads(raw)


_follow_state: dict = {"running": False, "processed": 0, "total": 0, "error": None}


def get_follow_draft_status() -> dict:
    return dict(_follow_state)


async def run_follow_draft_generation():
    global _follow_state
    if _follow_state["running"]:
        return

    total = db.count_leads_missing_follow_draft()
    _follow_state = {"running": True, "processed": 0, "total": total, "error": None}

    try:
        batch_size = 20
        while True:
            batch = db.get_leads_missing_follow_draft(limit=batch_size)
            if not batch:
                break

            results = await generate_follow_drafts_batch(batch)

            for result in results:
                db.update_lead(result["id"], dm_draft_follow=result.get("dm_draft_follow"))
            _follow_state["processed"] += len(batch)

    except Exception as e:
        _follow_state["error"] = str(e)
    finally:
        _follow_state["running"] = False
