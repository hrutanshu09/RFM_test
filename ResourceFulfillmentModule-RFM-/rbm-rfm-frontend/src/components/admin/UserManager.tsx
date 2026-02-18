import React, { useEffect, useMemo, useState } from "react";
import { Users, Edit, Plus, Power, Search } from "lucide-react";
import { fetchUsers, updateUser, AdminUser, createUser } from "../../api/users";
import { fetchEmployees, EmployeeOption } from "../../api/employees";

const defaultRoleOptions = ["Admin", "Owner", "HR", "Manager", "Employee", "TA"];

const UserManager: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("Employee");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const roleOptions = useMemo(() => {
    const roleSet = new Set(defaultRoleOptions);
    users.forEach((user) => user.roles.forEach((role) => roleSet.add(role)));
    return Array.from(roleSet);
  }, [users]);

  const filteredEmployees = useMemo(() => {
    if (!employeeSearch.trim()) {
      return employees;
    }
    const term = employeeSearch.toLowerCase();
    return employees.filter(
      (emp) =>
        emp.emp_id.toLowerCase().includes(term) ||
        emp.full_name.toLowerCase().includes(term),
    );
  }, [employees, employeeSearch]);

  const loadUsers = async (search?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchUsers(search);
      setUsers(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load users";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadEmployees = async () => {
    try {
      const data = await fetchEmployees();
      setEmployees(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load employees";
      setError(message);
    }
  };

  useEffect(() => {
    loadUsers();
    loadEmployees();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadUsers(searchTerm.trim() || undefined);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const handleEdit = (user: AdminUser) => {
    setEditingUser(user);
    setSelectedRoles(user.roles.length ? user.roles : ["Employee"]);
    setSelectedEmployeeId(user.employee?.id ?? "");
    setIsActive(user.is_active);
    setShowEditModal(true);
  };

  const isDirty = useMemo(() => {
    if (!editingUser) {
      return false;
    }
    const initialRoles = editingUser.roles;
    const rolesChanged =
      initialRoles.length !== selectedRoles.length ||
      initialRoles.some((role) => !selectedRoles.includes(role));
    const employeeChanged =
      (editingUser.employee?.id ?? "") !== selectedEmployeeId;
    const statusChanged = editingUser.is_active !== isActive;
    return rolesChanged || employeeChanged || statusChanged;
  }, [editingUser, selectedRoles, selectedEmployeeId, isActive]);

  const resetCreateForm = () => {
    setNewUsername("");
    setNewPassword("");
    setNewRole("Employee");
    setCreateError(null);
  };

  const handleOpenCreate = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim()) {
      setCreateError("Username is required.");
      return;
    }
    if (!newPassword.trim()) {
      setCreateError("Password is required.");
      return;
    }
    if (!newRole) {
      setCreateError("Role is required.");
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
      });
      await loadUsers();
      setShowCreateModal(false);
      resetCreateForm();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create user";
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSave = async () => {
    if (!editingUser) {
      return;
    }

    if (selectedRoles.length === 0) {
      setError("At least one role must be selected.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await updateUser(editingUser.user_id, {
        roles: selectedRoles,
        employee_id: selectedEmployeeId || null,
        is_active: isActive,
      });
      await loadUsers();
      setShowEditModal(false);
      setEditingUser(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update user";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleStatus = async (user: AdminUser) => {
    setIsLoading(true);
    setError(null);
    try {
      await updateUser(user.user_id, {
        is_active: !user.is_active,
      });
      await loadUsers();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update status";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="user-management-container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2>User Management</h2>
          {error && <p style={{ color: "#ef4444" }}>{error}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className="search-box" style={{ minWidth: "240px" }}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={handleOpenCreate}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "#4f46e5",
              color: "white",
              border: "none",
              padding: "8px 16px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            <Plus size={18} /> Create User
          </button>
        </div>
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Employee</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="table-loading">
                  Loading users...
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.user_id}>
                <td>{user.user_id}</td>
                <td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        background: "#e5e7eb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Users size={16} color="#6b7280" />
                    </div>
                    {user.username}
                  </div>
                </td>
                <td>
                  {user.employee ? (
                    <div>
                      <div>{user.employee.id}</div>
                      <small>{user.employee.name ?? "-"}</small>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{user.roles.join(", ") || "-"}</td>
                <td>
                  <span
                    className={`status-badge ${user.is_active ? "active" : "inactive"}`}
                  >
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="action-button edit"
                      title="Edit User"
                      onClick={() => handleEdit(user)}
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      className="action-button"
                      title={
                        user.is_active ? "Deactivate User" : "Activate User"
                      }
                      onClick={() => handleToggleStatus(user)}
                    >
                      <Power size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && users.length === 0 && (
          <div className="empty-state">
            <p>No users found.</p>
          </div>
        )}
      </div>

      {showEditModal && editingUser && (
        <div className="modal-overlay">
          <div className="modal-content edit-user-modal">
            <div className="modal-header">
              <div>
                <h3>Edit User</h3>
                <p className="modal-subtitle">
                  Update identity, employee link, roles, and account status
                </p>
              </div>
              <button
                className="close-button"
                onClick={() => {
                  setShowEditModal(false);
                  setEditingUser(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body edit-user-body">
              <div className="edit-user-section">
                <div className="section-header">
                  <h4>Identity</h4>
                  <p>Read-only account identity</p>
                </div>
                <div className="form-group">
                  <label>Username</label>
                  <input type="text" value={editingUser.username} disabled />
                </div>
              </div>

              <div className="edit-user-section">
                <div className="section-header">
                  <h4>Employee Link</h4>
                  <p>Search and associate a single employee</p>
                </div>
                <div className="form-group">
                  <label>Search Employee</label>
                  <input
                    type="text"
                    placeholder="Search by name or ID"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Select Employee</label>
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  >
                    <option value="">Unlinked</option>
                    {filteredEmployees.map((emp) => (
                      <option
                        key={emp.emp_id}
                        value={emp.emp_id}
                        disabled={Boolean(
                          emp.user_id && emp.emp_id !== selectedEmployeeId,
                        )}
                      >
                        {emp.emp_id} - {emp.full_name}
                        {emp.user_id && emp.emp_id !== selectedEmployeeId
                          ? " (linked)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="edit-user-section">
                <div className="section-header">
                  <h4>Roles & Permissions</h4>
                  <p>Select one or more roles for this account</p>
                </div>
                <div className="role-grid">
                  {roleOptions.map((role) => (
                    <label key={role} className="role-option">
                      <input
                        type="checkbox"
                        checked={selectedRoles.includes(role)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedRoles((prev) => [...prev, role]);
                          } else {
                            setSelectedRoles((prev) =>
                              prev.filter((r) => r !== role),
                            );
                          }
                        }}
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="edit-user-section">
                <div className="section-header">
                  <h4>Account Status</h4>
                  <p>Control access without deleting the account</p>
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={isActive ? "active" : "inactive"}
                    onChange={(e) => setIsActive(e.target.value === "active")}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="cancel-button"
                onClick={() => {
                  setShowEditModal(false);
                  setEditingUser(null);
                }}
              >
                Cancel
              </button>
              <button
                className="save-button"
                onClick={handleSave}
                disabled={!isDirty || isLoading}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content edit-user-modal">
            <div className="modal-header">
              <div>
                <h3>Create User</h3>
                <p className="modal-subtitle">
                  Create a new login with an initial role
                </p>
              </div>
              <button
                className="close-button"
                onClick={() => {
                  setShowCreateModal(false);
                  resetCreateForm();
                }}
              >
                ×
              </button>
            </div>

            <div className="modal-body edit-user-body">
              <div className="edit-user-section">
                <div className="section-header">
                  <h4>Account Details</h4>
                  <p>Set username, password and primary role</p>
                </div>
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Enter username"
                  />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter temporary password"
                  />
                </div>
                <div className="form-group">
                  <label>Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                  >
                    <option value="">Select role</option>
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
                {createError && (
                  <p style={{ color: "#ef4444", marginTop: "8px" }}>
                    {createError}
                  </p>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="cancel-button"
                onClick={() => {
                  setShowCreateModal(false);
                  resetCreateForm();
                }}
              >
                Cancel
              </button>
              <button
                className="save-button"
                onClick={handleCreateUser}
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManager;
