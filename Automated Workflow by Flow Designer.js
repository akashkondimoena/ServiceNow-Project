// ============================================================
// ServiceNow: Automated Workflow by Flow Designer
// Purpose: End-to-end Flow Designer flow for change request
//          approval, notification, and task auto-generation.
// Includes: Flow action scripts, subflow logic, custom actions
// ============================================================


// -------------------------------------------------------
// 1. Custom Flow Action Script: "Evaluate Change Risk"
//    Input:  change_sys_id (String)
//    Output: risk_level (String), auto_approve (Boolean)
// -------------------------------------------------------
(function executeAction(inputs, outputs) {

    var changeId = inputs.change_sys_id;
    var change   = new GlideRecord('change_request');

    if (!change.get(changeId)) {
        outputs.risk_level   = 'unknown';
        outputs.auto_approve = false;
        return;
    }

    var riskScore = 0;

    // Factor 1: Change type weight
    var typeWeights = { 'normal': 10, 'standard': 2, 'emergency': 20 };
    riskScore += typeWeights[change.getValue('type')] || 10;

    // Factor 2: Number of CIs affected
    var ciCount = new GlideAggregate('task_ci');
    ciCount.addQuery('task', changeId);
    ciCount.addAggregate('COUNT');
    ciCount.query();
    if (ciCount.next()) {
        riskScore += Math.min(parseInt(ciCount.getAggregate('COUNT'), 10) * 3, 30);
    }

    // Factor 3: Blackout window check
    var now      = new GlideDateTime();
    var blackout = new GlideRecord('cmdb_ci_outage');
    blackout.addQuery('begin', '<=', now);
    blackout.addQuery('end',   '>=', now);
    blackout.setLimit(1);
    blackout.query();
    if (blackout.next()) riskScore += 25;

    // Factor 4: Previous failed changes on same CI
    var failedChanges = new GlideRecord('change_request');
    failedChanges.addQuery('cmdb_ci',     change.getValue('cmdb_ci'));
    failedChanges.addQuery('close_code',  'unsuccessful');
    failedChanges.addQuery('sys_created_on', '>=', gs.beginningOfLast3Months());
    failedChanges.query();
    riskScore += failedChanges.getRowCount() * 5;

    // Determine risk band
    var riskLevel;
    if      (riskScore <= 15) riskLevel = 'low';
    else if (riskScore <= 35) riskLevel = 'medium';
    else if (riskScore <= 55) riskLevel = 'high';
    else                      riskLevel = 'critical';

    outputs.risk_level   = riskLevel;
    outputs.risk_score   = riskScore;
    outputs.auto_approve = (riskLevel === 'low' && change.getValue('type') === 'standard');

})(inputs, outputs);


// -------------------------------------------------------
// 2. Custom Flow Action Script: "Generate Change Tasks"
//    Input:  change_sys_id (String), template_id (String)
//    Output: tasks_created (Integer), task_sys_ids (String JSON)
// -------------------------------------------------------
(function executeAction(inputs, outputs) {

    var changeId     = inputs.change_sys_id;
    var templateId   = inputs.template_id;
    var taskSysIds   = [];
    var tasksCreated = 0;

    var defaultTasks = [
        { name: 'Pre-Implementation Review',  order: 10, group: 'Change Management' },
        { name: 'Implementation',             order: 20, group: 'Infrastructure'    },
        { name: 'Testing & Validation',       order: 30, group: 'QA Team'           },
        { name: 'Post-Implementation Review', order: 40, group: 'Change Management' },
        { name: 'Communication & Closure',    order: 50, group: 'Change Management' }
    ];

    if (templateId) {
        var tmplTask = new GlideRecord('change_task');
        tmplTask.addQuery('change_request', templateId);
        tmplTask.orderBy('order');
        tmplTask.query();
        defaultTasks = [];
        while (tmplTask.next()) {
            defaultTasks.push({
                name  : tmplTask.getValue('short_description'),
                order : tmplTask.getValue('order'),
                group : tmplTask.assignment_group.getDisplayValue()
            });
        }
    }

    defaultTasks.forEach(function (def) {
        var task = new GlideRecord('change_task');
        task.setValue('change_request',    changeId);
        task.setValue('short_description', def.name);
        task.setValue('order',             def.order);
        task.setValue('state',             '-5');

        var grp = new GlideRecord('sys_user_group');
        grp.addQuery('name', def.group);
        grp.setLimit(1);
        grp.query();
        if (grp.next()) task.setValue('assignment_group', grp.getValue('sys_id'));

        var taskId = task.insert();
        if (taskId) { taskSysIds.push(taskId); tasksCreated++; }
    });

    outputs.tasks_created = tasksCreated;
    outputs.task_sys_ids  = JSON.stringify(taskSysIds);

})(inputs, outputs);


