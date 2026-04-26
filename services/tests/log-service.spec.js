jest.mock("fs", () => ({
    promises: {
        readdir: jest.fn(),
        stat: jest.fn(),
        readFile: jest.fn(),
    },
}));

const fs = require("fs");
const { getAllLogs, getLog } = require("@services/log-service");
const AppError = require("@errors/app-error");
const NotFoundError = require("@errors/not-found-error");

beforeEach(() => {
    jest.clearAllMocks();
});

describe("getAllLogs()", () => {
    it("returns array of non-empty .log files", async () => {
        fs.promises.readdir.mockResolvedValue(["app.log", "error.log"]);
        fs.promises.stat.mockResolvedValue({ size: 100 });

        const result = await getAllLogs();

        expect(result).toEqual(["app.log", "error.log"]);
    });

    it("excludes files that don't end in .log", async () => {
        fs.promises.readdir.mockResolvedValue(["app.log", "readme.txt", "data.json"]);
        fs.promises.stat.mockResolvedValue({ size: 50 });

        const result = await getAllLogs();

        expect(result).toEqual(["app.log"]);
        expect(fs.promises.stat).toHaveBeenCalledTimes(1);
    });

    it("excludes empty .log files", async () => {
        fs.promises.readdir.mockResolvedValue(["app.log", "empty.log"]);
        fs.promises.stat.mockResolvedValueOnce({ size: 200 }).mockResolvedValueOnce({ size: 0 });

        const result = await getAllLogs();

        expect(result).toEqual(["app.log"]);
    });

    it("returns empty array when no log files exist", async () => {
        fs.promises.readdir.mockResolvedValue([]);

        const result = await getAllLogs();

        expect(result).toEqual([]);
    });

    it("throws AppError when readdir fails", async () => {
        fs.promises.readdir.mockRejectedValue(new Error("ENOENT"));

        await expect(getAllLogs()).rejects.toThrow(AppError);
        await expect(getAllLogs()).rejects.toThrow(/Failed to retrieve logs/);
    });
});

describe("getLog()", () => {
    it("returns file content as string", async () => {
        fs.promises.readFile.mockResolvedValue("line1\nline2\n");

        const result = await getLog("app.log");

        expect(result).toBe("line1\nline2\n");
        expect(fs.promises.readFile).toHaveBeenCalledWith("logs/app.log", "utf8");
    });

    it("throws NotFoundError when file doesn't exist", async () => {
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        fs.promises.readFile.mockRejectedValue(error);

        await expect(getLog("missing.log")).rejects.toThrow(NotFoundError);
        await expect(getLog("missing.log")).rejects.toThrow(/Log file not found/);
    });

    it("throws NotFoundError when a path segment resolves through a non-directory", async () => {
        const error = new Error("ENOTDIR");
        error.code = "ENOTDIR";
        fs.promises.readFile.mockRejectedValue(error);

        await expect(getLog("missing.log")).rejects.toThrow(NotFoundError);
    });
});
