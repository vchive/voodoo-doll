"""Bounded OpenAI-compatible HTTP gateway for game agents.

The gateway is deliberately small and provider-neutral.  It sends a filtered
``AgentRequest`` to an OpenAI-compatible ``chat/completions`` endpoint and
accepts only a response-shaped character proposal.  It never receives or
sends the authoritative ``WorldState`` and it has a deterministic local
fallback for missing configuration, transport errors, budget exhaustion, and
malformed model output.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json
import os
import re
import threading
from typing import Any, Callable, Dict, Mapping, Optional, Sequence
import urllib.error
import urllib.request

from .base import AgentRequest, ProviderError, ProviderResult
from .rule_agent import RuleAgent
from ..domain.actions import RESPONSE_ACTIONS
from ..domain.models import ValidationError
from ..tools.compiler import ToolCompilationError, ToolCompiler
from ..tools.registry import PublishedRegistry


# Context values are intentionally allow-listed.  New fields must be added
# here explicitly rather than accidentally exposing private state to a model.
_CONTEXT_KEYS = {
    "viewer", "room", "present", "environment", "relationships", "events",
    "memory", "short_memory", "capabilities",
}
_SENSITIVE_KEYS = {
    "avatar", "avatarurl", "image", "imageurl", "photo", "secret", "secrets",
    "apikey", "api_key", "token", "access_token", "password", "credential",
    "credentials", "privatekey", "private_key", "authorization", "cookie",
}
_FORBIDDEN_TEXT = re.compile(r"(?:https?|file)://|(?:api[_-]?key|access[_-]?token|password|secret)", re.I)


@dataclass(frozen=True)
class GatewayLimits:
    """Hard process-local limits for model calls."""

    timeout_seconds: float = 8.0
    max_output_chars: int = 800
    daily_request_budget: int = 100
    max_concurrency: int = 2

    def __post_init__(self) -> None:
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if self.max_output_chars <= 0:
            raise ValueError("max_output_chars must be positive")
        if self.daily_request_budget <= 0:
            raise ValueError("daily_request_budget must be positive")
        if self.max_concurrency <= 0:
            raise ValueError("max_concurrency must be positive")


Transport = Callable[[str, Mapping[str, str], bytes, float], Any]


def _json_safe(value: Any, *, depth: int = 0) -> Any:
    """Recursively redact sensitive fields and bound model-visible payloads."""
    if depth > 8:
        return None
    if isinstance(value, Mapping):
        result: Dict[str, Any] = {}
        for raw_key, child in value.items():
            key = str(raw_key)
            normalized = re.sub(r"[^a-z0-9]", "", key.lower())
            if normalized in {re.sub(r"[^a-z0-9]", "", item) for item in _SENSITIVE_KEYS}:
                continue
            result[key] = _json_safe(child, depth=depth + 1)
        return result
    if isinstance(value, (list, tuple)):
        return [_json_safe(item, depth=depth + 1) for item in list(value)[:128]]
    if isinstance(value, str):
        # Do not send a URL or anything that looks like a credential.  The
        # request normally contains prose and event text, so this is a final
        # defensive scrub rather than a semantic parser.
        if _FORBIDDEN_TEXT.search(value):
            return "[redacted]"
        return value[:4000]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:4000]


def _filtered_request(request: AgentRequest, actor: str) -> Dict[str, Any]:
    """Return only the small request contract accepted by the model gateway."""
    raw = request.as_dict() if hasattr(request, "as_dict") else {}
    if not isinstance(raw, Mapping):
        raw = {}
    context = raw.get("context", {})
    if not isinstance(context, Mapping):
        context = {}
    filtered_context = {
        key: _json_safe(context[key])
        for key in _CONTEXT_KEYS
        if key in context
    }
    trigger = raw.get("trigger", {})
    if not isinstance(trigger, Mapping):
        trigger = {}
    return {
        "actorId": actor,
        "context": filtered_context,
        "trigger": _json_safe(trigger),
        "traceId": str(raw.get("traceId", getattr(request, "trace_id", "")))[:160],
    }


def _completion_content(raw: Any) -> str:
    """Extract a bounded assistant message from a chat-completions result."""
    if isinstance(raw, (bytes, bytearray)):
        raw = json.loads(bytes(raw).decode("utf-8"))
    if not isinstance(raw, Mapping):
        raise ProviderError("model response is not an object")
    choices = raw.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], Mapping):
        raise ProviderError("model response has no choices")
    message = choices[0].get("message")
    if not isinstance(message, Mapping):
        raise ProviderError("model response has no message")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ProviderError("model response content is empty")
    # A few compatible gateways wrap JSON in a Markdown fence.  Removing only
    # the fence keeps the actual parser strict and bounded.
    content = content.strip()
    if content.startswith("```") and content.endswith("```"):
        content = content[3:-3].strip()
        if content.lower().startswith("json"):
            content = content[4:].lstrip()
    return content


def _proposal(raw: Any, actor: str, source: str, trace_id: str, max_chars: int) -> ProviderResult:
    if not isinstance(raw, Mapping):
        raise ProviderError("model proposal is not an object")
    allowed = {"actor", "action", "target", "text"}
    if set(raw) - allowed:
        raise ProviderError("model proposal contains unknown fields")
    proposed_actor = raw.get("actor")
    action = raw.get("action")
    target = raw.get("target", "YOU")
    text = raw.get("text")
    if proposed_actor != actor:
        raise ProviderError("model actor does not match requested actor")
    if not isinstance(action, str) or action not in RESPONSE_ACTIONS:
        raise ProviderError("model action is not an allowed response action")
    if target not in ("YOU", "PLAYER_DOLL"):
        raise ProviderError("model target is not the player")
    if text is not None and (not isinstance(text, str) or len(text) > max_chars):
        raise ProviderError("model text exceeded configured output budget")
    if action in {"answer", "deny", "lie", "counter", "refuse"} and (not isinstance(text, str) or not text.strip()):
        raise ProviderError("model response text is required")
    return ProviderResult(
        actor=actor,
        action=action,
        target=target,
        text=text.strip() if isinstance(text, str) else None,
        source=source,
        trace_id=trace_id or None,
    )


class GatewayAgent:
    """OpenAI-compatible adapter with bounded calls and a local fallback."""

    provider = "deepseek"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model_name: str,
        *,
        limits: Optional[GatewayLimits] = None,
        fallback: Any = None,
        transport: Optional[Transport] = None,
    ) -> None:
        if not base_url or not api_key or not model_name:
            raise ValueError("base_url, api_key and model_name are required")
        self.base_url = base_url.rstrip("/")
        if not self.base_url.endswith("/chat/completions"):
            self.base_url += "/chat/completions"
        self.api_key = api_key
        self.model_name = model_name
        self.limits = limits or GatewayLimits()
        self.fallback = fallback or RuleAgent()
        self.transport = transport or self._default_transport
        self._semaphore = threading.BoundedSemaphore(self.limits.max_concurrency)
        self._budget_lock = threading.Lock()
        self._budget_day = date.today()
        self._budget_used = 0

    @classmethod
    def from_env(cls, *, limits: Optional[GatewayLimits] = None, fallback: Any = None, transport: Optional[Transport] = None) -> Optional["GatewayAgent"]:
        base_url = os.getenv("MODEL_BASE_URL", "").strip()
        api_key = os.getenv("MODEL_API_KEY", "").strip()
        model_name = os.getenv("MODEL_NAME", "").strip()
        if not base_url or not api_key or not model_name:
            return None
        try:
            return cls(base_url, api_key, model_name, limits=limits, fallback=fallback, transport=transport)
        except ValueError:
            return None

    def _reserve_budget(self) -> None:
        today = date.today()
        with self._budget_lock:
            if today != self._budget_day:
                self._budget_day = today
                self._budget_used = 0
            if self._budget_used >= self.limits.daily_request_budget:
                raise ProviderError("daily model request budget exhausted")
            self._budget_used += 1

    def _default_transport(self, url: str, headers: Mapping[str, str], body: bytes, timeout: float) -> Any:
        request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            raise ProviderError("model HTTP request failed") from error

    def _request_model(self, request: AgentRequest, actor: str) -> ProviderResult:
        self._reserve_budget()
        acquired = self._semaphore.acquire(timeout=self.limits.timeout_seconds)
        if not acquired:
            raise ProviderError("model concurrency limit reached")
        try:
            visible = _filtered_request(request, actor)
            body = json.dumps(
                {
                    "model": self.model_name,
                    "temperature": 0.7,
                    "max_tokens": 256,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Return only one JSON object with actor, action, target, text. Use an allowed response action and never invent world facts.",
                        },
                        {"role": "user", "content": json.dumps(visible, ensure_ascii=False, separators=(",", ":"))},
                    ],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            raw = self.transport(
                self.base_url,
                {"Content-Type": "application/json", "Authorization": "Bearer " + self.api_key},
                body,
                self.limits.timeout_seconds,
            )
            content = _completion_content(raw)
            if len(content) > self.limits.max_output_chars:
                raise ProviderError("model output exceeded configured budget")
            try:
                proposal = json.loads(content)
            except (TypeError, ValueError) as error:
                raise ProviderError("model output is not valid JSON") from error
            return _proposal(proposal, actor, self.provider, getattr(request, "trace_id", ""), self.limits.max_output_chars)
        finally:
            self._semaphore.release()

    def propose(self, actor: str, request: AgentRequest, state: Any) -> Any:
        try:
            return self._request_model(request, actor)
        except Exception:
            # Keep the kernel playable when the gateway is unavailable.  The
            # fallback receives the filtered request and never gets credentials.
            return self.fallback.propose(actor, request, state)


def create_game_agent(*, limits: Optional[GatewayLimits] = None, fallback: Any = None, transport: Optional[Transport] = None) -> Any:
    """Create a configured gateway or a deterministic local RuleAgent."""
    return GatewayAgent.from_env(limits=limits, fallback=fallback, transport=transport) or (fallback or RuleAgent())


def draft_world_from_story(story: str, names: Sequence[str]) -> Optional[Dict[str, Any]]:
    """Ask the configured model for a validated, inert world declaration.

    The result is suitable as input to ``WorldBuilder.create_draft``.  It is
    always compiled through the declaration-only compiler before returning;
    arbitrary tools, code, rooms, network access, and unknown fields are
    rejected.  Missing configuration or any failure returns ``None``.
    """
    if not isinstance(story, str) or not story.strip() or len(story) > 12000:
        return None
    if not isinstance(names, Sequence) or isinstance(names, (str, bytes)) or len(names) > 32:
        return None
    clean_names = []
    for name in names:
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            return None
        clean_names.append(name.strip())
    gateway = GatewayAgent.from_env()
    if gateway is None:
        return None
    # Reuse the same bounded transport, budget and concurrency policy while
    # keeping this request independent from a live WorldState.
    request = AgentRequest(
        actor_id="WORLD_BUILDER",
        context={},
        trigger={"story": story.strip(), "names": clean_names},
        trace_id="world-draft",
    )
    try:
        gateway._reserve_budget()
        acquired = gateway._semaphore.acquire(timeout=gateway.limits.timeout_seconds)
    except Exception:
        return None
    if not acquired:
        return None
    try:
        prompt = {
            "story": story.strip(),
            "names": clean_names,
            "schema": {"narrative": "string", "entities": "array", "schedules": "array", "encounters": "array", "metadata": "object"},
            "rules": "Only existing room IDs and registered agent IDs; no rooms, code, URLs, scripts, or tools.",
        }
        body = json.dumps(
            {
                "model": gateway.model_name,
                "temperature": 0.5,
                "max_tokens": 1024,
                "messages": [
                    {"role": "system", "content": "Return only a JSON world declaration. It is inert data, never executable code."},
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False, separators=(",", ":"))},
                ],
            }, ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")
        raw = gateway.transport(
            gateway.base_url,
            {"Content-Type": "application/json", "Authorization": "Bearer " + gateway.api_key},
            body,
            gateway.limits.timeout_seconds,
        )
        content = _completion_content(raw)
        if len(content) > gateway.limits.max_output_chars:
            return None
        generated = json.loads(content)
        if not isinstance(generated, Mapping):
            return None
        raw_declaration = {
            "narrative": generated.get("narrative"),
            "entities": generated.get("entities", []),
            "schedules": generated.get("schedules", []),
            "encounters": generated.get("encounters", []),
            "metadata": generated.get("metadata", {}),
        }
        compiled = ToolCompiler().compile(raw_declaration, PublishedRegistry())
        return {
            "narrative": compiled["narrative"],
            "entities": compiled["entities"],
            "schedules": compiled["schedules"],
            "encounters": compiled["encounters"],
            "metadata": compiled["metadata"],
        }
    except Exception:
        return None
    finally:
        gateway._semaphore.release()
