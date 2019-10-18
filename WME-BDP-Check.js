/* eslint-disable no-nested-ternary */
// ==UserScript==
// @name        WME BDP Check (beta)
// @namespace   https://greasyfork.org/users/166843
// @version     2019.10.18.01
// @description Check for possible BDP routes between two selected segments.
// @author      dBsooner
// @include     /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @require     https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @grant       none
// @license     GPLv3
// ==/UserScript==

/* global localStorage, window, $, performance, GM_info, W, WazeWrap */

const ALERT_UPDATE = true,
    DEBUG = true,
    LOAD_BEGIN_TIME = performance.now(),
    // SCRIPT_AUTHOR = GM_info.script.author,
    SCRIPT_FORUM_URL = '',
    SCRIPT_GF_URL = '',
    SCRIPT_NAME = GM_info.script.name.replace('(beta)', 'β'),
    SCRIPT_VERSION = GM_info.script.version,
    SCRIPT_VERSION_CHANGES = ['<b>CHANGE:</b> Initial release.'],
    SETTINGS_STORE_NAME = 'WMEBDPC',
    _timeouts = { bootstrap: undefined, saveSettingsToStorage: undefined };
let _settings = {},
    _pathEndSegId;

function log(message) { console.log('WME-BDPC:', message); }
function logError(message) { console.error('WME-BDPC:', message); }
function logWarning(message) { console.warn('WME-BDPC:', message); }
function logDebug(message) {
    if (DEBUG)
        console.log('WME-BDPC:', message);
}

function loadSettingsFromStorage() {
    return new Promise(async resolve => {
        const defaultSettings = {
                lastSaved: 0,
                lastVersion: undefined
            },
            loadedSettings = $.parseJSON(localStorage.getItem(SETTINGS_STORE_NAME));
        _settings = $.extend({}, defaultSettings, loadedSettings);
        const serverSettings = await WazeWrap.Remote.RetrieveSettings(SETTINGS_STORE_NAME);
        if (serverSettings && (serverSettings.lastSaved > _settings.lastSaved))
            $.extend(_settings, serverSettings);
        _timeouts.saveSettingsToStorage = window.setTimeout(saveSettingsToStorage, 5000);
        resolve();
    });
}

function saveSettingsToStorage() {
    checkTimeout({ timeout: 'saveSettingsToStorage' });
    if (localStorage) {
        _settings.lastVersion = SCRIPT_VERSION;
        _settings.lastSaved = Date.now();
        localStorage.setItem(SETTINGS_STORE_NAME, JSON.stringify(_settings));
        WazeWrap.Remote.SaveSettings(SETTINGS_STORE_NAME, _settings);
        logDebug('Settings saved.');
    }
}

function showScriptInfoAlert() {
    if (ALERT_UPDATE && SCRIPT_VERSION !== _settings.lastVersion) {
        let releaseNotes = '';
        releaseNotes += '<p>What\'s new:</p>';
        if (SCRIPT_VERSION_CHANGES.length > 0) {
            releaseNotes += '<ul>';
            for (let idx = 0; idx < SCRIPT_VERSION_CHANGES.length; idx++)
                releaseNotes += `<li>${SCRIPT_VERSION_CHANGES[idx]}`;
            releaseNotes += '</ul>';
        }
        else {
            releaseNotes += '<ul><li>Nothing major.</ul>';
        }
        WazeWrap.Interface.ShowScriptUpdate(SCRIPT_NAME, SCRIPT_VERSION, releaseNotes, SCRIPT_GF_URL, SCRIPT_FORUM_URL);
    }
}

function checkTimeout(obj) {
    if (obj.toIndex) {
        if (_timeouts[obj.timeout] && (_timeouts[obj.timeout][obj.toIndex] !== undefined)) {
            window.clearTimeout(_timeouts[obj.timeout][obj.toIndex]);
            _timeouts[obj.timeout][obj.toIndex] = undefined;
        }
    }
    else {
        if (_timeouts[obj.timeout] !== undefined)
            window.clearTimeout(_timeouts[obj.timeout]);
        _timeouts[obj.timeout] = undefined;
    }
}

