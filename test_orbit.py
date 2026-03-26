"""
Quick test: fires a new Virlo Orbit job and polls until completed/failed.
Usage: python -u test_orbit.py
"""
import asyncio
import json
import sys
import time
import virlo
import database as db
import os
from dotenv import load_dotenv

# Force unbuffered output so tmux/tee shows lines immediately
sys.stdout.reconfigure(line_buffering=True)

load_dotenv()

KEYWORDS = [
    "tight hips",
    "hip flexor pain",
    "lower back stiffness",
    "body stiffness",
    "sciatica pain",
]

POLL_INTERVAL = 20   # seconds between status checks
MAX_WAIT_MIN  = 90   # bail out after 90 minutes


async def main():
    # Pass an orbit_id as argv[1] to resume polling an existing job
    if len(sys.argv) > 1:
        orbit_id = sys.argv[1]
        print(f"Resuming poll of existing orbit_id: {orbit_id}")
    else:
        print(f"Starting Orbit job with keywords: {KEYWORDS}")
        result = await virlo.start_orbit(KEYWORDS, name="test-run", time_period="this_month")
        payload = result.get("data") or result
        orbit_id = payload.get("orbit_id") or payload.get("id") or payload.get("orbitId")
        print(f"Orbit ID: {orbit_id}")
        if not orbit_id:
            print("ERROR: no orbit_id in response:", result)
            return
        db.init_db()
        db.upsert_orbit_job(orbit_id, "test-run", json.dumps(KEYWORDS), "running")
        print("Registered in database — visible in dashboard.")

    start = time.time()
    deadline = start + MAX_WAIT_MIN * 60

    while True:
        elapsed = int(time.time() - start)
        status_data = await virlo.get_orbit_status(orbit_id)
        inner = status_data.get("data") or status_data
        raw = inner.get("status", "?")
        print(f"  [{elapsed}s] status = {raw}")

        if raw == "completed":
            print("Completed! Fetching videos...")
            vids = await virlo.get_orbit_videos(orbit_id)
            vd = vids.get("data") or vids
            videos = vd.get("videos") or vd.get("items") or []
            print(f"  {len(videos)} posts returned.")
            for v in videos[:5]:
                url = v.get("post_url") or v.get("url") or v.get("postUrl", "")
                handle = v.get("creator_handle") or v.get("username") or v.get("handle", "")
                print(f"    @{handle}  {url}")
            break

        if raw == "failed":
            print("Virlo reported job as failed.")
            break

        if time.time() > deadline:
            print(f"Timed out after {MAX_WAIT_MIN} min — orbit_id={orbit_id}")
            break

        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
