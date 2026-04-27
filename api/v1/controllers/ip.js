const { dbGet, dbRun, dbGetAll } = require("@modules/database");
const { settings } = require("@modules/config");
const { SCOPES } = require("@modules/permissions");
const { getIpAccess, getIpAccessPaginated } = require("@services/ip-service");
const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const authentication = require("@middleware/authentication");
const fs = require("fs");
const net = require("net");
const { buildPagination, parsePaginationQuery } = require("@modules/pagination");
const ValidationError = require("@errors/validation-error");
const ConflictError = require("@errors/conflict-error");

const DEFAULT_IP_LIMIT = 20;
const MAX_IP_LIMIT = 100;

/**
 * Validate an IP address or CIDR range.
 * @param {string} ip - IP address or CIDR range.
 * @returns {boolean}
 */
function validateIp(ip) {
    const cidrMatch = ip.match(/^(.+)\/(\d+)$/);
    if (cidrMatch) {
        const [, addr, prefixStr] = cidrMatch;
        const ipVersion = net.isIP(addr);
        if (!ipVersion) return false;
        const prefix = Number(prefixStr);
        const maxPrefix = ipVersion === 4 ? 32 : 128;
        return prefix >= 0 && prefix <= maxPrefix;
    }
    return net.isIP(ip) !== 0;
}