function rtgContinuityCheck(segs = []) {
    if (segs.length < 2)
        return false;
    const rtg = { 7: 'mH', 6: 'MHFW', 3: 'MHFW' },
        seg1rtg = rtg[segs[0].attributes.roadType];
    segs.splice(0, 1);
    return segs.every(el => seg1rtg === rtg[el.attributes.roadType]);
}

function nameContinuityCheck(segs = []) {
    if (segs.length < 2)
        return false;
    const streetNames = [];
    let street;
    if (segs[0].attributes.primaryStreetID) {
        street = W.model.streets.getObjectById(segs[0].attributes.primaryStreetID);
        if (street && street.name && (street.name.length > 0))
            streetNames.push(street.name);
    }
    if (segs[0].attributes.streetIDs.length > 0) {
        for (let i = 0; i < segs[0].attributes.streetIDs.length; i++) {
            street = W.model.streets.getObjectById(segs[0].attributes.streetIDs[i]);
            if (street && street.name && (street.name.length > 0))
                streetNames.push(street.name);
        }
    }
    if (streetNames.length === 0)
        return false;
    segs.splice(0, 1);
    return segs.every(el => {
        if (el.attributes.primaryStreetID) {
            street = W.model.streets.getObjectById(el.attributes.primaryStreetID);
            if (street && street.name && (street.name.length > 0) && streetNames.includes(street.name))
                return true;
        }
        if (el.attributes.streetIDs.length > 0) {
            for (let i = 0; i < el.attributes.streetIDs.length; i++) {
                street = W.model.streets.getObjectById(el.attributes.streetIDs[i]);
                if (street && street.name && (street.name.length > 0) && streetNames.includes(street.name))
                    return true;
            }
        }
        return false;
    });
}

function findLiveMapRoutes(startSeg, endSeg, maxLength) {
    return new Promise(async resolve => {
        const start900913center = startSeg.getCenter(),
            end900913center = endSeg.getCenter(),
            start4326Center = WazeWrap.Geometry.ConvertTo4326(start900913center.x, start900913center.y),
            end4326Center = WazeWrap.Geometry.ConvertTo4326(end900913center.x, end900913center.y),
            url = (W.model.countries.getObjectById(235) || W.model.countries.getObjectById(40) || W.model.countries.getObjectById(182))
                ? '/RoutingManager/routingRequest'
                : W.model.countries.getObjectById(106)
                    ? '/il-RoutingManager/routingRequest'
                    : '/row-RoutingManager/routingRequest',
            data = {
                from: `x:${start4326Center.lon} y:${start4326Center.lat}`,
                to: `x:${end4326Center.lon} y:${end4326Center.lat}`,
                returnJSON: true,
                returnGeometries: true,
                returnInstructions: false,
                timeout: 60000,
                type: 'HISTORIC_TIME',
                nPaths: 6,
                clientVersion: '4.0.0',
                vehType: 'PRIVATE',
                options: 'AVOID_TOLL_ROADS:f,AVOID_PRIMARIES:f,AVOID_DANGEROUS_TURNS:f,AVOID_FERRIES:f,ALLOW_UTURNS:t'
            },
            returnRoutes = [];
        let jsonData;
        try {
            jsonData = await $.ajax({
                dataType: 'JSON',
                cache: false,
                url,
                data,
                traditional: true,
                dataFilter: retData => retData.replace(/NaN/g, '0')
            }).fail((response, textStatus, errorThrown) => {
                logWarning(`Route request failed ${(textStatus !== null ? `with ${textStatus}` : '')}\r\n${errorThrown}!`);
            });
        }
        catch (error) {
            logWarning(JSON.stringify(error));
            jsonData = { error };
        }
        if (!jsonData) {
            logWarning('No data returned.');
        }
        else if (jsonData.error !== undefined) {
            logWarning(((typeof jsonData.error === 'object') ? $.parseJSON(jsonData.error) : jsonData.error.replace('|', '\r\n')));
        }
        else {
            let routes = (jsonData.coords !== undefined) ? [jsonData] : [];
            if (jsonData.alternatives !== undefined)
                routes = routes.concat(jsonData.alternatives);
            routes.forEach(route => {
                const fullRouteSegIds = route.response.results.map(result => result.path.segmentId),
                    fullRouteSegs = W.model.segments.getByIds(fullRouteSegIds);
                if (nameContinuityCheck(fullRouteSegs) && rtgContinuityCheck(fullRouteSegs)) {
                    const routeDistance = route.response.results.map(result => result.length).slice(1, -1).reduce((a, b) => a + b);
                    if (routeDistance < maxLength)
                        returnRoutes.push(route.response.results.map(result => result.path.segmentId));
                }
            });
        }
        resolve(returnRoutes);
    });
}

