// ============================================================
// ServiceNow: Automated Catalog Item - Script Include + Client Script
// Purpose: Automate Service Catalog item ordering, variable
//          population, and fulfillment workflow trigger.
// Author:  Senior Developer
// ============================================================

// -------------------------------------------------------
// 1. Script Include: CatalogItemUtils
//    Scope: Global | Accessible: All applications
// -------------------------------------------------------
var CatalogItemUtils = Class.create();
CatalogItemUtils.prototype = Object.extendsObject(AbstractAjaxProcessor, {

    /**
     * Auto-populate catalog item variables based on the
     * requesting user's profile data.
     */
    populateUserDefaults: function () {
        var userId   = this.getParameter('sysparm_user_id');
        var gr       = new GlideRecord('sys_user');

        if (!gr.get(userId)) {
            return JSON.stringify({ success: false, message: 'User not found' });
        }

        var result = {
            success      : true,
            department   : gr.getValue('department'),
            location     : gr.getValue('location'),
            manager      : gr.getValue('manager'),
            cost_center  : gr.department.cost_center.getDisplayValue(),
            email        : gr.getValue('email'),
            phone        : gr.getValue('phone')
        };

        return JSON.stringify(result);
    },

    /**
     * Validate catalog item variables before submission.
     * Returns a list of validation errors.
     */
    validateVariables: function () {
        var cartItemId = this.getParameter('sysparm_cart_item_id');
        var errors     = [];
        var gr         = new GlideRecord('sc_cart_item');

        if (!gr.get(cartItemId)) {
            return JSON.stringify({ valid: false, errors: ['Cart item not found'] });
        }

        // Enforce mandatory business justification for items > $500
        var price = parseFloat(gr.getValue('price') || 0);
        if (price > 500) {
            var justification = gr.variables.business_justification + '';
            if (!justification || justification.trim().length < 20) {
                errors.push('Business justification is required for items over $500 (min 20 characters).');
            }
        }

        // Validate quantity
        var qty = parseInt(gr.variables.quantity + '', 10);
        if (isNaN(qty) || qty < 1 || qty > 50) {
            errors.push('Quantity must be between 1 and 50.');
        }

        return JSON.stringify({ valid: errors.length === 0, errors: errors });
    },

    /**
     * Retrieve catalog item approval policy.
     */
    getApprovalPolicy: function () {
        var itemId  = this.getParameter('sysparm_item_id');
        var catItem = new GlideRecord('sc_cat_item');
        if (!catItem.get(itemId)) {
            return JSON.stringify({});
        }

        return JSON.stringify({
            requires_approval : catItem.getValue('approval') === 'group',
            approval_group    : catItem.approval_group.getDisplayValue(),
            sla_hours         : catItem.getValue('delivery_time') || 24
        });
    },

    type: 'CatalogItemUtils'
});


// -------------------------------------------------------
// 2. Client Script: Auto-populate on load
//    Type: onLoad | Table: sc_cat_item_guide (or sc_req_item)
// -------------------------------------------------------
/*
function onLoad() {
    var ga = new GlideAjax('CatalogItemUtils');
    ga.addParam('sysparm_name',    'populateUserDefaults');
    ga.addParam('sysparm_user_id', g_user.userID);

    ga.getXMLAnswer(function (answer) {
        try {
            var data = JSON.parse(answer);
            if (data.success) {
                g_form.setValue('department', data.department);
                g_form.setValue('location',   data.location);
                g_form.setValue('u_cost_center', data.cost_center);
            }
        } catch (e) {
            // Silent fail - not critical path
        }
    });
}
*/


// -------------------------------------------------------
// 3. Catalog Client Script: Quantity field onChange
//    Type: onChange | Variable name: quantity
// -------------------------------------------------------
/*
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) return;

    var qty = parseInt(newValue, 10);
    if (isNaN(qty) || qty < 1) {
        g_form.showFieldMsg('quantity', 'Please enter a valid quantity (1 or more).', 'error');
        g_form.setValue('quantity', 1);
        return;
    }
    if (qty > 50) {
        g_form.showFieldMsg('quantity', 'Maximum quantity allowed is 50.', 'error');
        g_form.setValue('quantity', 50);
        return;
    }
    g_form.clearMessages();
}
*/


// -------------------------------------------------------
// 4. Flow Designer Action Script: Create RITM on approval
//    (Used inside a Flow Designer Action step)
// -------------------------------------------------------
(function executeAction(inputs, outputs) {

    var ritmId   = inputs.ritm_sys_id;
    var gr       = new GlideRecord('sc_req_item');

    if (!gr.get(ritmId)) {
        outputs.status  = 'error';
        outputs.message = 'RITM not found: ' + ritmId;
        return;
    }

    // Auto-assign to fulfillment group based on category
    var categoryId     = gr.getValue('cat_item');
    var catItem        = new GlideRecord('sc_cat_item');
    var fulfillGroup   = '';

    if (catItem.get(categoryId)) {
        fulfillGroup = catItem.getValue('group');
    }

    if (fulfillGroup) {
        gr.setValue('assignment_group', fulfillGroup);
    }

    // Set expected delivery date from catalog SLA
    var slaHours = parseInt(catItem.getValue('delivery_time') || 24, 10);
    var dueDate  = new GlideDateTime();
    dueDate.addSeconds(slaHours * 3600);
    gr.setValue('due_date', dueDate);

    // Move to Work In Progress
    gr.setValue('state', 2);
    gr.update();

    // Send notification to requester
    var notif = new GlideRecord('sysevent_email_action');
    gs.eventQueue(
        'sc.catalog.item.approved',
        gr,
        gr.getValue('request.requested_for'),
        gr.getDisplayValue()
    );

    outputs.status      = 'success';
    outputs.due_date    = dueDate.getDisplayValue();
    outputs.assigned_to = fulfillGroup;

})(inputs, outputs);


// -------------------------------------------------------
// 5. Business Rule: Prevent duplicate active requests
//    When: before insert | Table: sc_req_item
// -------------------------------------------------------
/*
(function executeBR(current, previous) {

    var duplicate = new GlideRecord('sc_req_item');
    duplicate.addQuery('request.requested_for', current.request.requested_for);
    duplicate.addQuery('cat_item',              current.cat_item);
    duplicate.addQuery('state',                 'IN', '1,2,3');      // Pending, WIP, Pending approval
    duplicate.addQuery('sys_id',                '!=', current.sys_id);
    duplicate.setLimit(1);
    duplicate.query();

    if (duplicate.next()) {
        current.setAbortAction(true);
        gs.addErrorMessage(
            'An active request for this catalog item already exists: ' +
            duplicate.getDisplayValue('number')
        );
    }

})(current, previous);
*/
