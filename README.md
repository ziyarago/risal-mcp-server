# Risal MCP Server

> Control [Risal](https://risal.io) — tasks, sprints, work timers, AI-cost
> tracking, and live server monitoring — straight from your AI agent, over the
> [Model Context Protocol](https://modelcontextprotocol.io).

[![npm version](https://img.shields.io/npm/v/risal-mcp-server.svg)](https://www.npmjs.com/package/risal-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/risal-mcp-server.svg)](https://www.npmjs.com/package/risal-mcp-server)
[![Docker Hub](https://img.shields.io/docker/v/shaxzod/risal-mcp-server?label=docker&logo=docker)](https://hub.docker.com/r/shaxzod/risal-mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Built for MCP](https://img.shields.io/badge/built%20for-MCP-7c3aed.svg)](https://modelcontextprotocol.io)

Risal is an AI-powered task & project management platform with built-in server
monitoring. This MCP server exposes Risal's API as agent tools, so an LLM client
(Claude Desktop, Claude Code, Cursor, or any MCP-capable agent) can:

- **Plan & track work** — create/update tasks, AI-parse a plan or notes into a
  task list, organize them into projects and sprints.
- **Track time** — start/stop the same cross-device work stopwatch the web app
  shows, or log minutes manually.
- **Account for AI cost** — log the agent's own model + token usage so it lands
  in Risal's cost report, and read that report back.
- **Operate servers** — read live CPU/RAM/disk metrics and alerts, and
  restart/start/stop Docker containers, systemd services and pm2 processes,
  fetch logs, run diagnostics, and manage down-alerts.

Everything is authed by a **scoped personal access token** and enforced
server-side — a token can never manage your account, and only touches servers
its owner enrolled.

## Get an API key

In the Risal web app go to **[app.risal.io](https://app.risal.io) → Profile →
API tokens**, create a token, and pick the scopes you need:

| Scope | Grants |
|-------|--------|
| `tasks:read`    | list tasks / projects / sprints, read timers & AI-cost report |
| `tasks:write`   | create / update / bulk-create / AI-parse tasks, timers, sprints, projects, log AI usage (implies read) |
| `servers:read`  | list servers, metrics, alerts, watched services |
| `servers:write` | restart/start/stop docker · systemd · pm2, fetch logs, run diagnostics, manage watched services (implies read) |

Copy the token (`risal_pat_…`) — it's shown once. Scope it to the minimum your
agent needs; you can revoke it anytime from the same screen.

## Install

Both methods register the server with Claude Code under the name `risal`.
Replace `risal_pat_…` with your token.

### npx (recommended — only needs Node ≥ 18, nothing to build)

```bash
claude mcp add risal --scope user --env RISAL_API_KEY=risal_pat_… -- npx -y risal-mcp-server
```

### Docker

```bash
claude mcp add risal --scope user --env RISAL_API_KEY=risal_pat_… -- docker run -i --rm -e RISAL_API_KEY shaxzod/risal-mcp-server:latest
```

<details>
<summary>Or configure MCP clients by hand (JSON)</summary>

**npx**

```jsonc
{
  "mcpServers": {
    "risal": {
      "command": "npx",
      "args": ["-y", "risal-mcp-server"],
      "env": { "RISAL_API_KEY": "risal_pat_…" }
    }
  }
}
```

**Docker** ([`shaxzod/risal-mcp-server`](https://hub.docker.com/r/shaxzod/risal-mcp-server) — `:latest` or pin a version like `:1.11.0`)

```jsonc
{
  "mcpServers": {
    "risal": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "RISAL_API_KEY=risal_pat_…", "shaxzod/risal-mcp-server:latest"]
    }
  }
}
```

</details>

### Self-hosted Risal

Point the server at your own Risal API host with the `RISAL_API_BASE` env var
(default `https://api.risal.io`). Add `--env RISAL_API_BASE=https://api.your-risal.example`
to the `claude mcp add` command, or to the `env` block in the JSON.

## Tools

Derived directly from the source — 42 tools across identity, tasks, and infra.

### Identity

| Tool | Scope | Purpose |
|------|-------|---------|
| `whoami` | any | the Risal user this token belongs to |

### Tasks, projects & sprints

| Tool | Scope | Purpose |
|------|-------|---------|
| `list_tasks` | tasks:read | list tasks, filter by status / project / planned date |
| `create_task` | tasks:write | create one task (defaults to today's calendar) |
| `update_task` | tasks:write | patch a task — status/workflow_state (Kanban column: in_progress/done…), assignee, dates, priority, project/sprint |
| `resync_board` | tasks:write | re-place a project's tasks on the Kanban column matching their state (fixes done tasks stuck in the wrong column) |
| `parse_text_to_tasks` | tasks:write | AI-parse free text into draft tasks (preview, no write) |
| `create_tasks_bulk` | tasks:write | create many tasks at once (e.g. the parsed drafts) |
| `list_projects` | tasks:read | projects tasks can attach to |
| `create_project` | tasks:write | create a project (`is_agile` for dev/Gantt workspace) |
| `delete_project` | tasks:write | delete a project (tasks return to backlog) |
| `list_sprints` | tasks:read | sprints with metrics (done/total, burndown) |
| `create_sprint` | tasks:write | create a sprint over a date range |
| `update_sprint` | tasks:write | update a sprint's dates, name or goal |
| `delete_sprint` | tasks:write | delete a sprint (tasks return to backlog) |

### Work timers & time logging

| Tool | Scope | Purpose |
|------|-------|---------|
| `start_timer` | tasks:write | start the cross-device work stopwatch on a task (idempotent) |
| `stop_timer` | tasks:write | pause the timer, banking elapsed time |
| `get_timer` | tasks:write | read a task's timer (elapsed + running state) |
| `log_time` | tasks:write | add/subtract logged minutes on a task's timer |

### AI usage & cost

| Tool | Scope | Purpose |
|------|-------|---------|
| `log_ai_usage` | tasks:write | record the agent's own model + token usage → cost report |
| `get_ai_usage` | tasks:read | token & USD cost report (by model/provider/project, date range) |

### Server monitoring (read)

| Tool | Scope | Purpose |
|------|-------|---------|
| `list_servers` | servers:read | monitored servers with live CPU/RAM/disk + status |
| `get_server` | servers:read | one server's detail (services, docker, nginx snapshots) |
| `get_server_metrics` | servers:read | resource time-series (1h / 24h / 7d / 30d / 1y) |
| `list_alerts` | servers:read | recent infra alerts, optionally for one server |
| `list_vuln_findings` | servers:read | a server's security/vuln findings (FAIL/WARN first; CVE/KEV, remediation, fix_kind) |

### Server management (write — async)

| Tool | Scope | Purpose |
|------|-------|---------|
| `restart_docker` / `start_docker` / `stop_docker` | servers:write | Docker container lifecycle |
| `get_docker_logs` | servers:write | fetch a container's log tail |
| `restart_service` | servers:write | restart a systemd service |
| `service_status` | servers:write | read-only `systemctl status` of a service |
| `server_diagnostics` | servers:write | read-only host health (uptime, mem, disk, top procs) |
| `list_pm2` | servers:write | list pm2-managed processes |
| `restart_pm2` / `reload_pm2` / `stop_pm2` / `start_pm2` | servers:write | pm2 process lifecycle (`reload` = zero-downtime) |
| `get_pm2_logs` | servers:write | fetch a pm2 process's log tail |
| `get_command` | servers:write | poll a queued command's status / exit code / output |
| `list_commands` | servers:write | list recent commands issued to a server |
| `list_watched_services` | servers:read | services/containers watched for down-alerts |
| `add_watched_service` | servers:write | watch a systemd / docker / cron service |
| `remove_watched_service` | servers:write | stop watching a service |
| `apply_vuln_fix` | servers:write | apply a finding's vetted remediation (safe fix_kinds only; runs through the approval gate) |
| `mute_vuln_finding` | servers:write | mute/unmute a finding (accepted risk / false positive) |

> **Server write actions are asynchronous.** They queue a command the on-box
> Risal agent runs on its next heartbeat (~1 min). The tool returns a command
> `id`; call `get_command` to see its `status` (pending → done/failed),
> `exit_code` and `output`. Every action is tenant-scoped — a token can only
> touch servers its owner enrolled.

## Usage examples

Natural-language prompts your agent can act on once the server is connected:

- *"Turn these meeting notes into tasks for today and schedule the design ones for Thursday."*
- *"Start a timer on the 'fix auth bug' task."* … later: *"Stop the timer and mark it done."*
- *"Create a sprint for next week and move my three open backend tasks into it."*
- *"How much have I spent on AI for the risal-saas project this month?"*
- *"Which of my servers is highest on disk right now, and show its 7-day trend."*
- *"The nginx container on prod looks down — restart it and show me the last 50 log lines."*
- *"Log that I used claude-opus with ~12k prompt / 3k completion tokens on this task."*

## Develop / run from source

```bash
git clone https://github.com/ziyarago/risal-mcp-server.git && cd risal-mcp-server
npm install
npm run build          # tsc → dist/
RISAL_API_KEY=risal_pat_… npm start
# or hot-reload during development:
RISAL_API_KEY=risal_pat_… npm run dev
```

## Publish (maintainers)

```bash
cd mcp-server
npm version patch                 # bump version
npm publish --access public       # prepublishOnly builds dist automatically

# Docker — tag the exact version and latest so users can pin or float:
VER=$(node -p "require('./package.json').version")
docker build -t shaxzod/risal-mcp-server:"$VER" -t shaxzod/risal-mcp-server:latest .
docker push shaxzod/risal-mcp-server:"$VER"
docker push shaxzod/risal-mcp-server:latest
```

CI (`.github/workflows/ci.yml`) type-checks and builds on every push/PR.
Publishing is intentionally manual; an opt-in tag-triggered npm-publish job is
included commented-out in the workflow.

## Security

- The token is a Bearer credential — keep it in your MCP client's env, never in
  a prompt or committed file. Revoke it anytime in Profile → API tokens.
- All calls go to the Risal API over HTTPS; this server only proxies tool calls
  and stores nothing.
- Account management (sessions, deleting the account, minting tokens) is **never**
  reachable with a token, regardless of scope.

## Links

- Risal — [risal.io](https://risal.io) · app: [app.risal.io](https://app.risal.io)
- npm — [risal-mcp-server](https://www.npmjs.com/package/risal-mcp-server)
- Docker Hub — [shaxzod/risal-mcp-server](https://hub.docker.com/r/shaxzod/risal-mcp-server)
- Model Context Protocol — [modelcontextprotocol.io](https://modelcontextprotocol.io)

## License

[MIT](./LICENSE) © 2026 Ziyarago (Risal)