function findDirectRoute(obj = {}) {
    const {
            maxLength, /* sOutIds, */ startSeg, startNode, endSeg, endNodeIds
        } = obj,
        // processedSegs = [startSeg.attributes.id],
        processedSegs = [],
        sOutIds = startNode.attributes.segIDs.filter(segId => segId !== startSeg.attributes.id),
        segIdsFilter = (nextSegIds, alreadyProcessed) => nextSegIds.filter(value => alreadyProcessed.indexOf(value) === -1),
        getNextSegs = (nextSegIds, curSeg, nextNode) => {
            const rObj = { addPossibleRouteSegments: [] };
            for (let i = 0; i < nextSegIds.length; i++) {
                const nextSeg = W.model.segments.getObjectById(nextSegIds[i]);
                if (curSeg.isTurnAllowed(nextSeg, nextNode) && nameContinuityCheck([startSeg, nextSeg])) {
                    if (!processedSegs.some(o => (o.fromSegId === curSeg.attributes.id) && (o.toSegId === nextSegIds[i]))) {
                        rObj.addPossibleRouteSegments.push({ nextSegStartNode: nextNode, nextSeg });
                        break;
                    }
                }
            }
            return rObj;
        },
        returnRoutes = [];
    for (let i = 0, len = sOutIds.length; i < len; i++) {
        const sOut = W.model.segments.getObjectById(sOutIds[i]);
        if (startSeg.isTurnAllowed(sOut, startNode) && nameContinuityCheck([startSeg, sOut])) {
            const possibleRouteSegments = [{
                curSeg: startSeg,
                nextSegStartNode: startNode,
                nextSeg: sOut
            }];
            let curLength = 0;
            while (possibleRouteSegments.length > 0) {
                const idx = possibleRouteSegments.length - 1,
                    curSeg = possibleRouteSegments[idx].nextSeg,
                    curSegStartNode = possibleRouteSegments[idx].nextSegStartNode,
                    curSegEndNode = curSeg.getOtherNode(curSegStartNode),
                    curSegEndNodeSOutIds = segIdsFilter(curSegEndNode.attributes.segIDs, possibleRouteSegments.map(routeSeg => routeSeg.nextSeg.attributes.id));
                if ((endNodeIds.indexOf(curSegEndNode.attributes.id) > -1) && curSeg.isTurnAllowed(endSeg, curSegEndNode)) {
                    returnRoutes.push([startSeg.attributes.id].concat(possibleRouteSegments.map(routeSeg => routeSeg.nextSeg.attributes.id), [endSeg.attributes.id]));
                    possibleRouteSegments.splice(idx, 1);
                }
                else if ((curLength + curSeg.attributes.length) > maxLength) {
                    possibleRouteSegments.splice(idx, 1);
                    curLength -= curSeg.attributes.length;
                }
                else {
                    const nextSegObj = getNextSegs(curSegEndNodeSOutIds, curSeg, curSegEndNode);
                    if (nextSegObj.addPossibleRouteSegments.length > 0) {
                        curLength += curSeg.attributes.length;
                        possibleRouteSegments.push(nextSegObj.addPossibleRouteSegments[0]);
                        processedSegs.push({ fromSegId: curSeg.attributes.id, toSegId: nextSegObj.addPossibleRouteSegments[0].nextSeg.attributes.id });
                    }
                    else {
                        curLength -= curSeg.attributes.length;
                        possibleRouteSegments.splice(idx, 1);
                    }
                }
            }
            if (returnRoutes.length > 0)
                break;
        }
        else {
            processedSegs.push({ fromSegId: startSeg.attributes.id, toSegId: sOut.attributes.id });
        }
    }
    return returnRoutes;
}

