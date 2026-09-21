# Agent Configuration & Rules

## Project Context
Always read [overview.md](domains/overview.md) on startup to understand current project priorities, milestones, and conventions.

## Obsidian Vault Memory Palace Rules
The user's local Obsidian Vault is mapped to this project via a symbolic link named `vault` at the project root.
- **Symlink Path:** `vault` (Mac only — points into the Obsidian Vault; absent on the PC, so skip vault steps there)
- **Structure:**
  - `vault/Rooms/agent-orchestration/Halls/`
  - `vault/Rooms/api-integration/Halls/`
- **Session Files:**
  - `facts.md`: Immutable truths and architecture principles established during developer/agent sessions.
  - `events.md`: Chronological log of major events, updates, and releases in this workspace.
  - `discoveries.md`: Bugs resolved, solutions found, and research findings.
  - `preferences.md`: Personal style or tool preferences defined by the developer.

### Rules for Agents writing to the Vault:
1. Always write logs, reference histories, and session notes to `vault/Rooms/agent-orchestration/Halls/events.md` or the appropriate folder files.
2. Read `facts.md` and `preferences.md` before making design decisions.
3. Keep logs concise. Do not clutter the user's Obsidian Vault.
