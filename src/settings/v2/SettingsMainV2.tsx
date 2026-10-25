import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import CopilotPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { Cog, Command, Cpu, Database, Sparkles, Wrench } from "lucide-react";
import React from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { CopilotPlusSettings } from "./components/CopilotPlusSettings";
import { ModelSettings } from "./components/ModelSettings";
import { QASettings } from "./components/QASettings";

const TAB_IDS = ["basic", "model", "QA", "command", "plus", "advanced"] as const;
type TabId = (typeof TAB_IDS)[number];

// tab icons
const icons: Record<TabId, JSX.Element> = {
  basic: <Cog className="tw-size-4" />,
  model: <Cpu className="tw-size-4" />,
  QA: <Database className="tw-size-4" />,
  command: <Command className="tw-size-4" />,
  plus: <Sparkles className="tw-size-4" />,
  advanced: <Wrench className="tw-size-4" />,
};

// tab components
const components: Record<TabId, React.FC> = {
  basic: () => <BasicSettings />,
  model: () => <ModelSettings />,
  QA: () => <QASettings />,
  command: () => <CommandSettings />,
  plus: () => <CopilotPlusSettings />,
  advanced: () => <AdvancedSettings />,
};

// tabs
const labels: Record<TabId, string> = {
  basic: "Basic",
  model: "Model",
  QA: "QA",
  command: "Command",
  plus: "Plus",
  advanced: "Advanced",
};

const tabs: TabItemType[] = TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: labels[id],
}));

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  const [isVertical, setIsVertical] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(min-width: 760px)");
    const updateOrientation = () => setIsVertical(mediaQuery.matches);
    updateOrientation();
    mediaQuery.addEventListener("change", updateOrientation);
    return () => mediaQuery.removeEventListener("change", updateOrientation);
  }, []);

  /** Move the active tab and DOM focus together using the ARIA tabs keyboard pattern. */
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const previousKey = isVertical ? "ArrowUp" : "ArrowLeft";
    const nextKey = isVertical ? "ArrowDown" : "ArrowRight";
    if (![previousKey, nextKey, "Home", "End"].includes(event.key)) return;

    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;

    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === previousKey
            ? (currentIndex - 1 + buttons.length) % buttons.length
            : (currentIndex + 1) % buttons.length;

    setSelectedTab(tabs[nextIndex].id);
    buttons[nextIndex].focus();
  };

  return (
    <div className="copilot-settings-layout">
      <div
        className="copilot-settings-nav"
        role="tablist"
        aria-label="Copilot settings"
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        onKeyDown={handleTabKeyDown}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
          />
        ))}
      </div>
      <div className="copilot-settings-content">
        {TAB_IDS.map((id) => {
          const Component = components[id];
          return (
            <TabContent key={id} id={id} isSelected={selectedTab === id}>
              <Component />
            </TabContent>
          );
        })}
      </div>
    </div>
  );
};

interface SettingsMainV2Props {
  plugin: CopilotPlugin;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin }) => {
  // Add a key state that we'll change when resetting
  const [resetKey, setResetKey] = React.useState(0);
  const { latestVersion, hasUpdate } = useLatestVersion(plugin.manifest.version);

  const handleReset = async () => {
    const modal = new ResetSettingsConfirmModal(app, async () => {
      resetSettings();
      // Increment the key to force re-render of all components
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <TabProvider>
      <div>
        <div className="tw-flex tw-flex-col tw-gap-2">
          <h1 className="tw-flex tw-flex-col tw-gap-2 sm:tw-flex-row sm:tw-items-center sm:tw-justify-between">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span>Copilot settings</span>
              <div className="tw-flex tw-items-center tw-gap-1">
                <span className="tw-text-xs tw-text-muted">v{plugin.manifest.version}</span>
                {latestVersion && (
                  <>
                    {hasUpdate ? (
                      <a
                        href="obsidian://show-plugin?id=copilot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tw-text-xs tw-text-accent hover:tw-underline"
                      >
                        (Update to v{latestVersion})
                      </a>
                    ) : (
                      <span className="tw-text-xs tw-text-normal"> (up to date)</span>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="tw-self-end sm:tw-self-auto">
              <Button variant="ghost2" size="sm" onClick={handleReset}>
                Reset settings
              </Button>
            </div>
          </h1>
        </div>
        {/* Add the key prop to force re-render */}
        <SettingsContent key={resetKey} />
      </div>
    </TabProvider>
  );
};

export default SettingsMainV2;
