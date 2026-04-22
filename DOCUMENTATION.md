# 📘 ServiceNow Project — Complete Documentation Guide

> **Purpose:** This document explains every file in this project in plain, clear language.
> It is written so that both technical and non-technical readers can fully understand
> what each script does, why it exists, and how it works.

---

## 📁 Project Structure Overview

```
ServiceNow-Project/
│
├── Automated Catalog Item.js
├── Automated Workflow by Flow Designer.js
├── Incident Generation from Inbound Email Action.js
├── ServiceNow Bidirectional Integration with JIRA.js
├── ServiceNow Custom Scoped Application.js
├── ServiceNow Integration with Spotify.js
└── README.md
```

---

## 🔷 What is ServiceNow?

ServiceNow is an enterprise cloud platform used by companies to manage IT services,
automate business workflows, handle employee requests, and track incidents
(problems reported by users). Think of it as the control center for IT operations
inside a company.

All scripts in this project are written in **JavaScript** and run inside the
ServiceNow platform. They use ServiceNow's built-in APIs like:

| API | What it does |
|-----|-------------|
| `GlideRecord` | Read/write data from ServiceNow database tables |
| `GlideAjax` | Call server-side scripts from the browser (client scripts) |
| `sn_ws.RESTMessageV2` | Make HTTP API calls to external services |
| `gs` (GlideSystem) | Utility functions: logging, properties, user info |
| `GlideDateTime` | Handle dates and times |

---

---

# 📄 FILE 1 — Automated Catalog Item.js

## 🧠 What is a Service Catalog?

A **Service Catalog** is like an online shopping portal inside a company.
Employees go there to request things — a new laptop, software access, a VPN account, etc.
Each item they can request is called a **Catalog Item**.

## 🎯 What does this file do?

This file **automates the catalog item ordering process** so employees don't have to
manually fill in information that the system already knows. It also validates their
input and prevents duplicate orders.

---

## 📦 Components Inside This File

### 1. `CatalogItemUtils` — Script Include (Server-Side Helper)

> Think of this as a **toolbox** that lives on the server and provides reusable functions.

#### Function: `populateUserDefaults()`
- **What it does:** When an employee opens a catalog item request form, this function
  automatically fills in their department, location, manager, cost center, email, and phone.
- **How:** It looks up the employee's profile from the `sys_user` table using their user ID.
- **Why:** Saves time — the employee doesn't need to type information the system already knows.

```
Employee opens request form
        ↓
System fetches their profile automatically
        ↓
Form fields are pre-filled (department, location, cost center, etc.)
```

#### Function: `validateVariables()`
- **What it does:** Checks if the form is filled out correctly before submission.
- **Rules it enforces:**
  - If the item costs **more than $500**, a business justification must be written (minimum 20 characters).
  - Quantity must be between **1 and 50**.
- **Returns:** A list of errors, or confirms everything is valid.

#### Function: `getApprovalPolicy()`
- **What it does:** Checks whether a catalog item needs manager/group approval before it
  can be fulfilled, and how many hours it takes to deliver.
- **Returns:** Whether approval is needed, which group approves it, and the SLA hours.

---

### 2. Client Script — Auto-Populate on Page Load

> This runs in the **browser** when the form loads.

- Calls `populateUserDefaults()` behind the scenes using GlideAjax (async call to server).
- Automatically sets the department, location, and cost center fields on screen.
- If something goes wrong, it silently fails — the employee can still fill it manually.

---

### 3. Client Script — Quantity Field Validation

> This runs in the **browser** when the employee changes the quantity field.

- If quantity is less than 1 → shows error message, resets to 1.
- If quantity is more than 50 → shows error message, resets to 50.
- Prevents bad data from reaching the server.

---

### 4. Flow Designer Action — Create RITM on Approval

> RITM = **Requested Item** — the actual record created when someone submits a catalog request.

- **Triggered when:** A catalog request gets approved inside a Flow Designer workflow.
- **What it does:**
  - Finds the correct fulfillment group (team responsible) based on the item's category.
  - Calculates the **due date** based on the item's SLA (e.g., 24 hours to deliver).
  - Updates the request state to **"Work In Progress"**.
  - Sends a notification event to the requester confirming approval.

---

### 5. Business Rule — Prevent Duplicate Active Requests

> A **Business Rule** is code that runs automatically when a record is saved.

- **When it runs:** Before a new RITM is inserted into the database.
- **What it checks:** Has this employee already requested this same item and it's still active?
- **If yes:** Blocks the new request and shows an error message with the existing request number.
- **Why:** Prevents employees from accidentally submitting the same request twice.

---

---

# 📄 FILE 2 — Automated Workflow by Flow Designer.js

## 🧠 What is Flow Designer?

**Flow Designer** is ServiceNow's drag-and-drop workflow automation tool.
You build flows visually — like a flowchart — and each step can run a script.
This file contains the scripts that power those individual flow steps.

## 🎯 What does this file do?

Automates the entire **Change Request** lifecycle — from risk assessment to task
creation to stakeholder notifications to emergency approvals.

> A **Change Request** is a formal record created when a company wants to modify
> something in its IT environment (e.g., update a server, deploy new software).

---

## 📦 Components Inside This File

### 1. Flow Action — "Evaluate Change Risk"

- **Input:** The ID of a change request.
- **What it does:** Calculates a **risk score** from 0–100+ using 4 factors:

| Factor | Points Added |
|--------|-------------|
| Change type (Standard=2, Normal=10, Emergency=20) | Up to 20 |
| Number of IT systems (CIs) affected (×3 each, max 30) | Up to 30 |
| Active blackout/maintenance window | +25 |
| Previous failed changes on the same system (×5 each) | Variable |

- **Risk Bands:**

| Score | Risk Level |
|-------|-----------|
| 0–15 | 🟢 Low |
| 16–35 | 🟡 Medium |
| 36–55 | 🟠 High |
| 56+ | 🔴 Critical |

- **Auto-Approve:** If risk is Low AND change type is Standard → automatically approved.
- **Output:** risk_level, risk_score, auto_approve (true/false).

---

### 2. Flow Action — "Generate Change Tasks"

- **What it does:** When a change is approved, automatically creates a set of **sub-tasks**
  that the different teams must complete.
- **Default tasks created (in order):**

| Order | Task Name | Assigned To |
|-------|-----------|-------------|
| 1 | Pre-Implementation Review | Change Management |
| 2 | Implementation | Infrastructure |
| 3 | Testing & Validation | QA Team |
| 4 | Post-Implementation Review | Change Management |
| 5 | Communication & Closure | Change Management |

- **Custom templates:** If a template ID is provided, tasks are loaded from that template instead.
- **Output:** Number of tasks created + their system IDs.

---

### 3. Flow Action — "Send Stakeholder Digest"

- **What it does:** Sends email notifications to a list of stakeholders when a change
  reaches a certain milestone (approval request, implementation start, closure).
- **Message types:** `approval_request`, `implementation`, `closure`
- **How:** Queues a ServiceNow notification event for each recipient.
- **Output:** Number of emails successfully queued.

---

### 4. Subflow — "Emergency Change Fast-Track"

> A **subflow** is a reusable mini-flow that can be called inside other flows.

- **Purpose:** Bypasses the normal CAB (Change Advisory Board) approval process for
  genuine emergencies.
- **Eligibility check:**
  - Change type must be **Emergency**
  - Priority must be **P1 or P2** (Critical or High)
- **What happens if eligible:**
  - Change is auto-approved instantly.
  - CAB review is waived and logged.
  - A work note is added explaining the bypass with timestamp.
  - Change Management team is notified via event.

---

### 5. Scheduled Job — "Daily Change Approval Digest"

- **When it runs:** Every day at 08:00 AM.
- **What it does:** Finds all change approvals that have been **waiting more than 24 hours**
  without a decision.
- **Groups them** by approver and sends each approver a summary email of pending items.
- **Why:** Prevents approvals from being forgotten — approvers get a daily reminder.

---

---

# 📄 FILE 3 — Incident Generation from Inbound Email Action.js

## 🧠 What is an Inbound Email Action?

When someone sends an email to the IT helpdesk (e.g., `helpdesk@company.com`),
ServiceNow receives it and this script runs automatically. It reads the email
and creates or updates an **Incident** record without any human needing to type it in.

> An **Incident** is a record created when something is broken or not working
> (e.g., "My laptop won't start", "I can't access the VPN").

## 🎯 What does this file do?

Intelligently parses every inbound email and:
- Creates a new incident with smart field mapping, OR
- Adds the email as a reply to an existing incident.

---

## 📦 How the Script Flows

```
Email arrives at helpdesk inbox
        ↓
Is this a reply to an existing incident?
        ↓
YES → Append to existing incident (and reopen if resolved)
NO  → Create brand new incident with auto-filled fields
        ↓
Fields auto-set: Caller, Description, Category, Priority, Assignment Group
```

---

## 📦 Components Inside This File

### 1. Main Action Script

Sets all the incident fields:

| Incident Field | How It's Set |
|---------------|-------------|
| `caller_id` | Matched from the sender's email address |
| `short_description` | Email subject (Re:/Fwd: prefix stripped) |
| `description` | Email body (trimmed to 4000 characters) |
| `category` / `subcategory` | Auto-detected from keywords |
| `impact` / `urgency` | Inferred from keywords + VIP status |
| `assignment_group` | Routed by category |
| `contact_type` | Set to "email" |

---

### 2. Helper: `findExistingIncident()`

Before creating a new incident, checks if one already exists using **2 strategies:**

- **Strategy 1:** Scans the email subject for a pattern like `INC0001234` — if found, updates that incident.
- **Strategy 2:** Checks the email's message ID against stored thread IDs in open incidents.

---

### 3. Helper: `appendEmailToIncident()`

- Adds the email body as a **work note** on the existing incident.
- If the incident was already **Resolved or Closed**, it automatically **reopens** it.

---

### 4. Helper: `inferCategory()`

Scans the email text for keywords and assigns a category automatically:

| Keywords Found | Category | Subcategory |
|---------------|----------|-------------|
| vpn, tunnel, remote access | Network | VPN |
| internet, wifi, lan | Network | Connectivity |
| laptop, screen, keyboard | Hardware | Laptop |
| printer, scanner, toner | Hardware | Printer |
| outlook, email, mailbox | Software | Email |
| password, locked, login | Access | Password |
| crash, error, not working | Application | Crash |
| slow, timeout, database | Database | Performance |

---

### 5. Helper: `inferPriority()`

Determines urgency and impact automatically:

| Trigger | Effect |
|---------|--------|
| Caller is VIP | Impact = 1 (High) automatically |
| Keywords: urgent, critical, outage, down, asap | Urgency = 1 (Critical) |
| Keywords: issue, problem, slow, error | Urgency = 2 (Medium) |
| Keywords: all users, production, entire team | Impact = 1 (High) |

---

### 6. Helper: `getAssignmentGroup()`

Routes the incident to the right team based on category:

| Category | Assigned Team |
|----------|--------------|
| Network | Network Operations |
| Hardware | Desktop Support |
| Software | Service Desk |
| Access | Identity & Access Management |
| Database | Database Administration |
| Application | Application Support |

---

### 7. Business Rule — Auto-Acknowledge

- **When it runs:** After a new incident is created from an email.
- **What it does:** Sends an automatic reply email to the caller confirming:
  - Their incident number
  - Short description
  - Priority
  - Which team it's assigned to

---

---

# 📄 FILE 4 — ServiceNow Bidirectional Integration with JIRA.js

## 🧠 What is the problem this solves?

Many companies use **both** ServiceNow (for ITSM) and **JIRA** (for software development tracking).
When an IT incident is raised, the development team needs to track a bug in JIRA.
Without integration, someone has to manually create tickets in both systems and
keep them in sync — which is slow, error-prone, and wasteful.

