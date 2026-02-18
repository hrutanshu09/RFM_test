import React from "react";

/* ======================================================
   Types
   ====================================================== */

interface TAMetric {
  label: string;
  value: string | number;
  variant: "success" | "warning" | "neutral";
}

interface TAAssigneePerformance {
  taName: string;
  requisitionsHandled: number;
  avgFulfillmentDays: number;
  slaAdherencePct: number;
}

interface FulfillmentRatio {
  internal: number;
  external: number;
}

/* ======================================================
   Mock Data (Replace with API later)
   ====================================================== */

const taMetrics: TAMetric[] = [
  {
    label: "Average Fulfillment Time (Days)",
    value: 11.8,
    variant: "neutral",
  },
  {
    label: "SLA Adherence",
    value: "92%",
    variant: "success",
  },
  {
    label: "Requisitions Closed (30 Days)",
    value: 48,
    variant: "neutral",
  },
  {
    label: "SLA Breaches",
    value: 3,
    variant: "warning",
  },
];

const taPerformanceData: TAAssigneePerformance[] = [
  {
    taName: "Rahul Mehta",
    requisitionsHandled: 16,
    avgFulfillmentDays: 10.4,
    slaAdherencePct: 94,
  },
  {
    taName: "Anita Sharma",
    requisitionsHandled: 21,
    avgFulfillmentDays: 11.9,
    slaAdherencePct: 91,
  },
  {
    taName: "Kunal Verma",
    requisitionsHandled: 11,
    avgFulfillmentDays: 13.2,
    slaAdherencePct: 87,
  },
];

const fulfillmentRatio: FulfillmentRatio = {
  internal: 68,
  external: 32,
};

/* ======================================================
   Component
   ====================================================== */

const TAReports: React.FC = () => {
  return (
    <>
      {/* Header */}
      <div className="manager-header">
        <h2>TA Performance & Reports</h2>
        <p className="subtitle">
          Efficiency, SLA adherence, and fulfillment insights
        </p>
      </div>

      {/* KPI Metrics */}
      <div className="tickets-kpi-grid">
        {taMetrics.map((metric) => (
          <div
            key={metric.label}
            className={`ticket-kpi-card ${metric.variant}`}
          >
            <div className="kpi-number">{metric.value}</div>
            <div className="kpi-label">{metric.label}</div>
          </div>
        ))}
      </div>

      {/* TA Performance Table */}
      <div className="stat-card" style={{ marginTop: 28 }}>
        <div className="data-manager-header">
          <h3>Requisitions per TA</h3>
          <p className="subtitle">Individual TA workload and efficiency</p>
        </div>

        <div className="ticket-table-container">
          <table className="ticket-table">
            <thead>
              <tr>
                <th>TA Name</th>
                <th>Requisitions Handled</th>
                <th>Avg Fulfillment (Days)</th>
                <th>SLA Adherence</th>
              </tr>
            </thead>

            <tbody>
              {taPerformanceData.map((ta) => (
                <tr key={ta.taName}>
                  <td>
                    <strong>{ta.taName}</strong>
                  </td>
                  <td>{ta.requisitionsHandled}</td>
                  <td>{ta.avgFulfillmentDays}</td>
                  <td>
                    <span
                      className={`status-badge ${
                        ta.slaAdherencePct >= 90 ? "active" : "inactive"
                      }`}
                    >
                      {ta.slaAdherencePct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Internal vs External Fulfillment */}
      <div className="stat-card" style={{ marginTop: 28 }}>
        <div className="data-manager-header">
          <h3>Fulfillment Source Ratio</h3>
          <p className="subtitle">Internal bench vs external hiring</p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 16,
          }}
        >
          <div className="stat-card" style={{ flex: 1 }}>
            <span className="stat-number">{fulfillmentRatio.internal}%</span>
            <span className="stat-label">Internal Fulfillment</span>
          </div>

          <div className="stat-card" style={{ flex: 1 }}>
            <span className="stat-number">{fulfillmentRatio.external}%</span>
            <span className="stat-label">External Hiring</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default TAReports;
