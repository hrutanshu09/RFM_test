// components/hr/HRDashboard.tsx
import React, { useState, useEffect } from "react";
import {
  Users,
  UserCheck,
  UserPlus,
  Clock,
  TrendingUp,
  AlertCircle,
  Calendar,
  ArrowUpRight,
} from "lucide-react";

interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  onboardingEmployees: number;
  benchEmployees: number;
  exitedEmployees: number;
  avgOnboardingTime: number; // days
  pendingActions: number;
}

const HRDashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats>({
    totalEmployees: 245,
    activeEmployees: 180,
    onboardingEmployees: 25,
    benchEmployees: 15,
    exitedEmployees: 25,
    avgOnboardingTime: 14,
    pendingActions: 8,
  });

  const [recentOnboarding, setRecentOnboarding] = useState([
    {
      id: 1,
      name: "Rajesh Kumar",
      department: "Engineering",
      daysRemaining: 3,
    },
    { id: 2, name: "Priya Sharma", department: "Marketing", daysRemaining: 5 },
    { id: 3, name: "Amit Patel", department: "Sales", daysRemaining: 1 },
  ]);

  const [upcomingActions, setUpcomingActions] = useState([
    {
      id: 1,
      type: "Probation Review",
      employee: "John Doe",
      date: "2024-01-15",
    },
    {
      id: 2,
      type: "Appraisal Due",
      employee: "Jane Smith",
      date: "2024-01-20",
    },
    {
      id: 3,
      type: "Contract Renewal",
      employee: "Bob Johnson",
      date: "2024-01-25",
    },
  ]);

  return (
    <div className="admin-content-area">
      {/* Header */}
      <div className="header-title mb-6">
        <h1>HR Dashboard</h1>
        <p>Welcome back! Here's what's happening with your workforce today.</p>
      </div>

      {/* Stats Grid */}
      <div className="admin-metrics">
        <div className="stat-card">
          <div className="stat-icon-wrapper total-employees">
            <Users size={20} />
          </div>
          <span className="stat-number">{stats.totalEmployees}</span>
          <span className="stat-label">Total Employees</span>
          <div className="text-xs text-green-600 mt-2 flex items-center">
            <ArrowUpRight size={12} />
            <span className="ml-1">+12% this month</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper users">
            <UserCheck size={20} />
          </div>
          <span className="stat-number">{stats.activeEmployees}</span>
          <span className="stat-label">Active Employees</span>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <UserPlus size={20} />
          </div>
          <span className="stat-number">{stats.onboardingEmployees}</span>
          <span className="stat-label">Onboarding</span>
          <div className="text-xs text-amber-600 mt-2">
            {stats.pendingActions} pending actions
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper uptime">
            <Clock size={20} />
          </div>
          <span className="stat-number">{stats.benchEmployees}</span>
          <span className="stat-label">Bench Resources</span>
          <div className="text-xs text-slate-500 mt-2">
            Avg. {stats.avgOnboardingTime} days
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Left Column - Onboarding Tracker */}
        <div className="lg:col-span-2">
          <div className="master-data-manager">
            <div className="data-manager-header">
              <h2>Onboarding Tracker</h2>
              <p className="subtitle">
                Employees currently in onboarding process
              </p>
            </div>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Days Remaining</th>
                    <th>Completion</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOnboarding.map((emp) => (
                    <tr key={emp.id}>
                      <td className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                          {emp.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-medium">{emp.name}</div>
                          <div className="text-xs text-slate-500">
                            EMP-{emp.id.toString().padStart(4, "0")}
                          </div>
                        </div>
                      </td>
                      <td>{emp.department}</td>
                      <td>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            emp.daysRemaining <= 2
                              ? "bg-red-100 text-red-800"
                              : emp.daysRemaining <= 5
                                ? "bg-amber-100 text-amber-800"
                                : "bg-green-100 text-green-800"
                          }`}
                        >
                          {emp.daysRemaining} days
                        </span>
                      </td>
                      <td>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{
                              width: `${100 - emp.daysRemaining * 10}%`,
                            }}
                          ></div>
                        </div>
                      </td>
                      <td>
                        <button className="action-button primary text-sm py-1 px-3">
                          View Tasks
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column - Quick Actions & Alerts */}
        <div>
          <div className="audit-log-viewer mb-6">
            <div className="viewer-header">
              <h2>Quick Actions</h2>
            </div>
            <div className="space-y-3">
              <button className="action-button primary w-full justify-center">
                <UserPlus size={16} />
                Create New Employee
              </button>
              <button className="action-button w-full justify-center">
                <Calendar size={16} />
                Schedule Appraisal
              </button>
              <button className="action-button w-full justify-center">
                <TrendingUp size={16} />
                Generate Reports
              </button>
            </div>
          </div>

          <div className="audit-log-viewer">
            <div className="viewer-header">
              <h2>Upcoming Actions</h2>
              <p className="subtitle">Next 7 days</p>
            </div>
            <div className="space-y-4">
              {upcomingActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div>
                    <div className="font-medium text-sm">{action.type}</div>
                    <div className="text-xs text-slate-500">
                      {action.employee}
                    </div>
                  </div>
                  <div className="text-xs text-slate-600">{action.date}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HRDashboard;
