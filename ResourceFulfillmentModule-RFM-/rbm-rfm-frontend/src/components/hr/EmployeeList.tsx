import React, { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../api/client";

interface EmployeeListEntry {
  emp_id: string;
  full_name: string;
  user_id?: number | null;
}

interface EmployeeDetail {
  emp_id: string;
  full_name: string;
  rbm_email: string;
  emp_status: string;
}

interface EmployeeSkillEntry {
  skill_id: number;
  emp_id: string;
}

interface AssignmentEntry {
  assignment_id: number;
  department_id: number;
  start_date: string;
  end_date?: string | null;
}

interface DepartmentEntry {
  department_id: number;
  department_name: string;
}

interface EmployeeRow {
  empId: string;
  name: string;
  status: string;
  department: string;
  skillsCount: number;
  profileComplete?: number | null;
}

const EmployeeList: React.FC = () => {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

  useEffect(() => {
    let isMounted = true;

    const fetchEmployees = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [employeesResponse, departmentsResponse] = await Promise.all([
          apiClient.get<EmployeeListEntry[]>("/employees/employees"),
          apiClient.get<DepartmentEntry[]>("/departments/"),
        ]);

        const departmentsById = new Map(
          (departmentsResponse.data ?? []).map((dept) => [
            dept.department_id,
            dept.department_name,
          ]),
        );

        const list = employeesResponse.data ?? [];

        const rows = await Promise.all(
          list.map(async (emp) => {
            const [detailResponse, skillsResponse, assignmentsResponse] =
              await Promise.all([
                apiClient.get<EmployeeDetail>(`/employees/${emp.emp_id}`),
                apiClient.get<EmployeeSkillEntry[]>(
                  `/employees/${emp.emp_id}/skills/`,
                ),
                apiClient.get<AssignmentEntry[]>(
                  `/employees/${emp.emp_id}/assignments`,
                ),
              ]);

            const assignments = assignmentsResponse.data ?? [];
            const latestAssignment = assignments[0];
            const departmentName = latestAssignment?.department_id
              ? (departmentsById.get(latestAssignment.department_id) ?? "—")
              : "—";

            const detail = detailResponse.data;
            const skillsCount = skillsResponse.data?.length ?? 0;

            return {
              empId: detail.emp_id,
              name: detail.full_name,
              status: detail.emp_status ?? "—",
              department: departmentName,
              skillsCount,
              profileComplete: null,
            } as EmployeeRow;
          }),
        );

        if (isMounted) {
          setEmployees(rows);
        }
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load employees";
        setError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchEmployees();

    return () => {
      isMounted = false;
    };
  }, []);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(employees.map((emp) => emp.status))).filter(
      Boolean,
    );
  }, [employees]);

  const departmentOptions = useMemo(() => {
    return Array.from(new Set(employees.map((emp) => emp.department))).filter(
      (dept) => dept && dept !== "—",
    );
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (statusFilter && emp.status !== statusFilter) return false;
      if (departmentFilter && emp.department !== departmentFilter) return false;
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        return (
          emp.name.toLowerCase().includes(query) ||
          emp.empId.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [employees, statusFilter, departmentFilter, searchTerm]);

  return (
    <>
      {/* Page Header
      <div className="manager-header">
        <h2>Employees</h2>
        <p className="subtitle">
          View and manage all employees across their lifecycle.
        </p>
      </div> */}

      {/* Filters & Search */}
      <div className="log-filters">
        <div className="filter-group">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search by name or employee ID..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </div>

        <div className="filter-grid">
          <div className="filter-item">
            <label>Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-item">
            <label>Department</label>
            <select
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
            >
              <option value="">All</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Employee Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Skills</th>
              <th>Status</th>
              <th>Profile</th>
            </tr>
          </thead>

          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5}>
                  <div className="tickets-empty-state">Loading employees…</div>
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <tr>
                <td colSpan={5}>
                  <div
                    className="tickets-empty-state"
                    style={{ color: "var(--error)" }}
                  >
                    {error}
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !error && filteredEmployees.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="tickets-empty-state">No employees found</div>
                </td>
              </tr>
            )}

            {!isLoading &&
              !error &&
              filteredEmployees.map((emp) => (
                <tr key={emp.empId}>
                  <td>
                    <strong>{emp.name}</strong>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      {emp.empId}
                    </div>
                  </td>

                  <td>{emp.department}</td>

                  <td>{emp.skillsCount}</td>

                  <td>
                    <span
                      className={`status-badge ${
                        emp.status === "Active" ? "active" : "inactive"
                      }`}
                    >
                      {emp.status}
                    </span>
                  </td>

                  <td>
                    {typeof emp.profileComplete === "number"
                      ? `${emp.profileComplete}%`
                      : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default EmployeeList;
