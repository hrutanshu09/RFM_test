/**
 * ============================================================================
 * CANDIDATE & INTERVIEW API
 * ============================================================================
 *
 * CRUD + pipeline operations for the Candidate Pipeline feature.
 * Replaces the old "Available Employees" placeholder.
 */

import { apiClient } from "./client";

/** Message shown when backend returns 403 (user is not the assigned TA for the requisition). */
export const TA_OWNERSHIP_DENIED_MESSAGE =
  "Access Denied: You are not the assigned TA for this requisition.";

export function getCandidateActionErrorMessage(
  err: unknown,
  fallback: string,
): string {
  const ax = err as {
    response?: { status?: number; data?: { detail?: string } };
  };
  const detail = ax?.response?.data?.detail;
  if (ax?.response?.status === 403) {
    return typeof detail === "string" && detail.trim().length > 0
      ? detail
      : TA_OWNERSHIP_DENIED_MESSAGE;
  }
  return typeof detail === "string" ? detail : fallback;
}

// ============================================================================
// TYPES
// ============================================================================

export interface Interview {
  id: number;
  candidate_id: number;
  round_number: number;
  interviewer_name: string;
  scheduled_at: string;
  status: "Scheduled" | "Completed" | "Cancelled";
  result: "Pass" | "Fail" | "Hold" | null;
  feedback: string | null;
  conducted_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Candidate {
  candidate_id: number;
  requisition_item_id: number;
  requisition_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  resume_path: string | null;
  current_stage:
    | "Sourced"
    | "Shortlisted"
    | "Interviewing"
    | "Offered"
    | "Hired"
    | "Rejected";
  added_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  interviews: Interview[];
}

export interface CandidateCreate {
  requisition_item_id: number;
  requisition_id: number;
  full_name: string;
  email: string;
  phone?: string;
  resume_path?: string;
}

export interface InterviewCreate {
  candidate_id: number;
  round_number: number;
  interviewer_name: string;
  scheduled_at: string; // ISO datetime
}

export interface InterviewUpdate {
  interviewer_name?: string;
  scheduled_at?: string;
  status?: "Scheduled" | "Completed" | "Cancelled";
  result?: "Pass" | "Fail" | "Hold";
  feedback?: string;
}

export interface CandidateStageUpdate {
  new_stage: Candidate["current_stage"];
  reason?: string;
}

// ============================================================================
// CANDIDATE ENDPOINTS
// ============================================================================

export async function fetchCandidates(
  requisitionId: number,
): Promise<Candidate[]> {
  const { data } = await apiClient.get<Candidate[]>("/candidates/", {
    params: { requisition_id: requisitionId },
  });
  return data;
}

export async function fetchCandidatesByItem(
  itemId: number,
): Promise<Candidate[]> {
  const { data } = await apiClient.get<Candidate[]>("/candidates/", {
    params: { requisition_item_id: itemId },
  });
  return data;
}

export async function getCandidate(candidateId: number): Promise<Candidate> {
  const { data } = await apiClient.get<Candidate>(`/candidates/${candidateId}`);
  return data;
}

export async function createCandidate(
  payload: CandidateCreate,
): Promise<Candidate> {
  const { data } = await apiClient.post<Candidate>("/candidates/", payload);
  return data;
}

export async function updateCandidateStage(
  candidateId: number,
  payload: CandidateStageUpdate,
): Promise<Candidate> {
  const { data } = await apiClient.patch<Candidate>(
    `/candidates/${candidateId}/stage`,
    payload,
  );
  return data;
}

export async function deleteCandidate(candidateId: number): Promise<void> {
  await apiClient.delete(`/candidates/${candidateId}`);
}

// ============================================================================
// INTERVIEW ENDPOINTS
// ============================================================================

export async function fetchInterviews(
  candidateId: number,
): Promise<Interview[]> {
  const { data } = await apiClient.get<Interview[]>("/interviews/", {
    params: { candidate_id: candidateId },
  });
  return data;
}

export async function createInterview(
  payload: InterviewCreate,
): Promise<Interview> {
  const { data } = await apiClient.post<Interview>("/interviews/", payload);
  return data;
}

export async function updateInterview(
  interviewId: number,
  payload: InterviewUpdate,
): Promise<Interview> {
  const { data } = await apiClient.patch<Interview>(
    `/interviews/${interviewId}`,
    payload,
  );
  return data;
}

export async function deleteInterview(interviewId: number): Promise<void> {
  await apiClient.delete(`/interviews/${interviewId}`);
}

// ============================================================================
// RESUME UPLOAD
// ============================================================================

export async function uploadResume(
  file: File,
): Promise<{ file_url: string; filename: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post<{ file_url: string; filename: string }>(
    "/uploads/resume",
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}
