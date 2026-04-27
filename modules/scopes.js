const SCOPES = {
    GLOBAL: {
        CLASS: {
            CREATE: "global.class.create",
            DELETE: "global.class.delete",
        },
        USERS: {
            MANAGE: "global.users.manage",
        },
        DIGIPOGS: {
            AWARD: "global.digipogs.award",
            TRANSFER: "global.digipogs.transfer",
        },
        POOLS: {
            MANAGE: "global.pools.manage",
        },
        SYSTEM: {
            ADMIN: "global.system.admin",
            MODERATE: "global.system.moderate",
            BLOCKED: "global.system.blocked",
        },
    },

    CLASS: {
        SYSTEM: {
            ADMIN: "class.system.admin",
			PANEL_ACCESS: "class.system.panel_access",
			CAN_DELETE_CLASS: "class.system.can_delete_class",
			CAN_RENAME_CLASS: "class.system.can_rename_class",
            BLOCKED: "class.system.blocked",
        },

        ROLES: {
            ASSIGN: "class.roles.assign",
            READ: "class.roles.read",
            MANAGE: "class.roles.manage",
        },

        POLL: {
            READ: "class.poll.read",
            VOTE: "class.poll.vote",
            CREATE: "class.poll.create",
            END: "class.poll.end",
            DELETE: "class.poll.delete",
            SHARE: "class.poll.share",
        },

		ROLES: {
			ASSIGN: "class.roles.assign",
			READ: "class.roles.read",
			MANAGE: "class.roles.manage",
		},

        STUDENTS: {
            READ: "class.students.read",
            KICK: "class.students.kick",
            BAN: "class.students.ban",
        },

        SESSION: {
            START: "class.session.start",
            END: "class.session.end",
            RENAME: "class.session.rename",
            SETTINGS: "class.session.settings",
            REGENERATE_CODE: "class.session.regenerate_code",
        },

        BREAK: {
            REQUEST: "class.break.request",
            APPROVE: "class.break.approve",
        },

        HELP: {
            REQUEST: "class.help.request",
            APPROVE: "class.help.approve",
        },

        TIMER: {
            READ: "class.timer.read",
            CONTROL: "class.timer.control",
        },

        AUXILIARY: {
            CONTROL: "class.auxiliary.control",
        },

        GAMES: {
            ACCESS: "class.games.access",
        },

        TAGS: {
            MANAGE: "class.tags.manage",
        },

        DIGIPOGS: {
            AWARD: "class.digipogs.award",
        },

        LINKS: {
            READ: "class.links.read",
            MANAGE: "class.links.manage",
        },
    },
};

module.exports = {
    SCOPES,
};
