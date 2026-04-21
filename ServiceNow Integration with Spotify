// ============================================================
// ServiceNow: Integration with Spotify
// Purpose: Connect ServiceNow to the Spotify Web API to
//          manage On-Call "focus playlists", auto-pause
//          music during P1 incidents, log listening sessions
//          to employee well-being records, and allow agents
//          to request custom playlists via Service Catalog.
//
// Auth:    OAuth 2.0 Client Credentials + PKCE for user flows
// ============================================================


// -------------------------------------------------------
// 1. Script Include: SpotifyIntegration
//    Scope: Global | Handles all Spotify API calls
// -------------------------------------------------------
var SpotifyIntegration = Class.create();
SpotifyIntegration.prototype = {

    initialize: function () {
        this.CLIENT_ID     = gs.getProperty('spotify.integration.client_id',     '');
        this.CLIENT_SECRET = gs.getProperty('spotify.integration.client_secret', '');
        this.TOKEN_URL     = 'https://accounts.spotify.com/api/token';
        this.API_BASE      = 'https://api.spotify.com/v1';
        this._accessToken  = null;
    },

    // ---- Auth ----

    /**
     * Obtain a Client Credentials access token (app-level).
     * Stored in system cache for 55 minutes (token TTL = 60 min).
     * @returns {String|null} Bearer token
     */
    getAppToken: function () {
        var cached = gs.getCacheEntry('spotify_app_token');
        if (cached) return cached;

        var credentials = GlideStringUtil.base64Encode(this.CLIENT_ID + ':' + this.CLIENT_SECRET);

        var request = new sn_ws.RESTMessageV2();
        request.setHttpMethod('POST');
        request.setEndpoint(this.TOKEN_URL);
        request.setRequestHeader('Authorization', 'Basic ' + credentials);
        request.setRequestHeader('Content-Type',  'application/x-www-form-urlencoded');
        request.setRequestBody('grant_type=client_credentials');

        var response = request.execute();
        if (response.getStatusCode() !== 200) {
            gs.error('SpotifyIntegration: Token request failed: ' + response.getBody());
            return null;
        }

        var data  = JSON.parse(response.getBody());
        var token = data.access_token;

        // Cache for 55 minutes
        gs.putCacheEntry('spotify_app_token', token, 3300);
        return token;
    },

    /**
     * Obtain a user-delegated token from the stored refresh token.
     * Requires 'spotify.integration.refresh_token_{userId}' property.
     * @param {String} userId - ServiceNow sys_user sys_id
     * @returns {String|null}
     */
    getUserToken: function (userId) {
        var refreshTokenProp = 'spotify.integration.refresh_token.' + userId;
        var refreshToken     = gs.getProperty(refreshTokenProp, '');

        if (!refreshToken) {
            gs.warn('SpotifyIntegration: No refresh token for user ' + userId);
            return null;
        }

        var credentials = GlideStringUtil.base64Encode(this.CLIENT_ID + ':' + this.CLIENT_SECRET);
        var request     = new sn_ws.RESTMessageV2();
        request.setHttpMethod('POST');
        request.setEndpoint(this.TOKEN_URL);
        request.setRequestHeader('Authorization', 'Basic ' + credentials);
        request.setRequestHeader('Content-Type',  'application/x-www-form-urlencoded');
        request.setRequestBody('grant_type=refresh_token&refresh_token=' + refreshToken);

        var response = request.execute();
        if (response.getStatusCode() !== 200) {
            gs.error('SpotifyIntegration: User token refresh failed for ' + userId);
            return null;
        }

        var data = JSON.parse(response.getBody());
        // Update refresh token if rotated
        if (data.refresh_token) {
            gs.setProperty(refreshTokenProp, data.refresh_token);
        }
        return data.access_token;
    },

    // ---- Playback Control ----

    /**
     * Pause playback for a user's active Spotify device.
     * @param {String} userId - ServiceNow sys_user sys_id
     * @returns {Boolean}
     */
    pausePlayback: function (userId) {
        var token = this.getUserToken(userId);
        if (!token) return false;
        var resp = this._call('PUT', '/me/player/pause', null, token);
        return resp !== null;
    },

    /**
     * Resume playback for a user's active Spotify device.
     * @param {String} userId
     */
    resumePlayback: function (userId) {
        var token = this.getUserToken(userId);
        if (!token) return false;
        var resp = this._call('PUT', '/me/player/play', null, token);
        return resp !== null;
    },

    /**
     * Start playing a specific playlist for a user.
     * @param {String} userId
     * @param {String} playlistId - Spotify playlist ID
     */
    playPlaylist: function (userId, playlistId) {
        var token = this.getUserToken(userId);
        if (!token) return false;
        var body = { context_uri: 'spotify:playlist:' + playlistId };
        return this._call('PUT', '/me/player/play', body, token) !== null;
    },

    /**
     * Get the user's currently playing track.
     * @param {String} userId
     * @returns {Object|null}
     */
    getCurrentlyPlaying: function (userId) {
        var token = this.getUserToken(userId);
        if (!token) return null;
        return this._call('GET', '/me/player/currently-playing', null, token);
    },

    // ---- Playlist Management ----

    /**
     * Search Spotify for playlists matching a query.
     * @param {String} query
     * @param {Number} limit
     * @returns {Array}
     */
    searchPlaylists: function (query, limit) {
        var token = this.getAppToken();
        if (!token) return [];

        var result = this._call(
            'GET',
            '/search?q=' + encodeURIComponent(query) +
            '&type=playlist&limit=' + (limit || 5),
            null,
            token
        );

        if (!result || !result.playlists) return [];

        return (result.playlists.items || []).map(function (p) {
            return {
                id          : p.id,
                name        : p.name,
                description : p.description,
                tracks      : (p.tracks || {}).total || 0,
                url         : (p.external_urls || {}).spotify || ''
            };
        });
    },

    /**
     * Create a new playlist in a user's Spotify account.
     * @param {String} userId
     * @param {String} spotifyUserId - Spotify user ID (not SN)
     * @param {String} name
     * @param {String} description
     * @returns {String|null} new playlist ID
     */
    createPlaylist: function (userId, spotifyUserId, name, description) {
        var token = this.getUserToken(userId);
        if (!token) return null;

        var result = this._call(
            'POST',
            '/users/' + spotifyUserId + '/playlists',
            { name: name, description: description, public: false },
            token
        );
        return result ? result.id : null;
    },

    // ---- Focus & Well-being ----

    /**
     * Start a "focus session" for an on-call engineer.
     * Plays the configured focus playlist and logs the session.
     * @param {String} snUserId
     */
    startFocusSession: function (snUserId) {
        var playlistId = gs.getProperty('spotify.integration.focus_playlist_id', '');
        if (!playlistId) {
            gs.warn('SpotifyIntegration: focus_playlist_id not configured.');
            return false;
        }

        var started = this.playPlaylist(snUserId, playlistId);
        if (started) this._logWellBeingSession(snUserId, 'focus_start', playlistId);
        return started;
    },

    /**
     * End the focus session — pause music and log duration.
     * @param {String} snUserId
     */
    endFocusSession: function (snUserId) {
        var paused = this.pausePlayback(snUserId);
        if (paused) this._logWellBeingSession(snUserId, 'focus_end', '');
        return paused;
    },

    // ---- Private Helpers ----

    _call: function (method, path, body, token) {
        try {
            var request = new sn_ws.RESTMessageV2();
            request.setHttpMethod(method);
            request.setEndpoint(this.API_BASE + path);
            request.setRequestHeader('Authorization', 'Bearer ' + token);
            request.setRequestHeader('Content-Type',  'application/json');
            if (body) request.setRequestBody(JSON.stringify(body));

            var response = request.execute();
            var status   = response.getStatusCode();
            var respBody = response.getBody();

            if (status === 204) return {};   // No content — success
            if (status >= 400) {
                gs.error('SpotifyIntegration: HTTP ' + status + ' on ' + method + ' ' + path + ': ' + respBody);
                return null;
            }
            return respBody ? JSON.parse(respBody) : {};
        } catch (ex) {
            gs.error('SpotifyIntegration: Exception on ' + method + ' ' + path + ': ' + ex.message);
            return null;
        }
    },

    _logWellBeingSession: function (userId, eventType, context) {
        var log = new GlideRecord('u_spotify_well_being_log');
        log.setValue('u_user',       userId);
        log.setValue('u_event_type', eventType);
        log.setValue('u_context',    context);
        log.setValue('u_timestamp',  new GlideDateTime());
        log.insert();
    },

    type: 'SpotifyIntegration'
};


