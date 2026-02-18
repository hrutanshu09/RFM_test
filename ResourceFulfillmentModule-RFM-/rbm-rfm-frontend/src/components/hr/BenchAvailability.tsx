// components/hr/BenchAvailability.tsx
import React from "react";

interface BenchEmployee {
  empId: string;
  name: string;
  department: string;
  benchSince: string;
  benchDays: number;
  skills: string[];
  availability: number;
}

const benchEmployees: BenchEmployee[] = [
  {
    empId: "RBM-021",
    name: "Ankit Mehta",
    department: "Engineering",
    benchSince: "2024-12-10",
    benchDays: 45,
    skills: ["React", "TypeScript", "Node.js"],
    availability: 100,
  },
  {
    empId: "RBM-034",
    name: "Pooja Nair",
    department: "QA",
    benchSince: "2025-01-02",
    benchDays: 22,
    skills: ["Automation", "Selenium", "Jest"],
    availability: 80,
  },
];

const BenchAvailability: React.FC = () => {
  return (
    <>
      {/* Page Header
      <div className="manager-header">
        <h2>Bench & Availability</h2>
        <p className="subtitle">
          View active employees who are currently unassigned and available.
        </p>
      </div> */}

      {/* Filters */}
      <div className="log-filters">
        <div className="filter-grid">
          <div className="filter-item">
            <label>Department</label>
            <select>
              <option value="">All</option>
              <option>Engineering</option>
              <option>QA</option>
              <option>HR</option>
            </select>
          </div>

          <div className="filter-item">
            <label>Availability</label>
            <select>
              <option value="">All</option>
              <option>100%</option>
              <option>80%+</option>
              <option>Below 80%</option>
            </select>
          </div>
        </div>
      </div>

      {/* Bench Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Bench Duration</th>
              <th>Skills</th>
              <th>Availability</th>
            </tr>
          </thead>

          <tbody>
            {benchEmployees.map((emp) => (
              <tr key={emp.empId}>
                <td>
                  <strong>{emp.name}</strong>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    {emp.empId}
                  </div>
                </td>

                <td>{emp.department}</td>

                <td>
                  {emp.benchDays} days
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    Since {emp.benchSince}
                  </div>
                </td>

                <td>{emp.skills.join(", ")}</td>

                <td>
                  <span className="status-badge active">
                    {emp.availability}%
                  </span>
                </td>
              </tr>
            ))}

            {benchEmployees.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state">
                    No employees are currently on bench.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default BenchAvailability;
