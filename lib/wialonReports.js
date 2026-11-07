
// =====================================================
// WIALON REPORTS
// =====================================================
//
// Handles:
//   1. Automatic report template discovery
//   2. Report execution
//   3. Report result rows
//   4. Report cleanup
//
// IMPORTANT:
// - Uses existing logged-in user SID when available.
// - If SID returns Wialon error 1, creates a fresh SID.
// - NO WIALON_RESOURCE_ID is required.
// - Automatically discovers accessible resources.
// - If core/search_items does not return resource.rep,
//   each resource is loaded individually with core/search_item.
// - Reads report templates from resource.rep.
// - Does NOT modify dashboard/unit-loading logic.
// =====================================================

const { wialonLogin, wialonLogout } = require('./wialon');
const fetch = require('node-fetch');


// =====================================================
// CONFIG
// =====================================================

const WIALON_HOST =
    process.env.WIALON_HOST ||
    'https://hst-api.wialon.eu';

const WIALON_REQUEST_TIMEOUT =
    Number(
        process.env.WIALON_REQUEST_TIMEOUT || 60000
    );


// =====================================================
// SESSION ERROR
// =====================================================

function isWialonSessionError(error) {

    if (!error) {
        return false;
    }

    const message =
        String(
            error.message || error
        );

    return (
        message.includes('"error":1') ||
        message.includes('"error_code":1') ||
        message.includes('error: 1') ||
        message.includes('error=1') ||
        /Wialon API error .*1/.test(message)
    );
}


// =====================================================
// WIALON REQUEST
// =====================================================

async function wialonRequest(
    sid,
    service,
    params = {}
) {

    const url =
        `${WIALON_HOST}/wialon/ajax.html` +
        `?svc=${encodeURIComponent(service)}` +
        `&params=${encodeURIComponent(
            JSON.stringify(params)
        )}` +
        (
            sid
                ? `&sid=${encodeURIComponent(sid)}`
                : ''
        );

    console.log('\n➡️ WIALON REQUEST');

    console.log(
        '➡️ Service:',
        service
    );

    console.log(
        '➡️ Has SID:',
        !!sid
    );

    console.log(
        '➡️ SID length:',
        sid ? sid.length : 0
    );

    const controller =
        new AbortController();

    const timeout =
        setTimeout(() => {

            console.error(
                `⏰ WIALON REQUEST TIMEOUT: ${service}`
            );

            controller.abort();

        }, WIALON_REQUEST_TIMEOUT);

    let response;

    try {

        response =
            await fetch(
                url,
                {
                    method: 'POST',
                    signal:
                        controller.signal,

                    headers: {
                        'Content-Type':
                            'application/x-www-form-urlencoded'
                    }
                }
            );

    } catch (error) {

        if (
            error &&
            (
                error.name === 'AbortError' ||
                error.code === 'ABORT_ERR'
            )
        ) {

            throw new Error(
                `Wialon request timed out after ` +
                `${WIALON_REQUEST_TIMEOUT / 1000}s ` +
                `(${service})`
            );
        }

        throw new Error(
            `Wialon request failed ` +
            `(${service}): ${error.message}`
        );

    } finally {

        clearTimeout(timeout);
    }

    const text =
        await response.text();

    console.log(
        '⬅️ WIALON HTTP STATUS:',
        response.status
    );

    let data;

    try {

        data =
            JSON.parse(text);

    } catch {

        throw new Error(
            `Invalid JSON from Wialon (${service}): ` +
            `${text.substring(0, 500)}`
        );
    }

    if (
        data &&
        (
            data.error !== undefined ||
            data.error_code !== undefined
        )
    ) {

        console.error(
            `❌ WIALON API ERROR (${service}):`,
            JSON.stringify(data)
        );

        throw new Error(
            `Wialon API error (${service}): ` +
            `${JSON.stringify(data)}`
        );
    }

    return data;
}


// =====================================================
// CREATE FRESH SID
// =====================================================

async function createFreshSid() {

    console.log('\n========================================');
    console.log('🔄 CREATING FRESH WIALON SID');
    console.log('========================================');

    const sid =
        await wialonLogin();

    if (!sid) {

        throw new Error(
            'Wialon login succeeded without returning a SID'
        );
    }

    console.log(
        '✅ Fresh Wialon SID created'
    );

    console.log(
        'SID length:',
        sid.length
    );

    return sid;
}


// =====================================================
// SAFE LOGOUT
// =====================================================

