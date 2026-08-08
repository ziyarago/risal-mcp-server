# Security Policy

## Reporting a vulnerability

If you believe you've found a security issue in `risal-mcp-server` or the Risal
platform it connects to, please report it **privately**:

- **Email:** security@risal.io

Please include a description, reproduction steps, and the impact you observed.

- Do **not** open a public GitHub issue for security reports.
- Please do **not** test against production systems or other users' data.

We aim to acknowledge valid reports within 3 business days.

## Scope

In scope:

- This package (`risal-mcp-server`) — the MCP tool layer.
- The Risal API it authenticates against (authentication, authorization, and
  command handling).

Out of scope:

- Denial-of-service, spam, or automated scanning.
- Social engineering of Risal users or staff.
- Findings that require a compromised operator machine, a leaked token, or
  physical access.

## A note on the tool layer

`risal-mcp-server` is a thin client — it does not execute anything on hosts
itself. Every action is forwarded to the authenticated Risal API, which is where
authentication, per-tenant authorization, the fixed command set, and approval of
state-changing operations are enforced. We appreciate reports that account for
this separation.
