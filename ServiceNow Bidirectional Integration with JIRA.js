// ============================================================
// ServiceNow: Bidirectional Integration with JIRA
// Purpose: Sync Incidents/Changes <-> JIRA Issues in real time
//          using REST messages. Handles create, update, comment
//          sync, and status mapping in both directions.
// ============================================================


// -------------------------------------------------------
// 1. Script Include: JiraIntegration
//    Provides all outbound (SN → JIRA) methods
// -------------------------------------------------------
var JiraIntegration = Class.create();
JiraIntegration.prototype = {

    initialize: function () {
        this.JIRA_BASE_URL  = gs.getProperty('jira.integration.base_url',  'https://yourcompany.atlassian.net');
        this.JIRA_PROJECT   = gs.getProperty('jira.integration.project_key', 'ITSM');
        this.JIRA_USER      = gs.getProperty('jira.integration.username',   '');
        this.JIRA_TOKEN     = gs.getProperty('jira.integration.api_token',  '');
        this.credentials    = GlideStringUtil.base64Encode(this.JIRA_USER + ':' + this.JIRA_TOKEN);
    },

    /**
     * Create a JIRA issue from a ServiceNow record.
     * @param {GlideRecord} snRecord - incident or change_request
     * @returns {String} jira issue key (e.g. ITSM-42) or null
     */
    createIssue: function (snRecord) {
        var table = snRecord.getTableName();

        var issueType = (table === 'incident') ? 'Bug' : 'Task';
        var priority  = this._mapSnPriorityToJira(snRecord.getValue('priority'));

        var payload = {
            fields: {
                project     : { key: this.JIRA_PROJECT },
                summary     : snRecord.getValue('short_description'),
                description : {
                    type    : 'doc',
                    version : 1,
                    content : [{
                        type    : 'paragraph',
                        content : [{
                            type : 'text',
                            text : (snRecord.getValue('description') || '').substring(0, 3000)
                        }]
                    }]
                },
                issuetype   : { name: issueType },
                priority    : { name: priority },
                labels      : ['servicenow', table, snRecord.getValue('number')]
            }
        };

        var response = this._callJira('POST', '/rest/api/3/issue', payload);

        if (response && response.key) {
            // Store JIRA key back on the SN record
            snRecord.setValue('u_jira_issue_key', response.key);
            snRecord.setValue('u_jira_issue_url', this.JIRA_BASE_URL + '/browse/' + response.key);
            snRecord.update();
            gs.info('JiraIntegration: Created JIRA issue ' + response.key + ' for ' + snRecord.getValue('number'));
            return response.key;
        }

        gs.error('JiraIntegration: Failed to create JIRA issue for ' + snRecord.getValue('number'));
        return null;
    },

    /**
     * Update an existing JIRA issue from a ServiceNow record.
     * @param {GlideRecord} snRecord
     */
    updateIssue: function (snRecord) {
        var issueKey = snRecord.getValue('u_jira_issue_key');
        if (!issueKey) {
            gs.warn('JiraIntegration: No JIRA key on ' + snRecord.getValue('number') + ', creating instead.');
            return this.createIssue(snRecord);
        }

        var payload = {
            fields: {
                summary  : snRecord.getValue('short_description'),
                priority : { name: this._mapSnPriorityToJira(snRecord.getValue('priority')) }
            }
        };

        this._callJira('PUT', '/rest/api/3/issue/' + issueKey, payload);

        // Sync state via transition
        var jiraStatus = this._mapSnStateToJira(snRecord.getTableName(), snRecord.getValue('state'));
        if (jiraStatus) this.transitionIssue(issueKey, jiraStatus);

        gs.info('JiraIntegration: Updated JIRA issue ' + issueKey);
    },

    /**
     * Add a comment to a JIRA issue.
     * @param {String} issueKey
     * @param {String} commentText
     */
    addComment: function (issueKey, commentText) {
        var payload = {
            body: {
                type    : 'doc',
                version : 1,
                content : [{
                    type    : 'paragraph',
                    content : [{ type: 'text', text: commentText.substring(0, 5000) }]
                }]
            }
        };
        this._callJira('POST', '/rest/api/3/issue/' + issueKey + '/comment', payload);
    },

    /**
     * Transition a JIRA issue to a new status by status name.
     * @param {String} issueKey
     * @param {String} targetStatus  e.g. 'In Progress', 'Done'
     */
    transitionIssue: function (issueKey, targetStatus) {
        var transitions = this._callJira('GET', '/rest/api/3/issue/' + issueKey + '/transitions', null);
        if (!transitions || !transitions.transitions) return;

        var transitionId = null;
        transitions.transitions.forEach(function (t) {
            if (t.to && t.to.name === targetStatus) transitionId = t.id;
        });

        if (!transitionId) {
            gs.warn('JiraIntegration: Transition to "' + targetStatus + '" not found on ' + issueKey);
            return;
        }

        this._callJira('POST', '/rest/api/3/issue/' + issueKey + '/transitions',
            { transition: { id: transitionId } });
    },

    // ---- Private Helpers ----

    _callJira: function (method, path, body) {
        try {
            var request = new sn_ws.RESTMessageV2();
            request.setHttpMethod(method);
            request.setEndpoint(this.JIRA_BASE_URL + path);
            request.setRequestHeader('Authorization', 'Basic ' + this.credentials);
            request.setRequestHeader('Content-Type',  'application/json');
            request.setRequestHeader('Accept',        'application/json');

            if (body) request.setRequestBody(JSON.stringify(body));

            var response     = request.execute();
            var responseCode = response.getStatusCode();
            var responseBody = response.getBody();

            if (responseCode >= 400) {
                gs.error('JiraIntegration: HTTP ' + responseCode + ' on ' + method + ' ' + path + ': ' + responseBody);
                return null;
            }

            return responseBody ? JSON.parse(responseBody) : {};
        } catch (ex) {
            gs.error('JiraIntegration: Exception on ' + method + ' ' + path + ': ' + ex.message);
            return null;
        }
    },

    _mapSnPriorityToJira: function (snPriority) {
        var map = { '1': 'Highest', '2': 'High', '3': 'Medium', '4': 'Low', '5': 'Lowest' };
        return map[String(snPriority)] || 'Medium';
    },

    _mapSnStateToJira: function (table, snState) {
        var incidentMap = {
            '1': 'To Do',
            '2': 'In Progress',
            '3': 'In Progress',
            '6': 'Done',
            '7': 'Done'
        };
        var changeMap = {
            '-5': 'To Do',
            '-4': 'To Do',
            '-3': 'In Progress',
            '-2': 'In Progress',
            '-1': 'In Progress',
            '0' : 'In Progress',
            '3' : 'Done',
            '4' : 'Done'
        };
        var stateMap = (table === 'incident') ? incidentMap : changeMap;
        return stateMap[String(snState)] || null;
    },

    type: 'JiraIntegration'
};


// -------------------------------------------------------
// 2. Business Rule: Push to JIRA on Insert/Update
//    Table: incident | When: after insert, after update
// -------------------------------------------------------
/*
(function executeBR(current, previous) {

    // Only sync if JIRA integration is enabled
    if (gs.getProperty('jira.integration.enabled') !== 'true') return;

    // Avoid recursive updates triggered by JIRA inbound
    if (current.getValue('u_jira_sync_in_progress') === 'true') return;

    var jira = new JiraIntegration();

    if (current.operation() === 'insert') {
        jira.createIssue(current);
    } else {
        // Only push on meaningful field changes
        var watchedFields = ['short_description', 'description', 'priority', 'state', 'assignment_group'];
        var changed = watchedFields.some(function (f) {
            return current.getValue(f) !== previous.getValue(f);
        });
        if (changed) jira.updateIssue(current);

        // Sync new work notes as JIRA comments
        var newNote = current.getValue('work_notes');
        var oldNote = previous.getValue('work_notes');
        if (newNote && newNote !== oldNote && current.getValue('u_jira_issue_key')) {
            jira.addComment(
                current.getValue('u_jira_issue_key'),
                '[ServiceNow ' + current.getValue('number') + ']\n' + newNote
            );
        }
    }

})(current, previous);
*/


// -------------------------------------------------------
// 3. Scripted REST API: Inbound webhook from JIRA → SN
//    Method: POST | Path: /api/x_custom/jira/webhook
// -------------------------------------------------------
(function process(request, response) {

    var body;
    try {
        body = JSON.parse(request.body.dataString);
    } catch (ex) {
        response.setStatus(400);
        response.setBody({ error: 'Invalid JSON payload' });
        return;
    }

    var event    = body.webhookEvent || '';
    var issue    = body.issue || {};
    var issueKey = issue.key || '';

    if (!issueKey) {
        response.setStatus(400);
        response.setBody({ error: 'Missing issue key' });
        return;
    }

    // Find the linked SN record by JIRA key
    var tables = ['incident', 'change_request'];
    var snRecord = null;

    tables.forEach(function (tbl) {
        if (snRecord) return;
        var gr = new GlideRecord(tbl);
        gr.addQuery('u_jira_issue_key', issueKey);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) snRecord = gr;
    });

    if (!snRecord) {
        response.setStatus(404);
        response.setBody({ error: 'No ServiceNow record found for JIRA key ' + issueKey });
        return;
    }

    // Mark sync in progress to prevent BR echo
    snRecord.setValue('u_jira_sync_in_progress', true);

    if (event === 'jira:issue_updated') {
        var fields = issue.fields || {};

        // Sync priority
        var jiraPriorityMap = { 'Highest': '1', 'High': '2', 'Medium': '3', 'Low': '4', 'Lowest': '5' };
        var jiraPriority    = (fields.priority || {}).name;
        if (jiraPriority && jiraPriorityMap[jiraPriority]) {
            snRecord.setValue('priority', jiraPriorityMap[jiraPriority]);
        }

        // Sync status
        var jiraStatus    = (fields.status || {}).name || '';
        var jiraStatusMap = { 'To Do': '1', 'In Progress': '2', 'Done': '6' };
        if (jiraStatusMap[jiraStatus]) {
            snRecord.setValue('state', jiraStatusMap[jiraStatus]);
        }

        snRecord.setValue(
            'work_notes',
            '[JIRA Update] Issue ' + issueKey + ' updated at ' + new GlideDateTime().getDisplayValue()
        );
    }

    if (event === 'jira:issue_comment_added') {
        var comment = ((body.comment || {}).body || '').substring(0, 4000);
        snRecord.setValue('comments', '[JIRA Comment] ' + comment);
    }

    snRecord.setValue('u_jira_sync_in_progress', false);
    snRecord.update();

    response.setStatus(200);
    response.setBody({ status: 'ok', synced: snRecord.getValue('number') });

})(request, response);


// -------------------------------------------------------
// 4. System Properties (add via sys_properties table)
//    jira.integration.enabled      = true
//    jira.integration.base_url     = https://yourcompany.atlassian.net
//    jira.integration.project_key  = ITSM
//    jira.integration.username     = svc-snow@yourcompany.com
//    jira.integration.api_token    = <Atlassian API token>
// -------------------------------------------------------
