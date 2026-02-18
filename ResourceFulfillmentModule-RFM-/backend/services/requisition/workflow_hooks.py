"""
Workflow Transition Hooks — Extension Pattern

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides a pluggable hook system for extending workflow transitions
without modifying the core engine code. Use cases include:

1. Notifications (email, Slack, etc.)
2. SLA timers and deadline tracking
3. Event publishing (message queues, webhooks)
4. Metrics collection (Prometheus, DataDog)
5. External system integration

Architecture:
- Hooks are registered as callables
- Multiple hooks can be registered for the same event
- Hooks run after successful transition (post-commit)
- Hooks run asynchronously to not block the main request
- Hook failures are logged but don't rollback the transition

Usage:
    from services.requisition.workflow_hooks import TransitionHookRegistry
    
    # Register a hook
    @TransitionHookRegistry.on_transition("requisition", "DRAFT", "PENDING_BUDGET")
    def notify_budget_team(event: TransitionEvent):
        send_email(to="budget@company.com", subject=f"New requisition {event.entity_id}")
    
    # Register a hook for any transition
    @TransitionHookRegistry.on_any_transition("requisition")
    def log_all_transitions(event: TransitionEvent):
        logger.info(f"Requisition {event.entity_id}: {event.from_status} -> {event.to_status}")
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Optional,
    Set,
    Tuple,
    Type,
    TypeVar,
    Union,
)

logger = logging.getLogger(__name__)

# Type aliases
HookCallable = Callable[["TransitionEvent"], None]
AsyncHookCallable = Callable[["TransitionEvent"], "asyncio.Coroutine"]


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class TransitionEvent:
    """
    Immutable event object passed to transition hooks.
    
    Contains all context needed for hook processing.
    """
    entity_type: str          # "requisition" or "requisition_item"
    entity_id: int            # req_id or item_id
    action: str               # "SUBMIT", "APPROVE_BUDGET", etc.
    from_status: str          # Previous status
    to_status: str            # New status
    performed_by: int         # User ID who performed the action
    user_roles: List[str]     # Roles of the performing user
    timestamp: datetime       # When the transition occurred
    version_before: int       # Entity version before transition
    version_after: int        # Entity version after transition
    reason: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # Related entity references (optional, for context)
    parent_req_id: Optional[int] = None  # For items, the parent requisition
    assigned_employee_id: Optional[str] = None  # For FULFILLED items
    assigned_ta_id: Optional[int] = None


@dataclass
class HookRegistration:
    """Internal registration record for a hook."""
    hook_id: str
    callable: Union[HookCallable, AsyncHookCallable]
    entity_type: str
    from_status: Optional[str]  # None means any
    to_status: Optional[str]    # None means any
    is_async: bool = False
    priority: int = 100         # Lower = runs first
    enabled: bool = True


# =============================================================================
# HOOK REGISTRY
# =============================================================================

class TransitionHookRegistry:
    """
    Central registry for workflow transition hooks.
    
    Thread-safe singleton pattern. Hooks are registered globally and
    dispatched after successful transitions.
    """
    
    _instance: Optional["TransitionHookRegistry"] = None
    _lock = asyncio.Lock() if hasattr(asyncio, 'Lock') else None
    _hooks: Dict[str, HookRegistration]
    
    def __new__(cls) -> "TransitionHookRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._hooks = {}
            cls._instance._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="hook_")
        return cls._instance
    
    @classmethod
    def reset(cls) -> None:
        """Reset the registry (useful for testing)."""
        if cls._instance:
            cls._instance._hooks.clear()
    
    # -------------------------------------------------------------------------
    # REGISTRATION METHODS
    # -------------------------------------------------------------------------
    
    @classmethod
    def register(
        cls,
        hook_id: str,
        callable: Union[HookCallable, AsyncHookCallable],
        entity_type: str,
        from_status: Optional[str] = None,
        to_status: Optional[str] = None,
        is_async: bool = False,
        priority: int = 100,
    ) -> None:
        """
        Register a hook for specific or all transitions.
        
        Args:
            hook_id: Unique identifier for this hook
            callable: Function to call on transition
            entity_type: "requisition" or "requisition_item"
            from_status: Source status (None = any)
            to_status: Target status (None = any)
            is_async: Whether the hook is async
            priority: Execution order (lower = first)
        """
        instance = cls()
        instance._hooks[hook_id] = HookRegistration(
            hook_id=hook_id,
            callable=callable,
            entity_type=entity_type,
            from_status=from_status,
            to_status=to_status,
            is_async=is_async,
            priority=priority,
        )
        logger.info(f"Registered hook: {hook_id} for {entity_type} ({from_status} -> {to_status})")
    
    @classmethod
    def unregister(cls, hook_id: str) -> bool:
        """Unregister a hook by ID."""
        instance = cls()
        if hook_id in instance._hooks:
            del instance._hooks[hook_id]
            logger.info(f"Unregistered hook: {hook_id}")
            return True
        return False
    
    @classmethod
    def on_transition(
        cls,
        entity_type: str,
        from_status: str,
        to_status: str,
        priority: int = 100,
    ) -> Callable[[HookCallable], HookCallable]:
        """
        Decorator to register a hook for a specific transition.
        
        Usage:
            @TransitionHookRegistry.on_transition("requisition", "DRAFT", "PENDING_BUDGET")
            def my_hook(event: TransitionEvent):
                ...
        """
        def decorator(func: HookCallable) -> HookCallable:
            hook_id = f"{entity_type}_{from_status}_{to_status}_{func.__name__}"
            is_async = asyncio.iscoroutinefunction(func)
            cls.register(
                hook_id=hook_id,
                callable=func,
                entity_type=entity_type,
                from_status=from_status,
                to_status=to_status,
                is_async=is_async,
                priority=priority,
            )
            return func
        return decorator
    
    @classmethod
    def on_any_transition(
        cls,
        entity_type: str,
        priority: int = 100,
    ) -> Callable[[HookCallable], HookCallable]:
        """
        Decorator to register a hook for any transition of an entity type.
        
        Usage:
            @TransitionHookRegistry.on_any_transition("requisition")
            def log_all(event: TransitionEvent):
                ...
        """
        def decorator(func: HookCallable) -> HookCallable:
            hook_id = f"{entity_type}_any_{func.__name__}"
            is_async = asyncio.iscoroutinefunction(func)
            cls.register(
                hook_id=hook_id,
                callable=func,
                entity_type=entity_type,
                from_status=None,
                to_status=None,
                is_async=is_async,
                priority=priority,
            )
            return func
        return decorator
    
    @classmethod
    def on_status_entry(
        cls,
        entity_type: str,
        status: str,
        priority: int = 100,
    ) -> Callable[[HookCallable], HookCallable]:
        """
        Decorator to register a hook when entering a specific status.
        
        Usage:
            @TransitionHookRegistry.on_status_entry("requisition", "ACTIVE")
            def on_activation(event: TransitionEvent):
                ...
        """
        def decorator(func: HookCallable) -> HookCallable:
            hook_id = f"{entity_type}_entry_{status}_{func.__name__}"
            is_async = asyncio.iscoroutinefunction(func)
            cls.register(
                hook_id=hook_id,
                callable=func,
                entity_type=entity_type,
                from_status=None,
                to_status=status,
                is_async=is_async,
                priority=priority,
            )
            return func
        return decorator
    
    @classmethod
    def on_status_exit(
        cls,
        entity_type: str,
        status: str,
        priority: int = 100,
    ) -> Callable[[HookCallable], HookCallable]:
        """
        Decorator to register a hook when leaving a specific status.
        
        Usage:
            @TransitionHookRegistry.on_status_exit("requisition", "DRAFT")
            def on_draft_exit(event: TransitionEvent):
                ...
        """
        def decorator(func: HookCallable) -> HookCallable:
            hook_id = f"{entity_type}_exit_{status}_{func.__name__}"
            is_async = asyncio.iscoroutinefunction(func)
            cls.register(
                hook_id=hook_id,
                callable=func,
                entity_type=entity_type,
                from_status=status,
                to_status=None,
                is_async=is_async,
                priority=priority,
            )
            return func
        return decorator
    
    # -------------------------------------------------------------------------
    # DISPATCH METHODS
    # -------------------------------------------------------------------------
    
    @classmethod
    def dispatch(cls, event: TransitionEvent) -> None:
        """
        Dispatch an event to all matching hooks synchronously.
        
        This method is called by the workflow engine after a successful transition.
        Hooks are executed in priority order. Failures are logged but don't
        raise exceptions.
        """
        instance = cls()
        matching = instance._find_matching_hooks(event)
        
        for registration in matching:
            try:
                if registration.is_async:
                    # Run async hook in executor
                    instance._executor.submit(
                        asyncio.run,
                        registration.callable(event)
                    )
                else:
                    registration.callable(event)
            except Exception as e:
                logger.error(
                    f"Hook {registration.hook_id} failed: {e}",
                    exc_info=True,
                    extra={
                        "hook_id": registration.hook_id,
                        "event_entity_type": event.entity_type,
                        "event_entity_id": event.entity_id,
                    }
                )
    
    @classmethod
    async def dispatch_async(cls, event: TransitionEvent) -> None:
        """
        Dispatch an event to all matching hooks asynchronously.
        
        Use this when running in an async context (e.g., FastAPI endpoint).
        """
        instance = cls()
        matching = instance._find_matching_hooks(event)
        
        tasks = []
        for registration in matching:
            try:
                if registration.is_async:
                    tasks.append(registration.callable(event))
                else:
                    # Run sync hook in executor
                    loop = asyncio.get_event_loop()
                    tasks.append(
                        loop.run_in_executor(
                            instance._executor,
                            registration.callable,
                            event,
                        )
                    )
            except Exception as e:
                logger.error(f"Hook {registration.hook_id} failed: {e}", exc_info=True)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    def _find_matching_hooks(self, event: TransitionEvent) -> List[HookRegistration]:
        """Find all hooks that match the given event."""
        matching = []
        
        for registration in self._hooks.values():
            if not registration.enabled:
                continue
            
            if registration.entity_type != event.entity_type:
                continue
            
            # Check from_status match
            if registration.from_status is not None:
                if registration.from_status != event.from_status:
                    continue
            
            # Check to_status match
            if registration.to_status is not None:
                if registration.to_status != event.to_status:
                    continue
            
            matching.append(registration)
        
        # Sort by priority
        matching.sort(key=lambda r: r.priority)
        return matching


# =============================================================================
# BUILT-IN HOOK IMPLEMENTATIONS
# =============================================================================

class BaseTransitionHook(ABC):
    """
    Abstract base class for complex hook implementations.
    
    Extend this class when you need stateful hooks or complex logic.
    """
    
    @abstractmethod
    def on_transition(self, event: TransitionEvent) -> None:
        """Handle the transition event."""
        pass
    
    def register(
        self,
        entity_type: str,
        from_status: Optional[str] = None,
        to_status: Optional[str] = None,
        priority: int = 100,
    ) -> None:
        """Register this hook instance with the registry."""
        hook_id = f"{entity_type}_{self.__class__.__name__}"
        TransitionHookRegistry.register(
            hook_id=hook_id,
            callable=self.on_transition,
            entity_type=entity_type,
            from_status=from_status,
            to_status=to_status,
            priority=priority,
        )


class MetricsHook(BaseTransitionHook):
    """
    Hook for collecting transition metrics.
    
    Designed for integration with Prometheus, DataDog, etc.
    """
    
    def __init__(self, metrics_client: Optional[Any] = None):
        self.metrics_client = metrics_client
        self._transition_counts: Dict[Tuple[str, str, str], int] = {}
        self._transition_times: List[float] = []
    
    def on_transition(self, event: TransitionEvent) -> None:
        """Record transition metrics."""
        key = (event.entity_type, event.from_status, event.to_status)
        self._transition_counts[key] = self._transition_counts.get(key, 0) + 1
        
        if self.metrics_client:
            # Push to external metrics system
            self.metrics_client.increment(
                "workflow.transition.count",
                tags={
                    "entity_type": event.entity_type,
                    "from_status": event.from_status,
                    "to_status": event.to_status,
                }
            )
    
    def get_counts(self) -> Dict[Tuple[str, str, str], int]:
        """Get current transition counts."""
        return self._transition_counts.copy()


class SLATimerHook(BaseTransitionHook):
    """
    Hook for tracking SLA timers on status changes.
    
    Tracks how long entities spend in each status for SLA monitoring.
    """
    
    def __init__(self, sla_repository: Optional[Any] = None):
        self.sla_repository = sla_repository
        self._status_entry_times: Dict[Tuple[str, int], datetime] = {}
    
    def on_transition(self, event: TransitionEvent) -> None:
        """
        Record status entry/exit times.
        
        - Closes timer for exited status
        - Starts timer for entered status
        """
        key = (event.entity_type, event.entity_id)
        
        # Close timer for previous status
        entry_time = self._status_entry_times.pop(key, None)
        if entry_time:
            duration_seconds = (event.timestamp - entry_time).total_seconds()
            
            if self.sla_repository:
                self.sla_repository.record_duration(
                    entity_type=event.entity_type,
                    entity_id=event.entity_id,
                    status=event.from_status,
                    duration_seconds=duration_seconds,
                )
        
        # Start timer for new status (unless terminal)
        terminal_statuses = {"FULFILLED", "REJECTED", "CANCELLED"}
        if event.to_status not in terminal_statuses:
            self._status_entry_times[key] = event.timestamp


class NotificationHook(BaseTransitionHook):
    """
    Hook for sending notifications on specific transitions.
    
    Configure notification rules for different transition types.
    """
    
    def __init__(self, notification_service: Optional[Any] = None):
        self.notification_service = notification_service
        self.rules: List[Dict[str, Any]] = []
    
    def add_rule(
        self,
        from_status: Optional[str],
        to_status: Optional[str],
        recipients: List[str],
        template: str,
    ) -> None:
        """Add a notification rule."""
        self.rules.append({
            "from_status": from_status,
            "to_status": to_status,
            "recipients": recipients,
            "template": template,
        })
    
    def on_transition(self, event: TransitionEvent) -> None:
        """Check rules and send notifications."""
        for rule in self.rules:
            if self._matches_rule(event, rule):
                self._send_notification(event, rule)
    
    def _matches_rule(self, event: TransitionEvent, rule: Dict[str, Any]) -> bool:
        """Check if event matches a notification rule."""
        if rule["from_status"] and rule["from_status"] != event.from_status:
            return False
        if rule["to_status"] and rule["to_status"] != event.to_status:
            return False
        return True
    
    def _send_notification(self, event: TransitionEvent, rule: Dict[str, Any]) -> None:
        """Send notification based on rule."""
        if self.notification_service:
            self.notification_service.send(
                recipients=rule["recipients"],
                template=rule["template"],
                context={
                    "entity_type": event.entity_type,
                    "entity_id": event.entity_id,
                    "from_status": event.from_status,
                    "to_status": event.to_status,
                    "performed_by": event.performed_by,
                    "timestamp": event.timestamp.isoformat(),
                }
            )


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def create_transition_event(
    entity_type: str,
    entity_id: int,
    action: str,
    from_status: str,
    to_status: str,
    performed_by: int,
    user_roles: List[str],
    version_before: int,
    version_after: int,
    reason: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    parent_req_id: Optional[int] = None,
    assigned_employee_id: Optional[str] = None,
    assigned_ta_id: Optional[int] = None,
) -> TransitionEvent:
    """Factory function to create TransitionEvent."""
    return TransitionEvent(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        from_status=from_status,
        to_status=to_status,
        performed_by=performed_by,
        user_roles=user_roles,
        timestamp=datetime.utcnow(),
        version_before=version_before,
        version_after=version_after,
        reason=reason,
        metadata=metadata or {},
        parent_req_id=parent_req_id,
        assigned_employee_id=assigned_employee_id,
        assigned_ta_id=assigned_ta_id,
    )


# =============================================================================
# MODULE INITIALIZATION
# =============================================================================

def register_default_hooks() -> None:
    """
    Register default hooks for the workflow system.
    
    Call this during application startup to enable built-in hooks.
    """
    logger.info("Registering default workflow hooks...")
    
    # Example: Log all transitions
    @TransitionHookRegistry.on_any_transition("requisition")
    def log_requisition_transition(event: TransitionEvent):
        logger.info(
            f"Requisition {event.entity_id} transitioned: "
            f"{event.from_status} -> {event.to_status} "
            f"by user {event.performed_by}"
        )
    
    @TransitionHookRegistry.on_any_transition("requisition_item")
    def log_item_transition(event: TransitionEvent):
        logger.info(
            f"Item {event.entity_id} transitioned: "
            f"{event.from_status} -> {event.to_status} "
            f"by user {event.performed_by}"
        )
