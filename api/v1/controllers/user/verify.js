const { dbRun, dbGetAll, dbGet } = require("@modules/database");
const { settings, frontendUrl } = require("@modules/config");
const { SCOPES, MANAGER_PERMISSIONS, STUDENT_PERMISSIONS } = require("@modules/permissions");
const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { classStateStore } = require("@services/classroom-service");
const userService = require("@services/user-service");
const { findRoleByPermissionLevel } = require("@services/role-service");
const jwt = require("jsonwebtoken");
const AppError = require("@errors/app-error");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

/**
 * Register verify controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/verify/request:
     *   post:
     *     summary: Request a verification email
     *     tags:
     *       - Users
     *     description: |
     *       Sends a verification email to the authenticated user's email address.
     *       Users may only request verification for their own account.
     *
     *       **Required Permission:** Authenticated user (own account only)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: The ID of the user requesting verification
     *     responses:
     *       200:
     *         description: Verification email sent or account already verified
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
     *                     message:
     *                       type: string
     *                       example: "Verification email has been sent."
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Cannot request verification for another user's account
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       503:
     *         description: Email service is not enabled
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/user/:id/verify/request", isAuthenticated, async (req, res) => {
        const targetUserId = String(req.params.id);
        if (String(req.user.id) !== targetUserId) {
            throw new ForbiddenError("You may only request verification for your own account.", {
                event: "user.verify.request.failed",
                reason: "forbidden",
            });
        }

        if (!settings.emailEnabled) {
            throw new AppError("Email service is not enabled. Verification emails are unavailable at this time.", {
                statusCode: 503,
                event: "user.verify.request.failed",
                reason: "email_disabled",
            });
        }

        const apiBaseUrl = `${req.protocol}://${req.get("host")}`;
        req.infoEvent("user.verify.request.attempt", "Attempting to request verification email", { targetUserId });

        const result = await userService.requestVerificationEmail(targetUserId, apiBaseUrl);

        req.infoEvent("user.verify.request.success", "Verification email request processed", {
            targetUserId,
            alreadyVerified: result.alreadyVerified,
        });

        res.status(200).json({
            success: true,
            data: {
                message: result.alreadyVerified ? "Your account is already verified." : "Verification email has been sent.",
            },
        });
    });

    /**
     * @swagger
     * /api/v1/user/verify/email:
     *   get:
     *     summary: Verify email via verification code
     *     tags:
     *       - Users
     *     description: |
     *       Verifies a user's email address using the code sent in the verification email.
     *       If the request accepts HTML and a frontend URL is configured, the user is
     *       redirected to the login page. Otherwise, a JSON response is returned.
     *     parameters:
     *       - in: query
     *         name: code
     *         required: true
     *         schema:
     *           type: string
     *         description: The verification code from the email
     *     responses:
     *       200:
     *         description: Email verified successfully (JSON response)
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
     *                     message:
     *                       type: string
     *                       example: "User has been verified successfully."
     *       302:
     *         description: Redirects to frontend login page (when request accepts HTML)
     *       400:
     *         description: Missing verification code
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.get("/user/verify/email", async (req, res) => {
        const code = typeof req.query.code === "string" ? req.query.code : "";
        if (!code) {
            throw new ValidationError("Verification code is required.", {
                event: "user.verify.email.failed",
                reason: "missing_code",
            });
        }

        req.infoEvent("user.verify.email.attempt", "Attempting to verify account via email token");
        const result = await userService.verifyEmailFromCode(code);

        req.infoEvent("user.verify.email.success", "Account verified via email token", {
            userId: result.userId,
            alreadyVerified: result.alreadyVerified,
        });

        const acceptsHtml = String(req.headers.accept || "").includes("text/html");
        if (acceptsHtml && frontendUrl) {
            return res.redirect(`${frontendUrl}/login?verified=true`);
        }

        return res.status(200).json({
            success: true,
            data: {
                message: result.alreadyVerified ? "User is already verified." : "User has been verified successfully.",
            },
        });
    });

    /**
     * Handle the verify user request.
     * @param {import("express").Request} req - req.
     * @param {import("express").Response} res - res.
     * @returns {Promise<void>}
     */
    const verifyUserHandler = async (req, res) => {
        const id = req.params.id;
        req.infoEvent("user.verify.attempt", "Attempting to verify user", { pendingUserId: id });

        const existingUser = await dbGet("SELECT id, email, verified FROM users WHERE id = ?", [id]);
        if (existingUser) {
            if (!existingUser.verified) {
                await dbRun("UPDATE users SET verified = 1 WHERE id = ?", [id]);
                if (classStateStore.getUser(existingUser.email)) {
                    classStateStore.updateUser(existingUser.email, { verified: 1 });
                }
            }

            req.infoEvent("user.verify.success", "User verified successfully", {
                userId: existingUser.id,
                alreadyVerified: !!existingUser.verified,
            });
            res.status(200).json({
                success: true,
                data: {
                    ok: true,
                },
            });
            return;
        }

        const tempUsers = await dbGetAll("SELECT * FROM temp_user_creation_data");
        let tempUser;
        for (const user of tempUsers) {
            const userData = jwt.decode(user.token);
            if (userData.newSecret == id) {
                tempUser = userData;
                break;
            }
        }

        if (!tempUser) {
            throw new NotFoundError("Pending user not found", { event: "user.verify.failed", reason: "user_not_found" });
        }

        await dbRun("INSERT INTO users (email, password, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?)", [
            tempUser.email,
            tempUser.hashedPassword,
            tempUser.newAPI,
            tempUser.newSecret,
            tempUser.displayName,
            1,
        ]);

        // Assign global role based on what was stored in the temp data
        const newUser = await dbGet("SELECT id FROM users WHERE email = ?", [tempUser.email]);
        if (newUser) {
            const role = await findRoleByPermissionLevel(
                tempUser.permissions === MANAGER_PERMISSIONS ? MANAGER_PERMISSIONS : STUDENT_PERMISSIONS,
                null
            );
            if (role) {
                await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [newUser.id, role.id]);
            }
        }

        await dbRun("DELETE FROM temp_user_creation_data WHERE secret=?", [tempUser.newSecret]);

        req.infoEvent("user.verify.success", "User verified successfully");
        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    };

    /**
     * @swagger
     * /api/v1/user/{id}/verify:
     *   patch:
     *     summary: Verify a pending user
     *     tags:
     *       - Users
     *     description: Verifies and activates a pending user account (requires manager permissions)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Pending user's temporary ID
     *     responses:
     *       200:
     *         description: User verified successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                   example: true
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Pending user not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.patch("/user/:id/verify", isAuthenticated, hasScope(SCOPES.GLOBAL.USERS.MANAGE), verifyUserHandler);

    // Deprecated endpoint - kept for backwards compatibility, use "PATCH /api/v1/user/:id/verify" instead
    router.post("/user/:id/verify", isAuthenticated, hasScope(SCOPES.GLOBAL.USERS.MANAGE), async (req, res) => {
        res.setHeader("X-Deprecated", "Use PATCH /api/v1/user/:id/verify instead");
        res.setHeader(
            "Warning",
            '299 - "Deprecated API: Use PATCH /api/v1/user/:id/verify instead. This endpoint will be removed in a future version."'
        );
        await verifyUserHandler(req, res);
    });
};
