#!/usr/bin/env node
/**
 * Risal MCP server.
 *
 * Exposes Risal tasks + server-monitoring as MCP tools over stdio. Auth is a
 * personal access token (`risal_pat_…`) created in the Risal web app (Profile →
 * API tokens), passed via the RISAL_API_KEY env var. The token's scopes
 * (tasks:read/write, servers:read/write) are enforced server-side by Risal.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const API_BASE = (process.env.RISAL_API_BASE || 'https://api.risal.io').replace(/\/$/, '')
const API_KEY = process.env.RISAL_API_KEY
if (!API_KEY) {
  console.error('RISAL_API_KEY is required (Risal web app → Profile → API tokens).')
  process.exit(1)
}

type Json = Record<string, unknown>

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Risal API ${res.status}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
function qs(params: Record<string, unknown>): string {
  const p = Object.entries(params).filter(([, v]) => v != null && v !== '')
  return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') : ''
}
function clean<T extends Json>(o: T): Json {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}
// The app's "today" is Asia/Riyadh (matches the backend's riyadh_today). Used to
// default AI-created tasks onto today's calendar instead of an invisible backlog.
function todayRiyadh(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) // YYYY-MM-DD
}

const server = new McpServer({ name: 'risal-mcp-server', version: '1.0.0' })

// ── identity ──
server.tool('whoami', 'The Risal user this token belongs to.', {}, async () => ok(await api('/auth/me')))

// ── tasks (scope: tasks) ──
server.tool(
  'list_tasks',
  'List the user\'s tasks. Optional filters by status / project / planned date.',
  { status: z.enum(['todo', 'done']).optional(), project_id: z.string().optional(), planned_date: z.string().optional() },
  async (a) => ok(await api(`/tasks${qs(a)}`)),
)
server.tool(
  'create_task',
  'Create a task. `type` is one of personal|content|code|docs|finance|health. Dates: planned_date = YYYY-MM-DD, deadline = ISO datetime. IMPORTANT: a task with no planned_date/deadline lands in the backlog and is NOT shown on the calendar — so if you do not set either, it defaults to TODAY (Asia/Riyadh) to stay visible. Set an explicit planned_date to schedule it on another day, or pass planned_date="" to deliberately leave it in the backlog.',
  {
    title: z.string(),
    type: z.enum(['personal', 'content', 'code', 'docs', 'finance', 'health']).default('personal'),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    description: z.string().optional(),
    planned_date: z.string().optional(),
    deadline: z.string().optional(),
    est_minutes: z.number().optional(),
    points: z.number().optional(),
    project_id: z.string().optional(),
  },
  async (a) => {
    const body = clean(a)
    // planned_date === '' is an explicit opt-out → leave in backlog (drop the empty value).
    if (body.planned_date === '') delete body.planned_date
    else if (body.planned_date == null && body.deadline == null) body.planned_date = todayRiyadh()
    return ok(await api('/tasks', { method: 'POST', body: JSON.stringify(body) }))
  },
)
server.tool(
  'update_task',
  'Update a task. Mark done/undone with `status` (todo|done) — NOT `state` (state is read-only/computed). Pass null for project_id/sprint_id to move a task to the backlog.',
  {
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(['personal', 'content', 'code', 'docs', 'finance', 'health']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    status: z.enum(['todo', 'done']).optional(),
    planned_date: z.string().nullable().optional(),
    deadline: z.string().nullable().optional(),
    est_minutes: z.number().optional(),
    points: z.number().optional(),
    project_id: z.string().nullable().optional(),
    sprint_id: z.string().nullable().optional(),
  },
  async ({ id, ...patch }) => ok(await api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(clean(patch)) })),
)
server.tool(
  'parse_text_to_tasks',
  'AI-parse free text (a plan, notes, a chat) into draft tasks. Preview only — does not create them. Follow up with create_tasks_bulk to persist.',
  { text: z.string() },
  async (a) => ok(await api('/tasks/parse-preview', { method: 'POST', body: JSON.stringify({ text: a.text }) })),
)
server.tool(
  'create_tasks_bulk',
  'Create many tasks at once (e.g. the draft_tasks returned by parse_text_to_tasks). Each task with no planned_date/deadline defaults to TODAY (Asia/Riyadh) so it shows on the calendar instead of the backlog; set planned_date per task to spread them across days, or planned_date="" to leave a task in the backlog.',
  { tasks: z.array(z.record(z.any())) },
  async (a) => {
    const today = todayRiyadh()
    const tasks = a.tasks.map((t) => {
      if (t.planned_date === '') { const { planned_date, ...rest } = t; return rest }
      if (t.planned_date == null && t.deadline == null) return { ...t, planned_date: today }
      return t
    })
    return ok(await api('/tasks/bulk', { method: 'POST', body: JSON.stringify({ tasks }) }))
  },
)
// Work timer = the SAME cross-device stopwatch the web app shows (task_timers).
// elapsed = accumulated_ms + (running_since ? now - running_since : 0).
type Timer = { task_id: string; accumulated_ms: number; running_since: string | null }
async function getTimer(taskId: string): Promise<Timer> {
  const all = (await api('/timers')) as Timer[]
  return all.find((t) => t.task_id === taskId) ?? { task_id: taskId, accumulated_ms: 0, running_since: null }
}
const setTimer = (taskId: string, body: { accumulated_ms: number; running_since: string | null }) =>
  api(`/timers/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) })

server.tool(
  'start_timer',
  'Start the work timer on a task (the same stopwatch shown in the web app). Idempotent — keeps running if already started.',
  { id: z.string() },
  async (a) => {
    const t = await getTimer(a.id)
    if (t.running_since) return ok(t) // already running
    return ok(await setTimer(a.id, { accumulated_ms: t.accumulated_ms, running_since: new Date().toISOString() }))
  },
)
server.tool(
  'stop_timer',
  'Pause a task\'s timer, banking the elapsed time into accumulated_ms.',
  { id: z.string() },
  async (a) => {
    const t = await getTimer(a.id)
    const elapsed = t.accumulated_ms + (t.running_since ? Date.now() - Date.parse(t.running_since) : 0)
    return ok(await setTimer(a.id, { accumulated_ms: Math.max(0, Math.round(elapsed)), running_since: null }))
  },
)
server.tool(
  'log_time',
  'Manually add minutes of actual work to a task (negative to correct an over-log). Adjusts the same timer.',
  { id: z.string(), minutes: z.number().int() },
  async (a) => {
    const t = await getTimer(a.id)
    const acc = Math.max(0, t.accumulated_ms + a.minutes * 60000)
    return ok(await setTimer(a.id, { accumulated_ms: acc, running_since: t.running_since }))
  },
)
server.tool(
  'get_timer',
  'Read a task\'s work timer (accumulated_ms + whether it is running).',
  { id: z.string() },
  async (a) => ok(await getTimer(a.id)),
)
server.tool('list_projects', 'List the projects tasks can be attached to.', {}, async () => ok(await api('/tasks/projects')))
server.tool(
  'create_project',
  'Create a project to group tasks under (returns its id to use as project_id). Set is_agile=true for a dev/code project — its tasks show in the Development workspace (Gantt/Sprints) instead of the personal Calendar.',
  { name: z.string(), description: z.string().optional(), is_agile: z.boolean().optional() },
  async (a) => ok(await api('/tasks/projects', { method: 'POST', body: JSON.stringify(clean(a)) })),
)
server.tool(
  'delete_project',
  'Delete a project. Its tasks return to the backlog (not deleted).',
  { id: z.string() },
  async (a) => ok(await api(`/tasks/projects/${a.id}`, { method: 'DELETE' })),
)
server.tool('list_sprints', 'List sprints with their metrics (done/total, burndown points).', {}, async () => ok(await api('/sprints')))
server.tool(
  'create_sprint',
  'Create a sprint over a date range (returns its id to use as sprint_id on tasks). Dates are YYYY-MM-DD; date_end must be on or after date_start.',
  {
    date_start: z.string().describe('YYYY-MM-DD'),
    date_end: z.string().describe('YYYY-MM-DD, on or after date_start'),
    name: z.string().max(120).optional(),
    goal: z.string().optional(),
  },
  async (a) => ok(await api('/sprints', { method: 'POST', body: JSON.stringify(clean(a)) })),
)
server.tool(
  'update_sprint',
  'Update a sprint\'s date range, name, or goal. Only the fields you pass change.',
  {
    id: z.string(),
    date_start: z.string().optional().describe('YYYY-MM-DD'),
    date_end: z.string().optional().describe('YYYY-MM-DD'),
    name: z.string().max(120).optional(),
    goal: z.string().optional(),
  },
  async ({ id, ...body }) => ok(await api(`/sprints/${id}`, { method: 'PATCH', body: JSON.stringify(clean(body)) })),
)
server.tool(
  'delete_sprint',
  'Delete a sprint. Its tasks are NOT deleted — they return to the backlog (sprint_id → null). Idempotent.',
  { id: z.string() },
  async (a) => ok(await api(`/sprints/${a.id}`, { method: 'DELETE' })),
)
server.tool(
  'log_ai_usage',
  'Record THIS coding agent\'s own AI usage (model + token counts) against a project (and optionally a specific task_id for per-task cost), so Risal\'s cost report includes it (e.g. claude-opus-4-8). Risal computes the USD cost. Token counts can be approximate.',
  { model: z.string(), prompt_tokens: z.number().int().default(0), completion_tokens: z.number().int().default(0), project_id: z.string().optional(), task_id: z.string().optional(), kind: z.string().optional() },
  async (a) => ok(await api('/analytics/ai-usage', { method: 'POST', body: JSON.stringify(clean(a)) })),
)
server.tool(
  'get_ai_usage',
  'AI token + cost report (totals, by model+provider, by project). Optional project_id, task_id, date_from/date_to (YYYY-MM-DD).',
  { project_id: z.string().optional(), task_id: z.string().optional(), date_from: z.string().optional(), date_to: z.string().optional() },
  async (a) => ok(await api(`/analytics/ai-usage${qs(a)}`)),
)

// ── servers / infra (scope: servers) ──
server.tool('list_servers', 'List monitored servers with live CPU/RAM/disk + status.', {}, async () => ok(await api('/infra/servers')))
server.tool('get_server', 'Detailed view of one server (services, docker, nginx snapshots).', { id: z.string() }, async (a) => ok(await api(`/infra/servers/${a.id}`)))
server.tool(
  'get_server_metrics',
  'Time-series resource metrics for a server.',
  { id: z.string(), range: z.enum(['1h', '24h', '7d', '30d', '1y']).default('24h') },
  async (a) => ok(await api(`/infra/servers/${a.id}/metrics-series?range=${a.range}`)),
)
server.tool('list_alerts', 'Recent infra alerts, optionally for one server.', { server_id: z.string().optional() }, async (a) => ok(await api(`/infra/alerts${qs(a)}`)))

// ── server management / write actions (scope: servers:write) ──
// All actions are tenant-scoped server-side: a token can only act on servers
// the user owns. Commands run asynchronously — the agent on the box picks them
// up on its next heartbeat (~1 min), then `get_command` shows the result/output.
async function queueCommand(serverId: string, kind: string, target: string, args?: Json) {
  return api(`/infra/servers/${serverId}/commands`, {
    method: 'POST',
    body: JSON.stringify(clean({ kind, target, args })),
  })
}

server.tool(
  'restart_docker',
  'Restart a Docker container on a server. Async — poll get_command with the returned id for the result.',
  { server_id: z.string(), container: z.string() },
  async (a) => ok(await queueCommand(a.server_id, 'docker_restart', a.container)),
)
server.tool(
  'start_docker',
  'Start a stopped Docker container on a server. Async — poll get_command with the returned id.',
  { server_id: z.string(), container: z.string() },
  async (a) => ok(await queueCommand(a.server_id, 'docker_start', a.container)),
)
server.tool(
  'stop_docker',
  'Stop a running Docker container on a server. Async — poll get_command with the returned id.',
  { server_id: z.string(), container: z.string() },
  async (a) => ok(await queueCommand(a.server_id, 'docker_stop', a.container)),
)
server.tool(
  'get_docker_logs',
  'Fetch recent logs of a Docker container. Async — the log tail lands in the command `output`; poll get_command with the returned id.',
  { server_id: z.string(), container: z.string(), tail: z.number().optional() },
  async (a) => ok(await queueCommand(a.server_id, 'docker_logs', a.container, a.tail ? { tail: a.tail } : undefined)),
)
server.tool(
  'restart_service',
  'Restart a systemd service on a server. Async — poll get_command with the returned id.',
  { server_id: z.string(), service: z.string() },
  async (a) => ok(await queueCommand(a.server_id, 'systemd_restart', a.service)),
)
server.tool(
  'service_status',
  'Read-only `systemctl status` of a service on a server. Async — output lands in the command `output`; poll get_command with the returned id.',
  { server_id: z.string(), service: z.string() },
  async (a) => ok(await queueCommand(a.server_id, 'systemd_status', a.service)),
)
server.tool(
  'server_diagnostics',
  'Read-only one-shot host health (uptime/load, memory, disk, top processes). Async — output lands in the command `output`; poll get_command with the returned id.',
  { server_id: z.string() },
  async (a) => ok(await queueCommand(a.server_id, 'sys_diag', 'host')),
)
// pm2 process manager. `process` = app name or id (or "all"). `user` is optional —
// pm2 lists are per-user, so pass the deploy user if apps run under one. Async:
// poll get_command with the returned id (list/logs output lands in `output`).
const pm2Args = (user?: string) => (user ? { user } : undefined)
server.tool(
  'list_pm2',
  'List pm2-managed processes on a server (pm2 jlist JSON: name, status, cpu, memory, restarts, uptime). Async — output lands in the command `output`; poll get_command with the returned id.',
  { server_id: z.string(), user: z.string().optional() },
  async (a) => ok(await queueCommand(a.server_id, 'pm2_list', 'all', pm2Args(a.user))),
)
server.tool(
  'restart_pm2',
  'Restart a pm2 process on a server (or "all"). Async — poll get_command with the returned id.',
  { server_id: z.string(), process: z.string(), user: z.string().optional() },
  async (a) => ok(await queueCommand(a.server_id, 'pm2_restart', a.process, pm2Args(a.user))),
)
server.tool(
  'reload_pm2',
  'Zero-downtime reload of a pm2 process on a server (or "all"). Async — poll get_command with the returned id.',
  { server_id: z.string(), process: z.string(), user: z.string().optional() },
  async (a) => ok(await queueCommand(a.server_id, 'pm2_reload', a.process, pm2Args(a.user))),
)
server.tool(
  'stop_pm2',
  'Stop a pm2 process on a server (or "all"). Async — poll get_command with the returned id.',
  { server_id: z.string(), process: z.string(), user: z.string().optional() },
  async (a) => ok(await queueCommand(a.server_id, 'pm2_stop', a.process, pm2Args(a.user))),
)
server.tool(
  'start_pm2',
  'Start a stopped pm2 process on a server (or "all"). Async — poll get_command with the returned id.',
  { server_id: z.string(), process: z.string(), user: z.string().optional() },
  async (a) => ok(await queueCommand(a.server_id, 'pm2_start', a.process, pm2Args(a.user))),
)
server.tool(
  'get_pm2_logs',
  'Fetch recent logs of a pm2 process on a server. Async — the log tail lands in the command `output`; poll get_command with the returned id.',
  { server_id: z.string(), process: z.string(), tail: z.number().optional(), user: z.string().optional() },
  async (a) => ok(await queueCommand(a.server_id, 'pm2_logs', a.process, { ...pm2Args(a.user), ...(a.tail ? { tail: a.tail } : {}) })),
)
server.tool(
  'get_command',
  'Get a queued command\'s status, exit code and output (use the id returned by restart_docker/get_docker_logs/etc.). Status goes pending → done/failed once the agent runs it.',
  { id: z.string() },
  async (a) => ok(await api(`/infra/commands/${a.id}`)),
)
server.tool(
  'list_commands',
  'List recent commands issued to a server, newest first.',
  { server_id: z.string(), limit: z.number().optional() },
  async (a) => ok(await api(`/infra/servers/${a.server_id}/commands${qs({ limit: a.limit })}`)),
)
server.tool(
  'list_watched_services',
  'List the services/containers being watched (auto-alert if down) on a server.',
  { server_id: z.string() },
  async (a) => ok(await api(`/infra/servers/${a.server_id}/watched`)),
)
server.tool(
  'add_watched_service',
  'Watch a service/container on a server — Risal alerts when it goes down. kind: systemd|docker|cron.',
  { server_id: z.string(), service_name: z.string(), kind: z.enum(['systemd', 'docker', 'cron']).default('docker') },
  async (a) => ok(await api(`/infra/servers/${a.server_id}/watched`, {
    method: 'POST',
    body: JSON.stringify({ service_name: a.service_name, kind: a.kind }),
  })),
)
server.tool(
  'remove_watched_service',
  'Stop watching a service (pass the watched-service id from list_watched_services).',
  { id: z.string() },
  async (a) => ok(await api(`/infra/watched/${a.id}`, { method: 'DELETE' })),
)

await server.connect(new StdioServerTransport())
console.error('risal-mcp-server ready →', API_BASE)
