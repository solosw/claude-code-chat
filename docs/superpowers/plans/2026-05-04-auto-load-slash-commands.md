# Slash Commands Auto-Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded slash command HTML with a JSON data file that enables dynamic command list rendering and easy updates.

**Architecture:** Extract hard-coded slash commands from `ui.ts` into a structured JSON data file (`src/slash-commands.json`). Modify the webview to render commands dynamically from this data instead of static HTML. Add a runtime auto-discovery mechanism that attempts to extract commands from the Claude Code CLI, falling back to the bundled JSON.

**Tech Stack:** TypeScript, VS Code Extension API, JSON data file

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/slash-commands.json` | **Create** - Structured data for all built-in slash commands (single source of truth) |
| `src/ui.ts` | **Modify** - Replace hardcoded command HTML with dynamic container placeholder |
| `src/extension.ts` | **Modify** - Add command data provider that sends slash commands to webview; add runtime auto-discovery |
| `src/script.ts` | **Modify** - Add dynamic command rendering function; remove hardcoded rendering assumptions |

---

### Task 1: Create slash-commands.json data file

**Files:**
- Create: `src/slash-commands.json`

- [ ] **Step 1: Create the JSON data file**

Create `src/slash-commands.json` with all 18 built-in commands extracted from `ui.ts` lines 1004-1164:

```json
[
  {
    "id": "add-dir",
    "icon": "📁",
    "title": "/add-dir",
    "description": "Add additional working directories"
  },
  {
    "id": "agents",
    "icon": "🤖",
    "title": "/agents",
    "description": "Manage custom AI subagents for specialized tasks"
  },
  {
    "id": "bug",
    "icon": "🐛",
    "title": "/bug",
    "description": "Report bugs (sends conversation to Anthropic)"
  },
  {
    "id": "clear",
    "icon": "🗑️",
    "title": "/clear",
    "description": "Clear conversation history"
  },
  {
    "id": "compact",
    "icon": "📦",
    "title": "/compact",
    "description": "Compact conversation with optional focus instructions"
  },
  {
    "id": "config",
    "icon": "⚙️",
    "title": "/config",
    "description": "Open the Settings interface (Config tab)"
  },
  {
    "id": "cost",
    "icon": "💰",
    "title": "/cost",
    "description": "Show token usage statistics"
  },
  {
    "id": "doctor",
    "icon": "🩺",
    "title": "/doctor",
    "description": "Checks the health of your Claude Code installation"
  },
  {
    "id": "help",
    "icon": "❓",
    "title": "/help",
    "description": "Get usage help"
  },
  {
    "id": "init",
    "icon": "🚀",
    "title": "/init",
    "description": "Initialize project with CLAUDE.md guide"
  },
  {
    "id": "login",
    "icon": "🔑",
    "title": "/login",
    "description": "Switch Anthropic accounts"
  },
  {
    "id": "logout",
    "icon": "🚪",
    "title": "/logout",
    "description": "Sign out from your Anthropic account"
  },
  {
    "id": "mcp",
    "icon": "🔌",
    "title": "/mcp",
    "description": "Manage MCP server connections and OAuth authentication"
  },
  {
    "id": "memory",
    "icon": "🧠",
    "title": "/memory",
    "description": "Edit CLAUDE.md memory files"
  },
  {
    "id": "model",
    "icon": "🤖",
    "title": "/model",
    "description": "Select or change the AI model"
  },
  {
    "id": "permissions",
    "icon": "🔒",
    "title": "/permissions",
    "description": "View or update permissions"
  },
  {
    "id": "pr_comments",
    "icon": "💬",
    "title": "/pr_comments",
    "description": "View pull request comments"
  },
  {
    "id": "review",
    "icon": "👀",
    "title": "/review",
    "description": "Request code review"
  },
  {
    "id": "rewind",
    "icon": "⏪",
    "title": "/rewind",
    "description": "Rewind the conversation and/or code"
  },
  {
    "id": "status",
    "icon": "📊",
    "title": "/status",
    "description": "Open the Settings interface (Status tab) showing version, model, account, and connectivity"
  },
  {
    "id": "terminal-setup",
    "icon": "⌨️",
    "title": "/terminal-setup",
    "description": "Install Shift+Enter key binding for newlines (iTerm2 and VSCode only)"
  },
  {
    "id": "usage",
    "icon": "📈",
    "title": "/usage",
    "description": "Show plan usage limits and rate limit status (subscription plans only)"
  },
  {
    "id": "vim",
    "icon": "📝",
    "title": "/vim",
    "description": "Enter vim mode for alternating insert and command modes"
  }
]
```

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "const d = require('./src/slash-commands.json'); console.log(d.length + ' commands loaded');"`
Expected: "23 commands loaded"

