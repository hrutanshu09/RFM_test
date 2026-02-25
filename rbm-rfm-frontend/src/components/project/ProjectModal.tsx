import React, { useState, useEffect } from 'react';
import { projectService } from '../../api/projectService';
import { fetchUsers, AdminUser } from '../../api/users'; // Ensure this path is correct
import { ProjectCreateRequest } from '../../types/projects';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ProjectStatus = 'Active' | 'On Hold' | 'Completed' | 'Cancelled';

const ProjectModal: React.FC<ProjectModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [managers, setManagers] = useState<AdminUser[]>([]);
  const [formData, setFormData] = useState({
    project_name: '',
    client_name: '',
    project_status: 'Active' as ProjectStatus,
    description: '',
    manager_user_id: '' // State to track selected manager ID
  });

  // Fetch system users when the modal opens to populate the dropdown
  useEffect(() => {
    if (isOpen) {
      fetchUsers()
        .then(data => setManagers(data))
        .catch(err => console.error("Failed to load users for manager selection", err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Prepare payload: convert manager_user_id string to number
      const payload: ProjectCreateRequest = {
        project_name: formData.project_name,
        client_name: formData.client_name,
        project_status: formData.project_status,
        description: formData.description,
        manager_user_id: formData.manager_user_id ? Number(formData.manager_user_id) : undefined
      };

      await projectService.createProject(payload);
      onSuccess();
    } catch (error) {
      console.error("Creation failed", error);
      alert("Failed to create project.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg w-96 shadow-xl">
        <h3 className="text-xl font-bold mb-4">Create New Project</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input 
            className="w-full p-2 border rounded"
            placeholder="Project Name" required
            value={formData.project_name}
            onChange={e => setFormData({...formData, project_name: e.target.value})}
          />

          {/* Manager Selection Dropdown */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Primary Project Manager</label>
            <select 
              className="w-full p-2 border rounded"
              value={formData.manager_user_id}
              onChange={e => setFormData({...formData, manager_user_id: e.target.value})}
            >
              <option value="">Select a Manager (Optional)</option>
              {managers.map(user => (
                <option key={user.user_id} value={user.user_id}>
                  {user.username} {user.employee?.name ? `(${user.employee.name})` : ''}
                </option>
              ))}
            </select>
          </div>

          <input 
            className="w-full p-2 border rounded"
            placeholder="Client Name"
            value={formData.client_name}
            onChange={e => setFormData({...formData, client_name: e.target.value})}
          />
          
          <select 
            className="w-full p-2 border rounded"
            value={formData.project_status}
            onChange={e => setFormData({...formData, project_status: e.target.value as ProjectStatus})}
          >
            <option value="Active">Active</option>
            <option value="On Hold">On Hold</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <textarea 
            className="w-full p-2 border rounded"
            placeholder="Description"
            value={formData.description}
            onChange={e => setFormData({...formData, description: e.target.value})}
          />

          <div className="flex justify-end gap-2 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Create Project</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProjectModal;