import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import "../../styles/ta/ta-resume-screening.css";

const SCREENING_STORAGE_KEY = "ta_resume_screening_state_v1";

interface JobCreateResponse {
  job_id: string;
  status: string;
}

interface JDParseApiResponse {
  job_id: string;
  parsed_jd: {
    title?: string | null;
    domain?: string | null;
    primary_skills?: string[];
    secondary_skills?: string[];
    min_experience_years?: number | null;
    max_experience_years?: number | null;
  };
}

interface JobResultsResponse {
  job_id: string;
  status: string;
  created_at?: string;
  title?: string;
  primary_skills?: string[];
  secondary_skills?: string[];
  min_match_percent?: number;
  uploaded?: number;
  processed?: number;
  total?: number;
  errors?: { filename: string; error: string }[];
  ranked_candidates?: CandidateResult[];
}

interface CandidateResult {
  candidate_id: string;
  name: string;
  overall_match_percent: number;
  skills: {
    skill: string;
    percent: number;
    evidence: string[];
    is_primary: boolean;
    debug?: {
      base?: number;
      occurrence_bonus?: number;
      matched_in_sections?: string[];
      alias_used?: boolean;
      evidence_count?: number;
      matched_tokens?: string[];
    };
  }[];
  source_filename?: string;
}

interface PersistedScreeningState {
  jobTitle: string;
  jobDescription: string;
  jdDomain: string;
  jdMinExperience: string;
  jdMaxExperience: string;
  jobId: string | null;
  jobStatus: string | null;
  jobProgress: { processed: number; total: number };
  primarySkills: string[];
  secondarySkills: string[];
  results: CandidateResult[];
  errors: { filename: string; error: string }[];
}