---

### Task 2: Modify extension.ts to load and send command data to webview

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Import slash-commands.json at the top of extension.ts**

Add near the other imports:

```typescript
import * as slashCommandsData from './slash-commands.json';
```

- [ ] **Step 2: Add auto-discovery method to attempt fetching commands from Claude Code**

In the `ClaudeCodeChatProvider` class, add a private method that tries to discover slash commands from the installed Claude Code CLI. This method reads the bundled JSON as the baseline and attempts to augment it with runtime discovery:

```typescript
private async _discoverSlashCommands(): Promise<Array<{id: string; icon: string; title: string; description: string}>> {
    // Start with bundled commands as baseline
    const bundledCommands: Array<{id: string; icon: string; title: string; description: string}> = (slashCommandsData as any).default || slashCommandsData;

    try {
        const config = vscode.workspace.getConfiguration('claudeCodeChat');
        const executablePath = config.get<string>('executable.path', 'claude');
        const wslEnabled = config.get<boolean>('wsl.enabled', false);

        let command = executablePath;
        let args: string[] = [];

        if (wslEnabled) {
            const wslDistro = config.get<string>('wsl.distro', 'Ubuntu');
            const claudePath = config.get<string>('wsl.claudePath', '/usr/local/bin/claude');
            command = 'wsl';
            args = ['-d', wslDistro, claudePath];
        }

        // Try to get help text which may contain slash command info
        const helpArgs = [...args, '--print', '/help'];
        const childProcess = require('child_process');
        const result = childProcess.execSync(
            wslEnabled ? `wsl -d ${config.get<string>('wsl.distro', 'Ubuntu')} ${config.get<string>('wsl.claudePath', '/usr/local/bin/claude')} --print /help` : `${executablePath} --print /help`,
            { timeout: 5000, encoding: 'utf8' }
        );

        // Parse the output for slash commands
        const commandPattern = /^\s*\/([a-z_-]+)\s*[-–—]\s*(.+)$/gm;
        let match;
        const discoveredCommands: Map<string, {id: string; icon: string; title: string; description: string}> = new Map();

        // Start with bundled commands
        for (const cmd of bundledCommands) {
            discoveredCommands.set(cmd.id, cmd);
        }

        // Update/augment with discovered commands
        while ((match = commandPattern.exec(result)) !== null) {
            const id = match[1];
            discoveredCommands.set(id, {
                id,
                icon: '⚡',
                title: `/${id}`,
                description: match[2].trim()
            });
        }

        return Array.from(discoveredCommands.values());
    } catch {
        // Discovery failed - return bundled commands
        return bundledCommands;
    }
}
```

- [ ] **Step 3: Send slash commands data to the webview on initialization**

Find the `_postMessage` pattern in `extension.ts` (where `settingsData`, `customSnippetsData` etc. are sent). Add a call to send slash commands, either discovered or bundled. Find the point where the webview is initialized (after the `_postMessage` for `settingsData`), and add:

```typescript
// Send slash commands to webview
const slashCommands = await this._discoverSlashCommands();
this._postMessage({
    type: 'nativeCommandsData',
    data: slashCommands
});
```

- [ ] **Step 4: Also handle the `getNativeCommands` message type from webview**

In the message handler switch block (near line 1039 where `executeSlashCommand` is handled), add:

```typescript
case 'getNativeCommands':
    const commands = await this._discoverSlashCommands();
    this._postMessage({
        type: 'nativeCommandsData',
        data: commands
    });
    break;
```

---

### Task 3: Modify ui.ts to use a dynamic container instead of hardcoded HTML

**Files:**
- Modify: `src/ui.ts`

- [ ] **Step 1: Replace the hardcoded command items with an empty container**

In `ui.ts`, find the `nativeCommandsList` `<div>` section (approximately lines 1003-1182). Replace the entire `nativeCommandsList` div contents with a single empty container. The before/after:

Replace everything inside `<div class="slash-commands-list" id="nativeCommandsList">` with just the "Quick Command" input at the end:

```html
<div class="slash-commands-list" id="nativeCommandsList">
    <!-- Dynamically populated from slash-commands.json -->
</div>
```

Keep the "Quick Command" custom input item as a separate static element outside `nativeCommandsList`, since it's not a command from the JSON:

