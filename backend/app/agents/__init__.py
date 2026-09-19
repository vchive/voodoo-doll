from .base import AgentAdapter, AgentRequest, AgentProposal
from .rule_agent import RuleAgent
from .gateway import GatewayAgent, GatewayLimits, create_game_agent

# Backwards-compatible name used by the initial M1 adapter contract.
LocalRuleAgent = RuleAgent

__all__ = [
    "AgentAdapter",
    "AgentRequest",
    "AgentProposal",
    "GatewayAgent",
    "GatewayLimits",
    "LocalRuleAgent",
    "RuleAgent",
    "create_game_agent",
]