async function safeWialonLogout(
    sid
) {

    if (!sid) {
        return;
    }

    try {

        console.log(
            '🔌 Logging out temporary Wialon SID...'
        );

        await wialonLogout(
            sid
        );

        console.log(
            '✅ Temporary Wialon SID logged out'
        );

    } catch (error) {

        console.warn(
            '⚠️ Temporary SID logout failed:',
            error.message
        );
    }
}


// =====================================================
// RESOLVE SID
// =====================================================

async function resolveSid(
    sessionUser
) {

    console.log('\n========================================');
    console.log('🔐 RESOLVING WIALON SID');
    console.log('========================================');

    if (
        sessionUser &&
        sessionUser.wialonSid
    ) {

        console.log(
            '✅ Using existing user Wialon SID'
        );

        console.log(
            'SID length:',
            sessionUser.wialonSid.length
        );

        return {

            sid:
                sessionUser.wialonSid,

            ownedByUs:
                false
        };
    }

    console.log(
        '⚠️ No user SID found.'
    );

    console.log(
        '🔄 Creating fresh SID...'
    );

    const sid =
        await createFreshSid();

    return {

        sid,

        ownedByUs:
            true
    };
}


// =====================================================
// REQUEST WITH SID RETRY
// =====================================================

async function requestWithSidRetry(
    sid,
    service,
    params
) {

    try {

        const data =
            await wialonRequest(
                sid,
                service,
                params
            );

        return {

            data,

            sid,

            temporarySid:
                false
        };

    } catch (firstError) {

        if (
            !isWialonSessionError(
                firstError
            )
        ) {

            throw firstError;
        }

        console.warn('\n⚠️ WIALON SESSION ERROR');

        console.warn(
            `⚠️ ${service} returned error 1`
        );

        console.warn(
            '🔄 Creating fresh SID...'
        );

        const freshSid =
            await createFreshSid();

        try {

            const data =
                await wialonRequest(
                    freshSid,
                    service,
                    params
                );

            console.log(
                `✅ ${service} succeeded with fresh SID`
            );

            return {

                data,

                sid:
                    freshSid,

                temporarySid:
                    true
            };

        } catch (secondError) {

            await safeWialonLogout(
                freshSid
            );

            throw secondError;
        }
    }
}


// =====================================================
// EXTRACT REPORT TEMPLATES
// =====================================================

function extractTemplatesFromResources(
    resources
) {

    if (
        !Array.isArray(resources)
    ) {

        return [];
    }

    const templates =
        [];

    console.log('\n========================================');
    console.log('📁 SCANNING WIALON RESOURCES');
    console.log('========================================');

    for (
        const resource
        of resources
    ) {

        if (!resource) {
            continue;
        }

        const resourceId =
            Number(
                resource.id
            );

        if (
            !Number.isFinite(
                resourceId
            )
        ) {

            continue;
        }

        const resourceName =
            resource.nm ||
            `Resource ${resourceId}`;

        const rep =
            resource.rep &&
            typeof resource.rep === 'object'
                ? resource.rep
                : {};

        const templateIds =
            Object.keys(
                rep
            );

        console.log('\n📁 RESOURCE');

        console.log(
            'Name:',
            resourceName
        );

        console.log(
            'ID:',
            resourceId
        );

        console.log(
            'Report templates:',
            templateIds.length
        );

        if (
            templateIds.length === 0
        ) {

            continue;
        }

        for (
            const templateKey
            of templateIds
        ) {

            const template =
                rep[templateKey];

            if (
                !template ||
                typeof template !== 'object'
            ) {

                continue;
            }

            const templateId =
                Number(
                    template.id ??
                    templateKey
                );

            if (
                !Number.isFinite(
                    templateId
                )
            ) {

                continue;
            }

            const templateName =
                template.n ||
                template.name ||
                template.nm ||
                `Template ${templateId}`;

            console.log(
                `   📊 ${templateId} → ${templateName}`
            );

            templates.push({

                resourceId,

                resourceName,

                templateId,

                name:
                    templateName
            });
        }
    }

    // =================================================
    // REMOVE DUPLICATES
    // =================================================

    const unique =
        [];

    const seen =
        new Set();

    for (
        const template
        of templates
    ) {

        const key =
            `${template.resourceId}:` +
            `${template.templateId}`;

        if (
            seen.has(key)
        ) {

            continue;
        }

        seen.add(
            key
        );

        unique.push(
            template
        );
    }

    // =================================================
    // SORT
    // =================================================

    unique.sort(
        (a, b) => {

            const resourceCompare =
                String(
                    a.resourceName
                ).localeCompare(
                    String(
                        b.resourceName
                    )
                );

            if (
                resourceCompare !== 0
            ) {

                return resourceCompare;
            }

            return String(
                a.name
            ).localeCompare(
                String(
                    b.name
                )
            );
        }
    );

    return unique;
}


