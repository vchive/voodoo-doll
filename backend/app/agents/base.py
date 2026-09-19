"""Provider-independent agent adapter contract.

The kernel only accepts structured proposals.  Providers receive a filtered
request and return data; they never receive a store or a world mutation hook.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Mapping, Optional, Protocol

from ..domain.actions import AgentProposal


class AgentAdapter(Protocol):
    provider: str

    def propose(self, actor: str, request: Any, state: Any) -> Any:
        """Return a structured proposal; never mutate world state."""


@dataclass(frozen=True)
class AdapterLimits:
    timeout_seconds: float = 8.0
    max_output_chars: int = 800


@dataclass(frozen=True)
class ProviderResult:
    """Provider output before Kernel validation."""

    actor: str
    action: str
    target: Optional[str]
    text: Optional[str]
    source: str
    trace_id: Optional[str] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


class ProviderError(RuntimeError):
    """A provider failure that must fall back to a local response."""


class StructuredProviderAdapter:
    """Thin adapter shared by Pi, DeepSeek and Claude gateways.

    `transport` is injected by the application, which keeps credentials and
    network code outside the world kernel.  The provider may return either a
    `ProviderResult` or a plain mapping with the same fields.
    """

    def __init__(self, provider: str, transport: Callable[[Dict[str, Any]], Any], limits: Optional[AdapterLimits] = None):
        if provider not in {"pi", "deepseek", "claude"}:
            raise ValueError("unsupported provider")
        self.provider = provider
        self.transport = transport
        self.limits = limits or AdapterLimits()

    def propose(self, actor: str, request: Any, state: Any) -> ProviderResult:
        payload = request.as_dict() if hasattr(request, "as_dict") else {
            "actorId": actor,
            "trigger": getattr(request, "payload", {}),
        }
        payload["limits"] = {
            "timeoutSeconds": self.limits.timeout_seconds,
            "maxOutputChars": self.limits.max_output_chars,
        }
        try:
            raw = self.transport(payload)
        except Exception as error:  # provider-specific errors never escape as world mutations
            raise ProviderError(f"{self.provider} provider failed") from error
        if isinstance(raw, ProviderResult):
            result = raw
        elif isinstance(raw, Mapping):
            result = ProviderResult(
                actor=str(raw.get("actor", actor)),
                action=str(raw.get("action", "refuse")),
                target=raw.get("target", "YOU"),
                text=raw.get("text"),
                source=self.provider,
                trace_id=raw.get("traceId"),
                metadata=raw.get("metadata", {}),
            )
        else:
            raise ProviderError("provider returned a non-object proposal")
        if result.actor != actor:
            raise ProviderError("provider actor does not match requested actor")
        if result.text is not None and len(str(result.text)) > self.limits.max_output_chars:
            raise ProviderError("provider output exceeded configured budget")
        return result


class ProviderRegistry:
    """Explicit provider registry; unknown names cannot become live adapters."""

    def __init__(self, adapters: Optional[Mapping[str, AgentAdapter]] = None):
        self._adapters = dict(adapters or {})

    def register(self, adapter: AgentAdapter) -> None:
        provider = getattr(adapter, "provider", None)
        if provider not in {"local", "pi", "deepseek", "claude"}:
            raise ValueError("provider is not registered")
        self._adapters[provider] = adapter

    def get(self, provider: str) -> Optional[AgentAdapter]:
        return self._adapters.get(provider)

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._adapters))


class AgentRequest:
    """Small immutable-ish request wrapper used by adapters and tests."""

    def __init__(self, actor_id: str, context: Dict[str, Any], trigger: Dict[str, Any], trace_id: str):
        self.actor_id = actor_id
        self.context = context
        self.trigger = trigger
        self.trace_id = trace_id

    def as_dict(self) -> Dict[str, Any]:
        return {
            "actorId": self.actor_id,
            "context": self.context,
            "trigger": self.trigger,
            "traceId": self.trace_id,
        }

    # Compatibility accessors let the deterministic legacy RuleAgent consume
    # the filtered wrapper during the staged provider migration.
    @property
    def turn_id(self) -> str:
        return str(self.trigger.get("turnId", self.trigger.get("turn_id", "")))

    @property
    def payload(self) -> Dict[str, Any]:
        value = self.trigger.get("payload", {})
        return value if isinstance(value, dict) else {}
