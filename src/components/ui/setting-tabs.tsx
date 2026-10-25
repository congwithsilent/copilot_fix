import { cn } from "@/lib/utils";
import React from "react";

export interface TabItem {
  icon: React.ReactNode;
  label: string;
  id: string;
}

interface TabItemProps {
  tab: TabItem;
  isSelected: boolean;
  onClick: () => void;
}

/** Render a keyboard-focusable settings navigation item. */
export const TabItem: React.FC<TabItemProps> = ({ tab, isSelected, onClick }) => {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${tab.id}`}
      aria-controls={`tabpanel-${tab.id}`}
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      onClick={onClick}
      className={cn(
        "copilot-settings-tab tw-flex tw-h-9 tw-w-full tw-items-center tw-gap-2 tw-rounded-md !tw-bg-transparent tw-px-2.5 tw-text-left tw-text-sm tw-text-muted !tw-shadow-none tw-transition-colors hover:!tw-bg-modifier-hover hover:tw-text-normal",
        isSelected && "!tw-bg-secondary-alt tw-font-medium tw-text-normal"
      )}
    >
      <span
        className={cn(
          "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center",
          isSelected && "tw-text-accent"
        )}
      >
        {tab.icon}
      </span>
      <span className="tw-truncate">{tab.label}</span>
    </button>
  );
};

interface TabContentProps {
  id: string;
  children: React.ReactNode;
  isSelected: boolean;
}

/** Preserve tab/panel relationships without mounting inactive settings panels. */
export const TabContent: React.FC<TabContentProps> = ({ id, children, isSelected }) => {
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      className="tw-min-w-0"
      hidden={!isSelected}
    >
      {isSelected ? children : null}
    </div>
  );
};