// =====================================================
// LOAD ONE RESOURCE
// =====================================================
//
// IMPORTANT:
//
// core/search_item returns:
//
// {
//     item: {...},
//     flags: ...
// }
//
// We request 8193:
//   1    = basic resource data
//   8192 = report templates
//
// =====================================================

async function loadResourceWithReports(
    sid,
    resourceId
) {

    console.log('\n----------------------------------------');

    console.log(
        '🔍 LOADING RESOURCE DETAILS'
    );

    console.log(
        'Resource ID:',
        resourceId
    );

    const result =
        await requestWithSidRetry(
            sid,
            'core/search_item',
            {

                id:
                    Number(
                        resourceId
                    ),

                flags:
                    8193
            }
        );

    const item =
        result.data?.item ||
        result.data;

    if (
        !item ||
        typeof item !== 'object'
    ) {

        console.warn(
            '⚠️ Resource returned no item:',
            resourceId
        );

        return {

            resource:
                null,

            sid:
                result.sid,

            temporarySid:
                result.temporarySid
        };
    }

    const rep =
        item.rep &&
        typeof item.rep === 'object'
            ? item.rep
            : {};

    const reportCount =
        Object.keys(
            rep
        ).length;

    console.log(
        '📁 Resource:',
        item.nm || item.id
    );

    console.log(
        '🆔 ID:',
        item.id
    );

    console.log(
        '📊 Report templates in item.rep:',
        reportCount
    );

    if (
        reportCount > 0
    ) {

        for (
            const key
            of Object.keys(rep)
        ) {

            const template =
                rep[key];

            if (
                template &&
                typeof template === 'object'
            ) {

                console.log(
                    `   📊 ${template.id ?? key} → ` +
                    `${template.n || template.name || template.nm || 'Unnamed'}`
                );
            }
        }
    }

    return {

        resource:
            item,

        sid:
            result.sid,

        temporarySid:
            result.temporarySid
    };
}


// =====================================================
// AUTO DISCOVER REPORT RESOURCES
// =====================================================
//
// STEP 1:
// Search all accessible resources.
//
// STEP 2:
// If search_items already contains rep,
// use it.
//
// STEP 3:
// If rep is missing, call core/search_item
// for every resource.
//
// This means the discovery does NOT depend
// on WIALON_RESOURCE_ID.
//
// =====================================================

async function discoverReportResources(
    sid
) {

    console.log('\n========================================');
    console.log('🔎 AUTO-DISCOVERING REPORT RESOURCES');
    console.log('========================================');

    const params = {

        spec: {

            itemsType:
                'avl_resource',

            propName:
                'sys_name',

            propValueMask:
                '*',

            sortType:
                'sys_name'
        },

        force:
            1,

        flags:
            8193,

        from:
            0,

        to:
            0
    };

    const result =
        await requestWithSidRetry(
            sid,
            'core/search_items',
            params
        );

    let resources =
        Array.isArray(
            result.data?.items
        )
            ? result.data.items
            : [];

    console.log(
        '🔎 Total resources returned:',
        resources.length
    );

    console.log(
        '🔎 Wialon applied flags:',
        result.data?.dataFlags
    );

    if (
        resources.length === 0
    ) {

        console.warn(
            '⚠️ Wialon returned ZERO accessible resources.'
        );

        return {

            templates:
                [],

            sid:
                result.sid,

            temporarySid:
                result.temporarySid
        };
    }

    // =================================================
    // FIRST PASS
    // =================================================

    let templates =
        extractTemplatesFromResources(
            resources
        );

    console.log(
        '📊 Templates found directly:',
        templates.length
    );

    // =================================================
    // SECOND PASS
    // =================================================
    //
    // If search_items returned resources but
    // resource.rep was not included, load each
    // resource individually.
    //
    // =================================================

    if (
        templates.length === 0
    ) {

        console.log('\n========================================');
        console.log(
            '🔄 RESOURCE DETAIL FALLBACK'
        );
        console.log('========================================');

        console.log(
            '⚠️ search_items returned resources but no report templates.'
        );

        console.log(
            '🔄 Loading each resource with core/search_item...'
        );

        const detailedResources =
            [];

        let activeSid =
            result.sid;

        let temporarySid =
            result.temporarySid;

        for (
            const resource
            of resources
        ) {

            if (
                !resource ||
                !resource.id
            ) {

                continue;
            }

            try {

                const detailed =
                    await loadResourceWithReports(
                        activeSid,
                        resource.id
                    );

                activeSid =
                    detailed.sid;

                if (
                    detailed.temporarySid
                ) {

                    temporarySid =
                        true;
                }

                if (
                    detailed.resource
                ) {

                    detailedResources.push(
                        detailed.resource
                    );
                }

            } catch (error) {

                console.warn(
                    `⚠️ Failed to load resource ${resource.id}:`,
                    error.message
                );
            }
        }

        resources =
            detailedResources;

        templates =
            extractTemplatesFromResources(
                resources
            );

        console.log(
            '📊 Templates found after resource-detail fallback:',
            templates.length
        );

        return {

            templates,

            sid:
                activeSid,

            temporarySid
        };
    }

    return {

        templates,

        sid:
            result.sid,

        temporarySid:
            result.temporarySid
    };
}


