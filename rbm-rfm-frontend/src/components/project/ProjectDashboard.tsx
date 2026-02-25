import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectService } from '../../api/projectService';
import { Project } from '../../types/projects';

const ProjectDashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    projectService.getProjects()
      .then(res => setProjects(res.data))
      .catch(err => console.error("Error fetching projects:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading Projects...</div>;

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2>Project Management</h2>
        <button className="btn-primary">Create New Project</button>
      </div>
      
      <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th>Project Name</th>
            <th>Client</th>
            <th>Status</th>
            <th>Created At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(project => (
            <tr key={project.project_id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{project.project_name}</td>
              <td>{project.client_name || 'N/A'}</td>
              <td>{project.project_status}</td>
              <td>{new Date(project.created_at).toLocaleDateString()}</td>
              <td>
                <button onClick={() => navigate(`/admin/projects/${project.project_id}`)}>
                  View Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ProjectDashboard;