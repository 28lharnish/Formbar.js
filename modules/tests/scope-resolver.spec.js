const {
    userHasScope,
    getUserScopes,
    getUserRoleName,
    getGlobalPermissionLevelForUser,
    getClassPermissionLevelForUser,
} = require("@modules/scope-resolver");
const { SCOPES, GUEST_PERMISSIONS, TEACHER_PERMISSIONS, MANAGER_PERMISSIONS } = require("@modules/permissions");

describe("getUserRoleName", () => {
    it("returns role field when present", () => {
        expect(getUserRoleName({ role: "Teacher" })).toBe("Teacher");
    });

    it("falls back to LEVEL_TO_ROLE for legacy numeric permissions", () => {
        expect(getUserRoleName({ permissions: 2 })).toBe("Student");
    });

    it("prefers role field over permissions", () => {
        expect(getUserRoleName({ role: "Student", permissions: 5 })).toBe("Student");
    });

    it("defaults to Guest for empty object", () => {
        expect(getUserRoleName({})).toBe("Guest");
    });
});

describe("userHasScope", () => {
    it("Manager has any scope", () => {
        expect(userHasScope({ role: "Manager" }, SCOPES.GLOBAL.SYSTEM.ADMIN)).toBe(true);
        expect(userHasScope({ role: "Manager" }, "anything.at.all")).toBe(true);
    });

    it("Student has global.pools.manage", () => {
        expect(userHasScope({ role: "Student" }, SCOPES.GLOBAL.POOLS.MANAGE)).toBe(true);
    });

    it("Student does not have global.system.admin", () => {
        expect(userHasScope({ role: "Student" }, SCOPES.GLOBAL.SYSTEM.ADMIN)).toBe(false);
    });

    it("null user returns false", () => {
        expect(userHasScope(null, SCOPES.GLOBAL.SYSTEM.ADMIN)).toBe(false);
    });
});

describe("getUserScopes", () => {
    it("filters mixed stored role scopes down to the requested domain", () => {
        const scopes = getUserScopes({
            roles: {
                global: [
                    {
                        id: 1,
                        name: "Student",
                        scopes: ["global.pools.manage", "global.digipogs.transfer", "class.poll.read", "class.poll.vote"],
                    },
                ],
                class: [],
            },
            scopes: {
                class: ["class.poll.vote", "global.pools.manage"],
            },
        });

        expect(scopes.global).toEqual(["global.pools.manage", "global.digipogs.transfer"]);
        expect(scopes.class).toEqual(["class.poll.vote"]);
    });
});

describe("permission level helpers", () => {
    it("computes the global permission level from resolved user scopes", () => {
        expect(
            getGlobalPermissionLevelForUser({
                roles: {
                    global: [{ name: "Teacher" }],
                    class: [],
                },
            })
        ).toBe(TEACHER_PERMISSIONS);
    });

    it("returns guest permissions when no class user is provided", () => {
        expect(getClassPermissionLevelForUser(null, null)).toBe(GUEST_PERMISSIONS);
    });

    it("treats the class owner as manager level", () => {
        expect(
            getClassPermissionLevelForUser(
                {
                    id: 10,
                    roles: {
                        global: [],
                        class: [],
                    },
                },
                {
                    owner: 10,
                }
            )
        ).toBe(MANAGER_PERMISSIONS);
    });
});

describe("userHasScope", () => {
    it("Manager has any class scope", () => {
        expect(userHasScope({ roles: { class: ["Manager"] } }, SCOPES.CLASS.POLL.CREATE, null)).toBe(true);
        expect(userHasScope({ roles: { class: ["Manager"] } }, SCOPES.CLASS.STUDENTS.KICK, null)).toBe(true);
    });

    it("Guest has class.poll.read", () => {
        expect(userHasScope({ roles: { class: ["Guest"] } }, SCOPES.CLASS.POLL.READ, null)).toBe(true);
    });

    it("Guest does not have class.poll.create", () => {
        expect(userHasScope({ roles: { class: ["Guest"] } }, SCOPES.CLASS.POLL.CREATE, null)).toBe(false);
    });
});
