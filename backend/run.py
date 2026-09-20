"""Run the optional FastAPI server with uvicorn.

Install the API extra first: ``python -m pip install -e 'backend[api]'``.
"""

import os
import sys
from pathlib import Path

# ``python backend/run.py`` puts ``backend/`` on sys.path, while the package
# import below is rooted at the repository. Keep the documented npm launcher
# working without requiring callers to export PYTHONPATH first.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.api.app import app


if app is None:
    raise SystemExit("FastAPI is not installed; run `python -m pip install -e 'backend[api]'` first")

import uvicorn

uvicorn.run(
    app,
    host=os.getenv("WORLD_HOST", "0.0.0.0"),
    port=int(os.getenv("WORLD_PORT", "8000")),
)
