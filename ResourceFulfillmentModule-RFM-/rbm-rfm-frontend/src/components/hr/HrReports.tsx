// components/hr/HrReports.tsx
import React, { useState } from "react";

type ReportType = "headcount" | "onboarding" | "skills" | "bench";

const HrReports: React.FC = () => {
  const [reportType, setReportType] = useState<ReportType>("headcount");

  /* ================= MOCK DATA ================= */

  const headcountData = [
    { label: "Active", count: 82 },
    { label: "Onboarding", count: 12 },
    { label: "Exited", count: 9 },
  ];

  const onboardingData = [
    {
      name: "Amit Sharma",
      doj: "2024-01-10",
      start: "2024-01-10",
      completed: "2024-01-25",
      days: 15,
    },
    {
      name: "Neha Verma",
      doj: "2024-02-01",
      start: "2024-02-01",
      completed: "",
      days: 28,
    },
  ];

  const skillsData = [
    {
      skill: "React",
      total: 18,
      junior: 6,
      mid: 8,
      senior: 4,
    },
    {
      skill: "Python",
      total: 7,
      junior: 3,
      mid: 2,
      senior: 2,
    },
  ];

  const benchData = [
    {
      name: "Rohit Kulkarni",
      skill: "React",
      benchSince: "2024-12-01",
      days: 45,
      availability: "100%",
    },
    {
      name: "Pooja Nair",
      skill: "QA Automation",
      benchSince: "2025-01-05",
      days: 21,
      availability: "80%",
    },
  ];

  /* ================= RENDERERS ================= */

  const renderSummary = () => {
    switch (reportType) {
      case "headcount":
        return (
          <div className="admin-metrics">
            {headcountData.map((h) => (
              <div key={h.label} className="stat-card">
                <span className="stat-number">{h.count}</span>
                <span className="stat-label">{h.label}</span>
              </div>
            ))}
          </div>
        );

      case "onboarding":
        return (
          <div className="admin-metrics">
            <div className="stat-card">
              <span className="stat-number">18 days</span>
              <span className="stat-label">Avg Onboarding</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">2</span>
              <span className="stat-label">Stuck &gt; 30 days</span>
            </div>
          </div>
        );

      case "skills":
        return (
          <div className="admin-metrics">
            <div className="stat-card">
              <span className="stat-number">24</span>
              <span className="stat-label">Total Skills</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">5</span>
              <span className="stat-label">Critical Gaps</span>
            </div>
          </div>
        );

      case "bench":
        return (
          <div className="admin-metrics">
            <div className="stat-card">
              <span className="stat-number">14</span>
              <span className="stat-label">On Bench</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">4</span>
              <span className="stat-label">&gt; 60 Days</span>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const renderTable = () => {
    switch (reportType) {
      case "headcount":
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Employee Count</th>
              </tr>
            </thead>
            <tbody>
              {headcountData.map((h) => (
                <tr key={h.label}>
                  <td>{h.label}</td>
                  <td>{h.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );

      case "onboarding":
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>DOJ</th>
                <th>Start</th>
                <th>Completed</th>
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
              {onboardingData.map((o) => (
                <tr key={o.name}>
                  <td>{o.name}</td>
                  <td>{o.doj}</td>
                  <td>{o.start}</td>
                  <td>{o.completed || "In Progress"}</td>
                  <td>{o.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );

      case "skills":
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Total</th>
                <th>Junior</th>
                <th>Mid</th>
                <th>Senior</th>
              </tr>
            </thead>
            <tbody>
              {skillsData.map((s) => (
                <tr key={s.skill}>
                  <td>{s.skill}</td>
                  <td>{s.total}</td>
                  <td>{s.junior}</td>
                  <td>{s.mid}</td>
                  <td>{s.senior}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );

      case "bench":
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Primary Skill</th>
                <th>Bench Since</th>
                <th>Days</th>
                <th>Availability</th>
              </tr>
            </thead>
            <tbody>
              {benchData.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td>{b.skill}</td>
                  <td>{b.benchSince}</td>
                  <td>{b.days}</td>
                  <td>{b.availability}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Header
      <div className="manager-header">
        <h2>HR Reports</h2>
        <p className="subtitle">
          Analytical reports for workforce visibility and decision-making.
        </p>
      </div> */}

      {/* Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          gap: "24px",
        }}
      >
        {/* Left Selector */}
        <div className="master-data-manager">
          <button
            className="control-button"
            onClick={() => setReportType("headcount")}
          >
            Headcount
          </button>
          <button
            className="control-button"
            onClick={() => setReportType("onboarding")}
          >
            Onboarding Duration
          </button>
          <button
            className="control-button"
            onClick={() => setReportType("skills")}
          >
            Skill Coverage
          </button>
          <button
            className="control-button"
            onClick={() => setReportType("bench")}
          >
            Bench Aging
          </button>
        </div>

        {/* Main Area */}
        <div>
          {renderSummary()}

          <div className="log-filters" style={{ marginTop: "24px" }}>
            <div className="filter-grid">
              <div className="filter-item">
                <label>Date Range</label>
                <input type="date" />
              </div>
              <div className="filter-item">
                <label>Status</label>
                <select>
                  <option>All</option>
                </select>
              </div>
            </div>
          </div>

          <div className="data-table-container" style={{ marginTop: "16px" }}>
            {renderTable()}
          </div>

          {/* Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "16px",
            }}
          >
            <button className="action-button">Export CSV</button>
            <button className="action-button">Export Excel</button>
          </div>
        </div>
      </div>
    </>
  );
};

export default HrReports;
