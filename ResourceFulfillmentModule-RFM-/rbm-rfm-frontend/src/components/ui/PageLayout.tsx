/**
 * PageLayout — Top-level page wrapper with optional back button.
 */

import React from "react";
import { ArrowLeft } from "lucide-react";
import "./ui.css";

export interface PageLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  title,
  subtitle,
  onBack,
  actions,
  className = "",
}) => {
  return (
    <div className={`ui-page-layout ${className}`}>
      {(title || onBack) && (
        <div className="ui-page-layout__header">
          <div className="ui-page-layout__header-left">
            {onBack && (
              <button
                className="ui-page-layout__back"
                onClick={onBack}
                type="button"
                aria-label="Go back"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            {title && (
              <div className="ui-page-layout__title-block">
                <h1 className="ui-page-layout__title">{title}</h1>
                {subtitle && (
                  <p className="ui-page-layout__subtitle">{subtitle}</p>
                )}
              </div>
            )}
          </div>
          {actions && <div className="ui-page-layout__actions">{actions}</div>}
        </div>
      )}
      <div className="ui-page-layout__body">{children}</div>
    </div>
  );
};

export default PageLayout;
