# Claude Code Chat

一个面向 VS Code 的 Claude Code 图形聊天扩展，让你不用频繁切到终端，也能在编辑器里直接和 Claude Code 交互。

## 简介

Claude Code Chat 把 Claude Code 的常用能力搬进 VS Code：
- 在侧边栏或独立面板中聊天
- 查看工具调用和执行结果
- 管理权限、模型、环境变量和 WSL 配置
- 使用 MCP、Skills、Plugins 市场
- 保存会话、查看历史、恢复检查点
- 支持图片粘贴、文件引用、Slash Commands 等能力

适合希望在 VS Code 内完成 Claude Code 工作流的用户，尤其适合 Windows / WSL 场景。

## 主要特性

### 1. 聊天界面
- 直接在 VS Code 内使用 Claude Code
- 支持实时流式响应
- 支持侧边栏和独立窗口两种模式
- 支持代码块高亮、消息复制、自动滚动

### 2. 会话与检查点
- 自动保存对话历史
- 支持恢复之前的会话
- 支持检查点回滚，方便试错和恢复代码状态
- 可查看最新修改并快速接受或拒绝变更

### 3. 权限系统
- 图形化权限管理
- 支持工具级“总是允许”
- Bash 支持按命令模式授权
- 支持 YOLO Mode 跳过权限确认
- 权限会按工作区保存
- 当前版本默认会为 **除 Bash 外的大多数工具** 自动授予权限

### 4. MCP / Skills / Plugins
- 浏览和安装 MCP Server
- 浏览和安装 Skills
- 浏览和安装 Plugins
- 支持项目级和全局级安装范围

### 5. 富交互输入体验
- 支持 `@` 引用工作区文件
- 支持粘贴图片和图片预览
- 支持 Slash Commands
- 支持 Plan 模式和不同强度的 Thinking 模式

### 6. 配置能力
- 支持自定义 Claude 可执行文件路径
- 支持 WSL 集成
- 支持自定义环境变量
- 支持环境变量预设
- 支持本地 Router 模式

## 安装要求

在使用本扩展前，请确保你已经具备以下环境：

- VS Code 1.94.0 或更高版本
- 已安装 Claude Code CLI
- Node.js 18+
- 可用的 Claude 账户、订阅或 API 环境

## 安装方式

### 从 Marketplace 安装
在 VS Code 扩展市场中搜索 `Claude Code Chat` 并安装。

### 手动安装
如果你有 `.vsix` 包，可以执行：

```bash
code --install-extension claude-code-chat-x.x.x.vsix
```

## 打开方式

安装后可以通过以下方式打开：

- 快捷键：`Ctrl+Shift+C`
- 命令面板：`Claude Code Chat: Open Chat`
- 活动栏中的 Claude Code Chat 图标

## 常用功能说明

### 文件引用
在输入框中输入 `@`，可以快速搜索并引用工作区内的文件。

### 图片输入
支持直接粘贴截图或通过文件选择器添加图片，发送前会显示预览。

### Slash Commands
输入 `/` 可以调出命令面板，快速执行 Claude Code 的常用命令。

### 权限管理
在设置面板中可以查看和管理工具权限：
- 非 Bash 工具通常可直接设为始终允许
- Bash 工具支持例如 `npm i *`、`git add *` 这类命令模式

### WSL 支持
如果你在 Windows 下通过 WSL 使用 Claude Code，可以在扩展设置中启用：
- `Claude Code Chat: WSL Enabled`
- `Claude Code Chat: WSL Distro`
- `Claude Code Chat: WSL Node Path`
- `Claude Code Chat: WSL Claude Path`

示例：

```json
{
  "claudeCodeChat.wsl.enabled": true,
  "claudeCodeChat.wsl.distro": "Ubuntu",
  "claudeCodeChat.wsl.nodePath": "/usr/bin/node",
  "claudeCodeChat.wsl.claudePath": "/usr/local/bin/claude"
}
```

## 主要配置项

扩展提供以下核心配置：

- `claudeCodeChat.wsl.enabled`
- `claudeCodeChat.wsl.distro`
- `claudeCodeChat.wsl.nodePath`
- `claudeCodeChat.wsl.claudePath`
- `claudeCodeChat.thinking.intensity`
- `claudeCodeChat.permissions.yoloMode`
- `claudeCodeChat.executable.path`
- `claudeCodeChat.environment.variables`
- `claudeCodeChat.environment.presets`
- `claudeCodeChat.environment.activePresetId`
- `claudeCodeChat.environment.disabled`
- `claudeCodeChat.router.enabled`

## 开发

### 安装依赖

```bash
npm install
```

### 编译

```bash
npm run compile
```

### 监听编译

```bash
npm run watch
```

### 运行扩展
在 VS Code 中按 `F5` 启动扩展开发宿主。

## 项目结构

主要代码集中在 `src/`：

- `src/extension.ts`：扩展主入口与核心逻辑
- `src/ui.ts`：Webview HTML 结构
- `src/script.ts`：前端交互逻辑
- `src/ui-styles.ts`：界面样式
- `src/router/`：路由与格式转换逻辑
- `src/skills-ui.ts` / `src/skills-script.ts`：Skills 界面相关逻辑
- `src/plugins-ui.ts` / `src/plugins-script.ts`：Plugins 界面相关逻辑
- `src/checkpointService.ts`：检查点相关逻辑

## 版本

当前版本：`2.0.6`

## 许可证

详见 [LICENSE](LICENSE)。

## 支持与反馈

- 扩展内可通过 Support 入口提交反馈
- 问题反馈：GitHub Issues

如果这个项目对你有帮助，欢迎 Star。