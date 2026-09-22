# 构建产物结构与修改指南

本文档说明 Copilot 插件构建产物（`main.js` / `styles.css` / `manifest.json`）的生成方式、内部结构，以及如何在不重新阅读全部源码的情况下定位和修改各个部分。

最后更新：2026-09-16（对应 commit `3c370a7` 之后的代码状态，含本次滚动跟随滚动、图片预览泄漏修复）

---

## 1. 构建产物概览

| 文件            | 大小（约） | 作用                                                                          | 是否可部署 |
| --------------- | ---------- | ----------------------------------------------------------------------------- | ---------- |
| `main.js`       | 5.5 MB     | 全部插件逻辑的 esbuild 单文件打包（CJS、ES2020、minified、无 sourcemap）      | ✅         |
| `styles.css`    | 73 KB      | Tailwind 压缩后的全量样式 + 手写 CSS                                          | ✅         |
| `manifest.json` | 0.4 KB     | Obsidian 插件清单（id: `copilot`, version: `3.2.8`, minAppVersion: `0.15.0`） | ✅         |

**部署方式**：将这三个文件复制到 Vault 的 `.obsidian/plugins/copilot/` 目录，重启 Obsidian 或在第三方插件设置里重载即可。

**构建命令**：

```bash
npm run build
```

它等价于两步（任何一步失败即中止）：

1. `build:tailwind` — `npx tailwindcss -i src/styles/tailwind.css -o styles.css --minify`
   扫描 `src/**/*.{js,ts,jsx,tsx}` 和 `src/styles/tailwind.css` 中出现的类名，只生成用到的工具类。
2. `build:esbuild` — `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`
   先跑全量 TypeScript 检查，再由 esbuild 从 `src/main.ts` 打出 `main.js`。

> ⚠️ 按 AGENTS.md 约定，不要运行 `npm run dev`（watch 模式），构建一律手动执行 `npm run build`。

### 构建管线的关键配置（esbuild.config.mjs）

- **入口**：`src/main.ts`（`CopilotPlugin extends Plugin`）
- **external**：`obsidian`、`electron`、全部 `@codemirror/*`、`@lezer/*`、Node 内建模块（`node:fs` 等）——这些在 Obsidian/Electron 运行时已存在，不打入包
- **格式**：CJS；`define` 把 `global` 映射为 `window`，并用 banner 里的 polyfill 处理 `import.meta.url`
- **自定义插件**：`nodeModuleShim`（shim `node:module`）、`svgPlugin`（SVG 以组件导入）、`wasmPlugin`（WASM 资产内联）
- **production**：`--minify` + 关闭 sourcemap；开发模式则是 inline sourcemap + watch

---

## 2. main.js 内部结构

`main.js` 是 minified 的单文件，无法直接改，但它的模块顺序与源码目录一一对应。**修改的正确方式永远是改 `src/` 下对应文件后重新 build**。下表是打包内容 → 源码位置的映射，按 Obsidian 加载插件时的执行顺序排列：

### 2.1 插件生命周期（src/main.ts）

`onload()` 的初始化顺序（`src/main.ts:95`）：

1. `loadSettings()` → 订阅设置变更（加密保存 / `registerCommands` 重注册）
2. `CopilotSettingTab` 注册设置页
3. `initializeBuiltinTools(app.vault)` → 内置工具获得 vault 访问
4. `BrevilabsClient.getInstance()` → 官方服务客户端，`checkIsPlusUser()` 校验 Plus 身份
5. `ProjectManager.getInstance()` / `VectorStoreManager.getInstance()` / `VaultDataManager` / `FileParserManager`
6. **新架构装配**：`MessageRepository` → `ChatManager` → `ChatUIState`
7. `QuickAskController` 注册 CM6 编辑器扩展；`ChatSelectionHighlightController`
8. `registerView(CHAT_VIEWTYPE, …)` 注册聊天视图；`registerView(APPLY_VIEW_TYPE, …)` 注册 Apply 视图
9. `addRibbonIcon("message-square", …)` 侧边栏图标；`registerCommands()`
10. workspace 事件（`editor-menu` 右键菜单、`active-leaf-change`）
11. `onLayoutReady` 后初始化自定义命令与系统提示词注册器

`onunload()` 负责清理：选区高亮、ProjectManager、各 manager 的 abort 等。

### 2.2 运行时消息流（一次对话的完整链路）

```
用户输入 (ChatInput.tsx, LexicalEditor)
  → Chat.handleSendMessage (src/components/Chat.tsx)
  → ChatUIState.sendMessage (src/state/ChatUIState.ts)      ← UI 状态层，订阅通知 React
  → ChatManager.sendMessage (src/core/ChatManager.ts)       ← 业务逻辑：ContextManager 处理笔记/URL/文件夹上下文
  → ChainManager.runChain (src/LLMProviders/chainManager.ts) ← 按 ChainType 分发
  → XxxChainRunner.run (src/LLMProviders/chainRunner/*)      ← 实际调模型（LangChain 或直连）
  → 流式回调 onStreamingContent/onAddMessage → ChatUIState → React 重渲染
```

