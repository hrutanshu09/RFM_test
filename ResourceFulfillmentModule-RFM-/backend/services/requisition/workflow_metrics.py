"""
============================================================================
Workflow Observability — Metrics & Monitoring
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides observability features:
1. Transition success/failure counters
2. Performance metrics
3. Health check data
4. Export-ready formats (Prometheus-compatible)

Thread-safe implementation using atomic operations.
"""

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, List, Optional, Tuple


# =============================================================================
# METRICS DATA STRUCTURES
# =============================================================================

@dataclass
class TransitionMetric:
    """Single transition metric entry."""
    entity_type: str
    from_status: str
    to_status: str
    action: str
    success_count: int = 0
    failure_count: int = 0
    total_duration_ms: float = 0.0
    last_success: Optional[datetime] = None
    last_failure: Optional[datetime] = None
    last_error: Optional[str] = None


@dataclass 
class OverallMetrics:
    """Aggregate metrics across all transitions."""
    total_transitions: int = 0
    total_successes: int = 0
    total_failures: int = 0
    total_conflicts: int = 0
    avg_duration_ms: float = 0.0
    uptime_seconds: float = 0.0
    start_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# =============================================================================
# METRICS COLLECTOR (Thread-Safe Singleton)
# =============================================================================

class WorkflowMetricsCollector:
    """
    Thread-safe metrics collector for workflow transitions.
    
    Provides:
    - Transition success/failure counting
    - Duration tracking
    - Error tracking
    - Prometheus-compatible export
    
    Usage:
        collector = WorkflowMetricsCollector.get_instance()
        collector.record_success("requisition", "DRAFT", "PENDING_BUDGET", "SUBMIT", 150.5)
        metrics = collector.get_metrics()
    """
    
    _instance: Optional["WorkflowMetricsCollector"] = None
    _lock = Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._metrics_lock = Lock()
        self._transition_metrics: Dict[str, TransitionMetric] = {}
        self._overall = OverallMetrics()
        self._error_log: List[Tuple[datetime, str, str]] = []  # (time, key, error)
        self._max_error_log = 1000
        self._initialized = True
    
    @classmethod
    def get_instance(cls) -> "WorkflowMetricsCollector":
        """Get singleton instance."""
        return cls()
    
    def _make_key(
        self, 
        entity_type: str, 
        from_status: str, 
        to_status: str, 
        action: str
    ) -> str:
        """Create unique key for a transition type."""
        return f"{entity_type}:{from_status}:{to_status}:{action}"
    
    def record_success(
        self,
        entity_type: str,
        from_status: str,
        to_status: str,
        action: str,
        duration_ms: float,
    ) -> None:
        """Record a successful transition."""
        key = self._make_key(entity_type, from_status, to_status, action)
        now = datetime.now(timezone.utc)
        
        with self._metrics_lock:
            if key not in self._transition_metrics:
                self._transition_metrics[key] = TransitionMetric(
                    entity_type=entity_type,
                    from_status=from_status,
                    to_status=to_status,
                    action=action,
                )
            
            metric = self._transition_metrics[key]
            metric.success_count += 1
            metric.total_duration_ms += duration_ms
            metric.last_success = now
            
            self._overall.total_transitions += 1
            self._overall.total_successes += 1
    
    def record_failure(
        self,
        entity_type: str,
        from_status: str,
        to_status: str,
        action: str,
        error: str,
        is_conflict: bool = False,
    ) -> None:
        """Record a failed transition."""
        key = self._make_key(entity_type, from_status, to_status, action)
        now = datetime.now(timezone.utc)
        
        with self._metrics_lock:
            if key not in self._transition_metrics:
                self._transition_metrics[key] = TransitionMetric(
                    entity_type=entity_type,
                    from_status=from_status,
                    to_status=to_status,
                    action=action,
                )
            
            metric = self._transition_metrics[key]
            metric.failure_count += 1
            metric.last_failure = now
            metric.last_error = error
            
            self._overall.total_transitions += 1
            self._overall.total_failures += 1
            
            if is_conflict:
                self._overall.total_conflicts += 1
            
            # Add to error log
            self._error_log.append((now, key, error))
            if len(self._error_log) > self._max_error_log:
                self._error_log = self._error_log[-self._max_error_log:]
    
    def get_metrics(self) -> Dict:
        """
        Get all metrics in a structured format.
        
        Returns:
            Dict with overall and per-transition metrics
        """
        with self._metrics_lock:
            uptime = (
                datetime.now(timezone.utc) - self._overall.start_time
            ).total_seconds()
            
            transitions = []
            total_duration = 0.0
            total_with_duration = 0
            
            for key, metric in self._transition_metrics.items():
                avg_duration = (
                    metric.total_duration_ms / metric.success_count
                    if metric.success_count > 0 else 0
                )
                
                transitions.append({
                    "entity_type": metric.entity_type,
                    "from_status": metric.from_status,
                    "to_status": metric.to_status,
                    "action": metric.action,
                    "success_count": metric.success_count,
                    "failure_count": metric.failure_count,
                    "avg_duration_ms": round(avg_duration, 2),
                    "last_success": metric.last_success.isoformat() if metric.last_success else None,
                    "last_failure": metric.last_failure.isoformat() if metric.last_failure else None,
                    "last_error": metric.last_error,
                })
                
                total_duration += metric.total_duration_ms
                total_with_duration += metric.success_count
            
            overall_avg = (
                total_duration / total_with_duration
                if total_with_duration > 0 else 0
            )
            
            return {
                "overall": {
                    "total_transitions": self._overall.total_transitions,
                    "total_successes": self._overall.total_successes,
                    "total_failures": self._overall.total_failures,
                    "total_conflicts": self._overall.total_conflicts,
                    "success_rate": (
                        round(self._overall.total_successes / self._overall.total_transitions * 100, 2)
                        if self._overall.total_transitions > 0 else 100.0
                    ),
                    "avg_duration_ms": round(overall_avg, 2),
                    "uptime_seconds": round(uptime, 1),
                    "start_time": self._overall.start_time.isoformat(),
                },
                "transitions": sorted(
                    transitions,
                    key=lambda x: x["success_count"] + x["failure_count"],
                    reverse=True
                ),
                "recent_errors": [
                    {
                        "timestamp": ts.isoformat(),
                        "transition": key,
                        "error": error,
                    }
                    for ts, key, error in self._error_log[-10:]
                ],
            }
    
    def get_prometheus_metrics(self) -> str:
        """
        Export metrics in Prometheus text format.
        
        Returns:
            Prometheus-compatible metrics string
        """
        lines = []
        
        with self._metrics_lock:
            # Overall counters
            lines.append("# HELP workflow_transitions_total Total number of workflow transitions")
            lines.append("# TYPE workflow_transitions_total counter")
            lines.append(f"workflow_transitions_total {self._overall.total_transitions}")
            
            lines.append("# HELP workflow_transitions_success_total Successful transitions")
            lines.append("# TYPE workflow_transitions_success_total counter")
            lines.append(f"workflow_transitions_success_total {self._overall.total_successes}")
            
            lines.append("# HELP workflow_transitions_failure_total Failed transitions")
            lines.append("# TYPE workflow_transitions_failure_total counter")
            lines.append(f"workflow_transitions_failure_total {self._overall.total_failures}")
            
            lines.append("# HELP workflow_conflicts_total Concurrency conflicts")
            lines.append("# TYPE workflow_conflicts_total counter")
            lines.append(f"workflow_conflicts_total {self._overall.total_conflicts}")
            
            # Per-transition metrics
            lines.append("# HELP workflow_transition_count Transitions by type")
            lines.append("# TYPE workflow_transition_count counter")
            
            for key, metric in self._transition_metrics.items():
                labels = (
                    f'entity="{metric.entity_type}",'
                    f'from="{metric.from_status}",'
                    f'to="{metric.to_status}",'
                    f'action="{metric.action}"'
                )
                lines.append(
                    f'workflow_transition_count{{{labels},result="success"}} {metric.success_count}'
                )
                lines.append(
                    f'workflow_transition_count{{{labels},result="failure"}} {metric.failure_count}'
                )
            
            # Duration histogram (simplified)
            lines.append("# HELP workflow_transition_duration_ms Transition duration")
            lines.append("# TYPE workflow_transition_duration_ms gauge")
            
            for key, metric in self._transition_metrics.items():
                if metric.success_count > 0:
                    avg = metric.total_duration_ms / metric.success_count
                    labels = (
                        f'entity="{metric.entity_type}",'
                        f'from="{metric.from_status}",'
                        f'to="{metric.to_status}",'
                        f'action="{metric.action}"'
                    )
                    lines.append(f'workflow_transition_duration_ms{{{labels}}} {avg:.2f}')
        
        return "\n".join(lines)
    
    def reset(self) -> None:
        """Reset all metrics (for testing)."""
        with self._metrics_lock:
            self._transition_metrics.clear()
            self._overall = OverallMetrics()
            self._error_log.clear()


# =============================================================================
# CONTEXT MANAGER FOR TIMED TRANSITIONS
# =============================================================================

class TransitionTimer:
    """
    Context manager to time and record workflow transitions.
    
    Usage:
        with TransitionTimer(collector, "requisition", "DRAFT", "PENDING_BUDGET", "SUBMIT") as timer:
            # perform transition
            pass
        # Metrics automatically recorded
    """
    
    def __init__(
        self,
        collector: WorkflowMetricsCollector,
        entity_type: str,
        from_status: str,
        to_status: str,
        action: str,
    ):
        self.collector = collector
        self.entity_type = entity_type
        self.from_status = from_status
        self.to_status = to_status
        self.action = action
        self.start_time = None
        self.success = True
        self.error = None
        self.is_conflict = False
    
    def __enter__(self):
        self.start_time = time.perf_counter()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = (time.perf_counter() - self.start_time) * 1000
        
        if exc_type is not None:
            self.success = False
            self.error = str(exc_val)
            
            # Check if it's a concurrency conflict
            from services.requisition.workflow_exceptions import ConcurrencyConflictException
            self.is_conflict = isinstance(exc_val, ConcurrencyConflictException)
            
            self.collector.record_failure(
                entity_type=self.entity_type,
                from_status=self.from_status,
                to_status=self.to_status,
                action=self.action,
                error=self.error,
                is_conflict=self.is_conflict,
            )
        else:
            self.collector.record_success(
                entity_type=self.entity_type,
                from_status=self.from_status,
                to_status=self.to_status,
                action=self.action,
                duration_ms=duration_ms,
            )
        
        # Don't suppress exceptions
        return False
    
    def mark_failure(self, error: str, is_conflict: bool = False):
        """Manually mark transition as failed (without exception)."""
        self.success = False
        self.error = error
        self.is_conflict = is_conflict


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

def get_workflow_metrics() -> Dict:
    """Get current workflow metrics."""
    return WorkflowMetricsCollector.get_instance().get_metrics()


def get_prometheus_metrics() -> str:
    """Get Prometheus-formatted metrics."""
    return WorkflowMetricsCollector.get_instance().get_prometheus_metrics()


def reset_workflow_metrics() -> None:
    """Reset all workflow metrics (for testing)."""
    WorkflowMetricsCollector.get_instance().reset()


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    'TransitionMetric',
    'OverallMetrics',
    'WorkflowMetricsCollector',
    'TransitionTimer',
    'get_workflow_metrics',
    'get_prometheus_metrics',
    'reset_workflow_metrics',
]