## 🎯 What does this file do?

Creates a **live, two-way sync** between ServiceNow and JIRA:
- **ServiceNow → JIRA:** When an incident or change is created/updated in ServiceNow, a JIRA issue is automatically created/updated.
- **JIRA → ServiceNow:** When a JIRA issue is updated or commented on, those changes flow back to ServiceNow automatically.

```
ServiceNow Incident ←————————————→ JIRA Issue
   (Created/Updated)                (Created/Updated)
   Work notes added  ←————————————→ Comments synced
   Status changed    ←————————————→ Status transitioned
```

---

## 📦 Components Inside This File

### 1. Script Include: `JiraIntegration` Class

A reusable JavaScript class with all the methods needed to talk to JIRA's REST API.

#### `initialize()`
Loads configuration from ServiceNow System Properties:
- JIRA base URL
- Project key
- Username + API token (used for authentication)

#### `createIssue(snRecord)`
- Takes a ServiceNow Incident or Change Request.
- Creates a matching JIRA issue with:
  - Summary = short description
  - Description = full description
  - Issue type: Bug (for incidents) or Task (for changes)
  - Priority mapped from SN to JIRA
  - Labels: `['servicenow', 'incident', 'INC0001234']`
- Stores the JIRA issue key (e.g., `ITSM-42`) back on the SN record.

#### `updateIssue(snRecord)`
- Updates the JIRA issue's summary and priority.
- Also syncs the status using `transitionIssue()`.

#### `addComment(issueKey, text)`
- Posts a new comment on a JIRA issue.
- Used when a ServiceNow work note is added.

#### `transitionIssue(issueKey, targetStatus)`
- Moves a JIRA issue to a new status (e.g., "In Progress", "Done").
- First fetches available transitions from JIRA, then applies the correct one.

#### Priority Mapping Table

| ServiceNow Priority | JIRA Priority |
|--------------------|--------------|
| 1 - Critical | Highest |
| 2 - High | High |
| 3 - Medium | Medium |
| 4 - Low | Low |
| 5 - Planning | Lowest |

#### Status Mapping Table

| ServiceNow State | JIRA Status |
|-----------------|------------|
| New (1) | To Do |
| In Progress (2, 3) | In Progress |
| Resolved (6) | Done |
| Closed (7) | Done |

---

### 2. Business Rule — Push to JIRA on SN Changes

- **Triggers:** After any insert or update on an Incident.
- **Smart change detection:** Only syncs if important fields changed
  (short_description, description, priority, state, assignment_group).
- **Work note sync:** If a new work note is added, posts it as a JIRA comment.
- **Loop prevention:** Uses a flag (`u_jira_sync_in_progress`) to prevent
  JIRA's response from triggering another sync back (infinite loop protection).

---

### 3. Scripted REST API — JIRA Webhook Receiver

> This is the **inbound** side — JIRA calls ServiceNow when something changes there.

- **Endpoint:** `POST /api/x_custom/jira/webhook`
- **What JIRA sends:** A JSON payload with the event type and updated issue data.
- **What ServiceNow does:**
  1. Parses the JIRA issue key from the payload.
  2. Finds the linked ServiceNow record.
  3. Syncs priority and status back to ServiceNow.
  4. Adds JIRA comments as ServiceNow work notes.
  5. Returns `200 OK` to JIRA confirming receipt.

---

### 4. System Properties Required

```
jira.integration.enabled       = true
jira.integration.base_url      = https://yourcompany.atlassian.net
jira.integration.project_key   = ITSM
jira.integration.username      = svc-snow@yourcompany.com
jira.integration.api_token     = <Atlassian API token from id.atlassian.com>
```

---

---

# 📄 FILE 5 — ServiceNow Custom Scoped Application.js

## 🧠 What is a Scoped Application?

