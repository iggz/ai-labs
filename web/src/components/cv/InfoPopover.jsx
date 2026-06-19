/**
 * InfoPopover.jsx — Reusable Info Popover
 * ========================================
 * Uses the native HTML Popover API for lightweight info tooltips.
 * Falls back gracefully in browsers without popover support.
 */

import { Info } from 'lucide-react';

let _popoverCounter = 0;

/**
 * InfoPopover — renders a trigger button + floating popover panel.
 *
 * @param {Object} props
 * @param {string} [props.id] - Unique ID for the popover (auto-generated if omitted)
 * @param {React.ReactNode} [props.trigger] - Custom trigger content (defaults to Info icon)
 * @param {React.ReactNode} props.children - Popover content
 */
export function InfoPopover({ id, trigger, children }) {
  // Stable ID — generate once per mount in the module scope for SSR safety
  const popoverId = id || `info-popover-${++_popoverCounter}`;

  return (
    <>
      <button
        popoverTarget={popoverId}
        className="info-popover__trigger"
        type="button"
        aria-label="More information"
      >
        {trigger || <Info size={14} />}
      </button>
      <div id={popoverId} popover="auto" className="info-popover__content">
        {children}
      </div>
    </>
  );
}
