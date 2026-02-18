/**
 * ConfirmationModal — Accessible confirmation dialog.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import "./ui.css";

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onCancel();
      }
    },
    [onCancel, isLoading],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const variantClass =
    variant === "danger"
      ? "ui-modal--danger"
      : variant === "warning"
        ? "ui-modal--warning"
        : "";

  return (
    <div
      className="ui-modal-overlay"
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current && !isLoading) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className={`ui-modal ${variantClass}`}>
        <div className="ui-modal__header">
          {variant !== "default" && (
            <AlertTriangle size={20} className="ui-modal__icon" />
          )}
          <h3 id="modal-title" className="ui-modal__title">
            {title}
          </h3>
          <button
            className="ui-modal__close"
            onClick={onCancel}
            disabled={isLoading}
            type="button"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="ui-modal__body">
          <p>{message}</p>
        </div>
        <div className="ui-modal__footer">
          <button
            className="ui-btn ui-btn--secondary"
            onClick={onCancel}
            disabled={isLoading}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`ui-btn ${variant === "danger" ? "ui-btn--danger" : "ui-btn--primary"}`}
            onClick={onConfirm}
            disabled={isLoading}
            type="button"
          >
            {isLoading ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
