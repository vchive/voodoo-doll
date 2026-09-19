"""Optional model adapter boundary and resilient provider composition."""

from __future__ import annotations

from typing import Any

from .base import ProviderError, StructuredProviderAdapter
from .rule_agent import RuleAgent


class UnavailableModelAdapter:
    provider = "unavailable"

    def propose(self, actor: str, request: Any, state: Any) -> Any:
        raise RuntimeError("model provider is not configured")


class ResilientAgent:
    """Use a configured provider when available and keep local playability.

    The provider returns a proposal only.  The World Kernel still validates the
    actor, action, target, visibility and relationship effects before commit.
    """

    def __init__(self, provider: StructuredProviderAdapter | None = None, fallback: Any | None = None):
        self.provider = provider
        self.fallback = fallback or RuleAgent()

    def propose(self, actor: str, request: Any, state: Any) -> Any:
        if self.provider is not None:
            try:
                return self.provider.propose(actor, request, state)
            except (ProviderError, TimeoutError, ValueError):
                pass
        return self.fallback.propose(actor, request, state)
