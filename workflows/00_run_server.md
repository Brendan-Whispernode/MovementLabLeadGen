# Workflow: Run the Dev Server

## Objective
Start the FastAPI server for the MovementLab LeadGen dashboard.

## Requirements
- Python 3.11 venv at `venv/` (built with `/opt/homebrew/bin/python3.11`)
- `.env` file present with `ANTHROPIC_API_KEY`, `APIFY_API_TOKEN`, `VIRLO_API_KEY`

## Steps

1. Activate the venv and start the server in a detached tmux session:
   ```bash
   tmux new-session -d -s leadgen-server "source venv/bin/activate && python server.py"
   ```
2. Server runs at `http://localhost:8000` with hot-reload via uvicorn.
3. Frontend is served from `/static/` (index.html).

## tmux Convention
- Session name: `leadgen-server`
- Kill when done: `tmux kill-session -t leadgen-server`

## Edge Cases
- If port 8000 is busy: `lsof -i :8000` to find and kill the occupying process.
- If venv is missing: `python3.11 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