// =====================================================
// GET RESOURCE DIRECTLY
// =====================================================

async function getResourceDirectly(
    sid,
    resourceId
) {

    console.log('\n========================================');
    console.log('📁 DIRECT WIALON RESOURCE LOOKUP');
    console.log('========================================');

    console.log(
        'Resource ID:',
        resourceId
    );

    const result =
        await requestWithSidRetry(
            sid,
            'core/search_item',
            {

                id:
                    Number(
                        resourceId
                    ),

                flags:
                    8193
            }
        );

    const item =
        result.data?.item ||
        result.data;

    console.log(
        'Resource returned:',
        !!item
    );

    if (
        !item ||
        typeof item !== 'object'
    ) {

        return {

            templates:
                [],

            sid:
                result.sid,

            temporarySid:
                result.temporarySid
        };
    }

    console.log(
        'Resource name:',
        item.nm
    );

    console.log(
        'Resource ID:',
        item.id
    );

    const templates =
        extractTemplatesFromResources(
            [item]
        );

    console.log(
        '✅ Direct resource templates:',
        templates.length
    );

    return {

        templates,

        sid:
            result.sid,

        temporarySid:
            result.temporarySid
    };
}


// =====================================================
// LIST REPORT TEMPLATES
// =====================================================

async function listReportTemplates(
    sid
) {

    console.log('\n========================================');
    console.log('📊 WIALON REPORT TEMPLATE DISCOVERY');
    console.log('========================================');

    if (!sid) {

        throw new Error(
            'Cannot discover report templates: Wialon SID is missing'
        );
    }

    let activeSid =
        sid;

    let temporarySid =
        false;

    try {

        // =================================================
        // OPTIONAL DIRECT RESOURCE
        // =================================================
        //
        // Normally NOT required.
        //
        // Automatic discovery is preferred.
        //
        // =================================================

        const configuredResourceId =
            process.env.WIALON_RESOURCE_ID
                ? Number(
                    process.env.WIALON_RESOURCE_ID
                )
                : null;

        if (
            configuredResourceId &&
            Number.isFinite(
                configuredResourceId
            )
        ) {

            console.log(
                '🎯 WIALON_RESOURCE_ID detected:',
                configuredResourceId
            );

            const direct =
                await getResourceDirectly(
                    activeSid,
                    configuredResourceId
                );

            activeSid =
                direct.sid;

            temporarySid =
                direct.temporarySid;

            if (
                direct.templates.length > 0
            ) {

                console.log(
                    '✅ REPORT TEMPLATES FOUND:',
                    direct.templates.length
                );

                return direct.templates;
            }

            console.warn(
                '⚠️ Configured resource has no report templates.'
            );

            console.warn(
                '🔄 Falling back to automatic discovery...'
            );
        }

        // =================================================
        // AUTO DISCOVERY
        // =================================================

        const discovered =
            await discoverReportResources(
                activeSid
            );

        activeSid =
            discovered.sid;

        temporarySid =
            discovered.temporarySid;

        if (
            discovered.templates.length === 0
        ) {

            console.warn('\n========================================');
            console.warn(
                '⚠️ NO REPORT TEMPLATES FOUND'
            );
            console.warn('========================================');

            console.warn(
                'Resources were found, but no report templates were returned.'
            );

            console.warn(
                'The resource-detail fallback was also unable to find templates.'
            );

            console.warn(
                'This usually means the Wialon user/token does not have report-template access.'
            );
        } else {

            console.log('\n========================================');
            console.log(
                '✅ REPORT TEMPLATES FOUND:',
                discovered.templates.length
            );
            console.log('========================================');

            for (
                const template
                of discovered.templates
            ) {

                console.log(
                    `📊 ${template.resourceName} | ` +
                    `${template.templateId} | ` +
                    `${template.name}`
                );
            }
        }

        return discovered.templates;

    } finally {

        if (
            temporarySid
        ) {

            await safeWialonLogout(
                activeSid
            );
        }
    }
}