```html
<div class="slash-command-item custom-command-item">
    <div class="slash-command-icon">⚡</div>
    <div class="slash-command-content">
        <div class="slash-command-title">Quick Command</div>
        <div class="slash-command-description">
            <div class="command-input-wrapper">
                <span class="command-prefix">/</span>
                <input type="text"
                       class="custom-command-input"
                       id="customCommandInput"
                       placeholder="enter-command"
                       onkeydown="handleCustomCommandKeydown(event)"
                       onclick="event.stopPropagation()">
            </div>
        </div>
    </div>
</div>
```

---

### Task 4: Add dynamic rendering and message handling in script.ts

**Files:**
- Modify: `src/script.ts`

- [ ] **Step 1: Add global variable for native commands data**

Near the top of the script section (where other global state variables are defined), add:

```javascript
let nativeCommandsData = [];
```

- [ ] **Step 2: Add the renderNativeCommands function**

Add a function that takes the commands array and renders them into the `nativeCommandsList` container:

```javascript
function renderNativeCommands(commands) {
    const container = document.getElementById('nativeCommandsList');
    if (!container) return;

    container.innerHTML = commands.map(cmd => `
        <div class="slash-command-item" onclick="executeSlashCommand('${cmd.id}')">
            <div class="slash-command-icon">${cmd.icon}</div>
            <div class="slash-command-content">
                <div class="slash-command-title">${cmd.title}</div>
                <div class="slash-command-description">${cmd.description}</div>
            </div>
        </div>
    `).join('');
}
```

- [ ] **Step 3: Handle the nativeCommandsData message from extension**

In the `window.addEventListener('message', ...)` handler (near line 5949 where `customSnippetsData` is handled), add a new branch:

```javascript
} else if (message.type === 'nativeCommandsData') {
    nativeCommandsData = message.data || [];
    renderNativeCommands(nativeCommandsData);
}
```

- [ ] **Step 4: Request native commands on page load**

Near where `getCustomSnippets` is requested (line 5934), add a request for native commands:

```javascript
vscode.postMessage({
    type: 'getNativeCommands'
});
```

- [ ] **Step 5: Update filterSlashCommands to work with dynamic content**

The existing `filterSlashCommands` function (line 3777) uses `querySelectorAll('.slash-command-item')` which already works with dynamically rendered content since it queries the DOM. No change needed here.

---

### Task 5: Configure TypeScript to allow JSON imports

**Files:**
- Modify: `tsconfig.json` (if needed)

- [ ] **Step 1: Check tsconfig.json for resolveJsonModule setting**

Read `tsconfig.json` and verify it includes `"resolveJsonModule": true` and `"esModuleInterop": true` in compilerOptions. If not present, add them.

- [ ] **Step 2: Verify the build compiles**

Run: `npm run compile`
Expected: No TypeScript errors related to JSON imports

---

### Task 6: Verification and testing

- [ ] **Step 1: Build and verify the extension compiles**

Run: `npm run compile`
Expected: Successful compilation with no errors

- [ ] **Step 2: Test in VS Code debug mode**

Launch the extension in VS Code debug mode (F5). Verify:
1. Opening the slash commands modal shows all 23 commands
2. The search/filter still works
3. Clicking a command executes it in terminal
4. The "Quick Command" input still works
5. When Claude Code adds new commands, updating `slash-commands.json` is all that's needed

- [ ] **Step 3: Commit**

```bash
git add src/slash-commands.json src/extension.ts src/ui.ts src/script.ts tsconfig.json
git commit -m "feat: replace hardcoded slash commands with JSON-driven dynamic loading

- Extract built-in commands from ui.ts into slash-commands.json
- Add runtime auto-discovery from Claude CLI (fallback to bundled JSON)
- Render command list dynamically from data instead of static HTML
- Enables easy command updates by editing a single JSON file"
```

---

## Design Decisions

1. **JSON data file over remote API**: Using a local JSON file is simpler (KISS), works offline, and doesn't add network dependency. When Claude Code adds new commands, just update the JSON.

2. **Runtime discovery attempt**: The `_discoverSlashCommands` method tries `claude --print /help` to find commands at runtime. If it fails (timeout, CLI not available, etc.), it gracefully falls back to the bundled JSON. This gives the best of both worlds.

3. **Keeping "Quick Command" static**: The custom command input isn't a "built-in command" — it's UI functionality. It stays in the HTML template, separate from the dynamic list.

4. **No emoji icons in JSON for discovered commands**: When commands are discovered at runtime (not from the bundled JSON), they get a default "⚡" icon since we can't determine the appropriate emoji programmatically.