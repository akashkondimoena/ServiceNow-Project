// ============================================================
// ServiceNow: Custom Scoped Application
// Scope:   x_custom_asset_mgr  (Asset Lifecycle Manager)
// Purpose: A fully scoped application for hardware asset
//          lifecycle management: procurement → deployment →
//          maintenance → retirement with cost tracking.
// ============================================================


// -------------------------------------------------------
// 1. Script Include: AssetLifecycleManager
//    Accessible: This application scope only
// -------------------------------------------------------
var AssetLifecycleManager = Class.create();
AssetLifecycleManager.prototype = {

    initialize: function () {
        this.ASSET_TABLE    = 'x_custom_asset_mgr_asset';
        this.LIFECYCLE_LOG  = 'x_custom_asset_mgr_lifecycle_log';
        this.COST_TABLE     = 'x_custom_asset_mgr_cost_entry';
    },

    /**
     * Transition an asset to the next lifecycle stage.
     * @param {String} assetId  - sys_id of the asset record
     * @param {String} newStage - Target stage
     * @param {String} notes    - Transition notes
     * @returns {Object} { success, message }
     */
    transitionStage: function (assetId, newStage, notes) {
        var asset = new GlideRecord(this.ASSET_TABLE);
        if (!asset.get(assetId)) {
            return { success: false, message: 'Asset not found: ' + assetId };
        }

        var allowedTransitions = {
            'requested'   : ['ordered'],
            'ordered'     : ['received'],
            'received'    : ['in_stock', 'quarantine'],
            'in_stock'    : ['deployed', 'retired'],
            'deployed'    : ['in_maintenance', 'retired', 'in_stock'],
            'in_maintenance': ['deployed', 'retired', 'in_stock'],
            'quarantine'  : ['in_stock', 'retired'],
            'retired'     : []
        };

        var currentStage = asset.getValue('stage');
        var allowed      = allowedTransitions[currentStage] || [];

        if (allowed.indexOf(newStage) === -1) {
            return {
                success : false,
                message : 'Invalid transition from "' + currentStage + '" to "' + newStage + '".' +
                          ' Allowed: ' + allowed.join(', ')
            };
        }

        var previousStage = currentStage;
        asset.setValue('stage', newStage);
        asset.setValue('u_last_stage_change', new GlideDateTime());

        // Stage-specific side effects
        if (newStage === 'deployed') {
            asset.setValue('u_deployed_date', new GlideDateTime());
        } else if (newStage === 'retired') {
            asset.setValue('u_retired_date', new GlideDateTime());
            asset.setValue('u_assigned_to',  '');
        }

        asset.update();
        this._logLifecycleEvent(assetId, previousStage, newStage, notes);

        return { success: true, message: 'Asset transitioned to ' + newStage };
    },

    /**
     * Assign an asset to a user and location.
     * @param {String} assetId
     * @param {String} userId
     * @param {String} locationId
     */
    assignAsset: function (assetId, userId, locationId) {
        var asset = new GlideRecord(this.ASSET_TABLE);
        if (!asset.get(assetId)) return false;

        if (asset.getValue('stage') !== 'in_stock') {
            gs.addErrorMessage('Asset must be In Stock before assignment.');
            return false;
        }

        asset.setValue('u_assigned_to', userId);
        asset.setValue('u_location',    locationId);
        asset.update();

        this.transitionStage(assetId, 'deployed', 'Assigned to user ' + userId);

        // Notify assignee
        gs.eventQueue(
            'x_custom_asset_mgr.asset.assigned',
            asset,
            userId,
            asset.getValue('u_asset_tag')
        );

        return true;
    },

    /**
     * Record a cost entry against an asset.
     * @param {String} assetId
     * @param {String} costType  - 'purchase','maintenance','disposal'
     * @param {Number} amount
     * @param {String} currency
     * @param {String} description
     */
    recordCost: function (assetId, costType, amount, currency, description) {
        var entry = new GlideRecord(this.COST_TABLE);
        entry.setValue('u_asset',       assetId);
        entry.setValue('u_cost_type',   costType);
        entry.setValue('u_amount',      amount);
        entry.setValue('u_currency',    currency || 'USD');
        entry.setValue('u_description', description);
        entry.setValue('u_entry_date',  new GlideDateTime());
        entry.insert();

        // Update total cost on asset
        var total    = this._calculateTotalCost(assetId);
        var asset    = new GlideRecord(this.ASSET_TABLE);
        if (asset.get(assetId)) {
            asset.setValue('u_total_cost', total);
            asset.update();
        }
    },

    /**
     * Generate a lifecycle summary report for an asset.
     * @param {String} assetId
     * @returns {Object} summary
     */
    getLifecycleSummary: function (assetId) {
        var asset = new GlideRecord(this.ASSET_TABLE);
        if (!asset.get(assetId)) return null;

        var logs    = [];
        var logGr   = new GlideRecord(this.LIFECYCLE_LOG);
        logGr.addQuery('u_asset', assetId);
        logGr.orderBy('sys_created_on');
        logGr.query();
        while (logGr.next()) {
            logs.push({
                from      : logGr.getValue('u_from_stage'),
                to        : logGr.getValue('u_to_stage'),
                timestamp : logGr.getValue('sys_created_on'),
                notes     : logGr.getValue('u_notes')
            });
        }

        return {
            asset_tag    : asset.getValue('u_asset_tag'),
            name         : asset.getValue('u_name'),
            current_stage: asset.getValue('stage'),
            total_cost   : asset.getValue('u_total_cost'),
            assigned_to  : asset.u_assigned_to.getDisplayValue(),
            location     : asset.u_location.getDisplayValue(),
            purchased    : asset.getValue('u_purchase_date'),
            deployed     : asset.getValue('u_deployed_date'),
            retired      : asset.getValue('u_retired_date'),
            lifecycle    : logs
        };
    },

    // ---- Private ----

    _logLifecycleEvent: function (assetId, fromStage, toStage, notes) {
        var log = new GlideRecord(this.LIFECYCLE_LOG);
        log.setValue('u_asset',      assetId);
        log.setValue('u_from_stage', fromStage);
        log.setValue('u_to_stage',   toStage);
        log.setValue('u_notes',      notes || '');
        log.setValue('u_changed_by', gs.getUserID());
        log.insert();
    },

    _calculateTotalCost: function (assetId) {
        var agg = new GlideAggregate(this.COST_TABLE);
        agg.addQuery('u_asset', assetId);
        agg.addAggregate('SUM', 'u_amount');
        agg.query();
        return agg.next() ? parseFloat(agg.getAggregate('SUM', 'u_amount') || 0) : 0;
    },

    type: 'AssetLifecycleManager'
};