// -------------------------------------------------------
// 3. Custom Flow Action Script: "Send Stakeholder Digest"
//    Input:  change_sys_id, recipients_json, message_type
//    Output: emails_sent (Integer)
// -------------------------------------------------------
(function executeAction(inputs, outputs) {

    var changeId    = inputs.change_sys_id;
    var recipients  = JSON.parse(inputs.recipients_json || '[]');
    var messageType = inputs.message_type || 'approval_request';
    var emailsSent  = 0;

    var change = new GlideRecord('change_request');
    if (!change.get(changeId)) { outputs.emails_sent = 0; return; }

    recipients.forEach(function (recipientId) {
        try {
            gs.eventQueue('change.request.' + messageType, change, recipientId, '');
            emailsSent++;
        } catch (ex) {
            gs.warn('CRFlow: email failed for ' + recipientId + ': ' + ex.message);
        }
    });

    outputs.emails_sent = emailsSent;

})(inputs, outputs);


// -------------------------------------------------------
// 4. Subflow: "Emergency Change Fast-Track"
//    Auto-approves P1/P2 emergency changes; bypasses CAB.
// -------------------------------------------------------
(function executeAction(inputs, outputs) {

    var changeId = inputs.change_sys_id;
    var change   = new GlideRecord('change_request');

    if (!change.get(changeId)) { outputs.fast_tracked = false; return; }

    var isEmergency = change.getValue('type') === 'emergency';
    var priority    = parseInt(change.getValue('priority'), 10);

    if (!isEmergency || priority > 2) {
        outputs.fast_tracked = false;
        outputs.reason       = 'Not eligible: requires emergency type + P1/P2 priority.';
        return;
    }

    change.setValue('approval',       'approved');
    change.setValue('state',          '-1');
    change.setValue('u_cab_required', false);
    change.setValue('u_fast_tracked', true);
    change.setValue(
        'work_notes',
        'Auto-approved via Emergency Fast-Track on ' +
        new GlideDateTime().getDisplayValue() + '. CAB waived per emergency policy.'
    );
    change.update();

    gs.eventQueue('change.emergency.fasttrack', change, '', '');

    outputs.fast_tracked = true;
    outputs.reason       = 'Emergency fast-track applied. CAB bypass logged.';

})(inputs, outputs);


// -------------------------------------------------------
// 5. Scheduled Job: "Daily Change Approval Digest"
//    Runs at 08:00 daily — emails pending approvals > 24 hr.
// -------------------------------------------------------
(function runJob() {

    var approval = new GlideRecord('sysapproval_approver');
    approval.addQuery('state',        'requested');
    approval.addQuery('source_table', 'change_request');
    approval.addQuery('sys_created_on', '<=', gs.hoursAgoStart(24));
    approval.query();

    var digestData = {};

    while (approval.next()) {
        var uid = approval.getValue('approver');
        if (!digestData[uid]) digestData[uid] = [];
        digestData[uid].push({
            number    : approval.sysapproval.number.getDisplayValue(),
            desc      : approval.sysapproval.short_description.getDisplayValue(),
            created   : approval.getValue('sys_created_on'),
            risk      : approval.sysapproval.risk.getDisplayValue()
        });
    }

    Object.keys(digestData).forEach(function (userId) {
        gs.eventQueue(
            'change.approval.digest',
            new GlideRecord('sys_user'),
            userId,
            JSON.stringify(digestData[userId])
        );
    });

    gs.info('ChangeDigest: Sent digests to ' + Object.keys(digestData).length + ' approvers.');

})();
