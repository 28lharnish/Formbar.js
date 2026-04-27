const { dbGet, dbGetAll } = require("@modules/database");
const { getUserOwnedClasses } = require("@services/user-service");
const { getUserJoinedClasses } = require("@services/class-service");
const { isSelfOrHasScope } = require("@middleware/permission-check");
const { SCOPES, computeClassPermissionLevel, MANAGER_PERMISSIONS, parseScopesField } = require("@modules/permissions");
const { isAuthenticated } = require("@middleware/authentication");
const { buildPagination, parsePaginationQuery } = require("@modules/pagination");
const NotFoundError = require("@errors/not-found-error");

const DEFAULT_CLASS_LIMIT = 20;
const MAX_CLASS_LIMIT = 100;

/**
 * Register classes controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/classes:
     *   get:
     *     summary: Get all classes associated with a user
     *     tags:
     *       - Users
     *     description: Returns a list of all classes the user is associated with (owned or joined), with each class indicating whether the user is the owner
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user
     *         schema:
     *           type: string
     *           example: "1"
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: integer
     *           default: 20
     *           minimum: 1
     *           maximum: 100
     *         description: Number of classes to return per page
     *       - in: query
     *         name: offset
     *         required: false
     *         schema:
     *           type: integer
     *           default: 0
     *           minimum: 0
     *         description: Number of classes to skip before returning results
     *     responses:
     *       200:
     *         description: List of classes retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     classes:
     *                       type: array
     *                       items:
     *                         type: object
     *                         properties:
     *                           id:
     *                             type: number
     *                           name:
     *                             type: string
     *                           key:
     *                             type: string
     *                           owner:
     *                             type: number
     *                           isOwner:
     *                             type: boolean
     *                           permissions:
     *                             type: number
     *                           classPermissions:
     *                             type: number
     *                     pagination:
     *                       type: object
     *                       properties:
     *                         total:
     *                           type: integer
     *                         limit:
     *                           type: integer
     *                         offset:
     *                           type: integer
     *                         hasMore:
     *                           type: boolean
     *       404:
     *         description: User not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get(
        "/user/:id/classes",
        isAuthenticated,
        isSelfOrHasScope(SCOPES.GLOBAL.USERS.MANAGE, "Not authorized to view this user's classes."),
        async (req, res) => {
            const userId = req.params.id;
            req.infoEvent("user.classes.view.attempt", "Attempting to view user classes", { targetUserId: userId });
            const user = await dbGet("SELECT * FROM users WHERE id = ?", [userId]);
            if (!user) {
                throw new NotFoundError("User not found");
            }

            // Get owned classes
            const ownedClasses = await getUserOwnedClasses(user.email, req.user);

            // Get joined classes and filter out banned users
            let joinedClasses = await getUserJoinedClasses(userId);

            const classRoleRows = joinedClasses.length
                ? await dbGetAll(
                      `SELECT ur.classId, r.scopes FROM user_roles ur
                       JOIN roles r ON ur.roleId = r.id
                       WHERE ur.userId = ? AND ur.classId IS NOT NULL`,
                      [userId]
                  )
                : [];

            const classRolesByClassId = new Map();
            const bannedClassIds = new Set();
            for (const row of classRoleRows) {
                if (!classRolesByClassId.has(row.classId)) {
                    classRolesByClassId.set(row.classId, []);
                }
                classRolesByClassId.get(row.classId).push(row);

                if (parseScopesField(row.scopes).includes(SCOPES.CLASS.SYSTEM.BLOCKED)) {
                    bannedClassIds.add(row.classId);
                }
            }
            joinedClasses = joinedClasses.filter((classroom) => !bannedClassIds.has(classroom.id));

            // Create a map to track classes and combine data
            const classesMap = new Map();

            // Add owned classes first (these are definitely owned)
            for (const ownedClass of ownedClasses) {
                classesMap.set(ownedClass.id, {
                    id: ownedClass.id,
                    name: ownedClass.name,
                    key: ownedClass.key,
                    owner: ownedClass.owner,
                    isOwner: true,
                    permissions: MANAGER_PERMISSIONS,
                    classPermissions: MANAGER_PERMISSIONS,
                    tags: ownedClass.tags,
                });
            }

            // Add joined classes (mark as not owned unless already in map as owned)
            for (const joinedClass of joinedClasses) {
                if (!classesMap.has(joinedClass.id)) {
                    const classRoles = classRolesByClassId.get(joinedClass.id) || [];
                    const classScopes = classRoles.flatMap((role) => parseScopesField(role.scopes));
                    const permissionLevel = computeClassPermissionLevel(classScopes);
                    classesMap.set(joinedClass.id, {
                        id: joinedClass.id,
                        name: joinedClass.name,
                        isOwner: false,
                        permissions: permissionLevel,
                        classPermissions: permissionLevel,
                    });
                }
            }

            // Convert map to array and use a stable order for pagination.
            const allClasses = Array.from(classesMap.values()).sort((a, b) => Number(a.id) - Number(b.id));
            const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_CLASS_LIMIT, MAX_CLASS_LIMIT);
            const classes = allClasses.slice(offset, offset + limit);

            req.infoEvent("user.classes.view.success", "User classes returned", { targetUserId: userId, classCount: classes.length });
            res.status(200).json({
                success: true,
                data: {
                    classes,
                    pagination: buildPagination(allClasses.length, limit, offset, classes.length),
                },
            });
        }
    );
};