// -------------------------------------------------------
// 2. Business Rule: Auto-retire assets past end-of-life
//    Table: x_custom_asset_mgr_asset
//    When: before query (runs as scheduled check)
// -------------------------------------------------------
/*
(function executeBR(current, previous) {

    var today    = new GlideDate();
    var mgr      = new AssetLifecycleManager();

    var assets   = new GlideRecord('x_custom_asset_mgr_asset');
    assets.addQuery('stage',        'IN', 'in_stock,deployed,in_maintenance');
    assets.addQuery('u_eol_date',   '<=', today);
    assets.query();

    var count = 0;
    while (assets.next()) {
        mgr.transitionStage(
            assets.getValue('sys_id'),
            'retired',
            'Auto-retired: End-of-life date reached on ' + today.getDisplayValue()
        );
        count++;
    }

    if (count > 0) gs.info('AssetMgr: Auto-retired ' + count + ' assets past end-of-life.');

})(current, previous);
*/


// -------------------------------------------------------
// 3. Scripted REST API: Asset Lookup
//    Path: /api/x_custom_asset_mgr/asset/{asset_tag}
//    Method: GET
// -------------------------------------------------------
(function process(request, response) {

    var assetTag = request.pathParams.asset_tag;
    if (!assetTag) {
        response.setStatus(400);
        response.setBody({ error: 'asset_tag path parameter is required.' });
        return;
    }

    var asset = new GlideRecord('x_custom_asset_mgr_asset');
    asset.addQuery('u_asset_tag', assetTag);
    asset.setLimit(1);
    asset.query();

    if (!asset.next()) {
        response.setStatus(404);
        response.setBody({ error: 'Asset not found: ' + assetTag });
        return;
    }

    var mgr     = new AssetLifecycleManager();
    var summary = mgr.getLifecycleSummary(asset.getValue('sys_id'));

    response.setStatus(200);
    response.setBody(summary);

})(request, response);


