import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { projectService } from '../../api/projectService';
import {
  fetchEmployees,
  fetchEmployeeSkillAssignments,
  fetchSkillCatalog,
  type EmployeeOption,
} from '../../api/employees';
import type {
  Project,
  EmployeeProjectAssignment,
  AssignmentCreateRequest,
  ProjectTimeline,
  SkillRecommendationEmployeeResult,
} from '../../types/projects';
import { useAuth } from '../../contexts/useAuth';
import './project-detail.css';

const ProjectDetail: React.FC = () => {
  const RESOURCES_PER_PAGE = 12;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const normalizedRoles = (user?.roles || []).map((role) => role.toLowerCase());
  const roleBasePath = normalizedRoles.includes('owner')
    ? '/owner'
    : normalizedRoles.includes('admin')
      ? '/admin'
      : normalizedRoles.includes('hr')
        ? '/hr'
        : normalizedRoles.includes('ta')
          ? '/ta'
          : normalizedRoles.includes('manager')
            ? '/manager'
            : '/dashboard';
  const isFullAccess = normalizedRoles.includes('admin') || normalizedRoles.includes('owner');
  const [project, setProject] = useState<Project | null>(null);
  const isManagerOnlyUser =
    normalizedRoles.includes('manager') &&
    !normalizedRoles.includes('admin') &&
    !normalizedRoles.includes('owner') &&
    !normalizedRoles.includes('hr') &&
    !normalizedRoles.includes('ta') &&
    !normalizedRoles.includes('pm');
  const canAccessBilling =
    normalizedRoles.includes('admin') ||
    normalizedRoles.includes('owner') ||
    normalizedRoles.includes('manager') ||
    normalizedRoles.includes('pm');
  const hasAssignmentWriteRole =
    normalizedRoles.includes('admin') ||
    normalizedRoles.includes('owner') ||
    normalizedRoles.includes('hr') ||
    normalizedRoles.includes('ta') ||
    normalizedRoles.includes('manager') ||
    normalizedRoles.includes('pm');
  const canWriteAssignments = isManagerOnlyUser
    ? Boolean(project?.can_current_user_approve)
    : hasAssignmentWriteRole;
  const canEditAssignmentStatus = isFullAccess;
  const canUpdateTimeline = isFullAccess;

  const canApproveAssignments = normalizedRoles.includes('manager');
  const showApprovalActionColumn = canApproveAssignments;
  const showLifecycleActionColumn = !normalizedRoles.includes('manager');
  const [assignments, setAssignments] = useState<EmployeeProjectAssignment[]>([]);
  const [timelines, setTimelines] = useState<ProjectTimeline[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [isSavingStatusChanges, setIsSavingStatusChanges] = useState(false);
  const [isSavingTimeline, setIsSavingTimeline] = useState(false);
  const [isSavingApproval, setIsSavingApproval] = useState(false);
  const [isAssignFormOpen, setIsAssignFormOpen] = useState(false);
  const [assignmentStep, setAssignmentStep] = useState(0);
  const [currentAssignmentsPage, setCurrentAssignmentsPage] = useState(1);
  const [employeeSearchInput, setEmployeeSearchInput] = useState('');
  const [isEmployeeDropdownOpen, setIsEmployeeDropdownOpen] = useState(false);
  const employeeDropdownRef = useRef<HTMLDivElement | null>(null);
  const approvalSectionRef = useRef<HTMLDivElement | null>(null);
  const [timelineForm, setTimelineForm] = useState({
    planned_start_date: '',
    planned_end_date: '',
    actual_start_date: '',
    actual_end_date: '',
    reason_for_change: '',
  });
  const [isProjectRejectModalOpen, setIsProjectRejectModalOpen] = useState(false);
  const [projectRejectReason, setProjectRejectReason] = useState('');
  const [statusDrafts, setStatusDrafts] = useState<Record<number, 'Planned' | 'Active'>>({});
  const [assignmentForm, setAssignmentForm] = useState({
    emp_id: '',
    allocation_pct: 100,
    start_date: '',
    end_date: '',
    status: 'Active' as 'Planned' | 'Active' | 'Ended',
    is_billable: canAccessBilling,
    billing_rate: '',
    billing_start_date: '',
    billing_end_date: '',
    send_for_approval: true,
  });
  const [isSkillSearchOpen, setIsSkillSearchOpen] = useState(false);
  const [requiredCount, setRequiredCount] = useState(3);
  const [desiredSkillsInput, setDesiredSkillsInput] = useState('');
  const [recommendations, setRecommendations] = useState<SkillRecommendationEmployeeResult[]>([]);
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [lastAutoRecommendationKey, setLastAutoRecommendationKey] = useState('');
  const [requestedAiRecommendation, setRequestedAiRecommendation] = useState(false);
  const [employeeSkillCatalogMap, setEmployeeSkillCatalogMap] = useState<Record<number, string>>({});
  const [employeeAvailableSkills, setEmployeeAvailableSkills] = useState<string[]>([]);
  const [selectedAssignmentSkills, setSelectedAssignmentSkills] = useState<string[]>([]);
  const [pendingRecommendedSkills, setPendingRecommendedSkills] = useState<string[]>([]);
  const [isEmployeeSkillsDropdownOpen, setIsEmployeeSkillsDropdownOpen] = useState(false);
  const [isEmployeeSkillsLoading, setIsEmployeeSkillsLoading] = useState(false);
  const employeeSkillsDropdownRef = useRef<HTMLDivElement | null>(null);

  const pathnameProjectId = location.pathname.split('/').filter(Boolean).pop();
  const resolvedProjectId = id ?? pathnameProjectId ?? '';
  const projectId = Number(resolvedProjectId);

  const resetAssignmentForm = () => {
    setAssignmentForm({
      emp_id: '',
      allocation_pct: 100,
      start_date: '',
      end_date: '',
      status: 'Active',
      is_billable: canAccessBilling,
      billing_rate: '',
      billing_start_date: '',
      billing_end_date: '',
      send_for_approval: true,
    });
    setEmployeeSearchInput('');
    setIsEmployeeDropdownOpen(false);
    setEmployeeAvailableSkills([]);
    setSelectedAssignmentSkills([]);
    setPendingRecommendedSkills([]);
    setIsEmployeeSkillsDropdownOpen(false);
    setAssignmentStep(0);
  };

  const filteredEmployees = useMemo(() => {
    const q = employeeSearchInput.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (emp) =>
        emp.emp_id.toLowerCase().includes(q) ||
        emp.full_name.toLowerCase().includes(q),
    );
  }, [employees, employeeSearchInput]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        employeeDropdownRef.current &&
        !employeeDropdownRef.current.contains(event.target as Node)
      ) {
        setIsEmployeeDropdownOpen(false);
      }
      if (
        employeeSkillsDropdownRef.current &&
        !employeeSkillsDropdownRef.current.contains(event.target as Node)
      ) {
        setIsEmployeeSkillsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!isSkillSearchOpen) return;
      if (!desiredSkillsInput.trim()) return;
      const autoKey = `${projectId}|${desiredSkillsInput.trim().toLowerCase()}|${requiredCount}`;
      if (autoKey === lastAutoRecommendationKey) return;
      setLastAutoRecommendationKey(autoKey);
      runRecommendations(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [desiredSkillsInput, isSkillSearchOpen, lastAutoRecommendationKey, projectId, requiredCount]);

  const fetchProjectData = async () => {
    const [projectRes, assignmentsRes, employeesRes, timelinesRes] = await Promise.all([
      projectService.getProject(projectId),
      projectService.getProjectAssignments(projectId),
      fetchEmployees(),
      projectService.getProjectTimelines(projectId),
    ]);
    setProject(projectRes.data);
    setTimelineForm({
      planned_start_date: projectRes.data.planned_start_date || '',
      planned_end_date: projectRes.data.planned_end_date || '',
      actual_start_date: projectRes.data.actual_start_date || '',
      actual_end_date: projectRes.data.actual_end_date || '',
      reason_for_change: '',
    });
    setAssignments(assignmentsRes.data);
    setStatusDrafts({});
    setTimelines(timelinesRes.data);
    setCurrentAssignmentsPage(1);
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

  useEffect(() => {
    if (!project) return;
    const shouldFocusApproval =
      location.search.includes('focus=approval') || location.hash === '#approval-section';
    if (!shouldFocusApproval) return;

    const scrollTimer = window.setTimeout(() => {
      approvalSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);

    return () => window.clearTimeout(scrollTimer);
  }, [location.hash, location.search, project]);

  const desiredSkills = useMemo(() => {
    const fromInput = desiredSkillsInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return fromInput;
  }, [desiredSkillsInput]);

  const openAssignmentWithEmployeeSkills = (
    employeeId: string,
    employeeName: string,
    recommendedSkills: string[],
  ) => {
    setPendingRecommendedSkills(
      Array.from(new Set(recommendedSkills.map((skill) => skill.trim()).filter(Boolean))),
    );
    setAssignmentForm((prev) => ({ ...prev, emp_id: employeeId }));
    setEmployeeSearchInput(`${employeeId} - ${employeeName}`);
    setIsEmployeeDropdownOpen(false);
    setAssignmentStep(0);
    setIsAssignFormOpen(true);
    setIsSkillSearchOpen(false);
  };

  useEffect(() => {
    const loadCatalog = async () => {
      if (Object.keys(employeeSkillCatalogMap).length > 0) return;
      try {
        const catalog = await fetchSkillCatalog();
        const mapped = catalog.reduce<Record<number, string>>((acc, row) => {
          acc[row.skill_id] = row.skill_name;
          return acc;
        }, {});
        setEmployeeSkillCatalogMap(mapped);
      } catch (err) {
        console.error('Failed to load skill catalog:', err);
      }
    };
    loadCatalog();
  }, [employeeSkillCatalogMap]);

  useEffect(() => {
    const loadEmployeeSkills = async () => {
      if (!isAssignFormOpen || !assignmentForm.emp_id) {
        setEmployeeAvailableSkills([]);
        setSelectedAssignmentSkills([]);
        setIsEmployeeSkillsDropdownOpen(false);
        return;
      }

      setIsEmployeeSkillsLoading(true);
      try {
        const assignments = await fetchEmployeeSkillAssignments(assignmentForm.emp_id);
        const names = assignments
          .map((row) => employeeSkillCatalogMap[row.skill_id])
          .filter((name): name is string => Boolean(name))
          .sort((a, b) => a.localeCompare(b));
        setEmployeeAvailableSkills(names);

        if (pendingRecommendedSkills.length > 0) {
          const preselected = names.filter((name) =>
            pendingRecommendedSkills.some((rec) => rec.toLowerCase() === name.toLowerCase()),
          );
          setSelectedAssignmentSkills(preselected.length > 0 ? preselected : names.slice(0, Math.min(2, names.length)));
          setPendingRecommendedSkills([]);
        } else {
          setSelectedAssignmentSkills((prev) => prev.filter((skill) => names.includes(skill)));
        }
      } catch (err) {
        console.error('Failed to load employee skills:', err);
        setEmployeeAvailableSkills([]);
        setSelectedAssignmentSkills([]);
      } finally {
        setIsEmployeeSkillsLoading(false);
      }
    };

    loadEmployeeSkills();
  }, [assignmentForm.emp_id, employeeSkillCatalogMap, isAssignFormOpen, pendingRecommendedSkills]);

  const runRecommendations = async (useAi: boolean) => {
    if (!desiredSkills.length) {
      setRecommendationError('Enter at least one desired skill.');
      return;
    }

    setIsRecommending(true);
    setRecommendationError('');
    try {
      const response = await projectService.recommendEmployeesBySkill(projectId, {
        requested_skills: desiredSkills,
        required_count: requiredCount,
        allow_existing_project_assignments: false,
        ai_enabled: useAi,
      });
      setRecommendations(response.data.results);
      setRequestedAiRecommendation(useAi);
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
      setRecommendationError('Unable to fetch recommendations.');
    } finally {
      setIsRecommending(false);
    }
  };

  const handleAssignEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignmentForm.emp_id || !assignmentForm.start_date) {
      alert('Please select employee and start date.');
      return;
    }
    if (selectedAssignmentSkills.length === 0) {
      alert('Please select at least one required skill from the employee.');
      return;
    }

    if (canAccessBilling && assignmentForm.is_billable && !assignmentForm.billing_rate) {
      alert('Please provide billing rate for billable assignments.');
      return;
    }

    setIsSavingAssignment(true);
    try {
      const payload: AssignmentCreateRequest = {
        emp_id: assignmentForm.emp_id,
        project_id: projectId,
        role: selectedAssignmentSkills.length
          ? `Skills: ${selectedAssignmentSkills.join(', ')}`
          : undefined,
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
        send_for_approval: isFullAccess ? assignmentForm.send_for_approval : undefined,
      };

      await projectService.assignEmployee(payload);
      const refreshed = await projectService.getProjectAssignments(projectId);
      setAssignments(refreshed.data);
      setCurrentAssignmentsPage(1);
      resetAssignmentForm();
      setIsAssignFormOpen(false);
    } catch (err) {
      console.error('Failed to assign employee:', err);
      const statusCode = (err as { response?: { status?: number } })?.response?.status;
      if (statusCode === 409) {
        alert('This employee is already actively assigned to this project.');
      } else {
        alert('Unable to assign employee');
      }
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
      setCurrentAssignmentsPage(1);
    } catch (err) {
      console.error('Failed to unassign resource:', err);
      alert('Unable to unassign resource');
    }
  };

  const handleSaveTimeline = async () => {
    if (isFullAccess) {
      if (!timelineForm.planned_start_date || !timelineForm.planned_end_date) {
        alert('Please provide planned start and planned end dates.');
        return;
      }

      if (timelineForm.planned_start_date > timelineForm.planned_end_date) {
        alert('Planned end date cannot be before planned start date.');
        return;
      }
    }

    if (
      timelineForm.actual_start_date &&
      timelineForm.actual_end_date &&
      timelineForm.actual_end_date < timelineForm.actual_start_date
    ) {
      alert('Actual end date cannot be before actual start date.');
      return;
    }

    if (isFullAccess) {
      const plannedChanged =
        (project?.planned_start_date || '') !== timelineForm.planned_start_date ||
        (project?.planned_end_date || '') !== timelineForm.planned_end_date;
      if (plannedChanged && !timelineForm.reason_for_change.trim()) {
        alert('Reason for change is required when planned dates are updated.');
        return;
      }
    }

    setIsSavingTimeline(true);
    try {
      const payload = isFullAccess
        ? {
            planned_start_date: timelineForm.planned_start_date,
            planned_end_date: timelineForm.planned_end_date,
            actual_start_date: timelineForm.actual_start_date || undefined,
            actual_end_date: timelineForm.actual_end_date || undefined,
            reason_for_change: timelineForm.reason_for_change.trim() || undefined,
          }
        : {
            actual_start_date: timelineForm.actual_start_date || undefined,
            actual_end_date: timelineForm.actual_end_date || undefined,
          };

      const updated = await projectService.updateProject(projectId, payload);
      const timelineHistory = await projectService.getProjectTimelines(projectId);
      setProject(updated.data);
      setTimelines(timelineHistory.data);
      setTimelineForm({
        planned_start_date: updated.data.planned_start_date || '',
        planned_end_date: updated.data.planned_end_date || '',
        actual_start_date: updated.data.actual_start_date || '',
        actual_end_date: updated.data.actual_end_date || '',
        reason_for_change: '',
      });
    } catch (err) {
      console.error('Failed to update timeline:', err);
      alert('Unable to update timeline');
    } finally {
      setIsSavingTimeline(false);
    }
  };

  const hasStatusChanges = assignments.some((asgn) => {
    if (asgn.status === 'Ended') return false;
    const draft = statusDrafts[asgn.assignment_id];
    return Boolean(draft && draft !== asgn.status);
  });

  const handleSaveStatusChanges = async () => {
    const changedAssignments = assignments.filter((asgn) => {
      if (asgn.status === 'Ended') return false;
      const draft = statusDrafts[asgn.assignment_id];
      return Boolean(draft && draft !== asgn.status);
    });

    if (!changedAssignments.length) {
      return;
    }

    setIsSavingStatusChanges(true);
    try {
      await Promise.all(
        changedAssignments.map((asgn) =>
          projectService.updateAssignment(asgn.assignment_id, {
            status: statusDrafts[asgn.assignment_id] as 'Planned' | 'Active',
          }),
        ),
      );

      const refreshed = await projectService.getProjectAssignments(projectId);
      setAssignments(refreshed.data);
      setStatusDrafts({});
      setCurrentAssignmentsPage(1);
    } catch (err) {
      console.error('Failed to save status changes:', err);
      alert('Unable to save status changes');
    } finally {
      setIsSavingStatusChanges(false);
    }
  };

  const handleApproveAssignment = async (assignmentId: number) => {
    try {
      await projectService.updateAssignmentApproval(assignmentId, {
        approval_status: 'Approved',
      });
      const refreshed = await projectService.getProjectAssignments(projectId);
      setAssignments(refreshed.data);
    } catch (err) {
      console.error('Failed to approve assignment:', err);
      alert('Unable to approve assignment');
    }
  };

  const handleRejectAssignment = async (assignmentId: number) => {
    const note = window.prompt('Enter rejection note (required):', '');
    if (!note || !note.trim()) {
      alert('Rejection note is required.');
      return;
    }

    try {
      await projectService.updateAssignmentApproval(assignmentId, {
        approval_status: 'Rejected',
        approval_note: note.trim(),
      });
      const refreshed = await projectService.getProjectAssignments(projectId);
      setAssignments(refreshed.data);
    } catch (err) {
      console.error('Failed to reject assignment:', err);
      alert('Unable to reject assignment');
    }
  };

  const handleApproveProject = async () => {
    if (!project) return;

    setIsSavingApproval(true);
    try {
      await projectService.updateApproval(project.project_id, {
        approval_status: 'Approved',
        approval_note: undefined,
      });
      await fetchProjectData();
      setProjectRejectReason('');
    } catch (err) {
      console.error('Failed to approve project:', err);
      alert('Unable to approve project');
    } finally {
      setIsSavingApproval(false);
    }
  };

  const handleRejectProject = async () => {
    setIsProjectRejectModalOpen(true);
  };

  const handleConfirmProjectReject = async () => {
    if (!project) return;

    if (!projectRejectReason.trim()) {
      alert('Rejection reason is required.');
      return;
    }

    setIsSavingApproval(true);
    try {
      await projectService.updateApproval(project.project_id, {
        approval_status: 'Rejected',
        approval_note: projectRejectReason.trim(),
      });
      await fetchProjectData();
      setProjectRejectReason('');
      setIsProjectRejectModalOpen(false);
    } catch (err) {
      console.error('Failed to reject project:', err);
      alert('Unable to reject project');
    } finally {
      setIsSavingApproval(false);
    }
  };

  if (loading) return <div className="loading-state">Loading Project Details...</div>;
  if (Number.isNaN(projectId)) return <div className="error-state">Invalid project route.</div>;
  if (!project) return <div className="error-state">Project not found.</div>;

  const renderAssignmentSkills = (roleValue?: string) => {
    if (!roleValue || !roleValue.trim()) return 'Not specified';
    const normalized = roleValue.trim();
    if (normalized.toLowerCase().startsWith('skills:')) {
      return normalized.slice(7).trim() || 'Not specified';
    }
    return normalized;
  };

  const assignmentTotalPages = Math.ceil(assignments.length / RESOURCES_PER_PAGE);
  const safeAssignmentsPage = assignmentTotalPages === 0 ? 1 : Math.min(currentAssignmentsPage, assignmentTotalPages);
  const assignmentStartIndex = (safeAssignmentsPage - 1) * RESOURCES_PER_PAGE;
  const paginatedAssignments = assignments.slice(
    assignmentStartIndex,
    assignmentStartIndex + RESOURCES_PER_PAGE,
  );

  return (
    <div className="project-detail-container">
      <div className="detail-header">
        <button onClick={() => navigate(`${roleBasePath}/projects`)} className="btn-back">Back to Portfolio</button>
        <h1>{project.project_name}</h1>
        <span className={`status-pill ${project.project_status.toLowerCase()}`}>
          {project.project_status}
        </span>
      </div>

      <div className="detail-grid">
        <section className="detail-card full-width">
          <h3>Description</h3>
          <p>{project.description || 'No description provided for this project.'}</p>
          <div className="meta-info">
            <div className="info-item"><strong>Client:</strong> {project.client_name || 'Internal'}</div>
            <div className="info-item"><strong>Manager:</strong> {project.manager_name || 'Not Assigned'}</div>
            <div className="info-item">
              <strong>Approval Status:</strong> {project.approval_status}
            </div>
            <div className="info-item">
              <strong>Approved By Manager ID:</strong> {project.approved_by_manager_id ?? '-'}
            </div>
            <div className="info-item">
              <strong>Approval Time:</strong>{' '}
              {project.approved_at ? new Date(project.approved_at).toLocaleString() : '-'}
            </div>
            <div className="info-item">
              <strong>Approval Note:</strong> {project.approval_note || '-'}
            </div>
            <div className="date-pair-row">
              <div className="info-item"><strong>Planned Start Date:</strong> {project.planned_start_date ? new Date(project.planned_start_date).toLocaleDateString() : 'Not Set'}</div>
              <div className="info-item"><strong>Actual Start Date:</strong> {project.actual_start_date ? new Date(project.actual_start_date).toLocaleDateString() : 'Not Set'}</div>
            </div>
            <div className="date-pair-row">
              <div className="info-item"><strong>Planned End Date:</strong> {project.planned_end_date ? new Date(project.planned_end_date).toLocaleDateString() : 'Not Set'}</div>
              <div className="info-item"><strong>Actual End Date:</strong> {project.actual_end_date ? new Date(project.actual_end_date).toLocaleDateString() : 'Not Set'}</div>
            </div>
            {canUpdateTimeline && (
              <div className="actual-dates-editor">
                {isFullAccess && (
                  <>
                    <div className="actual-date-field">
                      <label>Planned Start Date</label>
                      <input
                        type="date"
                        value={timelineForm.planned_start_date}
                        onChange={(e) =>
                          setTimelineForm((prev) => ({ ...prev, planned_start_date: e.target.value }))
                        }
                      />
                    </div>
                    <div className="actual-date-field">
                      <label>Planned End Date</label>
                      <input
                        type="date"
                        value={timelineForm.planned_end_date}
                        min={timelineForm.planned_start_date || undefined}
                        onChange={(e) =>
                          setTimelineForm((prev) => ({ ...prev, planned_end_date: e.target.value }))
                        }
                      />
                    </div>
                  </>
                )}
                <div className="actual-date-field">
                  <label>Actual Start Date</label>
                  <input
                    type="date"
                    value={timelineForm.actual_start_date}
                    onChange={(e) =>
                      setTimelineForm((prev) => ({ ...prev, actual_start_date: e.target.value }))
                    }
                  />
                </div>
                <div className="actual-date-field">
                  <label>Actual End Date</label>
                  <input
                    type="date"
                    value={timelineForm.actual_end_date}
                    min={timelineForm.actual_start_date || undefined}
                    onChange={(e) =>
                      setTimelineForm((prev) => ({ ...prev, actual_end_date: e.target.value }))
                    }
                  />
                </div>
                {isFullAccess && (
                  <div className="actual-date-field actual-date-field-full">
                    <label>Reason For Change</label>
                    <input
                      type="text"
                      value={timelineForm.reason_for_change}
                      placeholder="Required when changing planned dates"
                      onChange={(e) =>
                        setTimelineForm((prev) => ({ ...prev, reason_for_change: e.target.value }))
                      }
                    />
                  </div>
                )}
                <div className="actual-date-field actual-date-field-full">
                  <button
                    type="button"
                    className="save-actual-date-btn"
                    onClick={handleSaveTimeline}
                    disabled={isSavingTimeline}
                  >
                    {isSavingTimeline ? 'Saving...' : 'Save Timeline'}
                  </button>
                </div>
              </div>
            )}
            <div className="info-item"><strong>Created:</strong> {new Date(project.created_at).toLocaleDateString()}</div>
            <div id="approval-section" ref={approvalSectionRef}>
            {project.can_current_user_approve ? (
              <div className="actual-dates-editor">
                <div className="actual-date-field actual-date-field-full flex gap-3">
                  {project.approval_status === 'Rejected' ? (
                    <button
                      type="button"
                      className="approval-action-btn approval-action-btn-approve"
                      onClick={handleApproveProject}
                      disabled={isSavingApproval}
                    >
                      {isSavingApproval ? 'Saving...' : 'Approve Project'}
                    </button>
                  ) : project.approval_status === 'Approved' ? (
                    <button
                      type="button"
                      className="approval-action-btn approval-action-btn-reject"
                      onClick={handleRejectProject}
                      disabled={isSavingApproval}
                    >
                      {isSavingApproval ? 'Saving...' : 'Reject Project'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="approval-action-btn approval-action-btn-approve"
                        onClick={handleApproveProject}
                        disabled={isSavingApproval}
                      >
                        {isSavingApproval ? 'Saving...' : 'Approve Project'}
                      </button>
                      <button
                        type="button"
                        className="approval-action-btn approval-action-btn-reject"
                        onClick={handleRejectProject}
                        disabled={isSavingApproval}
                      >
                        {isSavingApproval ? 'Saving...' : 'Reject Project'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              normalizedRoles.includes('manager') && (
                <div className="info-item text-amber-700">
                  You can view this project, but only assigned manager can approve.
                </div>
              )
            )}
            </div>
          </div>
        </section>

        <section className="detail-card full-width">
          <div className="section-header">
            <h3>Timeline Version History</h3>
          </div>
          <div className="timeline-history-list">
            {timelines.length === 0 ? (
              <div className="empty-row">No timeline history yet.</div>
            ) : (
              timelines.map((timeline) => (
                <div key={timeline.timeline_id} className="timeline-history-item">
                  <div><strong>Version:</strong> V{timeline.version_number} {timeline.is_current ? '(Current)' : ''}</div>
                  <div><strong>Planned:</strong> {timeline.planned_start_date || '-'} to {timeline.planned_end_date || '-'}</div>
                  <div><strong>Actual:</strong> {timeline.actual_start_date || '-'} to {timeline.actual_end_date || '-'}</div>
                  <div><strong>Reason:</strong> {timeline.reason_for_change || '-'}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="detail-card full-width">
          <div className="section-header assign-toolbar">
            <h3>Resource Assignment</h3>
            {canWriteAssignments && (
              <div className="assign-action-group">
                <button
                  type="button"
                  className="assign-toggle-btn assign-search-btn"
                  onClick={() => {
                    setIsSkillSearchOpen(true);
                    setRecommendationError('');
                  }}
                >
                  Search by Skill / Tech Stack
                </button>
                <button
                  type="button"
                  className="assign-toggle-btn"
                  onClick={() => {
                    if (isAssignFormOpen) {
                      setIsAssignFormOpen(false);
                      setAssignmentStep(0);
                      return;
                    }
                    setAssignmentStep(0);
                    setIsAssignFormOpen(true);
                  }}
                >
                  {isAssignFormOpen ? 'Close Form' : 'Assign Resource'}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="detail-card full-width">
          <div className="section-header">
            <h3>Assigned Resources</h3>
          </div>
          <div className="assignment-table-container data-table-container">
            <table className="assignment-table data-table">
              <thead>
                <tr>
                  <th>Resource ID</th>
                  <th>Skills</th>
                  <th className="allocation-pct-col">Allocation Percentage</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th>Active Status</th>
                {canAccessBilling && (
                  <>
                    <th>Billable Status</th>
                    <th>Billing Rate</th>
                      <th>Billing Start</th>
                      <th>Billing End</th>
                    </>
                  )}
                  <th>Status</th>
                  <th>Approval Status</th>
                  {showApprovalActionColumn && <th>Approval Action</th>}
                  {showLifecycleActionColumn && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedAssignments.map((asgn) => (
                  <tr key={asgn.assignment_id}>
                    <td>
                      <div className="resource-id-block">
                        <div className="resource-id-text">{asgn.emp_id}</div>
                        <div className="resource-name-text">
                          {employees.find((emp) => emp.emp_id === asgn.emp_id)?.full_name || 'Unknown Resource'}
                        </div>
                      </div>
                    </td>
                    <td>{renderAssignmentSkills(asgn.role)}</td>
                    <td className="allocation-pct-col">{asgn.allocation_pct}%</td>
                    <td>{new Date(asgn.start_date).toLocaleDateString()}</td>
                    <td>{asgn.end_date ? new Date(asgn.end_date).toLocaleDateString() : '-'}</td>
                    <td>
                      <span className={`allocation-status-label ${asgn.status === 'Active' ? 'active' : 'inactive'}`}>
                        {asgn.status === 'Active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                {canAccessBilling && (
                  <>
                    <td>{asgn.is_billable ? 'Yes' : 'No'}</td>
                    <td>
                          {asgn.billing_rate != null
                            ? `$${asgn.billing_rate}`
                            : '-'}
                        </td>
                        <td>{asgn.billing_start_date ? new Date(asgn.billing_start_date).toLocaleDateString() : '-'}</td>
                        <td>{asgn.billing_end_date ? new Date(asgn.billing_end_date).toLocaleDateString() : '-'}</td>
                      </>
                    )}
                    <td>
                      {canEditAssignmentStatus && asgn.status !== 'Ended' ? (
                        <select
                          className="status-inline-select"
                          value={statusDrafts[asgn.assignment_id] ?? (asgn.status as 'Planned' | 'Active')}
                          onChange={(e) =>
                            setStatusDrafts((prev) => ({
                              ...prev,
                              [asgn.assignment_id]: e.target.value as 'Planned' | 'Active',
                            }))
                          }
                        >
                          <option value="Planned">Planned</option>
                          <option value="Active">Active</option>
                        </select>
                      ) : (
                        asgn.status
                      )}
                    </td>
                    <td>{asgn.approval_status || 'Pending'}</td>
                    {showApprovalActionColumn && (
                      <td>
                        {canApproveAssignments && asgn.can_current_user_approve ? (
                          <div className="assignment-approval-actions">
                            <button
                              className="approval-chip approval-chip-approve"
                              onClick={() => handleApproveAssignment(asgn.assignment_id)}
                              type="button"
                            >
                              Approve
                            </button>
                            <button
                              className="approval-chip approval-chip-reject"
                              onClick={() => handleRejectAssignment(asgn.assignment_id)}
                              type="button"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    )}
                    {showLifecycleActionColumn && (
                      <td>
                        {canEditAssignmentStatus && asgn.status !== 'Ended' ? (
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
                    )}
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr>
                    <td
                      colSpan={
                        8 +
                        (canAccessBilling ? 4 : 0) +
                        (showApprovalActionColumn ? 1 : 0) +
                        (showLifecycleActionColumn ? 1 : 0)
                      }
                      className="empty-row"
                    >
                      No resources assigned yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {canEditAssignmentStatus && (
            <div className="assignment-bulk-actions">
              <button
                type="button"
                className="save-status-changes-btn"
                onClick={handleSaveStatusChanges}
                disabled={!hasStatusChanges || isSavingStatusChanges}
              >
                {isSavingStatusChanges ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
          {assignmentTotalPages > 1 && (
            <div className="assignment-pagination">
              <button
                type="button"
                onClick={() => setCurrentAssignmentsPage((prev) => Math.max(prev - 1, 1))}
                disabled={safeAssignmentsPage === 1}
                className="assignment-page-btn"
              >
                Previous
              </button>
              <span className="assignment-page-meta">
                Page {safeAssignmentsPage} of {assignmentTotalPages}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCurrentAssignmentsPage((prev) =>
                    Math.min(prev + 1, assignmentTotalPages),
                  )
                }
                disabled={safeAssignmentsPage === assignmentTotalPages}
                className="assignment-page-btn"
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>

      {isSkillSearchOpen && canWriteAssignments && (
        <div
          className="assignment-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSkillSearchOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-search-title"
        >
          <div className="assignment-modal skill-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="assignment-modal-header">
              <h3 id="skill-search-title">Search by Skill / Tech Stack</h3>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setIsSkillSearchOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="skill-search-meta-grid">
              <div className="field-with-help">
                <label>Desired Skills (comma separated)</label>
                <input
                  type="text"
                  value={desiredSkillsInput}
                  onChange={(e) => setDesiredSkillsInput(e.target.value)}
                  className="skill-search-input"
                  placeholder="Try: React, Python, FastAPI"
                />
              </div>
              <div className="field-with-help">
                <label>Need More Employees</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  className="skill-search-input"
                  value={requiredCount}
                  onChange={(e) => setRequiredCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                />
              </div>
            </div>
            <div className="recommendation-panel">
              <div className="recommendation-panel-header">
                <h4>AI Recommendations</h4>
                <div className="recommendation-actions">
                  
                 
                </div>
              </div>
              {recommendationError && <div className="skill-search-error">{recommendationError}</div>}
              {requestedAiRecommendation && recommendations.length > 0 && (
                <div className="muted"></div>
              )}
              <div className="skill-search-results">
                {recommendations.map((result) => (
                  <div key={`rec-${result.emp_id}`} className="skill-search-card recommendation-card">
                    <div className="skill-search-card-header">
                      <div>
                        <div className="resource-id-text">{result.emp_id}</div>
                        <div className="resource-name-text">{result.full_name}</div>
                      </div>
                    </div>
                    <div className="skill-tag-wrap">
                      {result.matched_skills.map((skill) => (
                        <span key={`exact-${result.emp_id}-${skill}`} className="skill-tag">
                          {skill}
                        </span>
                      ))}
                      {result.related_skills.map((skill) => (
                        <span key={`related-${result.emp_id}-${skill}`} className="skill-tag skill-tag-related">
                          {skill}
                        </span>
                      ))}
                    </div>
                    {Object.entries(result.skill_groups || {}).length > 0 && (
                      <div className="skill-group-list">
                        {Object.entries(result.skill_groups).map(([group, skills]) => (
                          <div key={`${result.emp_id}-${group}`} className="skill-group-item">
                            <span className="skill-group-title">{group}:</span> {skills.join(', ')}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="recommendation-rationale">{result.rationale}</div>
                    {result.relevance_note && (
                      <div className="recommendation-note">{result.relevance_note}</div>
                    )}
                    {result.already_allocated_to_project && (
                      <div className="skill-search-warning">
                        This employee is already allocated to this project.
                      </div>
                    )}
                    <div className="skill-search-actions">
                      <button
                        type="button"
                        className="assign-top-submit"
                        onClick={() =>
                          openAssignmentWithEmployeeSkills(
                            result.emp_id,
                            result.full_name,
                            [...result.matched_skills, ...result.related_skills],
                          )
                        }
                      >
                        Use this employee
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {!isRecommending && desiredSkills.length > 0 && recommendations.length === 0 && !recommendationError && (
                <div className="empty-row">No AI recommendations found for the provided skills.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {isAssignFormOpen && canWriteAssignments && (
        <div
          className="assignment-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAssignFormOpen(false);
          }}
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
              <h3 id="assign-resource-title">Resource Assignment</h3>
            </div>

            <div className="flex items-center gap-2 p-2 rounded-xl border border-gray-200 bg-gray-50 mb-2">
              {[
                { label: 'Assignment Basics' },
                { label: 'Approval & Billing' },
              ].map((step, index) => {
                const isActive = index === assignmentStep;
                const isCompleted = index < assignmentStep;
                return (
                  <div key={step.label} className="flex items-center flex-1">
                    <div
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-semibold ${
                        isActive
                          ? 'bg-blue-500 text-white'
                          : isCompleted
                            ? 'bg-green-500 text-white'
                            : 'bg-white text-gray-600 border border-gray-200'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white/30 flex items-center justify-center text-[10px]">
                        {index + 1}
                      </span>
                      <span className="whitespace-nowrap">{step.label}</span>
                    </div>
                    {index < 1 && (
                      <div className={`h-0.5 flex-1 mx-2 ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`} />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="assignment-form">
              {assignmentStep === 0 ? (
                <>
                  <div className="field-with-help">
                    <label>Employee</label>
                    <div className="employee-dropdown" ref={employeeDropdownRef}>
                      <input
                        type="text"
                        className="employee-dropdown-trigger"
                        value={employeeSearchInput}
                        placeholder="Search employee ID or name"
                        onChange={(e) => {
                          setEmployeeSearchInput(e.target.value);
                          setAssignmentForm({ ...assignmentForm, emp_id: '' });
                          setIsEmployeeDropdownOpen(true);
                        }}
                        onFocus={() => setIsEmployeeDropdownOpen(true)}
                      />
                      {isEmployeeDropdownOpen && (
                        <div className="employee-dropdown-menu">
                          <div className="employee-dropdown-list">
                            {filteredEmployees.length > 0 ? (
                              filteredEmployees.map((employee) => (
                                <button
                                  key={employee.emp_id}
                                  type="button"
                                  className="employee-dropdown-item"
                                  onClick={() => {
                                    setAssignmentForm({ ...assignmentForm, emp_id: employee.emp_id });
                                    setEmployeeSearchInput(`${employee.emp_id} - ${employee.full_name}`);
                                    setIsEmployeeDropdownOpen(false);
                                  }}
                                >
                                  {employee.emp_id} - {employee.full_name}
                                </button>
                              ))
                            ) : (
                              <div className="employee-dropdown-empty">No matching employees</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <input type="hidden" value={assignmentForm.emp_id} required />
                  </div>

                  <div className="field-with-help">
                    <label>Required Skills from Employee</label>
                    <div className="employee-skill-dropdown" ref={employeeSkillsDropdownRef}>
                      <button
                        type="button"
                        className="employee-skill-trigger"
                        disabled={!assignmentForm.emp_id || isEmployeeSkillsLoading}
                        onClick={() => setIsEmployeeSkillsDropdownOpen((prev) => !prev)}
                      >
                        {isEmployeeSkillsLoading
                          ? 'Loading skills...'
                          : selectedAssignmentSkills.length > 0
                            ? `${selectedAssignmentSkills.length} skill(s) selected`
                            : assignmentForm.emp_id
                              ? 'Select required skills'
                              : 'Select employee first'}
                      </button>
                      {isEmployeeSkillsDropdownOpen && (
                        <div className="employee-skill-menu">
                          {employeeAvailableSkills.length > 0 ? (
                            employeeAvailableSkills.map((skill) => {
                              const checked = selectedAssignmentSkills.includes(skill);
                              return (
                                <label key={skill} className="employee-skill-item">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedAssignmentSkills((prev) => [...prev, skill]);
                                      } else {
                                        setSelectedAssignmentSkills((prev) =>
                                          prev.filter((currentSkill) => currentSkill !== skill),
                                        );
                                      }
                                    }}
                                  />
                                  <span>{skill}</span>
                                </label>
                              );
                            })
                          ) : (
                            <div className="employee-dropdown-empty">No skills found for this employee</div>
                          )}
                        </div>
                      )}
                    </div>
                    {selectedAssignmentSkills.length > 0 && (
                      <div className="selected-skill-chips">
                        {selectedAssignmentSkills.map((skill) => (
                          <span key={skill} className="skill-tag">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
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
                </>
              ) : (
                <>
                  {isFullAccess && (
                    <div className="field-with-help">
                      <label>Send For Manager Approval</label>
                      <select
                        value={assignmentForm.send_for_approval ? 'Yes' : 'No'}
                        onChange={(e) =>
                          setAssignmentForm({
                            ...assignmentForm,
                            send_for_approval: e.target.value === 'Yes',
                          })
                        }
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                  )}

                  {canAccessBilling && (
                    <>
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
                    </>
                  )}
                </>
              )}
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
              {assignmentStep > 0 && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setAssignmentStep((prev) => Math.max(prev - 1, 0))}
                >
                  Back
                </button>
              )}
              {assignmentStep === 0 ? (
                <button
                  type="button"
                  className="assign-top-submit"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!assignmentForm.emp_id || !assignmentForm.start_date) {
                      alert('Please select employee and start date.');
                      return;
                    }
                    if (selectedAssignmentSkills.length === 0) {
                      alert('Please select at least one required skill from the employee.');
                      return;
                    }
                    setAssignmentStep(1);
                  }}
                >
                  Continue to Step 2
                </button>
              ) : (
                <button type="submit" className="assign-top-submit" disabled={isSavingAssignment}>
                  {isSavingAssignment ? 'Saving...' : 'Assign Resource'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {isProjectRejectModalOpen && (
        <div
          className="project-reject-modal-overlay"
          onClick={() => {
            if (!isSavingApproval) setIsProjectRejectModalOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-reject-title"
        >
          <div className="project-reject-modal" onClick={(e) => e.stopPropagation()}>
            <div className="project-reject-modal-header">
              <h3 id="project-reject-title">Reject Project</h3>
              <p>Please provide a clear reason for rejection.</p>
            </div>
            <div className="field-with-help project-reject-field">
              <label>Reason for rejection</label>
              <textarea
                className="project-reject-textarea"
                value={projectRejectReason}
                onChange={(e) => setProjectRejectReason(e.target.value)}
                placeholder="Enter reason for rejecting this project"
                rows={4}
              />
            </div>
            <div className="assignment-form-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={isSavingApproval}
                onClick={() => setIsProjectRejectModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="approval-action-btn approval-action-btn-reject"
                disabled={isSavingApproval}
                onClick={handleConfirmProjectReject}
              >
                {isSavingApproval ? 'Saving...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDetail;
