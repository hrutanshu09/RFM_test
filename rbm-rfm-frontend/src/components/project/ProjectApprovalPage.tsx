import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projectService } from '../../api/projectService';
import { Project } from '../../types/projects';

const ProjectApprovalPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const projectId = Number(id);

  const loadProject = async () => {
    setLoading(true);
    try {
      const res = await projectService.getProject(projectId);
      setProject(res.data);
    } catch (err) {
      console.error('Failed to load project approval page:', err);
      setProject(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!Number.isNaN(projectId)) {
      loadProject();
    }
  }, [projectId]);

  const handleApprove = async () => {
    if (!project) return;
    setIsSaving(true);
    try {
      await projectService.updateApproval(project.project_id, {
        approval_status: 'Approved',
        approval_note: approvalNote.trim() || undefined,
      });
      await loadProject();
      setApprovalNote('');
    } catch (err) {
      console.error('Failed to approve project:', err);
      alert('Unable to approve project');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async () => {
    if (!project) return;
    const rejectionReason = window.prompt(
      'Please provide reason for rejection:',
      approvalNote.trim(),
    );
    if (!rejectionReason || !rejectionReason.trim()) {
      alert('Rejection reason is required.');
      return;
    }

    setIsSaving(true);
    try {
      await projectService.updateApproval(project.project_id, {
        approval_status: 'Rejected',
        approval_note: rejectionReason.trim(),
      });
      await loadProject();
      setApprovalNote('');
    } catch (err) {
      console.error('Failed to reject project:', err);
      alert('Unable to reject project');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8">Loading project approval details...</div>;
  }

  if (Number.isNaN(projectId) || !project) {
    return <div className="p-8 text-red-600">Project not found.</div>;
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto bg-white border rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">Project Approval</h1>
          <button
            type="button"
            className="px-3 py-2 rounded border bg-white"
            onClick={() => navigate('/manager/projects')}
          >
            Back to Projects
          </button>
        </div>

        <div className="space-y-1 text-sm text-gray-700">
          <p><strong>Project:</strong> {project.project_name}</p>
          <p><strong>Client:</strong> {project.client_name || 'Internal'}</p>
          <p><strong>Assigned Manager:</strong> {project.manager_name || 'Not Assigned'}</p>
          <p><strong>Approval Status:</strong> {project.approval_status}</p>
          <p><strong>Approval Note:</strong> {project.approval_note || '-'}</p>
          <p>
            <strong>Approved At:</strong>{' '}
            {project.approved_at ? new Date(project.approved_at).toLocaleString() : '-'}
          </p>
        </div>

        {project.can_current_user_approve ? (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Approval Note
              </label>
              <textarea
                className="w-full p-2 border rounded"
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder="Optional for approval, required for rejection"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleApprove}
                disabled={isSaving}
                className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
              >
                {isSaving ? 'Saving...' : 'Approve Project'}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={isSaving}
                className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
              >
                {isSaving ? 'Saving...' : 'Reject Project'}
              </button>
            </div>
          </>
        ) : (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-800 text-sm">
            You can view this project, but only the manager assigned to it can approve.
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectApprovalPage;
