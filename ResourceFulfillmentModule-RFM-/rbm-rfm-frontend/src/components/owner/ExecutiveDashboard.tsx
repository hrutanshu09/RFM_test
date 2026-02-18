import React from "react";

const ExecutiveDashboard: React.FC = () => {
  return (
    <>
      <div className="manager-header">
        <h2>Executive Dashboard</h2>
        <p className="subtitle">High-level resource fulfillment KPIs</p>
      </div>
      <div className="admin-metrics">
        <div className="stat-card">
          <span className="stat-number">86%</span>
          <span className="stat-label">Utilization</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">24</span>
          <span className="stat-label">Open Requisitions</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">12</span>
          <span className="stat-label">Avg Time to Fill (Days)</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">5</span>
          <span className="stat-label">Pending Approvals</span>
        </div>
      </div>
    </>
  );
};

export default ExecutiveDashboard;