// =====================================================
// EXECUTE REPORT FOR ONE UNIT
// =====================================================

async function execReportForUnit(
    sid,
    resourceId,
    templateId,
    unitId,
    interval
) {

    console.log('\n========================================');
    console.log('📊 EXECUTING WIALON REPORT');
    console.log('========================================');

    console.log(
        'Resource ID:',
        resourceId
    );

    console.log(
        'Template ID:',
        templateId
    );

    console.log(
        'Unit ID:',
        unitId
    );

    console.log(
        'Interval:',
        interval
    );

    const execParams = {

        reportResourceId:
            Number(
                resourceId
            ),

        reportTemplateId:
            Number(
                templateId
            ),

        reportObjectId:
            Number(
                unitId
            ),

        reportObjectSecId:
            0,

        interval: {

            from:
                Number(
                    interval.from
                ),

            to:
                Number(
                    interval.to
                ),

            flags:
                0
        }
    };

    let activeSid =
        sid;

    let temporarySid =
        false;

    try {

        // =================================================
        // EXEC REPORT
        // =================================================

        const execResult =
            await requestWithSidRetry(
                activeSid,
                'report/exec_report',
                execParams
            );

        activeSid =
            execResult.sid;

        temporarySid =
            execResult.temporarySid;

        console.log(
            '✅ report/exec_report succeeded'
        );

        const tableDefs =
            (
                execResult.data &&
                execResult.data.reportResult &&
                Array.isArray(
                    execResult.data.reportResult.tables
                )
            )
                ? execResult.data.reportResult.tables
                : [];

        console.log(
            '📊 Number of report tables:',
            tableDefs.length
        );

        const tables =
            [];

        // =================================================
        // SELECT RESULT ROWS
        // =================================================

        for (
            let tableIndex = 0;
            tableIndex < tableDefs.length;
            tableIndex++
        ) {

            const def =
                tableDefs[
                    tableIndex
                ];

            const rowCount =
                Number(
                    def?.rows || 0
                );

            console.log(
                `📄 Table ${tableIndex}:`,
                def?.label ||
                def?.name ||
                `Table ${tableIndex}`
            );

            console.log(
                'Rows:',
                rowCount
            );

            if (
                rowCount === 0
            ) {

                tables.push({

                    name:
                        def?.label ||
                        def?.name ||
                        `Table ${tableIndex}`,

                    headers:
                        Array.isArray(
                            def?.header
                        )
                            ? def.header
                            : [],

                    rows:
                        []
                });

                continue;
            }

            try {

                const rowsResult =
                    await requestWithSidRetry(
                        activeSid,
                        'report/select_result_rows',
                        {

                            tableIndex,

                            config: {

                                type:
                                    'range',

                                data: {

                                    from:
                                        0,

                                    to:
                                        rowCount - 1,

                                    level:
                                        0
                                }
                            }
                        }
                    );

                activeSid =
                    rowsResult.sid;

                if (
                    rowsResult.temporarySid
                ) {

                    temporarySid =
                        true;
                }

                const rowsData =
                    rowsResult.data;

                const rows =
                    Array.isArray(
                        rowsData
                    )
                        ? rowsData.map(
                            row => {

                                const cells =
                                    Array.isArray(
                                        row?.c
                                    )
                                        ? row.c
                                        : [];

                                return cells.map(
                                    cell => {

                                        if (
                                            cell &&
                                            typeof cell === 'object'
                                        ) {

                                            if (
                                                Object.prototype.hasOwnProperty.call(
                                                    cell,
                                                    'v'
                                                )
                                            ) {

                                                return cell.v;
                                            }

                                            if (
                                                Object.prototype.hasOwnProperty.call(
                                                    cell,
                                                    't'
                                                )
                                            ) {

                                                return cell.t;
                                            }
                                        }

                                        return cell;
                                    }
                                );
                            }
                        )
                        : [];

                tables.push({

                    name:
                        def?.label ||
                        def?.name ||
                        `Table ${tableIndex}`,

                    headers:
                        Array.isArray(
                            def?.header
                        )
                            ? def.header
                            : [],

                    rows
                });

                console.log(
                    `✅ Loaded ${rows.length} row(s)`
                );

            } catch (error) {

                console.error(
                    `❌ Failed to load table ${tableIndex}:`,
                    error.message
                );

                tables.push({

                    name:
                        def?.label ||
                        def?.name ||
                        `Table ${tableIndex}`,

                    headers:
                        Array.isArray(
                            def?.header
                        )
                            ? def.header
                            : [],

                    rows:
                        [],

                    error:
                        error.message
                });
            }
        }

        // =================================================
        // CLEANUP
        // =================================================

        try {

            await wialonRequest(
                activeSid,
                'report/cleanup_result',
                {}
            );

            console.log(
                '✅ report/cleanup_result successful'
            );

        } catch (error) {

            console.warn(
                '⚠️ Report cleanup failed:',
                error.message
            );
        }

        return {

            unitId,

            tables
        };

    } finally {

        if (
            temporarySid
        ) {

            await safeWialonLogout(
                activeSid
            );
        }
    }
}


