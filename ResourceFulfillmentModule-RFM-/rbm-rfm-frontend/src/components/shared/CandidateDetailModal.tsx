/**
 * CandidateDetailModal — Shared modal for TA & HR views
 *
 * Sections:
 *  1. Resume Viewer (iframe for PDF, download link for others)
 *  2. Interview Timeline (vertical timeline of rounds)
 *  3. Round Scheduler (multi-step form to add interviews)
 *  4. Stage transition actions
 */
import React, { useState, useEffect } from "react";
import {
  X,
  FileText,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  Plus,
  ChevronDown,
  ChevronUp,
  Download,
  User,
  Mail,
  Phone,
  Trash2,
} from "lucide-react";
import type { Candidate, Interview } from "../../api/candidateApi";
import {
  createInterview,
  updateInterview,
  updateCandidateStage,
  deleteInterview,
  getCandidate,
  getCandidateActionErrorMessage,
} from "../../api/candidateApi";
import { apiClient } from "../../api/client";

/** Re-export for callers that need the 403 message text. */
export { TA_OWNERSHIP_DENIED_MESSAGE } from "../../api/candidateApi";

interface CandidateDetailModalProps {
  candidate: Candidate;
  onClose: () => void;
  onUpdate: (updated: Candidate) => void;
  /** Roles that the current user has — used to show/hide action buttons */
  userRoles: string[];
  /** Base URL for the API to construct resume download URLs */
  apiBaseUrl?: string;
}

const STAGE_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  Sourced: {
    bg: "rgba(100,116,139,0.1)",
    text: "#64748b",
    border: "rgba(100,116,139,0.3)",
  },
  Shortlisted: {
    bg: "rgba(59,130,246,0.1)",
    text: "#3b82f6",
    border: "rgba(59,130,246,0.3)",
  },
  Interviewing: {
    bg: "rgba(168,85,247,0.1)",
    text: "#a855f7",
    border: "rgba(168,85,247,0.3)",
  },
  Offered: {
    bg: "rgba(245,158,11,0.1)",
    text: "#f59e0b",
    border: "rgba(245,158,11,0.3)",
  },
  Hired: {
    bg: "rgba(16,185,129,0.1)",
    text: "#10b981",
    border: "rgba(16,185,129,0.3)",
  },
  Rejected: {
    bg: "rgba(239,68,68,0.1)",
    text: "#ef4444",
    border: "rgba(239,68,68,0.3)",
  },
};

const RESULT_COLORS: Record<string, string> = {
  Pass: "#10b981",
  Fail: "#ef4444",
  Hold: "#f59e0b",
};

/** Which forward transitions are available from each stage (UI side) */
const FORWARD_TRANSITIONS: Record<string, string[]> = {
  Sourced: ["Shortlisted", "Rejected"],
  Shortlisted: ["Interviewing", "Rejected"],
  Interviewing: ["Offered", "Rejected"],
  Offered: ["Hired", "Rejected"],
};