### 2.3 ChainType → ChainRunner 分发（chainManager.ts:287）

| ChainType            | Runner                       | 用途                    |
| -------------------- | ---------------------------- | ----------------------- |
| `LLM_CHAIN`          | `LLMChainRunner`             | 普通对话                |
| `VAULT_QA_CHAIN`     | `VaultQAChainRunner`         | @vault 全库问答         |
| `COPILOT_PLUS_CHAIN` | `CopilotPlusChainRunner`     | Plus 模式（含工具调用） |
| `PROJECT_CHAIN`      | `ProjectChainRunner`         | 项目模式（隔离上下文）  |
| （自主模式）         | `AutonomousAgentChainRunner` | 设置里开启自主 Agent 后 |

> 注：`src/chainFactory.ts` 中的 LangChain `ChainFactory` 已被标记 deprecated（文件头 TODO），各 Runner 现在直接调用 chat model。`ChainType` 枚举仍定义在那里。

### 2.4 模型接入（chatModelManager.ts）

`CHAT_PROVIDER_CONSTRUCTORS` 映射表（`src/LLMProviders/chatModelManager.ts:75`）决定 provider → 类：

| Provider                                                                 | 类                                 | 说明                                    |
| ------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------- |
| OPENAI / AZURE_OPENAI                                                    | `ChatOpenAI`（LangChain）          |                                         |
| ANTHROPIC / GOOGLE / COHEREAI / XAI / GROQ / MISTRAL / DEEPSEEK / OLLAMA | 各官方 LangChain 类                |                                         |
| OPENROUTERAI / LM_STUDIO / COPILOT_PLUS                                  | `ChatOpenRouter`                   |                                         |
| **OPENAI_FORMAT / SILICONFLOW**                                          | **`ChatOpenAIFormat`**（自定义）   | 通用 OpenAI 兼容端点，含流式 delta 修复 |
| AMAZON_BEDROCK                                                           | `BedrockChatModel`（自定义）       |                                         |
| GITHUB_COPILOT                                                           | `GitHubCopilotChatModel`（自定义） |                                         |

**改模型行为的常用入口**：

- 修「某网关流式输出丢字 / thinking 不显示」→ `src/LLMProviders/openaiDeltaUtils.ts`（`normalizeDeltaContent` / `splitDeltaContent` / `normalizeReasoningPayload`）+ `ChatOpenAIFormat.ts`
- 修「思考块展示」→ `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`
- 加新 provider → 在 `CHAT_PROVIDER_CONSTRUCTORS` 加映射 + 在 `constants.ts` 的 `ChatModelProviders` 加枚举

### 2.5 上下文注入（发送前把笔记塞进 prompt）

- `src/core/ContextManager.ts`：组装 L1（活动笔记/选区）→ L2 → L3（文件夹/标签）上下文
- `src/contextProcessor.ts`：
  - `processContextNotes()` 输出 XML 结构 `<file><title>…<path>…<folder>…<content>…</file>`
  - `injectFolderFrontmatter()`：文件夹上下文的 md 笔记会被注入 `folder: <path>` frontmatter（上个 commit 新增）
- 改「上下文格式 / 附加元数据」就在这两个文件。

### 2.6 UI 组件树（React）

```
CopilotView (注册为 CHAT_VIEWTYPE)
└─ Chat (src/components/Chat.tsx)  ← 持有 streaming 合帧逻辑 (requestAnimationFrame)
   ├─ ChatMessages ─ ChatSingleMessage ─ markdown 渲染 / 错误块 / 工具调用 banner
   │    └─ 滚动控制: useChatScrolling (pin-to-bottom + 回到底部按钮)
   ├─ ChatControls (新建/历史/保存/模式切换)
   ├─ ChatInput
   │   ├─ LexicalEditor (上下文 pill: Note/URL/Folder/Tool/WebTab)
   │   ├─ ContextControl (上下文徽章行)
   │   └─ GeneratingIndicator (三点动画 + 耗时计时)
   └─ ProjectList (项目模式)
```

改交互行为时先找到对应组件，改完 `npm run build`。

---

## 3. styles.css 内部结构

产出 = **Tailwind 编译结果（前缀 `tw-`）+ `src/styles/tailwind.css` 里手写的自定义段**，全部 minify 到一行。

### 3.1 Tailwind 与 Obsidian 的桥接（tailwind.config.js）

这是理解样式产物的关键：**所有颜色/间距/字号 token 都映射到 Obsidian 的 CSS 变量**，因此样式自动适配亮暗主题和用户主题。例如：