async function doCheckBDP() {
    const selectedFeatures = W.selectionManager.getSelectedFeatures(),
        segmentSelection = W.selectionManager.getSegmentSelection(),
        numSelectedFeatureSegments = selectedFeatures.filter(feature => feature.model.type === 'segment').length;
    let startSeg,
        endSeg,
        directRoutes = [];
    if ((segmentSelection.segments.length < 2) || (numSelectedFeatureSegments < 2)) {
        WazeWrap.Alerts.error(SCRIPT_NAME, 'You must select either the two <i>bracketing segments</i> or an entire detour route with <i>bracketing segments</i>.');
        return;
    }
    if (segmentSelection.multipleConnectedComponents && ((segmentSelection.segments.length > 2) || (numSelectedFeatureSegments > 2))) {
        WazeWrap.Alerts.error(SCRIPT_NAME,
            'If you select more than 2 segments, the selection of segments must be continuous.<br><br>'
            + 'Either select just the two bracketing segments or an entire detour route with bracketing segments.');
        return;
    }
    if (segmentSelection.segments.length === 2) {
        [startSeg, endSeg] = segmentSelection.segments;
    }
    else if (_pathEndSegId !== undefined) {
        startSeg = W.model.segments.getObjectById(segmentSelection.segments[segmentSelection.segments.length - 1].attributes.id);
        endSeg = W.model.segments.getObjectById(_pathEndSegId);
        const tempSeg = W.model.segments.getObjectById(segmentSelection.segments[segmentSelection.segments.length - 2].attributes.id),
            tempNodeIds = [tempSeg.attributes.toNodeID, tempSeg.attributes.fromNodeID];
        endSeg.attributes.bdpcheck = (tempNodeIds.indexOf(endSeg.attributes.toNodeID) > -1) ? { routeFarEndNodeId: endSeg.attributes.toNodeID } : { routeFarEndNodeId: endSeg.attributes.fromNodeID };
        _pathEndSegId = undefined;
    }
    else {
        const tempNodeIds = [];
        segmentSelection.segments.forEach(segment => {
            let idx = tempNodeIds.map(tempNodeId => tempNodeId.nodeId).indexOf(segment.attributes.fromNodeID);
            if (idx > -1)
                tempNodeIds.splice(idx, 1);
            else
                tempNodeIds.push({ nodeId: segment.attributes.fromNodeID, segId: segment.attributes.id });
            idx = tempNodeIds.map(tempNodeId => tempNodeId.nodeId).indexOf(segment.attributes.toNodeID);
            if (idx > -1)
                tempNodeIds.splice(idx, 1);
            else
                tempNodeIds.push({ nodeId: segment.attributes.toNodeID, segId: segment.attributes.id });
        });
        if (tempNodeIds.length !== 2) {
            logError('Error finding which two segments were the bracketing segments.');
            return;
        }
        startSeg = W.model.segments.getObjectById(tempNodeIds[0].segId);
        endSeg = W.model.segments.getObjectById(tempNodeIds[1].segId);
        endSeg.attributes.bdpcheck = { routeFarEndNodeId: tempNodeIds[1].nodeId };
    }
    if ((startSeg.attributes.roadType < 3) || (startSeg.attributes.roadType === 4) || (startSeg.attributes.roadType === 5) || (startSeg.attributes.roadType > 7)
        || (endSeg.attributes.roadType < 3) || (endSeg.attributes.roadType === 4) || (endSeg.attributes.roadType === 5) || (endSeg.attributes.roadType > 7)
    ) {
        WazeWrap.Alerts.info(SCRIPT_NAME, 'At least one of the bracketing selected segments is not in the correct road type group for BDP.');
        return;
    }
    if (!rtgContinuityCheck([startSeg, endSeg])) {
        WazeWrap.Alerts.info(SCRIPT_NAME, 'One bracketing segment is a minor highway while the other is not. BDP only applies when bracketing segments are in the same road type group.');
        return;
    }
    const maxLength = (startSeg.attributes.roadType === 7) ? 5000 : 50000;
    if (segmentSelection.segments.length > 2) {
        // Detour route selected. Lets check BDP checkpoints.
        const routeSegIds = W.selectionManager.getSegmentSelection().getSelectedSegments()
                .map(segment => segment.attributes.id)
                .filter(segId => (segId !== endSeg.attributes.id) && (segId !== startSeg.attributes.id)),
            endNodeObj = endSeg.getOtherNode(W.model.nodes.getObjectById(endSeg.attributes.bdpcheck.routeFarEndNodeId)),
            startSegDirection = startSeg.getDirection(),
            startNodeObjs = (startSegDirection === 1) ? [startSeg.getToNode()] : (startSegDirection === 2) ? [startSeg.getFromNode()] : [startSeg.getToNode(), startSeg.getFromNode()],
            lastDetourSegId = routeSegIds.filter(el => endNodeObj.attributes.segIDs.includes(el)),
            lastDetourSeg = W.model.segments.getObjectById(lastDetourSegId),
            detourSegs = segmentSelection.segments.slice(1, -1);
        if (nameContinuityCheck([lastDetourSeg, endSeg])) {
            WazeWrap.Alerts.info(SCRIPT_NAME, 'BDP will not be applied to this detour route because the last detour segment and the second bracketing segment share a common street name.');
            return;
        }
        if (rtgContinuityCheck([lastDetourSeg, endSeg])) {
            WazeWrap.Alerts.info(SCRIPT_NAME, 'BDP will not be applied to this detour route because the last detour segment and the second bracketing segment are in the same road type group.');
            return;
        }
        if (detourSegs.length < 2) {
            WazeWrap.Alerts.info(SCRIPT_NAME, 'BDP will not be applied to this detour route because it is less than 2 segments long.');
            return;
        }
        if (detourSegs.map(seg => seg.attributes.length).reduce((a, b) => a + b) > ((startSeg.attributes.roadType === 7) ? 500 : 5000)) {
            WazeWrap.Alerts.info(SCRIPT_NAME, `BDP will not be applied to this detour route because it is longer than ${((startSeg.attributes.roadType === 7) ? '500m' : '5km')}.`);
            return;
        }
        // We have a preventable detour. Let's check for a direct route.
        // First check what is returned by the Live Map routing engine.
        directRoutes = directRoutes.concat(await findLiveMapRoutes(startSeg, endSeg, maxLength));
        if (directRoutes.length === 0) {
            for (let i = 0; i < startNodeObjs.length; i++) {
                const startNode = startNodeObjs[i];
                directRoutes = findDirectRoute({
                    maxLength, startSeg, startNode, endSeg, endNodeIds: [endNodeObj.attributes.id]
                });
                if (directRoutes.length > 0)
                    break;
            }
        }
    }
    else {
        // Check bracketing segment name continuity
        if (!nameContinuityCheck([startSeg, endSeg])) {
            WazeWrap.Alerts.info(SCRIPT_NAME, 'The bracketing segments do not share a street name. BDP will not be applied to any route.');
            return;
        }
        // Let's check for a "direct route"
        // First check what is returned by the Live Map routing engine.
        directRoutes = directRoutes.concat(await findLiveMapRoutes(startSeg, endSeg, maxLength));
        // No direct route found from live-map routing. Let's try to do it manually.
        if (directRoutes.length === 0) {
            const startSegDirection = startSeg.getDirection(),
                endSegDirection = endSeg.getDirection(),
                startNodeObjs = (startSegDirection === 1) ? [startSeg.getToNode()] : (startSegDirection === 2) ? [startSeg.getFromNode()] : [startSeg.getToNode(), startSeg.getFromNode()],
                endNodeObjs = (endSegDirection === 1) ? [endSeg.getFromNode()] : (endSegDirection === 2) ? [endSeg.getToNode()] : [endSeg.getFromNode(), endSeg.getToNode()],
                endNodeIds = endNodeObjs.map(nodeObj => nodeObj && nodeObj.attributes.id);
            for (let i = 0; i < startNodeObjs.length; i++) {
                const startNode = startNodeObjs[i]; // ,
                directRoutes = findDirectRoute({
                    maxLength, startSeg, startNode, endSeg, endNodeIds
                });
                if (directRoutes.length > 0)
                    break;
            }
        }
    }
    if (directRoutes.length > 0) {
        WazeWrap.Alerts.confirm(SCRIPT_NAME,
            'A <b>direct route</b> was found! Would you like to select the direct route?',
            () => {
                const segments = [];
                for (let i = 0; i < directRoutes[0].length; i++) {
                    const seg = W.model.segments.getObjectById(directRoutes[0][i]);
                    if (seg !== 'undefined')
                        segments.push(seg);
                }
                W.selectionManager.setSelectedModels(segments);
            },
            () => { }, 'Yes', 'No');
    }
    else if (segmentSelection.segments.length === 2) {
        WazeWrap.Alerts.info(SCRIPT_NAME,
            'No direct routes found between the two selected segments. A BDP penalty <b>will not</b> be applied to any routes.'
                + '<br><b>Note:</b> This could also be caused by the distance between the two selected segments is longer than than the allowed distance for detours.');
    }
    else {
        WazeWrap.Alerts.info(SCRIPT_NAME,
            'No direct routes found between the possible detour bracketing segments. A BDP penalty <b>will not</b> be applied to the selected route.'
                + '<br><b>Note:</b> This could also be because any possible direct routes are very long, which would take longer to travel than taking the selected route (even with penalty).');
    }
}

