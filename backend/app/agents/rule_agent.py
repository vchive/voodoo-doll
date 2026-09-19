"""Deterministic offline character policy.

It gives every character agency without requiring a model. The policy is small
on purpose: model adapters can improve wording while the Kernel keeps authority.
"""

from __future__ import annotations

import random
from typing import Any

from ..domain.resolver import EnvironmentResolver, RuleAgent as _RuleAgent


class RuleAgent(_RuleAgent):
    """Public adapter name that matches the WorldKernel proposal contract."""

    provider = "local"


class LocalEnvironmentResolver(EnvironmentResolver):
    """Public adapter name for the deterministic environment resolver."""
