import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "../../styles/ta/ta-resume-candidate.css";

interface CandidateSkillDebug {
  base?: number;
  occurrence_bonus?: number;
  matched_in_sections?: string[];
  alias_used?: boolean;
  evidence_count?: number;
  matched_tokens?: string[];
}

interface CandidateSkill {
  skill: string;
  percent: number;
  evidence: string[];
  is_primary: boolean;
  debug?: CandidateSkillDebug;
}

interface CandidateResult {
  candidate_id: string;
  name: string;
  overall_match_percent: number;
  skills: CandidateSkill[];
  source_filename?: string;
}

interface CandidateState {
  candidate?: CandidateResult;
  jobId?: string | null;
  jobTitle?: string;
  primarySkills?: string[];
  secondarySkills?: string[];
}

const TAResumeCandidateDetails: React.FC = () => {
  const navigate = useNavigate();
  const { candidateId } = useParams();
  const location = useLocation();
  const state = (location.state as CandidateState | null) ?? null;
  const candidate = state?.candidate;

  if (!candidate) {
    return (
      <section className="ta-candidate-details">
        <header className="candidate-header">
          <div>
            <h2>Candidate Details</h2>
            <p>Candidate data was not found for this page.</p>
          </div>
          <button type="button" className="secondary-btn" onClick={() => navigate(-1)}>
            Back
          </button>
        </header>
        <div className="candidate-card">
          <div className="candidate-empty">
            No candidate data found for id: {candidateId}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ta-candidate-details">
      <header className="candidate-header">
        <div>
          <h2>{candidate.name}</h2>
          <p>{candidate.source_filename || "resume"}</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => navigate(-1)}>
          Back
        </button>
      </header>

      <div className="candidate-summary">
        <div>
          <span className="summary-label">Overall Match</span>
          <span className="summary-value">{candidate.overall_match_percent}%</span>
        </div>
        <div>
          <span className="summary-label">Job Title</span>
          <span className="summary-value">{state?.jobTitle || "-"}</span>
        </div>
        <div>
          <span className="summary-label">Job Id</span>
          <span className="summary-value">{state?.jobId || "-"}</span>
        </div>
      </div>

      <div className="candidate-card">
        <h3>Skill Evidence</h3>
        <div className="candidate-skill-grid">
          {candidate.skills.map((skill) => (
            <div key={skill.skill} className="candidate-skill-card">
              <div className="skill-head">
                <div>
                  <span className={`skill-pill ${skill.is_primary ? "primary" : "secondary"}`}>
                    {skill.is_primary ? "Primary" : "Secondary"}
                  </span>
                  <h4>{skill.skill}</h4>
                </div>
                <div className="skill-score">{skill.percent}%</div>
              </div>

              {skill.debug?.matched_in_sections && skill.debug.matched_in_sections.length > 0 && (
                <div className="skill-meta">
                  Sections: {skill.debug.matched_in_sections.join(", ")}
                </div>
              )}

              {skill.debug?.base !== undefined && (
                <div className="skill-meta">Base score: {skill.debug.base}</div>
              )}

              <div className="evidence-list">
                {skill.evidence.length > 0 ? (
                  skill.evidence.map((item, idx) => (
                    <div key={`${skill.skill}-${idx}`} className="evidence-item">
                      {item}
                    </div>
                  ))
                ) : (
                  <div className="evidence-item empty">No evidence captured.</div>
                )}
              </div>

              {skill.debug?.matched_tokens && skill.debug.matched_tokens.length > 0 && (
                <div className="skill-meta">Matched tokens: {skill.debug.matched_tokens.join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TAResumeCandidateDetails;