/**
 * Register ip controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/ip/{type}:
     *   get:
     *     summary: Get IP access list
     *     tags:
     *       - IP Management
     *     description: |
     *       Retrieves the IP whitelist or blacklist with pagination.
     *
     *       **Required Permission:** Global Manager permission (level 5)
     *
     *       **Permission Levels:**
     *       - 1: Guest
     *       - 2: Student
     *       - 3: Moderator
     *       - 4: Teacher
     *       - 5: Manager
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: type
     *         required: true
     *         schema:
     *           type: string
     *           enum: [whitelist, blacklist]
     *         description: Type of IP list
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: integer
     *           default: 20
     *           minimum: 1
     *           maximum: 100
     *         description: Number of IPs to return per page
     *       - in: query
     *         name: offset
     *         required: false
     *         schema:
     *           type: integer
     *           default: 0
     *           minimum: 0
     *         description: Number of IPs to skip before returning results
     *     responses:
     *       200:
     *         description: IP list retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 active:
     *                   type: boolean
     *                 ips:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: integer
     *                       ip:
     *                         type: string
     *                 pagination:
     *                   type: object
     *                   properties:
     *                     total:
     *                       type: integer
     *                     limit:
     *                       type: integer
     *                     offset:
     *                       type: integer
     *                     hasMore:
     *                       type: boolean
     *       400:
     *         description: Invalid type
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    // List IPs
    router.get("/ip/:type", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), async (req, res) => {
        const ipMode = req.params.type;
        req.infoEvent("ip.list.view.attempt", "Attempting to view IP access list", { listType: ipMode });
        if (ipMode !== "whitelist" && ipMode !== "blacklist") {
            throw new ValidationError("Invalid type");
        }

        const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_IP_LIMIT, MAX_IP_LIMIT);
        const { ips, total } = await getIpAccessPaginated(ipMode, limit, offset);
        req.infoEvent("ip.list.view.success", "IP access list returned", { listType: ipMode, count: (ips || []).length });
        res.status(200).json({
            success: true,
            data: {
                active: settings[`${ipMode}Active`],
                ips: ips || [],
                pagination: buildPagination(total, limit, offset, (ips || []).length),
            },
        });
    });

    /**
     * @swagger
     * /api/v1/ip/{type}:
     *   post:
     *     summary: Add IP to access list
     *     tags:
     *       - IP Management
     *     description: |
     *       Adds an IP address to the whitelist or blacklist.
     *
     *       **Required Permission:** Global System Admin permission (level 5)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: type
     *         required: true
     *         schema:
     *           type: string
     *           enum: [whitelist, blacklist]
     *         description: Type of IP list
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - ip
     *             properties:
     *               ip:
     *                 type: string
     *                 example: "192.168.1.1"
     *     responses:
     *       201:
     *         description: IP added successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 data:
     *                   type: object
     *                   properties:
     *                     ok:
     *                       type: boolean
     *                       example: true
     *       400:
     *         description: Invalid type or missing IP
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       409:
     *         description: IP already exists in the list
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/ip/:type", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), async (req, res) => {
        const type = req.params.type;
        const { ip } = req.body || {};
        req.infoEvent("ip.list.add.attempt", "Attempting to add IP to access list", { listType: type });
        if (type !== "whitelist" && type !== "blacklist") {
            throw new ValidationError("Invalid type");
        }

        if (!ip) {
            throw new ValidationError("Missing ip");
        }

        if (!validateIp(ip)) {
            throw new ValidationError("Invalid IP format");
        }

        const isWhitelist = type === "whitelist" ? 1 : 0;

        // Check if the IP already exists
        const exists = await dbGet(`SELECT 1 AS one FROM ip_access_list WHERE ip=? AND is_whitelist=?`, [ip, isWhitelist]);
        if (exists && exists.one) {
            throw new ConflictError("IP already exists");
        }

        // Insert the IP into the database
        await dbRun(`INSERT INTO ip_access_list (ip, is_whitelist) VALUES(?, ?)`, [ip, isWhitelist]);
        const cache = await getIpAccess(type);
        if (type === "whitelist") {
            Object.keys(authentication.whitelistedIps).forEach((k) => delete authentication.whitelistedIps[k]);
            Object.assign(authentication.whitelistedIps, cache);
        } else {
            Object.keys(authentication.blacklistedIps).forEach((k) => delete authentication.blacklistedIps[k]);
            Object.assign(authentication.blacklistedIps, cache);
        }
        req.infoEvent("ip.list.add.success", "IP added to access list", { listType: type });
        res.status(201).json({
            success: true,
            data: {
                ok: true,
            },
        });
    });

    /**
     * @swagger
     * /api/v1/ip/{type}/{id}:
     *   put:
     *     summary: Update IP in access list
     *     tags:
     *       - IP Management
     *     description: |
     *       Updates an IP address in the whitelist or blacklist.
     *
     *       **Required Permission:** Global Manager permission (level 5)
     *
     *       **Permission Levels:**
     *       - 1: Guest
     *       - 2: Student
     *       - 3: Moderator
     *       - 4: Teacher
     *       - 5: Manager
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: type
     *         required: true
     *         schema:
     *           type: string
     *           enum: [whitelist, blacklist]
     *         description: Type of IP list
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: IP entry ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - ip
     *             properties:
     *               ip:
     *                 type: string
     *                 example: "192.168.1.1"
     *     responses:
     *       200:
     *         description: IP updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Invalid type or missing IP
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    // Update IP
    router.put("/ip/:type/:id", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), async (req, res) => {
        const type = req.params.type;
        const id = req.params.id;
        const { ip } = req.body || {};
        req.infoEvent("ip.list.update.attempt", "Attempting to update IP in access list", { listType: type, ipEntryId: id });
        if (!ip) {
            throw new ValidationError("Missing ip");
        }
        if (type !== "whitelist" && type !== "blacklist") {
            throw new ValidationError("Invalid type");
        }

        if (!validateIp(ip)) {
            throw new ValidationError("Invalid IP format");
        }

        const isWhitelist = type === "whitelist" ? 1 : 0;
        await dbRun(`UPDATE ip_access_list SET ip=? WHERE id=? AND is_whitelist=?`, [ip, id, isWhitelist]);
        const cache = await getIpAccess(type);
        if (type === "whitelist") {
            Object.keys(authentication.whitelistedIps).forEach((key) => delete authentication.whitelistedIps[key]);
            Object.assign(authentication.whitelistedIps, cache);
        } else {
            Object.keys(authentication.blacklistedIps).forEach((k) => delete authentication.blacklistedIps[k]);
            Object.assign(authentication.blacklistedIps, cache);
        }
        req.infoEvent("ip.list.update.success", "IP updated in access list", { listType: type, ipEntryId: id });
        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    });

    /**
     * @swagger
     * /api/v1/ip/{type}/{id}:
     *   delete:
     *     summary: Remove IP from access list
     *     tags:
     *       - IP Management
     *     description: |
     *       Removes an IP address from whitelist or blacklist.
     *
     *       **Required Permission:** Global Manager permission (level 5)
     *
     *       **Permission Levels:**
     *       - 1: Guest
     *       - 2: Student
     *       - 3: Moderator
     *       - 4: Teacher
     *       - 5: Manager
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: type
     *         required: true
     *         schema:
     *           type: string
     *           enum: [whitelist, blacklist]
     *         description: Type of IP list
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: IP entry ID
     *     responses:
     *       200:
     *         description: IP removed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Invalid type
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.delete("/ip/:type/:id", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), async (req, res) => {
        const type = req.params.type;
        const id = req.params.id;
        req.infoEvent("ip.list.remove.attempt", "Attempting to remove IP from access list", { listType: type, ipEntryId: id });
        if (type !== "whitelist" && type !== "blacklist") {
            throw new ValidationError("Invalid type");
        }

        const isWhitelist = type === "whitelist" ? 1 : 0;
        await dbRun(`DELETE FROM ip_access_list WHERE id=? AND is_whitelist=?`, [id, isWhitelist]);
        const cache = await getIpAccess(type);
        if (type === "whitelist") {
            Object.keys(authentication.whitelistedIps).forEach((k) => delete authentication.whitelistedIps[k]);
            Object.assign(authentication.whitelistedIps, cache);
        } else {
            Object.keys(authentication.blacklistedIps).forEach((k) => delete authentication.blacklistedIps[k]);
            Object.assign(authentication.blacklistedIps, cache);
        }
        req.infoEvent("ip.list.remove.success", "IP removed from access list", { listType: type, ipEntryId: id });
        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    });

    /**
     * @swagger
     * /api/v1/ip/{type}/toggle:
     *   post:
     *     summary: Toggle IP access list
     *     tags:
     *       - IP Management
     *     description: |
     *       Toggles the IP whitelist or blacklist on/off. Only one can be active at a time.
     *
     *       **Required Permission:** Global Manager permission (level 5)
     *
     *       **Permission Levels:**
     *       - 1: Guest
     *       - 2: Student
     *       - 3: Moderator
     *       - 4: Teacher
     *       - 5: Manager
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: type
     *         required: true
     *         schema:
     *           type: string
     *           enum: [whitelist, blacklist]
     *         description: Type of IP list to toggle
     *     responses:
     *       200:
     *         description: IP list toggled successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                   example: true
     *                 active:
     *                   type: boolean
     *                   description: Whether the specified type is now active
     *                 otherDisabled:
     *                   type: boolean
     *                   description: Whether the other type is disabled
     *       400:
     *         description: Invalid type
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    // Toggle ip whitelist/blacklist
    router.post("/ip/:type/toggle", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), (req, res) => {
        const type = req.params.type;
        req.infoEvent("ip.list.toggle.attempt", "Attempting to toggle IP access list", { listType: type });
        if (type !== "whitelist" && type !== "blacklist") {
            throw new ValidationError("Invalid type");
        }

        // Toggle the ip mode
        // If one is already enabled, then disable the other
        const otherType = type === "whitelist" ? "blacklist" : "whitelist";
        settings[`${type}Active`] = !settings[`${type}Active`];
        if (settings[`${type}Active`]) {
            settings[`${otherType}Active`] = false;
        }

        // Update the .env with the new settings
        const env = fs.readFileSync("./.env", "utf8");
        const whitelistEnabled = `${type.toUpperCase()}_ENABLED`;
        const blacklistEnabled = `${otherType.toUpperCase()}_ENABLED`;
        let updatedIpMode = env
            .replace(new RegExp(`${whitelistEnabled}='(true|false)'`), `${whitelistEnabled}='${settings[`${type}Active`]}'`)
            .replace(new RegExp(`${blacklistEnabled}='(true|false)'`), `${blacklistEnabled}='${settings[`${otherType}Active`]}'`);

        if (updatedIpMode === env) {
            // If keys not present, append them
            const lines = [`${whitelistEnabled}='${settings[`${type}Active`]}'`, `${blacklistEnabled}='${settings[`${otherType}Active`]}'`];
            updatedIpMode = env.trimEnd() + "\n" + lines.join("\n") + "\n";
        }

        fs.writeFileSync("./.env", updatedIpMode);
        req.infoEvent("ip.list.toggle.success", "IP access list toggled", { listType: type, active: settings[`${type}Active`] });
        res.status(200).json({
            success: true,
            data: {
                ok: true,
                active: settings[`${type}Active`],
                otherDisabled: !settings[`${otherType}Active`],
            },
        });
    });
};
