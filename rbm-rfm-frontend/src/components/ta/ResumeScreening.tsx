import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import "../../styles/ta/ta-resume-screening.css";

const SCREENING_STORAGE_KEY = "ta_resume_screening_state_v1";

interface JobCreatePayload {
  title?: string;
  primary_skills: string[];
  secondary_skills: string[];
  min_match_percent?: number;
}

interface JobCreateResponse {
  job_id: string;
  status: string;
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
  const [taxonomy, setTaxonomy] = useState<string[]>([]);
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [showFormulaInfo, setShowFormulaInfo] = useState(false);
  const formulaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loadTaxonomy = async () => {
      try {
        const response = await apiClient.get<{ skills: string[] }>("/ta/skills");
        setTaxonomy(response.data.skills ?? []);
      } catch (err) {
        setMessage("Failed to load skills taxonomy.");
      }
    };
    loadTaxonomy();
  }, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SCREENING_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as PersistedScreeningState;
        setJobTitle(cached.jobTitle ?? "");
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
      jobId,
      jobStatus,
      jobProgress,
      primarySkills,
      secondarySkills,
      results,
      errors,
    };
    window.sessionStorage.setItem(SCREENING_STORAGE_KEY, JSON.stringify(snapshot));
  }, [isHydrated, jobTitle, jobId, jobStatus, jobProgress, primarySkills, secondarySkills, results, errors]);

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

  const taxonomyMap = useMemo(() => {
    const map = new Map<string, string>();
    taxonomy.forEach((skill) => map.set(skill.toLowerCase(), skill));
    return map;
  }, [taxonomy]);

  const resolveSkill = (value: string) => taxonomyMap.get(value.toLowerCase()) ?? null;

  const addSkill = (
    value: string,
    type: "primary" | "secondary",
    clearInput: () => void,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (taxonomy.length === 0) {
      // Allow input when taxonomy failed to load to avoid blocking the user.
      if (type === "primary") {
        if (!primarySkills.includes(trimmed)) {
          setPrimarySkills((prev) => [...prev, trimmed]);
        }
      } else if (!secondarySkills.includes(trimmed)) {
        setSecondarySkills((prev) => [...prev, trimmed]);
      }
      clearInput();
      return;
    }

    const resolved = resolveSkill(trimmed);
    if (!resolved) {
      setMessage(`"${trimmed}" is not in the taxonomy.`);
      return;
    }
    if (type === "primary") {
      if (!primarySkills.includes(resolved)) {
        setPrimarySkills((prev) => [...prev, resolved]);
      }
    } else if (!secondarySkills.includes(resolved)) {
      setSecondarySkills((prev) => [...prev, resolved]);
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
      setMessage(`Uploaded ${files.length} resumes. Now select skills and start processing.`);
    } catch (err) {
      setMessage("Failed to upload resumes.");
    } finally {
      setIsUploading(false);
    }
  };

  const startProcessing = async () => {
    if (!jobId) {
      setMessage("Upload resumes before starting processing.");
      return;
    }
    if (primarySkills.length === 0) {
      setMessage("Please add at least one primary skill.");
      return;
    }

    setIsProcessing(true);
    setMessage(null);
    try {
      const payload: JobCreatePayload = {
        title: jobTitle,
        primary_skills: primarySkills,
        secondary_skills: secondarySkills,
        min_match_percent: 0,
      };
      const response = await apiClient.post(`/ta/jobs/${jobId}/skills`, payload);
      setJobStatus(response.data.status);
      setMessage("Processing started. Results will update automatically.");
    } catch (err) {
      setMessage("Failed to start processing.");
    } finally {
      setIsProcessing(false);
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
      setMessage("Failed to fetch results.");
    }
  };

  useEffect(() => {
    if (!jobId) return;
    if (jobStatus === "completed") return;

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
      label: "Skills",
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
          <p>Upload resumes, select skills, and rank candidates by match %.</p>
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
          <h3>Skill Setup</h3>
          <label>
            Job Title
            <input
              type="text"
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              placeholder="e.g. Frontend Engineer"
              disabled={!jobId}
            />
          </label>

          <div className="skill-section">
            <SkillInput
              label="Primary Skills"
              skills={primarySkills}
              onAdd={(value, clear) => addSkill(value, "primary", clear)}
              onRemove={(skill) => removeSkill(skill, "primary")}
              taxonomy={taxonomy}
              disabled={!jobId}
            />
            <SkillInput
              label="Secondary Skills"
              skills={secondarySkills}
              onAdd={(value, clear) => addSkill(value, "secondary", clear)}
              onRemove={(skill) => removeSkill(skill, "secondary")}
              taxonomy={taxonomy}
              disabled={!jobId}
            />
          </div>

          <button
            type="button"
            className="primary-btn start-processing-btn"
            onClick={startProcessing}
            disabled={isProcessing || !jobId}
          >
            {isProcessing ? "Starting..." : "Start Processing"}
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
  taxonomy: string[];
  onAdd: (value: string, clear: () => void) => void;
  onRemove: (skill: string) => void;
  disabled?: boolean;
}

const SkillInput: React.FC<SkillInputProps> = ({
  label,
  skills,
  taxonomy,
  onAdd,
  onRemove,
  disabled,
}) => {
  const [value, setValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeout = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const term = value.trim().toLowerCase();
    const available = taxonomy.filter((skill) => !skills.includes(skill));
    const list = term
      ? available.filter((skill) => skill.toLowerCase().includes(term))
      : available;
    return list.slice(0, 10);
  }, [taxonomy, skills, value]);

  useEffect(() => {
    setActiveIndex(filtered.length > 0 ? 0 : -1);
  }, [filtered.length]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showSuggestions) setShowSuggestions(true);
      setActiveIndex((prev) => Math.min(filtered.length - 1, prev + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (showSuggestions && activeIndex >= 0 && filtered[activeIndex]) {
        onAdd(filtered[activeIndex], () => setValue(""));
        setShowSuggestions(true);
        inputRef.current?.focus();
        return;
      }
      onAdd(value, () => setValue(""));
      setShowSuggestions(true);
      inputRef.current?.focus();
    }
    if (event.key === "Escape") {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  };

  const handleFocus = () => {
    if (blurTimeout.current) {
      window.clearTimeout(blurTimeout.current);
    }
    setShowSuggestions(true);
  };

  const handleBlur = () => {
    blurTimeout.current = window.setTimeout(() => {
      setShowSuggestions(false);
    }, 150);
  };

  return (
    <div className="skill-input">
      <label>{label}</label>
      <div className="tag-input">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={disabled ? "Upload resumes first" : "Type a skill and press Enter"}
          disabled={disabled}
        />
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            onAdd(value, () => setValue(""));
            setShowSuggestions(true);
            inputRef.current?.focus();
          }}
          disabled={disabled}
        >
          Add
        </button>
      </div>
      {showSuggestions && filtered.length > 0 && !disabled && (
        <div className="skill-suggestions">
          {filtered.map((skill, index) => (
            <button
              type="button"
              key={skill}
              className={`suggestion-item ${index === activeIndex ? "active" : ""}`}
              onClick={() => {
                onAdd(skill, () => setValue(""));
                setShowSuggestions(true);
                inputRef.current?.focus();
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {skill}
            </button>
          ))}
        </div>
      )}
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
















