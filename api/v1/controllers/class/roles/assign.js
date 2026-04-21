const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope, normalizeClassId } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam, requireBodyParam } = require("@modules/error-wrapper");
const { classStateStore } = require("@services/classroom-service");
const { addStudentRole, removeStudentRole, getStudentRoleAssignments, getActingUser } = require("@services/role-service");
const { broadcastClassUpdate } = require("@services/class-service");
const NotFoundError = require("@errors/not-found-error");

/**
 * * Register assign controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/roles:
     *   get:
     *     summary: List roles assigned to a student
     *     tags:
     *       - Class Roles
     *     description: |
     *       Returns all roles currently assigned to a student in the class.
     *       Guest is implicit and not included in the list.
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
     *       - in: path
     *         name: userId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The student's user ID
     *     responses:
     *       200:
     *         description: List of assigned roles
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   type: object
     *                   properties:
     *                     roles:
     *                       type: array
     *                       items:
     *                         type: object
     *                         properties:
     *                           id:
     *                             type: integer
     *                           name:
     *                             type: string
     *                           scopes:
     *                             type: array
     *                             items:
     *                               type: string
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
    router.get("/class/:id/students/:userId/roles", isAuthenticated, async (req, res) => {
        const { id: classIdRaw, userId } = req.params;
        const classId = normalizeClassId(classIdRaw);
        requireQueryParam(classIdRaw, "id");
        requireQueryParam(userId, "userId");
        req.infoEvent("class.roles.student.list.start", { classId, userId, actorId: req.user.id });

        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) throw new NotFoundError("Class not found.");

        const email = req.user.email;
        if (!classroom.students[email] && classroom.owner !== req.user.id) {
            throw new NotFoundError("Class not found.");
        }

        const roles = await getStudentRoleAssignments(classId, userId);
        req.infoEvent("class.roles.student.list.success", { classId, userId, actorId: req.user.id, roleCount: roles.length });
        res.status(200).json({ success: true, data: { roles } });
    });

    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/roles/:roleId:
     *   post:
     *     summary: Add a role to a student
     *     tags:
     *       - Class Roles
     *     description: |
     *       Adds a role to a student in the class. Students can have multiple roles
     *       simultaneously. Effective scopes are the union of all assigned roles.
     *       Guest is implicit and cannot be added.
     *
     *       **Required scope:** `class.students.perm_change`
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
     *         name: userId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The student's user ID
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The id of the role to give to the student.
     *     responses:
     *       200:
     *         description: Role added
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
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
    router.post("/class/:id/students/:userId/roles/:roleId", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.PERM_CHANGE), async (req, res) => {
        const { id: classIdRaw, userId, roleId } = req.params;
        requireQueryParam(classIdRaw, "id");
        requireQueryParam(userId, "userId");
        requireQueryParam(roleId, "roleId");
        const classId = normalizeClassId(classIdRaw);
        req.infoEvent("class.roles.student.add.start", { classId, userId, roleId, actorId: req.user.id });
        const classroom = classStateStore.getClassroom(classId);
        const actingClassUser = getActingUser(classroom, req.user);

        await addStudentRole(classId, userId, Number(roleId), actingClassUser, classroom);
        await broadcastClassUpdate(classId);
        req.infoEvent("class.roles.student.add.success", { classId, userId, roleId, actorId: req.user.id });
        res.status(200).json({ success: true, data: { message: "Role added." } });
    });

    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/roles/{roleId}:
     *   delete:
     *     summary: Remove a role from a student
     *     tags:
     *       - Class Roles
     *     description: |
     *       Removes a role from a student in the class. Guest is implicit
     *       and cannot be removed. If all roles are removed, the student
     *       effectively has only Guest permissions.
     *
     *       **Required scope:** `class.students.perm_change`
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
     *         name: userId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The student's user ID
     *       - in: path
     *         name: roleId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The role ID to remove
     *     responses:
     *       200:
     *         description: Role removed
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
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
    router.delete(
        "/class/:id/students/:userId/roles/:roleId",
        isAuthenticated,
        hasClassScope(SCOPES.CLASS.STUDENTS.PERM_CHANGE),
        async (req, res) => {
            const { id: classIdRaw, userId, roleId } = req.params;
            requireQueryParam(classIdRaw, "id");
            requireQueryParam(userId, "userId");
            requireQueryParam(roleId, "roleId");
            const classId = normalizeClassId(classIdRaw);
            req.infoEvent("class.roles.student.remove.start", { classId, userId, roleId, actorId: req.user.id });
            await removeStudentRole(classId, userId, Number(roleId));
            await broadcastClassUpdate(classId);
            req.infoEvent("class.roles.student.remove.success", { classId, userId, roleId, actorId: req.user.id });
            res.status(200).json({ success: true, data: { message: "Role removed." } });
        }
    );
};
