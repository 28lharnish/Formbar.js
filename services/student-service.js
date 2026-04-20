const { classStateStore } = require("@services/classroom-service");
const { database, dbGet, dbGetAll } = require("@modules/database");
const { buildRoleReferences } = require("@modules/role-reference");

// This class is used to create a student to be stored in the sessions data
class Student {
    constructor(email, id, API, ownedPolls = [], sharedPolls = [], tags, displayName, isGuest = false) {
        this.email = email;
        this.id = id;
        this.activeClass = null;
        this.role = null;
        this.roles = { global: [], class: [] };
        this.permissions = null;
        this.tags = tags || [];
        this.ownedPolls = ownedPolls || [];
        this.sharedPolls = sharedPolls || [];
        this.pollRes = {
            buttonRes: "",
            textRes: "",
            time: null,
        };
        this.help = false;
        this.break = false;
        this.API = API;
        this.digipogs = 0;
        this.pogMeter = 0;
        this.displayName = displayName;
        this.isGuest = isGuest;
    }
}

/**
 * Normalizes user tags into an array of strings.
 * Accepts either comma-delimited strings or arrays.
 * @param {string|string[]|null|undefined} tags
 * @returns {string[]}
 */
function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        return tags
            .filter((tag) => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter(Boolean);
    }

    if (typeof tags !== "string" || !tags.trim()) {
        return [];
    }

    return tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}

/**
 * Safely parses arrays that may be persisted as JSON strings.
 * @param {unknown} value
 * @returns {Array}
 */
function parseArrayField(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

/**
 * Builds a standardized in-memory Student/session user object from a DB row
 * or existing user-like object.
 * @param {Object} userData
 * @param {Object} [options]
 * @param {boolean} [options.isGuest]
 * @returns {Student}
 */
function createStudentFromUserData(userData, options = {}) {
    const isGuest = options.isGuest != null ? options.isGuest : Boolean(userData?.isGuest);

    const student = new Student(
        userData.email,
        userData.id,
        userData.API,
        parseArrayField(userData.ownedPolls),
        parseArrayField(userData.sharedPolls),
        normalizeTags(userData.tags),
        userData.displayName,
        isGuest
    );

    if (userData.activeClass != null) {
        student.activeClass = userData.activeClass;
    }

    if (userData.role != null) {
        student.role = userData.role;
    }

    if (userData.roles && typeof userData.roles === "object" && !Array.isArray(userData.roles)) {
        if (Array.isArray(userData.roles.global)) {
            student.roles.global = userData.roles.global;
        }
        if (userData.roles.class != null) {
            student.roles.class = Array.isArray(userData.roles.class) ? buildRoleReferences(userData.roles.class) : [];
        }
    }

    if (Object.prototype.hasOwnProperty.call(userData, "permissions")) {
        student.permissions = userData.permissions;
    }

    if (userData.pogMeter != null) {
        student.pogMeter = userData.pogMeter;
    }

    if (userData.digipogs != null) {
        student.digipogs = userData.digipogs;
    }

    if (userData.help !== undefined) {
        student.help = userData.help;
    }

    if (userData.break !== undefined) {
        student.break = userData.break;
    }

    if (userData.pollRes && typeof userData.pollRes === "object") {
        student.pollRes = { ...student.pollRes, ...userData.pollRes };
    }

    if (Object.prototype.hasOwnProperty.call(userData, "verified")) {
        student.verified = userData.verified;
    }

    return student;
}

/**
 * Retrieves the students in a class from the database.
 * Creates an actual student class for each student rather than just returning their data.
 * @param {integer} classId - The class id.
 * @returns {Promise|Object} A promise that resolves to the class users or an error object.
 */
async function getStudentsInClass(classId) {
    // Grab students associated with the class
    const studentIdsAndPermissions = await new Promise((resolve, reject) => {
        database.all("SELECT * FROM classusers WHERE classId = ?", [classId], (err, rows) => {
            if (err) {
                return reject(err);
            }

            const studentIdsAndPermissions = rows.map((row) => ({
                id: row.studentId,
            }));

            resolve(studentIdsAndPermissions);
        });
    });

    // Get student ids in the class user data
    const studentIds = studentIdsAndPermissions.map((student) => student.id);
    if (studentIds.length === 0) return {};

    const studentsData = await new Promise((resolve, reject) => {
        database.all("SELECT * FROM users WHERE id IN (" + studentIds.map(() => "?").join(",") + ")", studentIds, (err, rows) => {
            if (err) {
                return reject(err);
            }

            const studentData = {};
            for (const row of rows) {
                studentData[row.email] = row;
            }

            resolve(studentData);
        });
    });

    // Batch-load all role assignments for this class from user_roles
    const roleAssignments = await dbGetAll(
        `SELECT ur.userId, r.id AS roleId, r.name AS roleName, r.scopes AS roleScopes
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.classId = ?`,
        [classId]
    );

    // Group roles by userId
    const rolesByUserId = {};
    for (const row of roleAssignments) {
        if (!rolesByUserId[row.userId]) rolesByUserId[row.userId] = [];
        rolesByUserId[row.userId].push({
            id: row.roleId,
            name: row.roleName,
            scopes: row.roleScopes,
        });
    }

    // Create student class and return the data
    const students = {};
    for (const email in studentsData) {
        const userData = studentsData[email];
        const student = createStudentFromUserData(userData, { isGuest: false });

        // Load multi-role assignments from user_roles
        const roleRefs = rolesByUserId[userData.id] || [];
        student.roles.class = buildRoleReferences(roleRefs);

        students[email] = student;
    }

    return students;
}

/**
 * Retrieves a student's id from their email
 * @param email
 * @returns {Promise|Number}
 */
function getIdFromEmail(email) {
    try {
        // If the user is already loaded, return the id
        const user = classStateStore.getUser(email);
        if (user) {
            return user.id;
        }

        // If the user isn't loaded, get the id from the database
        return new Promise((resolve, reject) => {
            database.get("SELECT id FROM users WHERE email=?", [email], (err, row) => {
                if (err) return reject(err);
                resolve(row.id);
            });
        });
    } catch (err) {
        // Error handled by caller
    }
}

async function getEmailFromId(userId) {
    let email = null;
    for (const user of Object.values(classStateStore.getAllUsers())) {
        if (user && String(user.id) === String(userId)) {
            email = user.email;
            break;
        }
    }

    // If the user is not logged in, then get their email from the database
    if (!email) {
        const emailData = await dbGet("SELECT email FROM users WHERE id = ?", [userId]);
        if (emailData && emailData.email) {
            email = emailData.email;
        }
    }

    return email;
}

module.exports = {
    Student,
    createStudentFromUserData,
    getStudentsInClass,
    getIdFromEmail,
    getEmailFromId,
};