// -------------------------------------------------------
// 4. Scripted REST API: Transition Asset Stage
//    Path: /api/x_custom_asset_mgr/asset/{asset_tag}/transition
//    Method: POST  Body: { "stage": "deployed", "notes": "..." }
// -------------------------------------------------------
(function process(request, response) {

    var assetTag = request.pathParams.asset_tag;
    var body;
    try {
        body = JSON.parse(request.body.dataString);
    } catch (ex) {
        response.setStatus(400);
        response.setBody({ error: 'Invalid JSON body.' });
        return;
    }

    var asset = new GlideRecord('x_custom_asset_mgr_asset');
    asset.addQuery('u_asset_tag', assetTag);
    asset.setLimit(1);
    asset.query();

    if (!asset.next()) {
        response.setStatus(404);
        response.setBody({ error: 'Asset not found: ' + assetTag });
        return;
    }

    var mgr    = new AssetLifecycleManager();
    var result = mgr.transitionStage(asset.getValue('sys_id'), body.stage, body.notes);

    response.setStatus(result.success ? 200 : 422);
    response.setBody(result);

})(request, response);


// -------------------------------------------------------
// 5. Client Script: Stage transition UI
//    Type: onChange | Table: x_custom_asset_mgr_asset
//    Variable: stage
// -------------------------------------------------------
/*
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) return;

    var retireStages = ['retired'];
    if (retireStages.indexOf(newValue) !== -1) {
        var confirmed = confirm(
            'Retiring this asset is irreversible. Continue?'
        );
        if (!confirmed) {
            g_form.setValue('stage', oldValue);
            return;
        }
    }

    // Show/hide retirement date field
    if (newValue === 'retired') {
        g_form.setVisible('u_retired_date', true);
        g_form.setValue('u_retired_date', new GlideDateTime().getDisplayValue());
    } else {
        g_form.setVisible('u_retired_date', false);
    }
}
*/


// -------------------------------------------------------
// 6. Table Definitions (reference — create via Studio)
//
//  x_custom_asset_mgr_asset:
//    u_asset_tag        (String, unique)
//    u_name             (String)
//    stage              (Choice: requested,ordered,received,
//                        in_stock,deployed,in_maintenance,
//                        quarantine,retired)
//    u_assigned_to      (Reference: sys_user)
//    u_location         (Reference: cmn_location)
//    u_purchase_date    (Date)
//    u_eol_date         (Date)
//    u_deployed_date    (Date)
//    u_retired_date     (Date)
//    u_total_cost       (Currency)
//    u_last_stage_change (DateTime)
//
//  x_custom_asset_mgr_lifecycle_log:
//    u_asset            (Reference: x_custom_asset_mgr_asset)
//    u_from_stage       (String)
//    u_to_stage         (String)
//    u_notes            (String)
//    u_changed_by       (Reference: sys_user)
//
//  x_custom_asset_mgr_cost_entry:
//    u_asset            (Reference: x_custom_asset_mgr_asset)
//    u_cost_type        (Choice: purchase,maintenance,disposal)
//    u_amount           (Decimal)
//    u_currency         (String)
//    u_description      (String)
//    u_entry_date       (DateTime)
// -------------------------------------------------------
