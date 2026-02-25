import React, { useState } from 'react';
import { projectService } from '../../api/projectService';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ProjectStatus = 'Active' | 'On Hold' | 'Completed' | 'Cancelled';

const ProjectModal: React.FC<ProjectModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    project_name: '',
    client_name: '',
    project_status: 'Active' as ProjectStatus,
    description: ''
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await projectService.createProject(formData);
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
          </select>
          <textarea 
            className="w-full p-2 border rounded"
            placeholder="Description"
            value={formData.description}
            onChange={e => setFormData({...formData, description: e.target.value})}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProjectModal;