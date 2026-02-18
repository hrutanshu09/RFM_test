/**
 * ============================================================================
 * RoleGuard — Role-Based Access Control Component
 * ============================================================================
 *
 * Centralized component for conditional rendering based on user roles.
 * Works with AuthContext to show/hide UI elements based on permissions.
 *
 * USAGE:
 *   <RoleGuard roles={["hr", "admin"]}>
 *     <ApproveButton />
 *   </RoleGuard>
 *
 *   <RoleGuard roles={["ta"]} fallback={<span>Not authorized</span>}>
 *     <AssignButton />
 *   </RoleGuard>
 */

import React from "react";
import { useAuth } from "../../contexts/useAuth";

export type UserRole = "admin" | "owner" | "hr" | "ta" | "manager";

export interface RoleGuardProps {
  /** Roles that are allowed to see the children. User must have at least one. */
  roles: UserRole[];
  /** Optional fallback content when user lacks required roles. */
  fallback?: React.ReactNode;
  /** Content to render when user has required role(s). */
  children: React.ReactNode;
  /** If true, user must have ALL specified roles. Default: false (any match). */
  requireAll?: boolean;
}

/**
 * Check if user has at least one of the required roles.
 */
export function hasAnyRole(
  userRoles: string[] | undefined,
  requiredRoles: UserRole[],
): boolean {
  if (!userRoles || userRoles.length === 0) return false;
  const normalizedUserRoles = userRoles.map((r) => r.toLowerCase());
  return requiredRoles.some((role) =>
    normalizedUserRoles.includes(role.toLowerCase()),
  );
}

/**
 * Check if user has ALL of the required roles.
 */
export function hasAllRoles(
  userRoles: string[] | undefined,
  requiredRoles: UserRole[],
): boolean {
  if (!userRoles || userRoles.length === 0) return false;
  const normalizedUserRoles = userRoles.map((r) => r.toLowerCase());
  return requiredRoles.every((role) =>
    normalizedUserRoles.includes(role.toLowerCase()),
  );
}

/**
 * RoleGuard Component
 *
 * Conditionally renders children based on user roles from AuthContext.
 */
export const RoleGuard: React.FC<RoleGuardProps> = ({
  roles,
  fallback = null,
  children,
  requireAll = false,
}) => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return <>{fallback}</>;
  }

  const hasAccess = requireAll
    ? hasAllRoles(user.roles, roles)
    : hasAnyRole(user.roles, roles);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

/**
 * Hook to check if current user has specific roles.
 * Useful for conditional logic outside of JSX.
 */
export function useRoleCheck() {
  const { user, isAuthenticated } = useAuth();

  return {
    /**
     * Check if user has any of the specified roles.
     */
    hasRole: (...roles: UserRole[]): boolean => {
      if (!isAuthenticated || !user) return false;
      return hasAnyRole(user.roles, roles);
    },

    /**
     * Check if user has ALL of the specified roles.
     */
    hasAllRoles: (...roles: UserRole[]): boolean => {
      if (!isAuthenticated || !user) return false;
      return hasAllRoles(user.roles, roles);
    },

    /**
     * Check if user is a manager.
     */
    isManager: (): boolean => hasAnyRole(user?.roles, ["manager"]),

    /**
     * Check if user is HR.
     */
    isHR: (): boolean => hasAnyRole(user?.roles, ["hr"]),

    /**
     * Check if user is TA.
     */
    isTA: (): boolean => hasAnyRole(user?.roles, ["ta"]),

    /**
     * Check if user is admin or owner.
     */
    isAdmin: (): boolean => hasAnyRole(user?.roles, ["admin", "owner"]),

    /**
     * Get user's roles as lowercase array.
     */
    roles: user?.roles?.map((r) => r.toLowerCase()) ?? [],

    /**
     * Current user ID.
     */
    userId: user?.user_id ?? null,
  };
}

export default RoleGuard;
