import os
import httpx

VIRLO_BASE = "https://api.virlo.ai/v1"


def _headers():
    key = os.getenv("VIRLO_API_KEY", "")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


async def start_orbit(keywords: list[str], name: str, time_period: str = "30d") -> dict:
    payload = {
        "keywords": keywords,
        "platforms": ["instagram"],
        "time_period": time_period,
        "name": name,
        "intent": (
            "Track social media posts about pain, body tightness, and movement restriction "
            "to find potential leads for selling mobility and body freedom programs. "
            "Prioritize posts with high engagement where the audience expresses personal "
            "struggle with physical discomfort or limited mobility."
        ),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{VIRLO_BASE}/orbit", headers=_headers(), json=payload)
        r.raise_for_status()
        return r.json()


async def get_orbit_status(orbit_id: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{VIRLO_BASE}/orbit/{orbit_id}", headers=_headers())
        r.raise_for_status()
        return r.json()


async def get_orbit_videos(orbit_id: str, limit: int = 50, offset: int = 0) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{VIRLO_BASE}/orbit/{orbit_id}/videos",
            headers=_headers(),
            params={"limit": limit, "offset": offset},
        )
        r.raise_for_status()
        return r.json()


async def get_orbit_outliers(orbit_id: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{VIRLO_BASE}/orbit/{orbit_id}/creators/outliers",
            headers=_headers(),
        )
        r.raise_for_status()
        return r.json()


async def start_satellite(handle: str, platform: str = "instagram") -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{VIRLO_BASE}/satellite/creator/{platform}/{handle}",
            headers=_headers(),
            params={"include": "videos,outliers"},
        )
        r.raise_for_status()
        return r.json()


async def get_satellite_status(job_id: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{VIRLO_BASE}/satellite/creator/status/{job_id}",
            headers=_headers(),
        )
        r.raise_for_status()
        return r.json()
