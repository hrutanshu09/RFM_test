/**
 * Card — Container primitive with consistent spacing and borders.
 */

import React from "react";
import "./ui.css";

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Remove inner padding (for tables / full-bleed content). */
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  noPadding = false,
}) => {
  return (
    <div
      className={`ui-card ${noPadding ? "ui-card--no-padding" : ""} ${className}`}
    >
      {children}
    </div>
  );
};

export default Card;
