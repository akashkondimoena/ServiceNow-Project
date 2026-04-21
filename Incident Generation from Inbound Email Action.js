// ============================================================
// ServiceNow: Incident Generation from Inbound Email Action
// Purpose: Parse inbound emails and auto-create/update
//          Incident records with smart field mapping,
//          duplicate detection, and priority inference.
// Script type: Inbound Email Action (sys_script_email)
// ============================================================


// -------------------------------------------------------
// 1. Main Inbound Email Action Script
//    Table: Incident | When: Created/Reply
// -------------------------------------------------------
(function runAction(current, email) {

    // ---- Duplicate / update detection ----
    // If the email thread already has an incident, update it instead
    var existingIncident = findExistingIncident(email);
    if (existingIncident) {
        appendEmailToIncident(existingIncident, email);
        current.setRedirectURL(existingIncident);
        return;
    }

    // ---- Smart field mapping ----
    var subjectData  = parseSubject(email.subject);
    var bodyData     = parseBody(email.body_text || email.body_html);
    var callerRecord = resolveCallerFromEmail(email.from);

    // Caller
    if (callerRecord) {
        current.caller_id = callerRecord.sys_id;
    }

    // Short description — use subject (strip Re:/Fwd: etc.)
    current.short_description = subjectData.cleanSubject.substring(0, 160);

    // Description — email body trimmed to 4000 chars
    current.description = (email.body_text || email.body_html || '').substring(0, 4000);

    // Category / Subcategory from keyword inference
    var category = inferCategory(subjectData.cleanSubject + ' ' + bodyData.firstParagraph);
    current.category    = category.category;
    current.subcategory = category.subcategory;

    // Priority from urgency keywords + caller VIP status
    var priority = inferPriority(
        subjectData.cleanSubject + ' ' + bodyData.firstParagraph,
        callerRecord
    );
    current.impact   = priority.impact;
    current.urgency  = priority.urgency;
    // Priority is auto-calculated by ServiceNow from impact+urgency

    // Assignment group from category routing rules
    var assignGroup = getAssignmentGroup(category.category, category.subcategory);
    if (assignGroup) current.assignment_group = assignGroup;

    // Source = Email
    current.contact_type = 'email';

    // Store original email message ID for thread tracking
    current.u_email_message_id = email.message_id || '';

    // Add the raw email as a work note
    current.work_notes =
        '[Incident auto-created from inbound email]\n' +
        'From: ' + email.from + '\n' +
        'Subject: ' + email.subject + '\n' +
        'Received: ' + new GlideDateTime().getDisplayValue();

})(current, email);


// -------------------------------------------------------
// Helper: Find an existing incident from email thread
// -------------------------------------------------------
function findExistingIncident(email) {

    // Strategy 1: Subject contains INC number
    var incPattern = /\bINC\d{7}\b/i;
    var match      = (email.subject || '').match(incPattern);
    if (match) {
        var byNumber = new GlideRecord('incident');
        byNumber.addQuery('number', match[0].toUpperCase());
        byNumber.setLimit(1);
        byNumber.query();
        if (byNumber.next()) return byNumber;
    }

    // Strategy 2: Reply-to message ID matches stored ID
    if (email.message_id) {
        var byMsgId = new GlideRecord('incident');
        byMsgId.addQuery('u_email_message_id', email.message_id);
        byMsgId.addQuery('state', 'IN', '1,2,3,6');  // Active states
        byMsgId.setLimit(1);
        byMsgId.query();
        if (byMsgId.next()) return byMsgId;
    }

    return null;
}


// -------------------------------------------------------
// Helper: Append inbound email reply to existing incident
// -------------------------------------------------------
function appendEmailToIncident(incident, email) {
    var note =
        '--- Inbound Email Reply ---\n' +
        'From: ' + email.from + '\n' +
        'Date: ' + new GlideDateTime().getDisplayValue() + '\n\n' +
        (email.body_text || email.body_html || '').substring(0, 3000);

    incident.work_notes = note;

    // Reopen if resolved/closed
    var state = parseInt(incident.getValue('state'), 10);
    if (state === 6 || state === 7) {
        incident.state      = 2;    // In Progress
        incident.work_notes = 'Incident reopened via email reply.';
    }

    incident.update();
}


// -------------------------------------------------------
// Helper: Strip Re:/Fwd: prefixes from subject
// -------------------------------------------------------
function parseSubject(subject) {
    var clean = (subject || '').replace(/^(Re|Fwd|FW|RE|FWD):\s*/gi, '').trim();
    return { cleanSubject: clean };
}


