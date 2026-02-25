import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { projectService } from '../../api/projectService';
import { fetchEmployees, type EmployeeOption } from '../../api/employees';
import { Project, EmployeeProjectAssignment, AssignmentCreateRequest } from '../../types/projects';
import { useAuth } from '../../contexts/useAuth';
import './project-detail.css';

const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.roles?.includes('admin');

  const [project, setProject] = useState<Project | null>(null);
  const [assignments, setAssignments] = useState<EmployeeProjectAssignment[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [isAssignFormOpen, setIsAssignFormOpen] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({
    emp_id: '',
    role: '',
    allocation_pct: 100,
    start_date: '',
    end_date: '',
    status: 'Active' as 'Planned' | 'Active' | 'Ended',
    is_billable: true,
    billing_rate: '',
    billing_start_date: '',
    billing_end_date: '',
  });

  const projectId = Number(id);

  const resetAssignmentForm = () => {
    setAssignmentForm({
      emp_id: '',
      role: '',
      allocation_pct: 100,
      start_date: '',
      end_date: '',
      status: 'Active',
      is_billable: true,
      billing_rate: '',
      billing_start_date: '',
      billing_end_date: '',
    });
  };

  const fetchProjectData = async () => {
    const [projectRes, assignmentsRes, employeesRes] = await Promise.all([
      projectService.getProject(projectId),
      projectService.getProjectAssignments(projectId),
      fetchEmployees(),
    ]);
    setProject(projectRes.data);
    setAssignments(assignmentsRes.data);
    setEmployees(employeesRes);
  };

  useEffect(() => {
    const load = async () => {
      try {
        await fetchProjectData();
      } catch (err) {
        console.error('Failed to fetch project details:', err);
      } finally {
        setLoading(false);
      }
    };

    if (!Number.isNaN(projectId)) {
      load();
    }
  }, [projectId]);

  const handleAssignEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignmentForm.emp_id || !assignmentForm.start_date) {
      alert('Please select employee and start date.');
      return;
    }

    if (assignmentForm.is_billable && !assignmentForm.billing_rate) {
      alert('Please provide billing rate for billable assignments.');
      return;
    }

    setIsSavingAssignment(true);
    try {
      const payload: AssignmentCreateRequest = {
        emp_id: assignmentForm.emp_id,
        project_id: projectId,
        role: assignmentForm.role || undefined,
        allocation_pct: Number(assignmentForm.allocation_pct),
        start_date: assignmentForm.start_date,
        end_date: assignmentForm.end_date || undefined,
        status: assignmentForm.status,
        is_billable: assignmentForm.is_billable,
        timesheet_required: true,
        billing_rate: assignmentForm.is_billable && assignmentForm.billing_rate
          ? Number(assignmentForm.billing_rate)
          : undefined,
        billing_start_date: assignmentForm.billing_start_date || undefined,
        billing_end_date: assignmentForm.billing_end_date || undefined,
      };

      await projectService.assignEmployee(payload);
      const refreshed = await projectService.getProjectAssignments(projectId);
      setAssignments(refreshed.data);
      resetAssignmentForm();
      setIsAssignFormOpen(false);
    } catch (err) {
      console.error('Failed to assign employee:', err);
      alert('Unable to assign employee');
    } finally {
      setIsSavingAssignment(false);
    }
  };

  const handleUnassign = async (assignmentId: number) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      await projectService.updateAssignment(assignmentId, {
        status: 'Ended',
        end_date: today,
      });

      const refreshed = await projectService.getProjectAssignments(projectId);
      setAssignments(refreshed.data);
    } catch (err) {
      console.error('Failed to unassign resource:', err);
      alert('Unable to unassign resource');
    }
  };

  if (loading) return <div className="loading-state">Loading Project Details...</div>;
  if (!project) return <div className="error-state">Project not found.</div>;

  return (
    <div className="project-detail-container">
      <div className="detail-header">
        <button onClick={() => navigate('/admin/projects')} className="btn-back">Back to Portfolio</button>
        <h1>{project.project_name}</h1>
        <span className={`status-pill ${project.project_status.toLowerCase()}`}>
          {project.project_status}
        </span>
      </div>

      <div className="detail-grid">
        <section className="detail-card">
          <h3>Description</h3>
          <p>{project.description || 'No description provided for this project.'}</p>
          <div className="meta-info">
            <div className="info-item"><strong>Client:</strong> {project.client_name || 'Internal'}</div>
            <div className="info-item"><strong>Manager:</strong> {project.manager_name || 'Not Assigned'}</div>
            <div className="info-item"><strong>Planned Start Date:</strong> {project.planned_start_date ? new Date(project.planned_start_date).toLocaleDateString() : 'Not Set'}</div>
            <div className="info-item"><strong>Planned End Date:</strong> {project.planned_end_date ? new Date(project.planned_end_date).toLocaleDateString() : 'Not Set'}</div>
            <div className="info-item"><strong>Created:</strong> {new Date(project.created_at).toLocaleDateString()}</div>
          </div>
        </section>

        <section className="detail-card full-width">
          <div className="section-header assign-toolbar">
            <h3>Resource Assignment</h3>
            <button
              type="button"
              className="assign-toggle-btn"
              onClick={() => setIsAssignFormOpen((prev) => !prev)}
            >
              {isAssignFormOpen ? 'Close Form' : 'Assign Resource'}
            </button>
          </div>
        </section>

        <section className="detail-card full-width">
          <div className="section-header">
            <h3>Assigned Resources</h3>
          </div>
          <table className="assignment-table">
            <thead>
              <tr>
                <th>Resource ID</th>
                <th>Role</th>
                <th> Allocation Percentage</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Active Status</th>
                <th>Billable Status</th>
                <th>Billing Rate</th>
                <th>Billing Start</th>
                <th>Billing End</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((asgn) => (
                <tr key={asgn.assignment_id}>
                  <td>{asgn.emp_id}</td>
                  <td>{asgn.role || 'General Resource'}</td>
                  <td>{asgn.allocation_pct}%</td>
                  <td>{new Date(asgn.start_date).toLocaleDateString()}</td>
                  <td>{asgn.end_date ? new Date(asgn.end_date).toLocaleDateString() : '-'}</td>
                  <td>{asgn.status === 'Active' ? 'Active' : 'Inactive'}</td>
                  <td>{asgn.is_billable ? 'Yes' : 'No'}</td>
                  <td>
                    {asgn.billing_rate != null
                      ? `$${asgn.billing_rate}`
                      : isAdmin
                        ? '-'
                        : 'Restricted'}
                  </td>
                  <td>{asgn.billing_start_date ? new Date(asgn.billing_start_date).toLocaleDateString() : '-'}</td>
                  <td>{asgn.billing_end_date ? new Date(asgn.billing_end_date).toLocaleDateString() : '-'}</td>
                  <td>{asgn.status}</td>
                  <td>
                    {asgn.status !== 'Ended' ? (
                      <button
                        className="btn-inline"
                        onClick={() => handleUnassign(asgn.assignment_id)}
                        type="button"
                      >
                        Unassign
                      </button>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={12} className="empty-row">No resources assigned yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {isAssignFormOpen && (
        <div
          className="assignment-modal-overlay"
          onClick={() => setIsAssignFormOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-resource-title"
        >
          <form
            className="assignment-modal"
            onSubmit={handleAssignEmployee}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="assignment-modal-header">
              <h3 id="assign-resource-title">Assign Resource</h3>
              <button type="submit" className="assign-top-submit" disabled={isSavingAssignment}>
                {isSavingAssignment ? 'Saving...' : 'Assign Resource'}
              </button>
            </div>

            <div className="assignment-form">
              <div className="field-with-help">
                <label>Employee</label>
                <select
                  value={assignmentForm.emp_id}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, emp_id: e.target.value })}
                  required
                >
                  <option value="">Select Employee</option>
                  {employees.map((employee) => (
                    <option key={employee.emp_id} value={employee.emp_id}>
                      {employee.emp_id} - {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-with-help">
                <label>Role</label>
                <input
                  type="text"
                  value={assignmentForm.role}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, role: e.target.value })}
                />
              </div>

              <div className="field-with-help">
                <label>Allocation Percentage</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={assignmentForm.allocation_pct}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, allocation_pct: Number(e.target.value) })}
                  required
                />
              </div>

              <div className="field-with-help">
                <label>Assignment Start Date</label>
                <input
                  type="date"
                  value={assignmentForm.start_date}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, start_date: e.target.value })}
                  required
                />
              </div>

              <div className="field-with-help">
                <label>Assignment End Date</label>
                <input
                  type="date"
                  value={assignmentForm.end_date}
                  min={assignmentForm.start_date || undefined}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, end_date: e.target.value })}
                />
              </div>

              <div className="field-with-help">
                <label>Active Status</label>
                <select
                  value={assignmentForm.status}
                  onChange={(e) =>
                    setAssignmentForm({
                      ...assignmentForm,
                      status: e.target.value as 'Planned' | 'Active' | 'Ended',
                    })
                  }
                >
                  <option value="Planned">Planned</option>
                  <option value="Active">Active</option>
                  <option value="Ended">Ended</option>
                </select>
              </div>

              <div className="field-with-help">
                <label>Billable Status</label>
                <select
                  value={assignmentForm.is_billable ? 'Yes' : 'No'}
                  onChange={(e) => {
                    const isBillable = e.target.value === 'Yes';
                    setAssignmentForm({
                      ...assignmentForm,
                      is_billable: isBillable,
                      billing_rate: isBillable ? assignmentForm.billing_rate : '',
                      billing_start_date: isBillable ? assignmentForm.billing_start_date : '',
                      billing_end_date: isBillable ? assignmentForm.billing_end_date : '',
                    });
                  }}
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>

              <div className="field-with-help">
                <label>Billing Rate</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={assignmentForm.billing_rate}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, billing_rate: e.target.value })}
                  disabled={!assignmentForm.is_billable}
                />
              </div>

              <div className="field-with-help">
                <label>Billing Start Date</label>
                <input
                  type="date"
                  value={assignmentForm.billing_start_date}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, billing_start_date: e.target.value })}
                  disabled={!assignmentForm.is_billable}
                />
              </div>

              <div className="field-with-help">
                <label>Billing End Date</label>
                <input
                  type="date"
                  value={assignmentForm.billing_end_date}
                  min={assignmentForm.billing_start_date || undefined}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, billing_end_date: e.target.value })}
                  disabled={!assignmentForm.is_billable}
                />
              </div>
            </div>

            <div className="assignment-form-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  resetAssignmentForm();
                  setIsAssignFormOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ProjectDetail;
