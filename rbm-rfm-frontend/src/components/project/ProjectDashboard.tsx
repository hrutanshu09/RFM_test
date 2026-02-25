import React, { useEffect, useState } from 'react';
import { projectService } from '../../api/projectService';
import { Project } from '../../types/projects';
import ProjectModal from './ProjectModal';
import { useNavigate } from 'react-router-dom';

const ProjectDashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const navigate = useNavigate();

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await projectService.getProjects();
      setProjects(res.data);
    } catch (err) {
      console.error("Error fetching projects:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Project Management Dashboard</h1>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow transition"
        >
          + Create New Project
        </button>
      </div>

      {loading ? (
        <p>Loading projects...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div key={project.project_id} className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <div className="flex justify-between items-start">
                <h3 className="text-lg font-semibold text-blue-900">{project.project_name}</h3>
                <span className={`text-xs px-2 py-1 rounded ${
                  project.project_status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {project.project_status}
                </span>
              </div>
              
              <div className="mt-4 space-y-1">
                <p className="text-gray-500 text-sm">
                  <strong>Client:</strong> {project.client_name || 'No Client'}
                </p>
                <p className="text-gray-500 text-sm">
                  {/* manager_name is now provided by the updated backend API join */}
                  <strong>Manager:</strong> {project.manager_name || 'Not Assigned'}
                </p>
              </div>

              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => navigate(`/admin/projects/${project.project_id}`)} 
                  className="text-blue-600 text-sm font-medium hover:underline"
                >
                  View Details →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <ProjectModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          onSuccess={() => {
            setIsModalOpen(false);
            fetchProjects();
          }} 
        />
      )}
    </div>
  );
};

export default ProjectDashboard;