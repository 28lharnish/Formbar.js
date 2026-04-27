const EventEmitter = require("events");

const mockRequestLogger = { log: jest.fn() };
const mockBaseLogger = { child: jest.fn(() => mockRequestLogger) };

jest.mock("@modules/logger", () => ({
    getLogger: jest.fn().mockResolvedValue(mockBaseLogger),
    logEvent: jest.fn((logger, level, event, message = "", meta = {}) => logger.log({ level, event, message, ...meta })),
}));

const requestLogger = require("@middleware/request-logger");

afterEach(() => {
    mockRequestLogger.log.mockClear();
    mockBaseLogger.child.mockClear();
});

async function getLoggedPath(originalUrl) {
    const req = {
        method: "GET",
        originalUrl,
        ip: "127.0.0.1",
    };
    const res = new EventEmitter();
    const next = jest.fn();

    await requestLogger(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    return mockBaseLogger.child.mock.calls.at(-1)[0].path;
}

describe("requestLogger()", () => {
    it("redacts sensitive query parameters case-insensitively in logged paths", async () => {
        const path = await getLoggedPath("/callback?AccessToken=secret-a&access_token=secret-b&refresh_token=secret-c&state=public");

        expect(path).toContain("AccessToken=%5BREDACTED%5D");
        expect(path).toContain("access_token=%5BREDACTED%5D");
        expect(path).toContain("refresh_token=%5BREDACTED%5D");
        expect(path).toContain("state=public");
        expect(path).not.toContain("secret-a");
        expect(path).not.toContain("secret-b");
        expect(path).not.toContain("secret-c");
    });

    it("keeps fallback redaction case-insensitive for malformed URLs", async () => {
        const path = await getLoggedPath("http://[/?AccessToken=secret-a&access_token=secret-b&state=public");

        expect(path).toContain("AccessToken=[REDACTED]");
        expect(path).toContain("access_token=[REDACTED]");
        expect(path).toContain("state=public");
        expect(path).not.toContain("secret-a");
        expect(path).not.toContain("secret-b");
    });
});
