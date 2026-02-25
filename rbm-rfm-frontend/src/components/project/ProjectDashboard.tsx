import React, { useEffect, useState } from 'react';
import { projectService } from '../../api/projectService';
import { Project } from '../../types/projects';
import ProjectModal from './ProjectModal';
import { useNavigate } from 'react-router-dom';

const ProjectDashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const navigate = useNavigate();

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await projectService.getProjects();
      setProjects(res.data);
    } catch (err) {
      console.error('Error fetching projects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const clientOptions = Array.from(
    new Set(projects.map((p) => p.client_name).filter((value): value is string => Boolean(value))),
  );
  const managerOptions = Array.from(
    new Set(projects.map((p) => p.manager_name).filter((value): value is string => Boolean(value))),
  );

  const filteredProjects = projects.filter((project) => {
    const matchesClient = !clientFilter || project.client_name === clientFilter;
    const matchesStatus = !statusFilter || project.project_status === statusFilter;
    const matchesManager = !managerFilter || project.manager_name === managerFilter;
    return matchesClient && matchesStatus && matchesManager;
  });

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Project Management Dashboard</h1>
        <button
          onClick={() => {
            setSelectedProject(null);
            setIsModalOpen(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow transition"
        >
          + Create New Project
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="w-full rounded border bg-white px-3 py-2"
        >
          <option value="">All Clients</option>
          {clientOptions.map((client) => (
            <option key={client} value={client}>
              {client}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full rounded border bg-white px-3 py-2"
        >
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="On Hold">On Hold</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>

        <select
          value={managerFilter}
          onChange={(e) => setManagerFilter(e.target.value)}
          className="w-full rounded border bg-white px-3 py-2"
        >
          <option value="">All Managers</option>
          {managerOptions.map((manager) => (
            <option key={manager} value={manager}>
              {manager}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading projects...</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <div key={project.project_id} className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <div className="flex justify-between items-start">
                <h3 className="text-lg font-semibold text-blue-900">{project.project_name}</h3>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    project.project_status === 'Active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-orange-100 text-orange-700'
                  }`}
                >
                  {project.project_status}
                </span>
              </div>

              <div className="mt-4 space-y-1">
                <p className="text-gray-500 text-sm">
                  <strong>Client:</strong> {project.client_name || 'No Client'}
                </p>
                <p className="text-gray-500 text-sm">
                  <strong>Manager:</strong> {project.manager_name || 'Not Assigned'}
                </p>
              </div>

              <div className="mt-6 flex items-center justify-end gap-4">
                <button
                  onClick={() => {
                    setSelectedProject(project);
                    setIsModalOpen(true);
                  }}
                  className="text-slate-600 text-sm font-medium hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => navigate(`/admin/projects/${project.project_id}`)}
                  className="text-blue-600 text-sm font-medium hover:underline"
                >
                  View Details
                </button>
              </div>
            </div>
          ))}
          {!filteredProjects.length && (
            <div className="rounded border bg-white p-6 text-sm text-gray-500">
              No projects match the selected filters.
            </div>
          )}
        </div>
      )}

      {isModalOpen && (
        <ProjectModal
          isOpen={isModalOpen}
          project={selectedProject}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedProject(null);
          }}
          onSuccess={() => {
            setIsModalOpen(false);
            setSelectedProject(null);
            fetchProjects();
          }}
        />
      )}
    </div>
  );
};

export default ProjectDashboard;
