/**
 * SectionHeader — Consistent section title + optional subtitle and actions.
 */

import React from "react";
import "./ui.css";

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  actions,
  className = "",
}) => {
  return (
    <div className={`ui-section-header ${className}`}>
      <div className="ui-section-header__text">
        <h2 className="ui-section-header__title">{title}</h2>
        {subtitle && <p className="ui-section-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-section-header__actions">{actions}</div>}
    </div>
  );
};

export default SectionHeader;