A **Scoped Application** in ServiceNow is like building your own mini-app
inside the platform. It has its own:
- Database tables
- Scripts
- APIs
- Namespace (so it doesn't interfere with other apps)

This application is named: **Asset Lifecycle Manager** (`x_custom_asset_mgr`).

## 🎯 What does this file do?

Manages the full **hardware asset lifecycle** — from the moment a laptop or server
is requested, all the way through its useful life, to retirement.

```
Requested → Ordered → Received → In Stock → Deployed → Maintenance → Retired
```

---

## 📦 Components Inside This File

### 1. Script Include: `AssetLifecycleManager` Class

#### `transitionStage(assetId, newStage, notes)`

Controls how assets move through lifecycle stages.

**Allowed transitions (enforced strictly):**

| Current Stage | Can Move To |
|--------------|-------------|
| Requested | Ordered |
| Ordered | Received |
| Received | In Stock, Quarantine |
| In Stock | Deployed, Retired |
| Deployed | In Maintenance, Retired, In Stock |
| In Maintenance | Deployed, Retired, In Stock |
| Quarantine | In Stock, Retired |
| Retired | ❌ No further moves |

- Rejects invalid transitions with a clear error message.
- Automatically stamps dates (deployed date, retired date).
- Clears assigned user when asset is retired.
- Logs every transition for full audit trail.

---

#### `assignAsset(assetId, userId, locationId)`

- Asset must be **In Stock** before it can be assigned.
- Sets the assigned user and location.
- Automatically transitions asset to **Deployed**.
- Sends a notification event to the user receiving the asset.

---

#### `recordCost(assetId, costType, amount, currency, description)`

Records financial entries against an asset:

| Cost Type | When Used |
|-----------|----------|
| `purchase` | When asset is bought |
| `maintenance` | Repair or service costs |
| `disposal` | Recycling/disposal fees |

- Automatically recalculates and updates the **total lifetime cost** on the asset.

---

#### `getLifecycleSummary(assetId)`

Returns a complete report for an asset:
- Asset tag, name, current stage
- Total cost, assigned user, location
- Purchase date, deployed date, retired date
- Full history of every stage transition (audit log)

---

### 2. Business Rule — Auto-Retire End-of-Life Assets

- **Runs daily** as a scheduled check.
- Finds all deployed/in-stock assets where the **end-of-life date has passed**.
- Automatically transitions them to **Retired** stage.
- Logs how many assets were auto-retired.

---

### 3. REST API — Asset Lookup

- **Endpoint:** `GET /api/x_custom_asset_mgr/asset/{asset_tag}`
- **What it does:** Returns the full lifecycle summary for any asset by its asset tag.
- **Example response:**
```json
{
  "asset_tag": "ASSET-0042",
  "name": "Dell Latitude 5520",
  "current_stage": "deployed",
  "total_cost": 1450.00,
  "assigned_to": "John Smith",
  "location": "New York Office",
  "purchased": "2024-01-15",
  "deployed": "2024-02-01",
  "lifecycle": [
    { "from": "requested", "to": "ordered", "timestamp": "..." },
    { "from": "ordered",   "to": "received","timestamp": "..." }
  ]
}
```

---

### 4. REST API — Transition Asset Stage

- **Endpoint:** `POST /api/x_custom_asset_mgr/asset/{asset_tag}/transition`
- **Body:** `{ "stage": "retired", "notes": "Device damaged beyond repair" }`
- **What it does:** Moves the asset to a new stage via API (useful for external systems or mobile apps).
- Returns `200 OK` on success, `422 Unprocessable` if the transition is not allowed.

---

### 5. Client Script — Stage Transition UI Warning

- When an agent tries to set the stage to **Retired** on screen:
  - A **confirmation popup** appears: *"Retiring this asset is irreversible. Continue?"*
  - If cancelled, the stage reverts to the previous value.
  - If confirmed, the retirement date field appears and is auto-filled with today's date.

---

### 6. Custom Database Tables

| Table | Purpose |
|-------|---------|
| `x_custom_asset_mgr_asset` | Main asset records |
| `x_custom_asset_mgr_lifecycle_log` | Audit log of every stage change |
| `x_custom_asset_mgr_cost_entry` | All financial entries per asset |

---

---

# 📄 FILE 6 — ServiceNow Integration with Spotify.js

## 🧠 What is the idea behind this?

On-call IT engineers often work late hours handling critical incidents.
This integration connects ServiceNow to **Spotify** to:
- Auto-pause music when a P1 (Critical) incident arrives — so the engineer isn't distracted.
- Play a "focus playlist" to help engineers concentrate during long incident resolution sessions.
- Log music/focus sessions to employee well-being records.
- Allow employees to request a focus playlist through the Service Catalog.

## 🎯 What does this file do?

Connects ServiceNow to the **Spotify Web API** using OAuth 2.0 authentication,
enabling playback control, playlist management, and focus session logging.

---

## 📦 How Authentication Works

Spotify uses **OAuth 2.0**, which means:
1. Each user must **authorize** ServiceNow to control their Spotify account once.
2. After authorization, a **refresh token** is stored per user.
3. Every API call uses a short-lived **access token** obtained from the refresh token.

```
User clicks "Connect Spotify" in ServiceNow
        ↓
Redirected to Spotify login page
        ↓
User approves access
        ↓
Spotify sends authorization code to ServiceNow callback URL
        ↓
ServiceNow exchanges code for access token + refresh token
        ↓
Refresh token stored securely in system properties
        ↓
Future API calls use refresh token to get fresh access tokens
```

---

## 📦 Components Inside This File

### 1. Script Include: `SpotifyIntegration` Class

#### `getAppToken()`
- Gets an **app-level** Spotify token (no user required).
- Used for searching playlists publicly.
- Token is **cached for 55 minutes** to avoid unnecessary API calls.

#### `getUserToken(userId)`
- Gets a **user-level** token using the stored refresh token.
- If Spotify rotates the refresh token, the new one is saved automatically.
- Used for controlling a specific user's playback.

#### `pausePlayback(userId)`
- Pauses Spotify on the user's currently active device.

#### `resumePlayback(userId)`
- Resumes Spotify playback for the user.

#### `playPlaylist(userId, playlistId)`
- Starts playing a specific playlist on the user's Spotify.

#### `getCurrentlyPlaying(userId)`
- Returns details of the track currently playing for a user.

#### `searchPlaylists(query, limit)`
- Searches Spotify for playlists matching a keyword.
- Returns: playlist ID, name, description, track count, and URL.

#### `createPlaylist(userId, spotifyUserId, name, description)`
- Creates a new private playlist in a user's Spotify account.

#### `startFocusSession(snUserId)`
- Plays the company's configured focus playlist for the user.
- Logs a `focus_start` entry in the well-being log table.

#### `endFocusSession(snUserId)`
- Pauses playback.
- Logs a `focus_end` entry in the well-being log table.

---

### 2. Business Rule — Auto-Pause on P1 Incident

- **Triggers:** After a new Critical (P1) incident is created.
- **What it does:**
  1. Finds all members of the incident's assignment group.
  2. Checks which members have Spotify linked to their account.
  3. Calls `pausePlayback()` for each of them.
  4. Logs the action.
- **Why:** When a P1 hits, engineers need to focus immediately — no music distraction.

---

### 3. Catalog Item Script — "Request Focus Playlist"

- **Triggered from:** A Service Catalog item employees can order.
- **How it works:**
  1. Employee selects a mood: `focus`, `energize`, or `calm`.
  2. System searches Spotify using the matching query:

| Mood | Search Query |
|------|-------------|
| Focus | "deep work focus instrumental" |
| Energize | "high energy workout pump up" |
| Calm | "chill lofi calm relaxing" |

  3. Top result is played on the employee's Spotify.
  4. Returns the playlist name and URL.

---

### 4. Scripted REST API — OAuth Callback Handler

- **Endpoint:** `GET /api/x_custom/spotify/callback`
- **Purpose:** This is where Spotify redirects the user after they approve access.
- **What it does:**
  1. Receives the authorization code from Spotify.
  2. Exchanges it for access + refresh tokens.
  3. Stores the refresh token against the user's ServiceNow account.
  4. Shows a success page: *"Your Spotify account is now linked!"*

---

### 5. Required Spotify OAuth Scopes

| Scope | Why Needed |
|-------|-----------|
| `user-read-playback-state` | See what's playing |
| `user-modify-playback-state` | Pause / play / skip |
| `user-read-currently-playing` | Get current track info |
| `playlist-modify-private` | Create private playlists |
| `playlist-read-private` | Read user's playlists |

---

---

# 🔧 System Configuration Summary

Below are all the system properties that need to be set in ServiceNow
(`System Properties` table) for full functionality:

### JIRA Integration Properties
| Property | Value |
|----------|-------|
| `jira.integration.enabled` | `true` |
| `jira.integration.base_url` | `https://yourcompany.atlassian.net` |
| `jira.integration.project_key` | `ITSM` |
| `jira.integration.username` | `svc-snow@yourcompany.com` |
| `jira.integration.api_token` | *(API token from Atlassian account)* |

### Spotify Integration Properties
| Property | Value |
|----------|-------|
| `spotify.integration.enabled` | `true` |
| `spotify.integration.client_id` | *(From Spotify Developer Dashboard)* |
| `spotify.integration.client_secret` | *(From Spotify Developer Dashboard)* |
| `spotify.integration.redirect_uri` | `https://<instance>.service-now.com/api/x_custom/spotify/callback` |
| `spotify.integration.focus_playlist_id` | *(Spotify Playlist ID)* |

---

---

# 🛠️ Technology & Concepts Reference

| Term | Meaning |
|------|---------|
| **GlideRecord** | ServiceNow's way of querying and updating database tables |
| **Business Rule** | Server-side script that runs automatically on record save/insert/delete |
| **Script Include** | Reusable server-side JavaScript class/library |
| **Client Script** | JavaScript that runs in the user's browser on a form |
| **Flow Designer** | Visual workflow builder inside ServiceNow |
| **Flow Action** | A single step inside a Flow Designer flow (can contain custom script) |
| **Subflow** | A reusable mini-flow called from other flows |
| **Scripted REST API** | Custom HTTP endpoint built inside ServiceNow |
| **Inbound Email Action** | Script that processes incoming emails to create/update records |
| **RITM** | Requested Item — the record created when a catalog request is submitted |
| **CAB** | Change Advisory Board — group that approves IT changes |
| **SLA** | Service Level Agreement — the time commitment to fulfill/resolve something |
| **OAuth 2.0** | Secure authorization standard used by Spotify and other APIs |
| **Scoped Application** | A self-contained app built inside ServiceNow with its own namespace |
| **CI** | Configuration Item — any IT asset tracked in the CMDB (servers, laptops, etc.) |
| **P1 / P2** | Priority 1 (Critical) / Priority 2 (High) incidents |

---

---

# 📊 Project Summary Table

| File | Core Purpose | Key Tech Used |
|------|-------------|--------------|
| Automated Catalog Item | Auto-fill, validate & fulfill catalog requests | Script Include, Client Script, Business Rule, Flow Action |
| Automated Workflow by Flow Designer | Risk scoring, task creation, approvals for Change Requests | Flow Actions, Subflow, Scheduled Job |
| Incident Generation from Inbound Email | Create/update incidents automatically from emails | Inbound Email Action, Business Rule, Keyword AI |
| ServiceNow Bidirectional Integration with JIRA | Two-way live sync between SN and JIRA | REST API, Script Include, Webhook, Business Rule |
| ServiceNow Custom Scoped Application | Full asset lifecycle management app | Scoped App, Script Include, REST API, Custom Tables |
| ServiceNow Integration with Spotify | Music control & well-being during on-call incidents | OAuth 2.0, REST API, Script Include, Catalog Script |

---

> **Platform Requirement:** ServiceNow **Utah release or later**
> **External APIs:** JIRA Cloud (Atlassian API v3), Spotify Web API
> **Language:** JavaScript (ServiceNow Rhino engine — ES5 compatible)

---

*Documentation prepared for client review — April 2026*