// -------------------------------------------------------
// Helper: Extract first meaningful paragraph from body
// -------------------------------------------------------
function parseBody(body) {
    var text = (body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    var first = text.split(/\n{2,}/)[0] || text.substring(0, 500);
    return { firstParagraph: first.substring(0, 500) };
}


// -------------------------------------------------------
// Helper: Resolve caller sys_user record from email address
// -------------------------------------------------------
function resolveCallerFromEmail(fromAddress) {
    if (!fromAddress) return null;

    var emailAddr = fromAddress.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    if (!emailAddr) return null;

    var user = new GlideRecord('sys_user');
    user.addQuery('email', emailAddr[0].toLowerCase());
    user.setLimit(1);
    user.query();
    return user.next() ? user : null;
}


// -------------------------------------------------------
// Helper: Infer category/subcategory from keyword matching
// -------------------------------------------------------
function inferCategory(text) {
    var lower = (text || '').toLowerCase();

    var rules = [
        { category: 'network',      subcategory: 'vpn',         keywords: ['vpn', 'tunnel', 'remote access']              },
        { category: 'network',      subcategory: 'connectivity', keywords: ['internet', 'network', 'wi-fi', 'wifi', 'lan'] },
        { category: 'hardware',     subcategory: 'laptop',       keywords: ['laptop', 'notebook', 'screen', 'keyboard']    },
        { category: 'hardware',     subcategory: 'printer',      keywords: ['print', 'printer', 'scanner', 'toner']        },
        { category: 'software',     subcategory: 'email',        keywords: ['outlook', 'email', 'mailbox', 'calendar']     },
        { category: 'software',     subcategory: 'office',       keywords: ['word', 'excel', 'powerpoint', 'office 365']   },
        { category: 'access',       subcategory: 'password',     keywords: ['password', 'locked', 'login', 'cannot log']   },
        { category: 'access',       subcategory: 'permissions',  keywords: ['permission', 'access denied', 'unauthorized'] },
        { category: 'database',     subcategory: 'performance',  keywords: ['slow', 'timeout', 'database', 'query']        },
        { category: 'application',  subcategory: 'crash',        keywords: ['crash', 'error', 'exception', 'not working']  }
    ];

    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        for (var j = 0; j < rule.keywords.length; j++) {
            if (lower.indexOf(rule.keywords[j]) !== -1) {
                return { category: rule.category, subcategory: rule.subcategory };
            }
        }
    }

    return { category: 'inquiry', subcategory: 'general' };
}


// -------------------------------------------------------
// Helper: Infer impact/urgency from text + VIP status
// -------------------------------------------------------
function inferPriority(text, callerRecord) {
    var lower   = (text || '').toLowerCase();
    var impact  = 3;   // Low
    var urgency = 3;   // Low

    // VIP callers always get impact 1
    if (callerRecord && callerRecord.getValue('vip') === 'true') {
        impact = 1;
    }

    // High urgency keywords
    var highUrgency = ['urgent', 'critical', 'down', 'outage', 'not working', 'immediately', 'asap', 'emergency'];
    highUrgency.forEach(function (kw) {
        if (lower.indexOf(kw) !== -1) urgency = Math.min(urgency, 1);
    });

    // Medium urgency keywords
    var medUrgency = ['issue', 'problem', 'slow', 'intermittent', 'error', 'broken'];
    medUrgency.forEach(function (kw) {
        if (lower.indexOf(kw) !== -1 && urgency > 2) urgency = 2;
    });

    // Broad impact keywords
    var highImpact = ['all users', 'entire team', 'department', 'everyone', 'production', 'business critical'];
    highImpact.forEach(function (kw) {
        if (lower.indexOf(kw) !== -1) impact = Math.min(impact, 1);
    });

    return { impact: impact, urgency: urgency };
}


// -------------------------------------------------------
// Helper: Route to assignment group by category
// -------------------------------------------------------
function getAssignmentGroup(category, subcategory) {
    var routingMap = {
        'network':     'Network Operations',
        'hardware':    'Desktop Support',
        'software':    'Service Desk',
        'access':      'Identity & Access Management',
        'database':    'Database Administration',
        'application': 'Application Support',
        'inquiry':     'Service Desk'
    };

    var groupName = routingMap[category] || 'Service Desk';
    var grp       = new GlideRecord('sys_user_group');
    grp.addQuery('name', groupName);
    grp.setLimit(1);
    grp.query();
    return grp.next() ? grp.getValue('sys_id') : null;
}


// -------------------------------------------------------
// 2. Business Rule: Auto-acknowledge email-sourced incidents
//    When: after insert | Table: incident
//    Condition: current.contact_type == 'email'
// -------------------------------------------------------
/*
(function executeBR(current, previous) {

    if (current.getValue('contact_type') !== 'email') return;

    var caller = new GlideRecord('sys_user');
    if (!caller.get(current.getValue('caller_id'))) return;

    var template = new GlideEmailOutbound();
    template.setFrom('servicenow@yourcompany.com');
    template.setTo(caller.getValue('email'));
    template.setSubject(
        'Your request has been received [' + current.getValue('number') + ']'
    );
    template.setBody(
        'Hello ' + caller.getDisplayValue('name') + ',\n\n' +
        'We have received your request and created ' + current.getValue('number') + '.\n\n' +
        'Short description: ' + current.getValue('short_description') + '\n' +
        'Priority: ' + current.priority.getDisplayValue() + '\n' +
        'Assigned to: ' + current.assignment_group.getDisplayValue() + '\n\n' +
        'We will be in touch shortly.\n\nService Desk'
    );
    template.save();

})(current, previous);
*/