// =====================================================
// RUN REPORT
// =====================================================

async function runReport({
    templateId,
    resourceId,
    units,
    interval,
    sessionUser
}) {

    console.log('\n========================================');
    console.log('📊 WIALON RUN REPORT');
    console.log('========================================');

    if (!templateId) {

        throw new Error(
            'templateId is required.'
        );
    }

    if (
        !Array.isArray(units) ||
        units.length === 0
    ) {

        throw new Error(
            'At least one Wialon unit is required.'
        );
    }

    if (
        !interval ||
        typeof interval.from !== 'number' ||
        typeof interval.to !== 'number'
    ) {

        throw new Error(
            'A valid interval { from, to } is required.'
        );
    }

    const effectiveResourceId =
        resourceId ||
        (
            process.env.WIALON_RESOURCE_ID
                ? Number(
                    process.env.WIALON_RESOURCE_ID
                )
                : null
        );

    if (
        !effectiveResourceId
    ) {

        throw new Error(
            'No Wialon resourceId was supplied. ' +
            'The selected report template must provide its resourceId.'
        );
    }

    console.log(
        'Resource ID:',
        effectiveResourceId
    );

    console.log(
        'Template ID:',
        templateId
    );

    console.log(
        'Units:',
        units.length
    );

    console.log(
        'Interval:',
        interval
    );

    let sid =
        null;

    let ownedByUs =
        false;

    const results =
        [];

    try {

        const resolved =
            await resolveSid(
                sessionUser
            );

        sid =
            resolved.sid;

        ownedByUs =
            resolved.ownedByUs;

        console.log(
            '✅ SID resolved'
        );

        // =================================================
        // RUN EACH UNIT
        // =================================================

        for (
            const unit
            of units
        ) {

            console.log(
                '\n----------------------------------------'
            );

            console.log(
                '🚚 Running report for:',
                unit.name
            );

            console.log(
                'Unit ID:',
                unit.id
            );

            const runResult =
                await execReportForUnit(
                    sid,
                    effectiveResourceId,
                    templateId,
                    unit.id,
                    interval
                );

            results.push({

                unitId:
                    unit.id,

                unitName:
                    unit.name,

                tables:
                    runResult.tables,

                warning:
                    runResult.warning ||
                    null
            });
        }

        console.log(
            '\n========================================'
        );

        console.log(
            '✅ WIALON REPORT RUN COMPLETE'
        );

        console.log(
            '========================================'
        );

        console.log(
            'Units processed:',
            results.length
        );

        return results;

    } finally {

        if (
            sid &&
            ownedByUs
        ) {

            try {

                await wialonLogout(
                    sid
                );

                console.log(
                    '✅ Wialon logout successful'
                );

            } catch (error) {

                console.warn(
                    '⚠️ Wialon logout failed:',
                    error.message
                );
            }
        }
    }
}


// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    listReportTemplates,

    runReport,

    resolveSid
};

