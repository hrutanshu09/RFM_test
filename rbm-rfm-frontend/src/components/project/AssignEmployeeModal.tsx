import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { projectService } from '../../api/projectService';
import { EmployeeProjectAssignment } from '../../types/projects';
import './project-modals.css'; // Create this for custom styling

interface AssignEmployeeModalProps {
  projectId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AssignEmployeeModal: React.FC<AssignEmployeeModalProps> = ({
  projectId, isOpen, onClose, onSuccess 
}) => {
  const { user } = useAuth();
  const isAdmin = user?.roles?.includes('Admin') ?? false;

  const [formData, setFormData] = useState({
    emp_id: '',
    role: '',
    allocation_pct: 100,
    start_date: new Date().toISOString().split('T')[0],
    status: 'Active',
    // --- Billing Fields ---
    billing_rate: 0,
    billing_start_date: '',
    billing_end_date: '',
    is_billable: true,
    timesheet_required: true,
    client_pm_name: '',
    billing_project_id: projectId
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // If not admin, the service will handle stripping the rate, 
      // but we can also ensure it's not sent here.
      const { billing_rate, ...payload } = formData;
      const finalPayload = isAdmin ? formData : payload;

      await projectService.assignEmployee(finalPayload as any);
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Assignment failed", error);
      alert("Failed to assign resource. Please check details.");
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>Assign Resource to Project</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-section">
            <h4>Core Assignment</h4>
            <input 
              type="text" placeholder="Employee ID" required
              value={formData.emp_id} onChange={e => setFormData({...formData, emp_id: e.target.value})}
            />
            <input 
              type="text" placeholder="Project Role (e.g. Frontend Dev)"
              value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}
            />
            <label>Allocation %</label>
            <input 
              type="number" min="0" max="100"
              value={formData.allocation_pct} onChange={e => setFormData({...formData, allocation_pct: Number(e.target.value)})}
            />
          </div>

          <div className="form-section billing-section">
            <h4>Billing Configuration</h4>
            
            {isAdmin ? (
              <div className="form-group">
                <label>Billing Rate (Hourly/Monthly)</label>
                <input 
                  type="number" step="0.01"
                  value={formData.billing_rate} onChange={e => setFormData({...formData, billing_rate: Number(e.target.value)})}
                />
              </div>
            ) : (
              <div className="info-box">Financial details are restricted to Administrators.</div>
            )}

            <div className="toggle-group">
              <label>
                <input type="checkbox" checked={formData.is_billable} onChange={e => setFormData({...formData, is_billable: e.target.checked})} />
                Billable Resource
              </label>
              <label>
                <input type="checkbox" checked={formData.timesheet_required} onChange={e => setFormData({...formData, timesheet_required: e.target.checked})} />
                Timesheet Required
              </label>
            </div>

            <input 
              type="text" placeholder="Client PM Name"
              value={formData.client_pm_name} onChange={e => setFormData({...formData, client_pm_name: e.target.value})}
            />
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Assign Resource</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AssignEmployeeModal;