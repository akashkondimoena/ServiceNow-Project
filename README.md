# ServiceNow Project — Integration & Automation Suite

A collection of production-ready ServiceNow scripts covering catalog automation, Flow Designer workflows, inbound email processing, external integrations, and a fully scoped custom application.

---

## Files

| File | Description |
|---|---|
| `Automated Catalog Item` | Script Include, Client Scripts & Business Rules for automated catalog item ordering, variable auto-population, duplicate prevention, and fulfillment routing |
| `Automated Workflow by Flow Designer` | Flow Designer custom actions for change risk evaluation, task auto-generation, stakeholder notifications, emergency fast-track subflow, and daily approval digest job |
| `Incident Generation from Inbound Email Action` | Inbound Email Action that parses raw emails into Incidents with smart keyword-based category/priority inference, duplicate detection via thread tracking, and auto-acknowledgement |
| `ServiceNow Bidirectional Integration with JIRA` | `JiraIntegration` Script Include + Business Rules + Scripted REST webhook for real-time two-way sync of Incidents/Changes with JIRA issues (status, priority, comments) |
| `ServiceNow Custom Scoped Application` | `AssetLifecycleManager` scoped app (`x_custom_asset_mgr`) for hardware asset lifecycle: procurement → deployment → maintenance → retirement with cost tracking and REST APIs |
| `ServiceNow Integration with Spotify` | `SpotifyIntegration` Script Include using OAuth 2.0 to control playback, auto-pause on P1 incidents, run focus sessions for on-call engineers, and fulfill playlist catalog requests |

---

## Setup

### Common Steps
1. Copy script content into the appropriate ServiceNow script editor (Script Include, Business Rule, Inbound Email Action, Scripted REST API, or Flow Designer Action).
2. Set required **System Properties** listed at the bottom of each file.
3. Enable each integration by setting `<integration>.enabled = true` in System Properties.

### JIRA Integration
- Create a JIRA API token at `id.atlassian.com/manage-profile/security/api-tokens`.
- Set properties: `jira.integration.base_url`, `jira.integration.project_key`, `jira.integration.username`, `jira.integration.api_token`.
- Configure a JIRA webhook pointing to `/api/x_custom/jira/webhook` for inbound sync.

### Spotify Integration
- Register a Spotify app at `developer.spotify.com/dashboard`.
- Set redirect URI to `https://<instance>.service-now.com/api/x_custom/spotify/callback`.
- Required scopes: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `playlist-modify-private`, `playlist-read-private`.
- Users authorize via OAuth; refresh tokens are stored per-user as system properties.

### Custom Scoped Application
- Create application scope `x_custom_asset_mgr` in Studio.
- Create tables as defined in the Table Definitions section of the file.
- Deploy Script Include, Business Rules, and REST APIs within the scope.

---

## Architecture Notes

- All external HTTP calls use `sn_ws.RESTMessageV2` (no `XMLHTTPRequest`).
- Tokens are cached using `gs.putCacheEntry` / `gs.getCacheEntry` to minimize auth calls.
- Business Rules that call external APIs guard against recursive updates via `u_<integration>_sync_in_progress` flags.
- Inbound Email Actions use message-ID threading before falling back to subject-line INC number extraction.
- The scoped application enforces lifecycle state machine transitions — invalid transitions are rejected with a clear error message.

---

## Requirements

- ServiceNow release: **Utah** or later (Flow Designer actions, `sn_ws.RESTMessageV2`, scoped apps)
- JIRA: Cloud (Atlassian API v3)
- Spotify: Web API (requires active Spotify Premium for playback control)