// -------------------------------------------------------
// 2. Business Rule: Auto-pause Spotify on P1 Incident
//    Table: incident | When: after insert
//    Condition: priority == 1 (Critical)
// -------------------------------------------------------
/*
(function executeBR(current, previous) {

    if (current.getValue('priority') !== '1') return;
    if (gs.getProperty('spotify.integration.enabled') !== 'true') return;

    // Find all on-call agents in the assignment group
    var group   = current.getValue('assignment_group');
    var members = new GlideRecord('sys_user_grmember');
    members.addQuery('group', group);
    members.query();

    var spotify = new SpotifyIntegration();

    while (members.next()) {
        var userId = members.getValue('user');
        // Only pause if user has Spotify linked
        var refreshProp = gs.getProperty('spotify.integration.refresh_token.' + userId, '');
        if (refreshProp) {
            spotify.pausePlayback(userId);
            gs.info('SpotifyIntegration: Paused playback for on-call agent ' + userId + ' due to P1 ' + current.getValue('number'));
        }
    }

})(current, previous);
*/


// -------------------------------------------------------
// 3. Catalog Item Script: "Request Focus Playlist"
//    Fulfillment script (Flow Designer Action)
// -------------------------------------------------------
(function executeAction(inputs, outputs) {

    var requestedFor = inputs.requested_for;
    var mood         = inputs.mood || 'focus';   // focus, energize, calm
    var spotify      = new SpotifyIntegration();

    var moodQueries = {
        focus    : 'deep work focus instrumental',
        energize : 'high energy workout pump up',
        calm     : 'chill lofi calm relaxing'
    };

    var searchQuery = moodQueries[mood] || moodQueries.focus;
    var playlists   = spotify.searchPlaylists(searchQuery, 3);

    if (!playlists || playlists.length === 0) {
        outputs.status  = 'error';
        outputs.message = 'No playlists found for mood: ' + mood;
        return;
    }

    var topPlaylist = playlists[0];
    var started     = spotify.playPlaylist(requestedFor, topPlaylist.id);

    outputs.status      = started ? 'success' : 'error';
    outputs.playlist_id = topPlaylist.id;
    outputs.playlist_url= topPlaylist.url;
    outputs.message     = started
        ? 'Now playing "' + topPlaylist.name + '" on your Spotify.'
        : 'Could not start playback. Ensure Spotify is open on one of your devices.';

})(inputs, outputs);


