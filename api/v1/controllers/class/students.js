const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { classStateStore } = require("@services/classroom-service");
const { SCOPES, computeClassPermissionLevel } = require("@modules/permissions");
const { getUserScopes } = require("@modules/scope-resolver");
const { dbGetAll } = require("@modules/database");
const { buildPagination, parsePaginationQuery } = require("@modules/pagination");
const NotFoundError = require("@errors/not-found-error");

const DEFAULT_STUDENT_LIMIT = 20;
const MAX_STUDENT_LIMIT = 100;

/**
 * Register students controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/students:
     *   get:
     *     summary: Get students in a class
     *     tags:
     *       - Class
     *     description: |
     *       Returns a paginated list of students enrolled in a class.
     *
     *       **Required Permission:** Class-specific `manageClass` permission (default: Teacher)
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
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Class ID
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: integer
     *           default: 20
     *           minimum: 1
     *           maximum: 100
     *         description: Number of students to return per page
     *       - in: query
     *         name: offset
     *         required: false
     *         schema:
     *           type: integer
     *           default: 0
     *           minimum: 0
     *         description: Number of students to skip before returning results
     *     responses:
     *       200:
     *         description: Students retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 students:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/Student'
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
     *         description: Class not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get("/class/:id/students", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.READ), async (req, res) => {
        // Get the class key from the request parameters and log the request details
        const classId = req.params.id;
        req.infoEvent("class.students.view", "Viewing class students", { classId });

        // Get the students of the class
        // If an error occurs, log the error and return the error
        const classUsers = await dbGetAll(
            "SELECT users.id, users.displayName, users.digipogs FROM users INNER JOIN classUsers ON users.id = classUsers.studentId WHERE classUsers.classId = ?",
            [classId]
        );
        if (classUsers.error) {
            throw new NotFoundError(classUsers, { event: "class.students.error", reason: "retrieval_error" });
        }

        const classroom = classStateStore.getClassroom(classId);
        if (classroom) {
            for (const classUser of classUsers) {
                const studentEntry = Object.values(classroom.students).find((s) => s.id === classUser.id);
                if (studentEntry) {
                    classUser.roles = { global: classUser.roles?.global || [], class: studentEntry.roles?.class || [] };
                    const resolvedScopes = getUserScopes(studentEntry, classroom);
                    classUser.classPermissions = computeClassPermissionLevel(resolvedScopes.class, {
                        isOwner: Boolean(studentEntry.isClassOwner),
                        globalScopes: resolvedScopes.global,
                    });
                }
            }

            for (const [, studentInfo] of Object.entries(classroom.students)) {
                if (studentInfo.isGuest && !classUsers.find((user) => user.id === studentInfo.id)) {
                    classUsers.push({
                        id: studentInfo.id,
                        displayName: studentInfo.displayName || "Guest",
                        roles: { global: [], class: [] },
                        classPermissions: computeClassPermissionLevel(getUserScopes(studentInfo, classroom).class),
                    });
                }
            }
        }

        const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_STUDENT_LIMIT, MAX_STUDENT_LIMIT);
        const students = classUsers.slice(offset, offset + limit);

        // Send the students of the class as a JSON response
        res.status(200).json({
            success: true,
            data: {
                students,
                pagination: buildPagination(classUsers.length, limit, offset, students.length),
            },
        });
    });
};
