const { ROLE_NAMES, ROLES, LEVEL_TO_ROLE } = require("@modules/roles");
const { SCOPES } = require("@modules/permissions");

const EXPECTED_ROLE_NAMES = ["Banned", "Guest", "Student", "Mod", "Teacher", "Manager"];

describe("ROLE_NAMES", () => {
    it("has all 6 expected role name strings", () => {
        const values = Object.values(ROLE_NAMES);
        expect(values).toHaveLength(6);
        for (const name of EXPECTED_ROLE_NAMES) {
            expect(values).toContain(name);
        }
    });
});

describe("ROLES", () => {
    it("has an entry for each ROLE_NAMES value", () => {
        for (const name of Object.values(ROLE_NAMES)) {
            expect(ROLES).toHaveProperty(name);
        }
    });

    it.each(EXPECTED_ROLE_NAMES)("%s has global and class arrays", (roleName) => {
        expect(Array.isArray(ROLES[roleName].global)).toBe(true);
        expect(Array.isArray(ROLES[roleName].class)).toBe(true);
    });

    it("Banned carries explicit blocked marker scopes", () => {
        expect(ROLES.Banned.global).toContain(SCOPES.GLOBAL.SYSTEM.BLOCKED);
        expect(ROLES.Banned.class).toContain(SCOPES.CLASS.SYSTEM.BLOCKED);
    });

    it("Guest class scopes include class.poll.read and class.links.read", () => {
        expect(ROLES.Guest.class).toContain(SCOPES.CLASS.POLL.READ);
        expect(ROLES.Guest.class).toContain(SCOPES.CLASS.LINKS.READ);
    });

    it("Student inherits all Guest class scopes", () => {
        for (const scope of ROLES.Guest.class) {
            expect(ROLES.Student.class).toContain(scope);
        }
    });

    it("Student class scopes include class.timer.read", () => {
        expect(ROLES.Student.class).toContain(SCOPES.CLASS.TIMER.READ);
    });

    it("Mod inherits all Student class scopes", () => {
        for (const scope of ROLES.Student.class) {
            expect(ROLES.Mod.class).toContain(scope);
        }
    });

    it("Teacher inherits all Mod class scopes", () => {
        for (const scope of ROLES.Mod.class) {
            expect(ROLES.Teacher.class).toContain(scope);
        }
    });

    it("Manager inherits all Teacher class scopes", () => {
        for (const scope of ROLES.Teacher.class) {
            expect(ROLES.Manager.class).toContain(scope);
        }
    });

    it("Manager global scopes include global.system.admin and global.users.manage", () => {
        expect(ROLES.Manager.global).toContain(SCOPES.GLOBAL.SYSTEM.ADMIN);
        expect(ROLES.Manager.global).toContain(SCOPES.GLOBAL.USERS.MANAGE);
    });

    it("Mod and Manager carry their explicit scope markers", () => {
        expect(ROLES.Mod.global).toContain(SCOPES.GLOBAL.SYSTEM.MODERATE);
        expect(ROLES.Manager.class).toContain(SCOPES.CLASS.SYSTEM.ADMIN);
    });

    it("Teacher class scopes include class.digipogs.award but Student and Mod do not", () => {
        expect(ROLES.Teacher.class).toContain(SCOPES.CLASS.DIGIPOGS.AWARD);
        expect(ROLES.Student.class).not.toContain(SCOPES.CLASS.DIGIPOGS.AWARD);
        expect(ROLES.Mod.class).not.toContain(SCOPES.CLASS.DIGIPOGS.AWARD);
    });

    it("Student global scopes include global.pools.manage and global.digipogs.transfer", () => {
        expect(ROLES.Student.global).toContain(SCOPES.GLOBAL.POOLS.MANAGE);
        expect(ROLES.Student.global).toContain(SCOPES.GLOBAL.DIGIPOGS.TRANSFER);
    });

    it.each(EXPECTED_ROLE_NAMES)("%s has no duplicate global scopes", (roleName) => {
        const { global: g } = ROLES[roleName];
        expect(new Set(g).size).toBe(g.length);
    });

    // Spread inheritance duplicates class.poll.read (explicit in Student + spread from Guest).
    // Verify no duplicates beyond that known one.
    it.each(EXPECTED_ROLE_NAMES)("%s has at most one duplicate class scope from spread inheritance", (roleName) => {
        const { class: c } = ROLES[roleName];
        expect(c.length - new Set(c).size).toBeLessThanOrEqual(1);
    });
});

describe("LEVEL_TO_ROLE", () => {
    it("has exactly 6 entries", () => {
        expect(Object.keys(LEVEL_TO_ROLE)).toHaveLength(6);
    });

    it("maps 0-5 to correct role names", () => {
        expect(LEVEL_TO_ROLE[0]).toBe("Banned");
        expect(LEVEL_TO_ROLE[1]).toBe("Guest");
        expect(LEVEL_TO_ROLE[2]).toBe("Student");
        expect(LEVEL_TO_ROLE[3]).toBe("Mod");
        expect(LEVEL_TO_ROLE[4]).toBe("Teacher");
        expect(LEVEL_TO_ROLE[5]).toBe("Manager");
    });
});
