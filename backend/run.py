"""Run the optional FastAPI server with uvicorn.

Install the API extra first: ``python -m pip install -e 'backend[api]'``.
"""

from backend.app.api.app import app


if app is None:
    raise SystemExit("FastAPI is not installed; run `python -m pip install -e 'backend[api]'` first")

import uvicorn
import os

uvicorn.run(
    app,
    host=os.getenv("WORLD_HOST", "0.0.0.0"),
    port=int(os.getenv("WORLD_PORT", "8000")),
)
