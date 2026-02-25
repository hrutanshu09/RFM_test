import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { projectService } from '../../api/projectService';
import { Project, EmployeeProjectAssignment } from '../../types/projects';
import { useAuth } from '../../contexts/useAuth';
import './project-detail.css';

const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.roles?.includes('admin');

  const [project, setProject] = useState<Project | null>(null);
  const [assignments, setAssignments] = useState<EmployeeProjectAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const projectId = Number(id);
        const [projectRes, assignmentsRes] = await Promise.all([
          projectService.getProject(projectId),
          projectService.getProjectAssignments(projectId)
        ]);
        setProject(projectRes.data);
        setAssignments(assignmentsRes.data);
      } catch (err) {
        console.error("Failed to fetch project details:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  if (loading) return <div className="loading-state">Loading Project Details...</div>;
  if (!project) return <div className="error-state">Project not found.</div>;

  return (
    <div className="project-detail-container">
      {/* 1. Overview Header */}
      <div className="detail-header">
        <button onClick={() => navigate('/admin/projects')} className="btn-back">← Portfolio</button>
        <h1>{project.project_name}</h1>
        <span className={`status-pill ${project.project_status.toLowerCase()}`}>
          {project.project_status}
        </span>
      </div>

      <div className="detail-grid">
        {/* 2. Core Metadata & description */}
        <section className="detail-card">
          <h3>Description</h3>
          <p>{project.description || "No description provided for this project."}</p>
          <div className="meta-info">
            <div className="info-item"><strong>Client:</strong> {project.client_name || "Internal"}</div>
            <div className="info-item"><strong>Created:</strong> {new Date(project.created_at).toLocaleDateString()}</div>
          </div>
        </section>

        {/* 3. Resource Allocation Table */}
        <section className="detail-card full-width">
          <div className="section-header">
            <h3>Assigned Resources</h3>
          </div>
          <table className="assignment-table">
            <thead>
              <tr>
                <th>Resource ID</th>
                <th>Project Role</th>
                <th>Allocation %</th>
                <th>Billable</th>
                {isAdmin && <th>Billing Rate</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map(asgn => (
                <tr key={asgn.assignment_id}>
                  <td>{asgn.emp_id}</td>
                  <td>{asgn.role || 'General Resource'}</td>
                  <td>{asgn.allocation_pct}%</td>
                  <td>{asgn.is_billable ? '✅' : '❌'}</td>
                  {isAdmin && <td>{asgn.billing_rate ? `$${asgn.billing_rate}` : 'Masked'}</td>}
                  <td>{asgn.status}</td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr><td colSpan={isAdmin ? 6 : 5} className="empty-row">No resources assigned yet.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
};

export default ProjectDetail;