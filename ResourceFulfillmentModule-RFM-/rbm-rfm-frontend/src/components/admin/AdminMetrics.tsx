import React, { useEffect, useMemo, useState } from "react";
import { Users, Database, Shield, CheckCircle } from "lucide-react";
import { apiClient } from "../../api/client";

type OverviewResponse = {
  total_users: number;
  total_employees: number;
  total_skills: number;
  total_locations: number;
  total_departments: number;
  roles_breakdown: Record<string, number>;
};

const AdminMetrics: React.FC = () => {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const response =
          await apiClient.get<OverviewResponse>("/admin/overview");
        setOverview(response.data);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load overview";
        setError(message);
      }
    };

    loadOverview();
  }, []);

  const metrics = [
    {
      key: "total-users",
      label: "Total System Users",
      value: overview?.total_users ?? 0,
      icon: <Users size={20} />,
    },
    {
      key: "total-employees",
      label: "Total Employees",
      value: overview?.total_employees ?? 0,
      icon: <Shield size={20} />,
    },
    {
      key: "total-skills",
      label: "Total Skills",
      value: overview?.total_skills ?? 0,
      icon: <Database size={20} />,
    },
    {
      key: "total-locations",
      label: "Total Locations / Offices",
      value: overview?.total_locations ?? 0,
      icon: <CheckCircle size={20} />,
    },
    {
      key: "total-departments",
      label: "Total Departments",
      value: overview?.total_departments ?? 0,
      icon: <Database size={20} />,
    },
  ];

  const roleEntries = useMemo(() => {
    if (!overview?.roles_breakdown) {
      return [];
    }
    return Object.entries(overview.roles_breakdown).sort((a, b) => b[1] - a[1]);
  }, [overview]);

  return (
    <div className="admin-metrics">
      {metrics.map((metric) => (
        <div className="stat-card" key={metric.key}>
          <div className={`stat-icon-wrapper ${metric.key}`}>{metric.icon}</div>
          <span className="stat-number">{metric.value}</span>
          <span className="stat-label">{metric.label}</span>
        </div>
      ))}
      <div className="stat-card role-distribution-card">
        <div className="stat-icon-wrapper roles">
          <Users size={20} />
        </div>
        <span className="stat-number">{roleEntries.length}</span>
        <span className="stat-label">Role Distribution</span>
        {error && <p className="metric-error">{error}</p>}
        {!error && roleEntries.length === 0 && (
          <p className="metric-empty">No role data available</p>
        )}
        {!error && roleEntries.length > 0 && (
          <ul className="role-breakdown">
            {roleEntries.map(([role, count]) => (
              <li key={role}>
                <span className="role-name">{role}</span>
                <span className="role-count">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AdminMetrics;
