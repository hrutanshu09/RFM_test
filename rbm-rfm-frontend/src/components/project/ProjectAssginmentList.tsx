import React from 'react';
import { useAuth } from '../../contexts/useAuth';
import { EmployeeProjectAssignment } from '../../types/projects';

interface Props {
  assignments: EmployeeProjectAssignment[];
}

const ProjectAssignmentList: React.FC<Props> = ({ assignments }) => {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('Admin') ?? false;

  return (
    <div className="assignment-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Role</th>
            <th>Allocation</th>
            <th>Billable</th>
            {isAdmin && <th>Billing Rate</th>}
            <th>Client PM</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map(asgn => (
            <tr key={asgn.assignment_id}>
              <td>{asgn.emp_id}</td>
              <td>{asgn.role}</td>
              <td>{asgn.allocation_pct}%</td>
              <td>{asgn.is_billable ? '✅ Yes' : '❌ No'}</td>
              {isAdmin && (
                <td className="financial-data">
                  {asgn.billing_rate ? `$${asgn.billing_rate}` : 'N/A'}
                </td>
              )}
              <td>{asgn.client_pm_name || 'Not Assigned'}</td>
              <td><span className={`status-pill ${asgn.status.toLowerCase()}`}>{asgn.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};