const TAResumeScreening: React.FC = () => {
  const navigate = useNavigate();
  const [primarySkills, setPrimarySkills] = useState<string[]>([]);
  const [secondarySkills, setSecondarySkills] = useState<string[]>([]);
  const [jobTitle, setJobTitle] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<{ processed: number; total: number }>({
    processed: 0,
    total: 0,
  });
  const [results, setResults] = useState<CandidateResult[]>([]);
  const [errors, setErrors] = useState<{ filename: string; error: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isJDParsing, setIsJDParsing] = useState(false);
  const [isJDProcessing, setIsJDProcessing] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [jdDomain, setJdDomain] = useState("");
  const [jdMinExperience, setJdMinExperience] = useState("");
  const [jdMaxExperience, setJdMaxExperience] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [showFormulaInfo, setShowFormulaInfo] = useState(false);
  const formulaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SCREENING_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as PersistedScreeningState;
        setJobTitle(cached.jobTitle ?? "");
        setJobDescription(cached.jobDescription ?? "");
        setJdDomain(cached.jdDomain ?? "");
        setJdMinExperience(cached.jdMinExperience ?? "");
        setJdMaxExperience(cached.jdMaxExperience ?? "");
        setJobId(cached.jobId ?? null);
        setJobStatus(cached.jobStatus ?? null);
        setJobProgress(cached.jobProgress ?? { processed: 0, total: 0 });
        setPrimarySkills(Array.isArray(cached.primarySkills) ? cached.primarySkills : []);
        setSecondarySkills(Array.isArray(cached.secondarySkills) ? cached.secondarySkills : []);
        setResults(Array.isArray(cached.results) ? cached.results : []);
        setErrors(Array.isArray(cached.errors) ? cached.errors : []);
      }
    } catch {
      // Ignore stale/corrupt session state.
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    const snapshot: PersistedScreeningState = {
      jobTitle,
      jobDescription,
      jdDomain,
      jdMinExperience,
      jdMaxExperience,
      jobId,
      jobStatus,
      jobProgress,
      primarySkills,
      secondarySkills,
      results,
      errors,
    };
    window.sessionStorage.setItem(SCREENING_STORAGE_KEY, JSON.stringify(snapshot));
  }, [isHydrated, jobTitle, jobDescription, jdDomain, jdMinExperience, jdMaxExperience, jobId, jobStatus, jobProgress, primarySkills, secondarySkills, results, errors]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!formulaRef.current) return;
      if (!formulaRef.current.contains(event.target as Node)) {
        setShowFormulaInfo(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const addSkill = (
    value: string,
    type: "primary" | "secondary",
    clearInput: () => void,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (type === "primary") {
      if (!primarySkills.includes(trimmed)) {
        setPrimarySkills((prev) => [...prev, trimmed]);
      }
    } else if (!secondarySkills.includes(trimmed)) {
      setSecondarySkills((prev) => [...prev, trimmed]);
    }

    clearInput();
  };

  const removeSkill = (skill: string, type: "primary" | "secondary") => {
    if (type === "primary") {
      setPrimarySkills((prev) => prev.filter((item) => item !== skill));
    } else {
      setSecondarySkills((prev) => prev.filter((item) => item !== skill));
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    setFiles(nextFiles);
  };

  const uploadResumes = async () => {
    if (files.length === 0) {
      setMessage("Select one or more resumes to upload.");
      return;
    }

    setIsUploading(true);
    setMessage(null);
    const fd = new FormData();
    files.forEach((file) => fd.append("files", file));

    try {
      const response = await apiClient.post<JobCreateResponse>("/ta/jobs/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setJobId(response.data.job_id);
      setJobStatus(response.data.status);
      setResults([]);
      setErrors([]);
      setJobProgress({ processed: 0, total: files.length });
      setMessage(`Uploaded ${files.length} resumes. Paste JD, parse it, review details, then start screening.`);
    } catch (err) {
      setMessage("Failed to upload resumes.");
    } finally {
      setIsUploading(false);
    }
  };

  const parseJD = async () => {
    if (!jobId) {
      setMessage("Upload resumes before parsing JD.");
      return;
    }
    if (!jobDescription.trim()) {
      setMessage("Please add a job description to parse.");
      return;
    }

    setIsJDParsing(true);
    setMessage(null);
    try {
      const response = await apiClient.post<JDParseApiResponse>(`/ta/jobs/${jobId}/parse-jd`, {
        job_description: jobDescription,
        strict_upper_bound: false,
        force_refresh: true,
        debug: false,
      });
      const parsed = response.data.parsed_jd || {};
      setJobTitle(parsed.title ?? "");
      setJdDomain(parsed.domain ?? "");
      setPrimarySkills(parsed.primary_skills ?? []);
      setSecondarySkills(parsed.secondary_skills ?? []);
      setJdMinExperience(
        parsed.min_experience_years === null || parsed.min_experience_years === undefined
          ? ""
          : String(parsed.min_experience_years),
      );
      setJdMaxExperience(
        parsed.max_experience_years === null || parsed.max_experience_years === undefined
          ? ""
          : String(parsed.max_experience_years),
      );
      setMessage("JD parsed. Review and edit details before starting screening.");
    } catch (err) {
      setMessage("Failed to parse JD.");
    } finally {
      setIsJDParsing(false);
    }
  };

  const startJDProcessing = async () => {
    if (!jobId) {
      setMessage("Upload resumes before starting JD processing.");
      return;
    }
    if (!jobDescription.trim()) {
      setMessage("Please add a job description before JD processing.");
      return;
    }

    setIsJDProcessing(true);
    setMessage(null);
    try {
      const response = await apiClient.post(`/ta/jobs/${jobId}/process-with-jd`, {
        job_description: jobDescription,
        title: jobTitle,
        domain: jdDomain,
        primary_skills: primarySkills,
        secondary_skills: secondarySkills,
        min_experience_years: jdMinExperience.trim() ? Number(jdMinExperience) : null,
        max_experience_years: jdMaxExperience.trim() ? Number(jdMaxExperience) : null,
        strict_upper_bound: false,
        force_refresh: true,
        debug: false,
      });
      setJobStatus(response.data.status ?? "completed");
      setMessage("JD-based processing completed. Ranked results are ready.");
      await refreshResults();
    } catch (err) {
      setMessage("Failed to process with JD.");
    } finally {
      setIsJDProcessing(false);
    }
  };

  const refreshResults = async () => {
    if (!jobId) return;
    try {
      const response = await apiClient.get<JobResultsResponse>(`/ta/jobs/${jobId}/results`);
      setJobStatus(response.data.status);
      setResults(response.data.ranked_candidates ?? []);
      setErrors(response.data.errors ?? []);
      setJobProgress({
        processed: response.data.processed ?? 0,
        total: response.data.total ?? 0,
      });
    } catch (err) {
      const statusCode = (err as { response?: { status?: number } })?.response?.status;
      if (statusCode === 404) {
        setJobStatus("not_found");
        setJobId(null);
        setResults([]);
        setErrors([]);
        setJobProgress({ processed: 0, total: 0 });
        setFiles([]);
        setMessage("Previous job was not found (likely stale after restart). Please upload resumes again.");
        return;
      }
      setMessage("Failed to fetch results.");
    }
  };

  useEffect(() => {
    if (!jobId) return;
    if (jobStatus === "completed" || jobStatus === "not_found") return;

    const interval = window.setInterval(() => {
      refreshResults();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [jobId, jobStatus]);

  const completionPercent = useMemo(() => {
    if (jobProgress.total === 0) return 0;
    return Math.round((jobProgress.processed / jobProgress.total) * 100);
  }, [jobProgress]);

  const isCompleted = jobStatus === "completed";
  const isUploaded = Boolean(jobId);
  const hasStarted = jobStatus === "processing" || jobStatus === "completed";

  const steps = [
    {
      key: "upload",
      label: "Upload",
      active: !isUploaded,
      done: isUploaded,
    },
    {
      key: "skills",
      label: "JD Setup",
      active: isUploaded && !hasStarted,
      done: hasStarted,
    },
    {
      key: "processing",
      label: "Processing",
      active: hasStarted && !isCompleted,
      done: isCompleted,
    },
    {
      key: "results",
      label: "Results",
      active: isCompleted,
      done: isCompleted,
    },
  ];

  return (
    <section className="ta-screening">
      <header className="ta-screening-header">
        <div>
          <div className="title-row" ref={formulaRef}>
            <h2>Resume Screening</h2>
            <button
              type="button"
              className="info-btn"
              aria-label="Show ranking formula"
              onClick={() => setShowFormulaInfo((prev) => !prev)}
            >
              i
            </button>
            {showFormulaInfo && (
              <div className="formula-popover">
                <div className="formula-title">How Ranking Works</div>
                <div className="formula-body">
                  Per-skill base: Skills section = 70, Projects/Work/Education = 50, Not found = 0.
                  Bonus: +5 for each unique matched evidence line (cap 95 per skill).
                  Overall score is weighted average: Primary skills x1.0, Secondary skills x0.5.
                </div>
                <div className="formula-example">
                  Example: React is in Skills and one project line {"->"} 70 + 5 = 75.
                  If Kubernetes is not found anywhere {"->"} 0.
                </div>
              </div>
            )}
          </div>
          <p>Upload resumes, parse JD, review parsed details, and rank candidates.</p>
        </div>
        <div className="ta-screening-status">
          <span className={`status-pill ${jobStatus ?? "idle"}`}>
            {jobStatus ?? "idle"}
          </span>
          {jobId && <span className="job-id">Job: {jobId}</span>}
        </div>
      </header>

      <div className="screening-steps">
        {steps.map((step) => (
          <div
            key={step.key}
            className={`step-pill ${step.active ? "active" : ""} ${step.done ? "done" : ""}`}
          >
            <span className="step-dot" />
            {step.label}
          </div>
        ))}
      </div>

      {message && <div className="ta-screening-message">{message}</div>}

      <div className="ta-screening-grid">
        <div className="ta-screening-card">
          <h3>Upload Resumes</h3>
          <label className="file-input">
            <input
              type="file"
              multiple
              accept=".pdf,.docx"
              onChange={handleFileChange}
            />
            <span>Select PDF/DOCX</span>
          </label>
          <div className="file-count">{files.length} files selected</div>

          <button
            type="button"
            className="primary-btn"
            onClick={uploadResumes}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Upload Resumes"}
          </button>
        </div>

        <div className={`ta-screening-card ${jobId ? "" : "disabled"}`}>
          <h3>JD Setup</h3>

          <label>
            Job Description
            <textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="Paste JD here, then click Parse JD"
              disabled={!jobId}
              rows={6}
            />
          </label>

          <button
            type="button"
            className="secondary-btn"
            onClick={parseJD}
            disabled={isJDParsing || !jobId || !jobDescription.trim()}
          >
            {isJDParsing ? "Parsing JD..." : "Parse JD"}
          </button>

          <label>
            Title
            <input
              type="text"
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              placeholder="Parsed title"
              disabled={!jobId}
            />
          </label>

          <label>
            Domain
            <input
              type="text"
              value={jdDomain}
              onChange={(event) => setJdDomain(event.target.value)}
              placeholder="Parsed domain"
              disabled={!jobId}
            />
          </label>

          <div className="skill-section">
            <SkillInput
              label="Primary Skills"
              skills={primarySkills}
              onAdd={(value, clear) => addSkill(value, "primary", clear)}
              onRemove={(skill) => removeSkill(skill, "primary")}
              disabled={!jobId}
            />
            <SkillInput
              label="Secondary Skills"
              skills={secondarySkills}
              onAdd={(value, clear) => addSkill(value, "secondary", clear)}
              onRemove={(skill) => removeSkill(skill, "secondary")}
              disabled={!jobId}
            />
          </div>

          <div className="experience-row">
            <label>
              Min Experience (Years)
              <input
                type="number"
                min={0}
                step={0.5}
                value={jdMinExperience}
                onChange={(event) => setJdMinExperience(event.target.value)}
                disabled={!jobId}
              />
            </label>
            <label>
              Max Experience (Years)
              <input
                type="number"
                min={0}
                step={0.5}
                value={jdMaxExperience}
                onChange={(event) => setJdMaxExperience(event.target.value)}
                disabled={!jobId}
              />
            </label>
          </div>

          <button
            type="button"
            className="primary-btn start-processing-btn"
            onClick={startJDProcessing}
            disabled={isJDProcessing || !jobId || !jobDescription.trim()}
          >
            {isJDProcessing ? "Processing JD..." : "Start JD Screening"}
          </button>
        </div>
      </div>

      {hasStarted && (
      <div className="ta-screening-card">
        <div className="progress-section">
          <div className="progress-label">
            Processed {jobProgress.processed}/{jobProgress.total}
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>
      </div>
    )}

    <div className="ta-screening-card results-card">
        <div className="results-header">
          <h3>Ranked Candidates</h3>
          <span>{isCompleted ? results.length : 0} candidates</span>
        </div>

        <div className="results-summary">
          <div>
            <span className="summary-label">Uploaded</span>
            <span className="summary-value">{jobProgress.total}</span>
          </div>
          <div>
            <span className="summary-label">Processed</span>
            <span className="summary-value">{jobProgress.processed}</span>
          </div>
          <div>
            <span className="summary-label">Matched</span>
            <span className="summary-value">{isCompleted ? results.length : 0}</span>
          </div>
          <div>
            <span className="summary-label">Errors</span>
            <span className="summary-value">{errors.length}</span>
          </div>
        </div>

        {!isCompleted ? (
          <div className="empty-state">Processing in progress. Final rankings will appear when completed.</div>
        ) : results.length === 0 ? (
          <div className="empty-state">No candidates yet.</div>
        ) : (
          <div className="results-list">
            {results.map((candidate, index) => (
              <button
                type="button"
                key={candidate.candidate_id}
                className="result-row"
                onClick={() =>
                  navigate(`/ta/resume-screening/${candidate.candidate_id}`, {
                    state: {
                      candidate,
                      jobId,
                      jobTitle,
                      primarySkills,
                      secondarySkills,
                    },
                  })
                }
              >
                <div className="rank">#{index + 1}</div>
                <div className="result-main">
                  <div className="candidate-name">{candidate.name}</div>
                  <div className="candidate-meta">
                    {candidate.source_filename || "resume"}
                  </div>
                  <div className="skill-badges">
                    {candidate.skills.map((skill) => (
                      <span
                        key={`${candidate.candidate_id}-${skill.skill}`}
                        className={`skill-badge ${skill.is_primary ? "primary" : "secondary"}`}
                      >
                        {skill.skill}: {skill.percent}%
                      </span>
                    ))}
                  </div>
                </div>
                <div className="overall-score">{candidate.overall_match_percent}%</div>
              </button>
            ))}
          </div>
        )}

        {errors.length > 0 && (
          <div className="error-list">
            <h4>Errors</h4>
            {errors.map((err) => (
              <div key={err.filename} className="error-item">
                {err.filename}: {err.error}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

interface SkillInputProps {
  label: string;
  skills: string[];
  onAdd: (value: string, clear: () => void) => void;
  onRemove: (skill: string) => void;
  disabled?: boolean;
}

const SkillInput: React.FC<SkillInputProps> = ({
  label,
  skills,
  onAdd,
  onRemove,
  disabled,
}) => {
  const [value, setValue] = useState("");

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      onAdd(value, () => setValue(""));
    }
  };

  return (
    <div className="skill-input">
      <label>{label}</label>
      <div className="tag-input">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Upload resumes first" : "Type a skill and press Enter"}
          disabled={disabled}
        />
        <button
          type="button"
          className="secondary-btn"
          onClick={() => onAdd(value, () => setValue(""))}
          disabled={disabled}
        >
          Add
        </button>
      </div>
      <div className="tag-list">
        {skills.map((skill) => (
          <span key={skill} className="tag">
            {skill}
            <button type="button" onClick={() => onRemove(skill)} disabled={disabled}>
              x
            </button>
          </span>
        ))}
      </div>
    </div>
  );
};

export default TAResumeScreening;
















