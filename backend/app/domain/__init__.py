from .models import Event, AgentProfile, WorldState, default_world
from .events import WorldEvent

__all__ = ["AgentProfile", "Event", "WorldEvent", "WorldKernel", "WorldState", "default_world"]


def __getattr__(name: str):
    """Load the kernel lazily so agent adapter imports stay acyclic."""
    if name == "WorldKernel":
        from .world import WorldKernel
        return WorldKernel
    raise AttributeError(name)