// -------------------------------------------------------
// 4. Scripted REST API: OAuth Callback Handler
//    Path: /api/x_custom/spotify/callback
//    Method: GET  (Spotify redirects here with ?code=...)
// -------------------------------------------------------
(function process(request, response) {

    var code    = request.queryParams.code    ? request.queryParams.code[0]  : null;
    var state   = request.queryParams.state   ? request.queryParams.state[0] : null;  // snUserId
    var error   = request.queryParams.error   ? request.queryParams.error[0] : null;

    if (error || !code) {
        response.setStatus(400);
        response.setBody('<html><body>Spotify authorization failed: ' + (error || 'no code') + '</body></html>');
        return;
    }

    // Exchange code for tokens
    var clientId     = gs.getProperty('spotify.integration.client_id',     '');
    var clientSecret = gs.getProperty('spotify.integration.client_secret', '');
    var redirectUri  = gs.getProperty('spotify.integration.redirect_uri',  '');
    var credentials  = GlideStringUtil.base64Encode(clientId + ':' + clientSecret);

    var tokenReq = new sn_ws.RESTMessageV2();
    tokenReq.setHttpMethod('POST');
    tokenReq.setEndpoint('https://accounts.spotify.com/api/token');
    tokenReq.setRequestHeader('Authorization', 'Basic ' + credentials);
    tokenReq.setRequestHeader('Content-Type',  'application/x-www-form-urlencoded');
    tokenReq.setRequestBody(
        'grant_type=authorization_code' +
        '&code=' + encodeURIComponent(code) +
        '&redirect_uri=' + encodeURIComponent(redirectUri)
    );

    var tokenResp = tokenReq.execute();
    if (tokenResp.getStatusCode() !== 200) {
        response.setStatus(500);
        response.setBody('<html><body>Token exchange failed.</body></html>');
        return;
    }

    var tokenData = JSON.parse(tokenResp.getBody());

    // Store refresh token against the user (state = SN user sys_id)
    if (state && tokenData.refresh_token) {
        gs.setProperty('spotify.integration.refresh_token.' + state, tokenData.refresh_token);
    }

    response.setStatus(200);
    response.setBody(
        '<html><body>' +
        '<h2>Spotify Connected!</h2>' +
        '<p>Your Spotify account is now linked to ServiceNow. You can close this window.</p>' +
        '</body></html>'
    );

})(request, response);


// -------------------------------------------------------
// 5. System Properties Required:
//    spotify.integration.enabled         = true
//    spotify.integration.client_id       = <Spotify App Client ID>
//    spotify.integration.client_secret   = <Spotify App Client Secret>
//    spotify.integration.redirect_uri    = https://<instance>.service-now.com/api/x_custom/spotify/callback
//    spotify.integration.focus_playlist_id = <Spotify Playlist ID>
//    spotify.integration.refresh_token.<sys_user_sys_id> = <per-user token>
//
// 6. Required Spotify OAuth Scopes:
//    user-read-playback-state
//    user-modify-playback-state
//    user-read-currently-playing
//    playlist-modify-private
//    playlist-read-private
// -------------------------------------------------------
