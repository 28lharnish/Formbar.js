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
            PERM_CHANGE: "class.students.perm_change",
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

const SOCKET_EVENT_SCOPE_MAP = {
    deleteClass: SCOPES.GLOBAL.CLASS.DELETE,
    getOwnedClasses: SCOPES.GLOBAL.CLASS.CREATE,
    logout: null,
    saveTags: SCOPES.CLASS.TAGS.MANAGE,
    setTags: SCOPES.CLASS.TAGS.MANAGE,
    joinClass: null,
    joinRoom: null,
    getActiveClass: null,
    auth: null,
    getClassroom: null,
    transferDigipogs: SCOPES.GLOBAL.DIGIPOGS.TRANSFER,
    awardDigipogs: SCOPES.CLASS.DIGIPOGS.AWARD,
    awardDigipogsResponse: SCOPES.CLASS.DIGIPOGS.AWARD,

    help: SCOPES.CLASS.HELP.REQUEST,
    pollResp: SCOPES.CLASS.POLL.VOTE,
    requestBreak: SCOPES.CLASS.BREAK.REQUEST,
    endBreak: SCOPES.CLASS.BREAK.REQUEST,
    leaveClass: null,
    leaveRoom: null,
    classUpdate: null,
    setClassSetting: SCOPES.CLASS.SESSION.SETTINGS,
    classPoll: SCOPES.CLASS.POLL.CREATE,
    updatePoll: SCOPES.CLASS.POLL.CREATE,
    timer: SCOPES.CLASS.TIMER.CONTROL,
    timerOn: SCOPES.CLASS.TIMER.CONTROL,
    getPreviousPolls: SCOPES.CLASS.POLL.READ,
    updateExcludedRespondents: SCOPES.CLASS.STUDENTS.READ,

    startPoll: SCOPES.CLASS.POLL.CREATE,
    customPollUpdate: SCOPES.CLASS.POLL.CREATE,
    savePoll: SCOPES.CLASS.POLL.CREATE,
    deletePoll: SCOPES.CLASS.POLL.DELETE,
    setPublicPoll: SCOPES.CLASS.POLL.SHARE,
    sharePollToUser: SCOPES.CLASS.POLL.SHARE,
    removeUserPollShare: SCOPES.CLASS.POLL.SHARE,
    getPollShareIds: SCOPES.CLASS.POLL.SHARE,
    sharePollToClass: SCOPES.CLASS.POLL.SHARE,
    removeClassPollShare: SCOPES.CLASS.POLL.SHARE,
    classKickStudent: SCOPES.CLASS.STUDENTS.KICK,
    classKickStudents: SCOPES.CLASS.STUDENTS.KICK,
    classRemoveFromSession: SCOPES.CLASS.STUDENTS.KICK,
    approveBreak: SCOPES.CLASS.BREAK.APPROVE,
    deleteTicket: SCOPES.CLASS.BREAK.APPROVE,
    startClass: SCOPES.CLASS.SESSION.START,
    endClass: SCOPES.CLASS.SESSION.END,
    isClassActive: SCOPES.CLASS.SESSION.SETTINGS,
    regenerateClassCode: SCOPES.CLASS.SESSION.REGENERATE_CODE,
    changeClassName: SCOPES.CLASS.SESSION.RENAME,
    classBannedUsersUpdate: SCOPES.CLASS.STUDENTS.BAN,
    classBanUser: SCOPES.CLASS.STUDENTS.BAN,
    classUnbanUser: SCOPES.CLASS.STUDENTS.BAN,
};

module.exports = {
    SCOPES,
    SOCKET_EVENT_SCOPE_MAP,
};
