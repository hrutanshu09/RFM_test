import React, { useEffect, useState } from "react";
import axios from "axios";
import { fetchUsers, type AdminUser } from "../../api/users";
import { projectService } from "../../api/projectService";
import { Project, ProjectCreateRequest } from "../../types/projects";

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  project?: Project | null;
}

type ProjectStatus = "Active" | "On Hold" | "Completed" | "Cancelled";

const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  project,
}) => {
  const [managers, setManagers] = useState<AdminUser[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const buildInitialForm = (source?: Project | null) => ({
    project_name: source?.project_name || "",
    client_name: source?.client_name || "",
    project_status: (source?.project_status || "Active") as ProjectStatus,
    description: source?.description || "",
    manager_user_id: source?.manager_user_id ? String(source.manager_user_id) : "",
    planned_start_date: source?.planned_start_date || "",
    planned_end_date: source?.planned_end_date || "",
  });

  const [formData, setFormData] = useState<{
    project_name: string;
    client_name: string;
    project_status: ProjectStatus;
    description: string;
    manager_user_id: string;
    planned_start_date: string;
    planned_end_date: string;
  }>(() => buildInitialForm(project));

  useEffect(() => {
    if (!isOpen) return;
    setCurrentStep(0);

    fetchUsers()
      .then((data) =>
        setManagers(
          data.filter((user) =>
            (user.roles || []).some((role) => role.toLowerCase() === "manager"),
          ),
        ),
      )
      .catch((err) =>
        console.error("Failed to load users for manager dropdown", err),
      );
  }, [isOpen]);


  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasStart = Boolean(formData.planned_start_date);
    const hasEnd = Boolean(formData.planned_end_date);
    if (hasStart !== hasEnd) {
      alert("Please provide both planned start and planned end dates.");
      return;
    }
    const payload: ProjectCreateRequest = {
      project_name: formData.project_name,
      client_name: formData.client_name || undefined,
      project_status: formData.project_status,
      description: formData.description || undefined,
      manager_user_id: formData.manager_user_id
        ? Number(formData.manager_user_id)
        : undefined,
      planned_start_date: formData.planned_start_date || undefined,
      planned_end_date: formData.planned_end_date || undefined,
    };

    try {
      if (project?.project_id) {
        await projectService.updateProject(project.project_id, payload);
      } else {
        await projectService.createProject(payload);
      }
      onSuccess();
    } catch (err) {
      console.error("Project save failed", err);
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;
        const message =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join(", ")
              : err.message;
        alert(`Unable to save project: ${message}`);
      } else {
        alert("Unable to save project");
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  const stepLabels = [
    { title: 'Project Basics', subtitle: 'Core project information' },
    { title: 'Timeline & Details', subtitle: 'Dates and final notes' },
  ];

  const handleStepNext = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!formData.project_name.trim()) {
      alert('Project Name is required.');
      return;
    }
    setCurrentStep(1);
  };

  return (
    <div
      className="fixed left-0 right-0 bottom-0 top-16 z-50 flex items-start justify-center bg-black/50 p-4 pt-4 pb-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl space-y-3 rounded-lg bg-white p-5 shadow-xl"
      >
        <h3 id="create-project-title" className="text-xl font-bold">
          {project ? "Edit Project" : "Create New Project"}
        </h3>

        <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50">
          {stepLabels.map((step, index) => {
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            return (
              <div key={step.title} className="flex items-center flex-1">
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                    isActive
                      ? 'bg-blue-500 text-white'
                      : isCompleted
                        ? 'bg-green-500 text-white'
                        : 'bg-white text-gray-600 border border-gray-200'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white/30 flex items-center justify-center text-[11px]">
                    {index + 1}
                  </span>
                  <span className="whitespace-nowrap">{step.title}</span>
                </div>
                {index < stepLabels.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-2 ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>

        {currentStep === 0 ? (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Project Name
              </label>
              <input
                className="w-full p-2 border rounded"
                placeholder="Project Name"
                value={formData.project_name}
                onChange={(e) =>
                  setFormData({ ...formData, project_name: e.target.value })
                }
                required
              />
            </div>

            <div className="form-group">
              <label>Project Manager</label>
              <select
                value={formData.manager_user_id}
                onChange={(e) =>
                  setFormData({ ...formData, manager_user_id: e.target.value })
                }
                className="w-full px-3 py-2 border rounded"
              >
                <option value="">-- none --</option>
                {managers.map((user) => (
                  <option key={user.user_id} value={user.user_id}>
                    {user.employee?.name || user.username}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Client Name
              </label>
              <input
                className="w-full p-2 border rounded"
                placeholder="Client Name"
                value={formData.client_name}
                onChange={(e) =>
                  setFormData({ ...formData, client_name: e.target.value })
                }
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Project Status
              </label>
              <select
                className="w-full p-2 border rounded"
                value={formData.project_status}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    project_status: e.target.value as ProjectStatus,
                  })
                }
              >
                <option value="Active">Active</option>
                <option value="On Hold">On Hold</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Planned Start Date
                </label>
                <input
                  type="date"
                  className="w-full p-2 border rounded"
                  value={formData.planned_start_date}
                  onChange={(e) =>
                    setFormData({ ...formData, planned_start_date: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Planned End Date
                </label>
                <input
                  type="date"
                  className="w-full p-2 border rounded"
                  value={formData.planned_end_date}
                  min={formData.planned_start_date || undefined}
                  onChange={(e) =>
                    setFormData({ ...formData, planned_end_date: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                className="w-full p-2 border rounded"
                placeholder="Description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          {currentStep > 0 && (
            <button
              type="button"
              onClick={() => setCurrentStep((prev) => Math.max(prev - 1, 0))}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Back
            </button>
          )}
          {currentStep === 0 ? (
            <button
              type="button"
              onClick={handleStepNext}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Continue to Step 2
            </button>
          ) : (
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {project ? "Save Changes" : "Create Project"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default ProjectModal;
