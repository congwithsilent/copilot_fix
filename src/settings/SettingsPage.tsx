import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE } from "@/constants";
import CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { logInfo, logError } from "@/logger";
import { App, Notice, PluginSettingTab } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { ContainerContext } from "@/settings/v2/components/ContainerContext";

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;
  private root: Root | null = null;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async reloadPlugin() {
    try {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;

      // Analyze chat messages for memory if enabled
      if (chatView && getSettings().enableRecentConversations) {
        try {
          // Get the current chat model from the chain manager
          const chainManager = this.plugin.projectManager.getCurrentChainManager();
          const chatModel = chainManager.chatModelManager.getChatModel();
          this.plugin.userMemoryManager.addRecentConversation(
            this.plugin.chatUIState.getMessages(),
            chatModel
          );
        } catch (error) {
          logInfo("Failed to analyze chat messages for memory:", error);
        }
      }

      // Autosave the current chat before reloading
      if (chatView && getSettings().autosaveChat) {
        await this.plugin.autosaveCurrentChat();
      }

      // Reload the plugin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = this.plugin.app as any;
      await app.plugins.disablePlugin("copilot");
      await app.plugins.enablePlugin("copilot");

      app.setting.openTabById("copilot").display();
      new Notice("Plugin reloaded successfully.");
    } catch (error) {
      new Notice("Failed to reload the plugin. Please reload manually.");
      logError("Error reloading plugin:", error);
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.userSelect = "text";

    // Unmount any previous tree: every display() used to create a new React
    // root and abandon the old one, keeping its settings subscriptions,
    // ResizeObservers and modals alive for the lifetime of the app.
    this.root?.unmount();
    const div = containerEl.createDiv("div");
    this.root = createRoot(div);

    this.root.render(
      <ContainerContext.Provider value={containerEl}>
        <SettingsMainV2 plugin={this.plugin} />
      </ContainerContext.Provider>
    );
  }

  hide(): void {
    this.root?.unmount();
    this.root = null;
  }
}
