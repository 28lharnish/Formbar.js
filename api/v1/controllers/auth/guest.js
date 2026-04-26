const crypto = require("crypto");
const authService = require("@services/auth-service");
const { createStudentFromUserData } = require("@services/student-service");
const { classStateStore } = require("@services/classroom-service");
const { GUEST_PERMISSIONS } = require("@modules/permissions");
const { requireBodyParam } = require("@modules/error-wrapper");

let nextGuestId = Date.now();

/**
 * Create a guest user ID by incrementing the current timestamp.
 * @returns {number}
 */
function createGuestId() {
    return nextGuestId++;
}

/**
 * Register guest controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/auth/guest:
     *   post:
     *     summary: Create a global guest session (no database user)
     *     tags:
     *       - Authentication
     *     description: |
     *       Creates an in-memory guest identity and returns a short-lived access token.
     *       No refresh token is issued; guests are not persisted to the database.
     *
     *       **Required Permission:** None (public endpoint)
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - displayName
     *             properties:
     *               displayName:
     *                 type: string
     *                 description: Desired guest display name. It is normalized to the same safe format used for user accounts.
     *     responses:
     *       200:
     *         description: Guest session created
     *       500:
     *         description: Server error
     */
    router.post("/auth/guest", async (req, res) => {
        req.infoEvent("auth.guest.attempt", "Global guest session creation");

        const email = `guest_${crypto.randomUUID()}@guest.local`;
        const rawDisplayName = req.body.displayName;
        requireBodyParam(rawDisplayName, "displayName");
        const displayName = authService.sanitizeDisplayName(rawDisplayName, email);

        const id = createGuestId();
        const userData = {
            id,
            email,
            displayName,
            API: null,
            digipogs: 0,
            permissions: GUEST_PERMISSIONS,
            globalRoles: [],
            role: "Guest",
            verified: 0,
        };

        const student = createStudentFromUserData(userData, { isGuest: true });
        classStateStore.setUser(email, student);

        const { accessToken } = authService.loginAsGuest({
            id,
            email,
            displayName,
            digipogs: 0,
            permissions: GUEST_PERMISSIONS,
        });

        req.infoEvent("auth.guest.success", "Global guest session created", { email });

        res.json({
            success: true,
            data: {
                accessToken,
                user: {
                    email,
                    displayName,
                    isGuest: true,
                    digipogs: 0,
                    permissions: GUEST_PERMISSIONS,
                },
            },
        });
    });
};
