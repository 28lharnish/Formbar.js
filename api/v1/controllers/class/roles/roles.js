const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam, requireBodyParam } = require("@modules/error-wrapper");
const { classStateStore } = require("@services/classroom-service");
const { getClassRoles, createClassRole, updateClassRole, deleteClassRole, getActingUser } = require("@services/role-service");
const { broadcastClassUpdate } = require("@services/class-service");
const NotFoundError = require("@errors/not-found-error");

/**
 * Register roles controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/roles:
     *   get:
     *     summary: List roles for a class
     *     tags:
     *       - Class Roles
     *     description: |
     *       Returns all roles available for the class,
     *       including the scopes assigned to each role.
     *
     *       **Required:** Must be authenticated and a member of the class.
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: The class ID
     *     responses:
     *       200:
     *         description: List of roles
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: integer
     *                       name:
     *                         type: string
     *                       scopes:
     *                         type: array
     *                         items:
     *                           type: string
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       404:
     *         description: Not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get("/class/:id/roles", isAuthenticated, async (req, res) => {
        const classId = req.params.id;
        requireQueryParam(classId, "id");
        req.infoEvent("class.roles.list.start", { classId, actorId: req.user.id });

        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) throw new NotFoundError("Class not found.");

        const { id: userId, email } = req.user;
        if (!classroom.students[email] && classroom.owner !== userId && classroom.owner !== email) {
            throw new NotFoundError("Class not found.");
        }

        const roles = await getClassRoles(classId);
        req.infoEvent("class.roles.list.success", { classId, actorId: req.user.id, roleCount: roles.length });
        res.status(200).json({ success: true, data: roles });
    });

    /**
     * @swagger
     * /api/v1/class/{id}/roles:
     *   post:
     *     summary: Create a custom role
     *     tags:
     *       - Class Roles
     *     description: |
     *       Creates a new custom role for the class with the specified scopes.
     *       You can only grant scopes you possess yourself (no privilege escalation).
     *
     *       **Required scope:** `class.session.settings`
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: The class ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - scopes
     *             properties:
     *               name:
     *                 type: string
     *                 example: CustomMod
     *               scopes:
     *                 type: array
     *                 items:
     *                   type: string
     *                 example: ["class.poll.create", "class.poll.end"]
     *               color:
     *                 type: string
     *                 example: "#123456"
     *     responses:
     *       201:
     *         description: Role created
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   type: object
     *                   properties:
     *                     id:
     *                       type: integer
     *                     name:
     *                       type: string
     *                     scopes:
     *                       type: array
     *                       items:
     *                         type: string
     *                     color:
     *                       type: string
     *       400:
     *         description: Invalid parameters
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
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
    router.post("/class/:id/roles", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.SETTINGS), async (req, res) => {
        const classId = req.params.id;
        requireQueryParam(classId, "id");

        const { name, scopes, color } = req.body;
        requireBodyParam(name, "name");
        requireBodyParam(scopes, "scopes");
        req.infoEvent("class.roles.create.start", { classId, actorId: req.user.id, roleName: name });

        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) throw new NotFoundError("Class not found.");
        const actingClassUser = getActingUser(classroom, req.user);

        const role = await createClassRole({ classId, name, scopes, actingClassUser, classroom, color });
        await broadcastClassUpdate(classId);
        req.infoEvent("class.roles.create.success", { classId, actorId: req.user.id, roleId: role.id, roleName: role.name });
        res.status(201).json({ success: true, data: role });
    });

    /**
     * @swagger
     * /api/v1/class/{id}/roles/{roleId}:
     *   patch:
     *     summary: Update a role
     *     tags:
     *       - Class Roles
     *     description: |
     *       Updates the name and/or scopes of a role.
     *       You can only grant scopes you possess yourself.
     *
     *       **Required scope:** `class.session.settings`
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: The class ID
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The role ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name:
     *                 type: string
     *               scopes:
     *                 type: array
     *                 items:
     *                   type: string
     *               color:
     *                 type: string
     *                 example: "#123456"
     *     responses:
     *       200:
     *         description: Role updated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   type: object
     *                   properties:
     *                     id:
     *                       type: integer
     *                     name:
     *                       type: string
     *                     scopes:
     *                       type: array
     *                       items:
     *                         type: string
     *                     color:
     *                       type: string
     *       400:
     *         description: Invalid parameters
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
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
     *       404:
     *         description: Not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.patch("/class/:id/roles/:roleId", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.SETTINGS), async (req, res) => {
        const { id: classId, roleId } = req.params;
        requireQueryParam(classId, "id");
        requireQueryParam(roleId, "roleId");
        req.infoEvent("class.roles.update.start", { classId, roleId, actorId: req.user.id });

        const updates = req.body;
        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) throw new NotFoundError("Class not found.");
        const actingClassUser = getActingUser(classroom, req.user);

        const role = await updateClassRole({
            roleId,
            classId,
            updates,
            actingClassUser,
            classroom,
        });
        await broadcastClassUpdate(classId);
        req.infoEvent("class.roles.update.success", { classId, roleId: role.id, actorId: req.user.id });
        res.status(200).json({ success: true, data: role });
    });

    /**
     * @swagger
     * /api/v1/class/{id}/roles/{roleId}:
     *   delete:
     *     summary: Delete a role
     *     tags:
     *       - Class Roles
     *     description: |
     *       Deletes a role. Students assigned to this role are
     *       reassigned to the Guest role.
     *
     *       **Required scope:** `class.session.settings`
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: The class ID
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The role ID
     *     responses:
     *       200:
     *         description: Role deleted
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
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
     *       404:
     *         description: Not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.delete("/class/:id/roles/:roleId", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.SETTINGS), async (req, res) => {
        const { id: classId, roleId } = req.params;
        requireQueryParam(classId, "id");
        requireQueryParam(roleId, "roleId");
        req.infoEvent("class.roles.delete.start", { classId, roleId, actorId: req.user.id });

        await deleteClassRole(roleId, classId);
        await broadcastClassUpdate(classId);
        req.infoEvent("class.roles.delete.success", { classId, roleId, actorId: req.user.id });
        res.status(200).json({ success: true, data: { message: "Role deleted." } });
    });
};