export default function CandidateDetailModal({
  candidate: initialCandidate,
  onClose,
  onUpdate,
  userRoles,
  apiBaseUrl,
}: CandidateDetailModalProps) {
  const [candidate, setCandidate] = useState<Candidate>(initialCandidate);
  const [showScheduler, setShowScheduler] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeBlobUrl, setResumeBlobUrl] = useState<string | null>(null);
  const [resumeMimeType, setResumeMimeType] = useState<string | null>(null);
  const [loadingResume, setLoadingResume] = useState(false);

  // Scheduler form state
  const [interviewerName, setInterviewerName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduling, setScheduling] = useState(false);

  // Inline interview update
  const [editingInterview, setEditingInterview] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<string>("");
  const [editResult, setEditResult] = useState<string>("");
  const [editFeedback, setEditFeedback] = useState<string>("");

  const normalizedRoles = userRoles.map((r) => r.toLowerCase());
  const canEdit = normalizedRoles.some((r) =>
    ["ta", "hr", "admin"].includes(r),
  );
  const stageColor =
    STAGE_COLORS[candidate.current_stage] ?? STAGE_COLORS["Sourced"]!;

  // Refresh candidate data
  const refresh = async () => {
    try {
      const updated = await getCandidate(candidate.candidate_id);
      setCandidate(updated);
      onUpdate(updated);
    } catch {
      // keep stale data
    }
  };

  // ---- Stage transition ----
  const handleStageChange = async (newStage: string) => {
    setError(null);
    setTransitioning(true);
    try {
      const updated = await updateCandidateStage(candidate.candidate_id, {
        new_stage: newStage as Candidate["current_stage"],
      });
      setCandidate(updated);
      onUpdate(updated);
    } catch (err: any) {
      setError(
        getCandidateActionErrorMessage(err, `Failed to move to ${newStage}`),
      );
    } finally {
      setTransitioning(false);
    }
  };

  // ---- Schedule interview ----
  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!interviewerName.trim() || !scheduledAt) return;

    // Client-side past-date guard
    if (new Date(scheduledAt) < new Date()) {
      setError("You cannot select a past date for the interview schedule");
      return;
    }

    setScheduling(true);
    try {
      await createInterview({
        candidate_id: candidate.candidate_id,
        round_number: candidate.interviews.length + 1,
        interviewer_name: interviewerName.trim(),
        scheduled_at: new Date(scheduledAt).toISOString(),
      });
      setInterviewerName("");
      setScheduledAt("");
      setShowScheduler(false);
      await refresh();
    } catch (err: any) {
      setError(
        getCandidateActionErrorMessage(err, "Failed to schedule interview"),
      );
    } finally {
      setScheduling(false);
    }
  };

  // ---- Update interview result ----
  const handleUpdateInterview = async (interview: Interview) => {
    setError(null);
    try {
      await updateInterview(interview.id, {
        status: editStatus as Interview["status"],
        result: editResult
          ? (editResult as NonNullable<Interview["result"]>)
          : undefined,
        feedback: editFeedback || undefined,
      });
      setEditingInterview(null);
      await refresh();
    } catch (err: any) {
      setError(
        getCandidateActionErrorMessage(err, "Failed to update interview"),
      );
    }
  };

  // ---- Delete interview ----
  const handleDeleteInterview = async (id: number) => {
    try {
      await deleteInterview(id);
      await refresh();
    } catch (err: any) {
      setError(
        getCandidateActionErrorMessage(err, "Failed to delete interview"),
      );
    }
  };

  useEffect(() => {
    if (!showResume || !candidate.resume_path) return;
    if (candidate.resume_path.startsWith("http")) return;

    const filename = candidate.resume_path.split(/[/\\]/).pop();
    if (!filename) return;

    let objectUrl: string | null = null;
    const loadResume = async () => {
      setLoadingResume(true);
      try {
        const response = await apiClient.get(`/uploads/resume/${filename}`, {
          responseType: "blob",
        });
        objectUrl = URL.createObjectURL(response.data);
        setResumeBlobUrl(objectUrl);
        setResumeMimeType(response.data.type || null);
      } catch {
        setResumeBlobUrl(null);
        setResumeMimeType(null);
      } finally {
        setLoadingResume(false);
      }
    };

    void loadResume();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [showResume, candidate.resume_path]);

  const resumeUrl = candidate.resume_path
    ? candidate.resume_path.startsWith("http")
      ? candidate.resume_path
      : resumeBlobUrl
    : null;

  const isPdf = resumeUrl
    ? // Remote URL: decide by extension
      candidate.resume_path?.toLowerCase().endsWith(".pdf") ||
      // Local blob: decide by MIME type OR original filename
      (resumeMimeType ?? "").toLowerCase().includes("pdf")
    : false;

  const resumeFilename =
    candidate.resume_path?.split(/[/\\]/).pop() ?? "resume";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.5)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: "90%",
          maxWidth: "720px",
          maxHeight: "90vh",
          backgroundColor: "var(--bg-primary)",
          borderRadius: "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
        }}
      >
        {/* ---- Header ---- */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
              {candidate.full_name}
            </h2>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginTop: "6px",
                fontSize: "13px",
                color: "var(--text-secondary)",
              }}
            >
              <span
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
              >
                <Mail size={13} /> {candidate.email}
              </span>
              {candidate.phone && (
                <span
                  style={{ display: "flex", alignItems: "center", gap: "4px" }}
                >
                  <Phone size={13} /> {candidate.phone}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                padding: "4px 12px",
                borderRadius: "20px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: stageColor.bg,
                color: stageColor.text,
                border: `1px solid ${stageColor.border}`,
              }}
            >
              {candidate.current_stage}
            </span>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                color: "var(--text-secondary)",
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ---- Body (scrollable) ---- */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {error && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#ef4444",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* ---- Stage Actions ---- */}
          {canEdit &&
            !["Hired", "Rejected"].includes(candidate.current_stage) && (
              <div style={{ marginBottom: "20px" }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text-tertiary)",
                    marginBottom: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Move Candidate
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {(FORWARD_TRANSITIONS[candidate.current_stage] ?? []).map(
                    (stage) => {
                      const sc =
                        STAGE_COLORS[stage] ?? STAGE_COLORS["Sourced"]!;
                      return (
                        <button
                          key={stage}
                          disabled={transitioning}
                          className="action-button"
                          style={{
                            fontSize: "12px",
                            padding: "6px 14px",
                            borderRadius: "8px",
                            backgroundColor: sc.bg,
                            color: sc.text,
                            border: `1px solid ${sc.border}`,
                            cursor: "pointer",
                          }}
                          onClick={() => handleStageChange(stage)}
                        >
                          → {stage}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            )}

          {/* ---- Resume Section ---- */}
          <div style={{ marginBottom: "24px" }}>
            <button
              onClick={() => setShowResume(!showResume)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "12px 16px",
                borderRadius: "10px",
                backgroundColor: "var(--bg-secondary)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontWeight: 600,
                  fontSize: "14px",
                }}
              >
                <FileText size={16} /> Resume
              </span>
              {showResume ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showResume && (
              <div
                style={{
                  marginTop: "8px",
                  borderRadius: "10px",
                  border: "1px solid var(--border-subtle)",
                  overflow: "hidden",
                }}
              >
                {loadingResume ? (
                  <div
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "var(--text-tertiary)",
                      fontSize: "13px",
                    }}
                  >
                    Loading resume...
                  </div>
                ) : resumeUrl ? (
                  <>
                    {isPdf ? (
                      <iframe
                        src={resumeUrl}
                        title="Resume"
                        style={{
                          width: "100%",
                          height: "400px",
                          border: "none",
                        }}
                      />
                    ) : (
                      <div style={{ padding: "24px", textAlign: "center" }}>
                        <FileText
                          size={32}
                          style={{
                            marginBottom: "8px",
                            color: "var(--text-tertiary)",
                          }}
                        />
                        <p
                          style={{
                            fontSize: "13px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          Preview not available for this file type.
                        </p>
                      </div>
                    )}
                    <div
                      style={{
                        padding: "10px 16px",
                        borderTop: "1px solid var(--border-subtle)",
                        display: "flex",
                        justifyContent: "flex-end",
                      }}
                    >
                      <a
                        href={resumeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={resumeFilename}
                        className="action-button"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          textDecoration: "none",
                        }}
                      >
                        <Download size={14} /> Download Resume
                      </a>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "var(--text-tertiary)",
                      fontSize: "13px",
                    }}
                  >
                    No resume uploaded yet.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---- Interview Timeline ---- */}
          <div style={{ marginBottom: "24px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <Calendar size={16} /> Interview Rounds (
                {candidate.interviews.length})
              </span>
              {canEdit && (
                <button
                  className="action-button primary"
                  style={{
                    fontSize: "12px",
                    padding: "6px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                  onClick={() => setShowScheduler(!showScheduler)}
                >
                  <Plus size={14} /> Schedule Round
                </button>
              )}
            </div>

            {/* Scheduler form */}
            {showScheduler && (
              <form
                onSubmit={handleSchedule}
                style={{
                  marginBottom: "16px",
                  padding: "16px",
                  borderRadius: "10px",
                  backgroundColor: "rgba(59,130,246,0.04)",
                  border: "1px solid rgba(59,130,246,0.15)",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    marginBottom: "12px",
                  }}
                >
                  Schedule Round {candidate.interviews.length + 1}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    marginBottom: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <label
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        display: "block",
                        marginBottom: "4px",
                      }}
                    >
                      Interviewer Name *
                    </label>
                    <input
                      type="text"
                      value={interviewerName}
                      onChange={(e) => setInterviewerName(e.target.value)}
                      placeholder="e.g., Tech Lead"
                      required
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <label
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        display: "block",
                        marginBottom: "4px",
                      }}
                    >
                      Date & Time *
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      required
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    className="action-button"
                    style={{ fontSize: "12px", padding: "6px 14px" }}
                    onClick={() => setShowScheduler(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="action-button primary"
                    style={{ fontSize: "12px", padding: "6px 14px" }}
                    disabled={
                      scheduling || !interviewerName.trim() || !scheduledAt
                    }
                  >
                    {scheduling ? "Scheduling..." : "Schedule"}
                  </button>
                </div>
              </form>
            )}

            {/* Rounds list */}
            {candidate.interviews.length === 0 ? (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: "var(--text-tertiary)",
                  fontSize: "13px",
                }}
              >
                No interviews scheduled yet.
              </div>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "0" }}
              >
                {candidate.interviews.map((iv, idx) => {
                  const isEditing = editingInterview === iv.id;
                  const statusColor =
                    iv.status === "Completed"
                      ? "#10b981"
                      : iv.status === "Cancelled"
                        ? "#ef4444"
                        : "#3b82f6";
                  const resultColor = iv.result
                    ? (RESULT_COLORS[iv.result] ?? "#64748b")
                    : "#64748b";

                  return (
                    <div key={iv.id} style={{ display: "flex", gap: "12px" }}>
                      {/* Timeline connector */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          width: "24px",
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: "10px",
                            height: "10px",
                            borderRadius: "50%",
                            backgroundColor: statusColor,
                            marginTop: "6px",
                            flexShrink: 0,
                          }}
                        />
                        {idx < candidate.interviews.length - 1 && (
                          <div
                            style={{
                              width: "2px",
                              flex: 1,
                              backgroundColor: "var(--border-subtle)",
                              marginTop: "4px",
                            }}
                          />
                        )}
                      </div>

                      {/* Round card */}
                      <div
                        style={{
                          flex: 1,
                          padding: "12px 16px",
                          marginBottom: "12px",
                          borderRadius: "10px",
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "13px" }}>
                              Round {iv.round_number} — {iv.interviewer_name}
                            </div>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--text-tertiary)",
                                marginTop: "2px",
                              }}
                            >
                              {new Date(iv.scheduled_at).toLocaleString()}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "11px",
                                fontWeight: 600,
                                backgroundColor: `${statusColor}18`,
                                color: statusColor,
                              }}
                            >
                              {iv.status}
                            </span>
                            {iv.result && (
                              <span
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: "12px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  backgroundColor: `${resultColor}18`,
                                  color: resultColor,
                                }}
                              >
                                {iv.result}
                              </span>
                            )}
                          </div>
                        </div>

                        {iv.feedback && (
                          <div
                            style={{
                              marginTop: "8px",
                              fontSize: "12px",
                              color: "var(--text-secondary)",
                              fontStyle: "italic",
                            }}
                          >
                            "{iv.feedback}"
                          </div>
                        )}

                        {/* Inline edit for interview result */}
                        {canEdit && iv.status !== "Cancelled" && (
                          <>
                            {!isEditing ? (
                              <div
                                style={{
                                  marginTop: "8px",
                                  display: "flex",
                                  gap: "6px",
                                }}
                              >
                                <button
                                  className="action-button"
                                  style={{
                                    fontSize: "11px",
                                    padding: "4px 10px",
                                  }}
                                  onClick={() => {
                                    setEditingInterview(iv.id);
                                    setEditStatus(iv.status);
                                    setEditResult(iv.result ?? "");
                                    setEditFeedback(iv.feedback ?? "");
                                  }}
                                >
                                  Update Result
                                </button>
                                <button
                                  className="action-button"
                                  style={{
                                    fontSize: "11px",
                                    padding: "4px 10px",
                                    color: "#ef4444",
                                  }}
                                  onClick={() => handleDeleteInterview(iv.id)}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ) : (
                              <div
                                style={{
                                  marginTop: "10px",
                                  padding: "12px",
                                  borderRadius: "8px",
                                  backgroundColor: "var(--bg-primary)",
                                  border: "1px solid var(--border-subtle)",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "10px",
                                    marginBottom: "8px",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <select
                                    value={editStatus}
                                    onChange={(e) =>
                                      setEditStatus(e.target.value)
                                    }
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: "6px",
                                      border: "1px solid var(--border-subtle)",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <option value="Scheduled">Scheduled</option>
                                    <option value="Completed">Completed</option>
                                    <option value="Cancelled">Cancelled</option>
                                  </select>
                                  <select
                                    value={editResult}
                                    onChange={(e) =>
                                      setEditResult(e.target.value)
                                    }
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: "6px",
                                      border: "1px solid var(--border-subtle)",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <option value="">No Result</option>
                                    <option value="Pass">Pass</option>
                                    <option value="Fail">Fail</option>
                                    <option value="Hold">Hold</option>
                                  </select>
                                </div>
                                <textarea
                                  placeholder="Feedback..."
                                  value={editFeedback}
                                  onChange={(e) =>
                                    setEditFeedback(e.target.value)
                                  }
                                  rows={2}
                                  style={{
                                    width: "100%",
                                    padding: "8px 10px",
                                    borderRadius: "6px",
                                    border: "1px solid var(--border-subtle)",
                                    fontSize: "12px",
                                    resize: "vertical",
                                    marginBottom: "8px",
                                  }}
                                />
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "6px",
                                    justifyContent: "flex-end",
                                  }}
                                >
                                  <button
                                    className="action-button"
                                    style={{
                                      fontSize: "11px",
                                      padding: "4px 10px",
                                    }}
                                    onClick={() => setEditingInterview(null)}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="action-button primary"
                                    style={{
                                      fontSize: "11px",
                                      padding: "4px 10px",
                                    }}
                                    onClick={() => handleUpdateInterview(iv)}
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