- `tw-text-muted` → `var(--text-muted)`
- `tw-bg-secondary-alt` → `var(--background-secondary-alt)`
- `tw-border-border` → `var(--background-modifier-border)`
- 间距 `tw-p-2` → `var(--size-4-2)`；字号 `tw-text-ui-small` → `var(--font-ui-small)`
- z-index `tw-z-modal` → `var(--layer-modal)`
- **`prefix: "tw-"`**：所有 Tailwind 类必须带 `tw-` 前缀（如 `tw-flex`），这是为了不污染 Obsidian 自身样式；`preflight` 已关闭

所以**改主题相关的颜色永远不要硬编码 hex**，要么用现有 token，要么在 `tailwind.config.js` 的 theme 里加新映射。

### 3.2 手写自定义 CSS 段（src/styles/tailwind.css，约 1590 行）

按段落主题列出（改样式时直接定位到对应段）：

| 段落       | 关键类                                                                                                                             | 作用                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 全局       | `[data-radix-popper-content-wrapper]{z-index:9999!important}`                                                                      | Radix 弹层盖过 workspace 分隔条                                                                                           |
| 设置页     | `.copilot-setting-item-*`                                                                                                          | 设置项布局                                                                                                                |
| 旧版按钮   | `.chat-icon-button` / `.model-select-button` / `.submit-button` 等                                                                 | 带 `!important` 的遗留样式（与聊天输入框按钮相关）                                                                        |
| 图片预览   | `.selected-images` / `.image-preview-container` / `.remove-image-button`                                                           | 聊天输入框选中的图片缩略图                                                                                                |
| 聊天排版   | `.workspace-leaf-content[data-type="copilot-chat-view"]` 定义 `--copilot-chat-font-size`；`.copilot-chat-text`；`.message-content` | **消息正文的全部 Markdown 排版**：40rem 行宽、标题/列表/表格（只有横线）/blockquote/code/callout/脚注。改消息外观主要在这 |
| 可折叠块   | `.copilot-collapsible*`                                                                                                            | thinking 块、sources 折叠条                                                                                               |
| Sources    | `.copilot-sources*`                                                                                                                | 引用来源列表                                                                                                              |
| 生成指示器 | `.copilot-generating-indicator` / `.copilot-streaming-dots` / `@keyframes copilot-dot-pulse`                                       | 三点动画（纯 CSS，含 `prefers-reduced-motion` 降级）、`.copilot-generating-timer` 用 tabular-nums                         |
| 其他       | `.copilot-command-*`、`.copilot-notice-*`、`.warning-message` 等                                                                   | 命令弹窗、内嵌 notice                                                                                                     |

### 3.3 改样式的操作路径

1. 组件内联样式（首选）：组件 tsx 里 `tw-*` 类 —— 改类名即可，Tailwind 会在下次 build 自动收录
2. 跨组件的排版规则（如消息 Markdown 渲染）：改 `src/styles/tailwind.css` 对应段
3. **注意**：新增类名后必须重新 `npm run build`，Tailwind 按 content 扫描生成，没有被扫到的类不会出现在 `styles.css` 里

---

## 4. 常见修改场景速查

| 想改什么         | 去哪改                                                             | 备注                                         |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| 消息气泡外观     | `ChatSingleMessage.tsx:1088-1136`                                  | 用户消息底色在 1092-1098                     |
| 流式滚动行为     | `src/hooks/useChatScrolling.ts`                                    | `PIN_TO_BOTTOM_THRESHOLD_PX` 阈值            |
| 生成中指示器     | `GeneratingIndicator.tsx` + tailwind.css `copilot-generating-*` 段 |                                              |
| 发送前上下文格式 | `ContextManager.ts` / `contextProcessor.ts`                        | XML 标签结构在 `processContextNotes`         |
| 某网关的流式兼容 | `openaiDeltaUtils.ts` / `ChatOpenAIFormat.ts`                      | 有单测                                       |
| 系统/用户提示词  | `src/system-prompts` / `src/LLMProviders/promptManager.ts`         | ⚠️ AGENTS.md：未经用户要求不得改 prompt 内容 |
| 命令注册         | `src/commands/index.ts` (`registerCommands`)                       | 设置变更时会重注册                           |
| 新增设置项       | `src/settings/model`（含迁移）+ `src/settings/v2` UI               | 设置有版本化迁移机制                         |
| 聊天持久化格式   | `src/core/ChatPersistenceManager.ts`                               | 按 markdown 文件存储，项目 ID 前缀           |
| 保存数据加密     | `main.ts` onload 第 2 步订阅                                       | `enableEncryption` 开关                      |

## 5. 修改后的验证清单

```bash
npx tsc --noEmit          # 类型检查（build 也会自动跑）
npm run lint              # ESLint（AGENTS.md：PR 前 format + lint）
npm run test              # 1980 个单测，约 2.5 分钟
npm run build             # 产出可部署三件套
```

产物部署到 `.obsidian/plugins/copilot/` 后，在 Obsidian 设置里关闭再开启插件（或 Ctrl+R 重载）生效。若改了 `manifest.json` 的 version，记得同步 `versions.json`（`npm version` 脚本会自动处理）。
