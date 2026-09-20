"""FastAPI facade for the legacy kernel API and the single-player product API."""

import os
import secrets
from pathlib import Path
from typing import Any, Optional

from ..domain.models import WorldError, ValidationError
from ..domain.events import events_for_viewer
from ..domain.world import WorldKernel
from ..gameplay import SinglePlayerGame
from ..sessions import SESSION_COOKIE, SessionManager
from ..store.event_store import EventStore

try:  # FastAPI is optional for domain-only/offline tests.
    from fastapi import FastAPI, HTTPException, Query, Request, Response
    from fastapi.responses import JSONResponse, StreamingResponse
    from fastapi.staticfiles import StaticFiles
except ImportError:  # pragma: no cover - exercised in minimal Python installs
    FastAPI = None
    HTTPException = None
    Query = None
    Request = None
    Response = None
    JSONResponse = None
    StreamingResponse = None
    StaticFiles = None


def _persistent_store() -> EventStore:
    configured = os.getenv("WORLD_DB_PATH", "data/world.sqlite3")
    if configured != ":memory:":
        Path(configured).expanduser().parent.mkdir(parents=True, exist_ok=True)
    return EventStore(configured)


def _static_directory() -> Path:
    configured = os.getenv("WORLD_STATIC_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3] / "dist-hex"


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def create_app(kernel: Optional[WorldKernel] = None) -> Any:
    if FastAPI is None:
        raise RuntimeError("FastAPI is optional; install backend[api] to run the HTTP server")
    if kernel is None:
        store = _persistent_store()
        world = WorldKernel(store=store)
    else:
        store = kernel.store
        world = kernel
    sessions = SessionManager(store)
    app = FastAPI(title="Voodoo Doll World Kernel", version="4")
    max_body_bytes = _positive_int_env("WORLD_MAX_BODY_BYTES", 1024 * 1024)
    configured_origins = {
        item.strip().rstrip("/")
        for item in os.getenv("WORLD_ALLOWED_ORIGINS", "").split(",")
        if item.strip()
    }
    admin_token = os.getenv("WORLD_ADMIN_TOKEN", "").strip()

    @app.middleware("http")
    async def protect_http_boundary(request: Request, call_next: Any) -> Response:
        path = request.url.path
        product_path = path == "/api/v4/session" or path.startswith("/api/v4/play/")
        admin_path = path.startswith("/internal/") or (path.startswith("/api/v4/") and not product_path)
        if admin_path:
            authorization = request.headers.get("authorization", "")
            supplied = authorization[7:].strip() if authorization.lower().startswith("bearer ") else request.headers.get("x-world-admin-token", "")
            if not admin_token:
                return JSONResponse(
                    {"detail": {"code": "not_found", "message": "not found"}},
                    status_code=404,
                )
            if not supplied or not secrets.compare_digest(supplied, admin_token):
                return JSONResponse(
                    {"detail": {"code": "admin_forbidden", "message": "admin token is invalid"}},
                    status_code=403,
                )
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            request_origin = f"{request.url.scheme}://{request.headers.get('host', request.url.netloc)}".rstrip("/")
            if origin and origin.rstrip("/") not in configured_origins | {request_origin}:
                return JSONResponse(
                    {"detail": {"code": "origin_forbidden", "message": "request origin is not allowed"}},
                    status_code=403,
                )
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    if int(content_length) > max_body_bytes:
                        return JSONResponse(
                            {"detail": {"code": "request_too_large", "message": "request body is too large"}},
                            status_code=413,
                        )
                except ValueError:
                    return JSONResponse(
                        {"detail": {"code": "invalid_content_length", "message": "content length is invalid"}},
                        status_code=400,
                    )
            body = await request.body()
            if len(body) > max_body_bytes:
                return JSONResponse(
                    {"detail": {"code": "request_too_large", "message": "request body is too large"}},
                    status_code=413,
                )
        return await call_next(request)

    def session_game(request: Request) -> tuple[str, SinglePlayerGame, bool]:
        session_id, session_kernel, created = sessions.resolve(request.cookies.get(SESSION_COOKIE))
        return session_id, SinglePlayerGame(session_kernel, session_id), created

    def response_with_cookie(payload: dict, session_id: str, created: bool) -> Response:
        response = JSONResponse(payload)
        response.headers["Cache-Control"] = "no-store"
        if created:
            response.set_cookie(
                SESSION_COOKIE,
                session_id,
                httponly=True,
                samesite="lax",
                secure=os.getenv("WORLD_COOKIE_SECURE", "0") == "1",
                max_age=60 * 60 * 24 * 365,
                path="/",
            )
        return response

    def play_error(error: WorldError) -> HTTPException:
        return HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.api_route("/api/v4/session", methods=["GET", "POST"])
    def session(request: Request) -> Response:
        session_id, game, created = session_game(request)
        if game.profile:
            game._ensure_interest()
        payload = {
            "snapshot": game.snapshot(),
            "profile": game.profile,
            "modelEnabled": bool(os.getenv("MODEL_PROVIDER")),
        }
        return response_with_cookie(payload, session_id, created)

    @app.post("/api/v4/play/story")
    def play_story(request: Request, body: dict) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.story_draft(body), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.post("/api/v4/play/story/{draft_id}/confirm")
    def play_story_confirm(request: Request, draft_id: str, body: Optional[dict] = None) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.confirm_story(draft_id, body or {}), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.post("/api/v4/play/story/{draft_id}/cancel")
    def play_story_cancel(request: Request, draft_id: str) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.cancel_story(draft_id), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.post("/api/v4/play/intent")
    def play_intent(request: Request, body: dict) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.intent(body), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.post("/api/v4/play/intent/{turn_id}/confirm")
    def play_intent_confirm(request: Request, turn_id: str, body: Optional[dict] = None) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.confirm_intent(turn_id, body or {}), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.post("/api/v4/play/intent/{turn_id}/cancel")
    def play_intent_cancel(request: Request, turn_id: str) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.cancel_intent(turn_id), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.get("/api/v4/play/save")
    def play_save(request: Request) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.export_save(), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.post("/api/v4/play/save/import")
    def play_save_import(request: Request, body: dict) -> Response:
        try:
            session_id, game, created = session_game(request)
            return response_with_cookie(game.import_save(body), session_id, created)
        except WorldError as error:
            raise play_error(error)

    @app.get("/healthz")
    def health() -> dict:
        return {"status": "ok", "schemaVersion": world.schema_version, "worldVersion": world.state.world_version}

    @app.get("/api/v4/world")
    def snapshot(viewer: str = "YOU") -> dict:
        return world.snapshot(viewer)

    @app.get("/api/v4/world/clock")
    def clock() -> dict:
        return {"clock": world.world_clock(), "worldVersion": world.state.world_version}

    @app.get("/api/v4/tools/registry")
    def tool_registry() -> dict:
        return world._published_registry().to_dict()

    @app.post("/api/v4/tools/proposals")
    def tool_proposal(body: dict) -> dict:
        try:
            return world.submit_tool(body)
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/api/v4/world-builder/drafts")
    def create_world_draft(body: dict) -> dict:
        try:
            payload = dict(body)
            draft_id = payload.pop("draftId", None)
            return world.create_world_draft(payload, draft_id)
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.get("/api/v4/world-builder/drafts/{draft_id}")
    def get_world_draft(draft_id: str) -> dict:
        try:
            return world.world_draft(draft_id)
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/api/v4/world-builder/drafts/{draft_id}/confirm")
    def publish_world_draft(draft_id: str, body: Optional[dict] = None) -> dict:
        try:
            return world.publish_world_draft(draft_id, (body or {}).get("expectedVersion"))
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/api/v4/world-builder/drafts/{draft_id}/cancel")
    def cancel_world_draft(draft_id: str) -> dict:
        try:
            return world.cancel_world_draft(draft_id)
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/api/v4/sessions/{session_id}/interest")
    def interest(session_id: str, body: dict) -> dict:
        try:
            if any(key in body for key in ("day", "minute", "clock", "clockVersion")):
                raise ValidationError("client time cannot advance the world", "client_clock_forbidden")
            return world.update_interest(session_id, body.get("roomId"), body.get("zoneId"), body.get("ttlSeconds", 90))
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/api/v4/sessions/{session_id}/heartbeat")
    def heartbeat(session_id: str, body: Optional[dict] = None) -> dict:
        try:
            body = body or {}
            if any(key in body for key in ("day", "minute", "clock", "clockVersion")):
                raise ValidationError("client time cannot advance the world", "client_clock_forbidden")
            return world.heartbeat(session_id, body.get("ttlSeconds", 90), lease_generation=body.get("leaseGeneration"), lease_token=body.get("leaseToken"))
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/internal/v4/world/tick")
    def tick() -> dict:
        return world.advance_world(reason="internal_tick")

    @app.get("/internal/v4/audits")
    def audits(afterId: int = 0) -> dict:
        report = world.audit()
        reader = getattr(world.store, "audits", None)
        return {"report": report, "events": reader(world.state.world_id, afterId) if callable(reader) else []}

    @app.post("/api/v4/turns")
    def turn(body: dict) -> dict:
        try:
            return world.submit_turn(body)
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/api/v4/turns/{turn_id}/confirm")
    def confirm(turn_id: str, body: Optional[dict] = None) -> dict:
        try:
            return world.confirm_turn(turn_id, (body or {}).get("expectedVersion"))
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.post("/api/v4/turns/{turn_id}/cancel")
    def cancel(turn_id: str) -> dict:
        try:
            return world.cancel_turn(turn_id)
        except WorldError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error)})

    @app.get("/api/v4/events")
    def events(after: int = 0, afterEventId: Optional[str] = None, viewer: str = "YOU") -> dict:
        if afterEventId:
            reader = getattr(world.store, "events_after_cursor", None)
            raw_events = reader(world.state.world_id, afterEventId) if callable(reader) else []
            visible = [item for item in raw_events if events_for_viewer([item], viewer, world.state)]
            return {"events": [item.to_dict() for item in visible], "worldVersion": world.state.world_version}
        return {"events": world.events(after, viewer), "worldVersion": world.state.world_version}

    @app.get("/api/v4/events/stream")
    def event_stream(after: int = 0, afterEventId: Optional[str] = None, viewer: str = "YOU") -> Any:
        # The first milestone uses a short poll-backed stream. The event
        # contract is already SSE-shaped, so a broker can replace this later.
        def generate() -> Any:
            if afterEventId:
                reader = getattr(world.store, "events_after_cursor", None)
                source = reader(world.state.world_id, afterEventId) if callable(reader) else []
                source = [item for item in source if events_for_viewer([item], viewer, world.state)]
                items = [item.to_dict() for item in source]
            else:
                items = world.events(after, viewer)
            for item in items:
                event_id = item.get("eventId", item.get("event_id", ""))
                yield "id: %s\ndata: %s\n\n" % (event_id, __import__("json").dumps(item, ensure_ascii=False))

        return StreamingResponse(generate(), media_type="text/event-stream")

    # Keep this catch-all last so health, API and internal routes always win.
    # A missing frontend build must not prevent the world API from starting.
    static_directory = _static_directory()
    if static_directory.is_dir():
        app.mount("/", StaticFiles(directory=str(static_directory), html=True), name="single-player")

    return app


app = None
if FastAPI is not None:  # Avoid constructing a persistent SQLite file at import time in minimal use.
    app = create_app()