function insertCheckBDPButton(evt) {
    if (!evt || !evt.object || !evt.object._selectedFeatures || (evt.object._selectedFeatures.length < 2)) {
        if ($('#WME-BDPC').length > 0)
            $('#WME-BDPC').remove();
        return;
    }
    if (evt.object._selectedFeatures.filter(feature => feature.model.type === 'segment').length > 1) {
        $('.edit-restrictions').after(
            '<button id="WME-BDPC" class="waze-btn waze-btn-small waze-btn-white" title="Check if there are possible BDP routes between two selected segments.">BDP Check</button>'
        );
    }
    else if ($('#WME-BDPC').length > 0) {
        $('#WME-BDPC').remove();
    }
}

function pathSelected(evt) {
    if (evt && evt.feature && evt.feature.model && (evt.feature.model.type === 'segment'))
        _pathEndSegId = evt.feature.model.attributes.id;
}

async function init() {
    log('Initializing.');
    await loadSettingsFromStorage();
    W.selectionManager.events.register('selectionchanged', null, insertCheckBDPButton);
    W.selectionManager.selectionMediator.on('map:selection:pathSelect', pathSelected);
    W.selectionManager.selectionMediator.on('map:selection:featureClick', () => { _pathEndSegId = undefined; });
    W.selectionManager.selectionMediator.on('map:selection:clickOut', () => { _pathEndSegId = undefined; });
    W.selectionManager.selectionMediator.on('map:selection:deselectKey', () => { _pathEndSegId = undefined; });
    W.selectionManager.selectionMediator.on('map:selection:featureBoxSelection', () => { _pathEndSegId = undefined; });
    if (W.selectionManager.getSegmentSelection().segments.length > 1) {
        $('.edit-restrictions').after(
            '<button id="WME-BDPC" class="waze-btn waze-btn-small waze-btn-white" title="Check if there are possible BDP routes between two selected segments.">BDP Check</button>'
        );
    }
    $('#sidebar').on('click', '#WME-BDPC', e => {
        e.preventDefault();
        doCheckBDP();
    });
    showScriptInfoAlert();
    log(`Fully initialized in ${Math.round(performance.now() - LOAD_BEGIN_TIME)} ms.`);
}

function bootstrap(tries) {
    if (W && W.map && W.model && $ && WazeWrap.Ready) {
        checkTimeout({ timeout: 'bootstrap' });
        log('Bootstrapping.');
        init();
    }
    else if (tries < 1000) {
        logDebug(`Bootstrap failed. Retrying ${tries} of 1000`);
        _timeouts.bootstrap = window.setTimeout(bootstrap, 200, ++tries);
    }
    else {
        logError('Bootstrap timed out waiting for WME to become ready.');
    }
}

bootstrap(1);
