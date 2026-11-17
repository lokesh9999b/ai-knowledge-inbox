# 0005. SSRF-guarded server-side URL fetch

- Status: Accepted
- Date: 2026-11-17
- Area: backend

## Context
The server fetches user-supplied URLs, which could be pointed at localhost, cloud metadata endpoints or internal hosts.

## Decision
Accept only http/https. Resolve the host and reject private, loopback, link-local, CGNAT and multicast addresses
(IPv4 and IPv6, including IPv4-mapped). Follow redirects manually (max 3) and re-check every hop. Apply a 10 s timeout,
2 MB body cap and a content-type allowlist (HTML and plain text). Reject obviously bad URLs synchronously (`400`/`422`)
and report fetch failures through the item's `failed` status.

## Alternatives considered
- **Allowlist of domains**: too restrictive for a general inbox.
- **Egress proxy**: the right production answer, too heavy here.

## Consequences
- Good: blocks the common SSRF paths; tested for loopback, metadata IP and IPv6.
- Cost / risk: DNS-rebinding race between the check and the connection remains.
- Follow-ups: pin the resolved IP when connecting, or fetch via an egress proxy.
