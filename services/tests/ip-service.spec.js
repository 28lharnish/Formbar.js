const { createTestDb } = require("@test-helpers/db");

let mockDatabase;

jest.mock("@modules/database", () => {
    const dbProxy = new Proxy(
        {},
        {
            get(_, method) {
                return (...args) => mockDatabase.db[method](...args);
            },
        }
    );
    return {
        get database() {
            return dbProxy;
        },
        dbGet: (...args) => mockDatabase.dbGet(...args),
        dbRun: (...args) => mockDatabase.dbRun(...args),
        dbGetAll: (...args) => mockDatabase.dbGetAll(...args),
    };
});

const { getIpAccess, getIpAccessPaginated } = require("@services/ip-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedIp(ip, isWhitelist) {
    return mockDatabase.dbRun("INSERT INTO ip_access_list (ip, is_whitelist) VALUES (?, ?)", [ip, isWhitelist ? 1 : 0]);
}

describe("getIpAccess()", () => {
    describe("'whitelist' type", () => {
        it("returns an empty object when there are no whitelist entries", async () => {
            const result = await getIpAccess("whitelist");
            expect(result).toEqual({});
        });

        it("returns only whitelist entries keyed by their DB id", async () => {
            const id1 = await seedIp("192.168.1.1", true);
            const id2 = await seedIp("10.0.0.1", true);
            await seedIp("1.2.3.4", false); // blacklist – should not appear

            const result = await getIpAccess("whitelist");

            expect(Object.keys(result)).toHaveLength(2);
            expect(result[id1]).toMatchObject({ ip: "192.168.1.1" });
            expect(result[id2]).toMatchObject({ ip: "10.0.0.1" });
        });

        it("does not include blacklist entries", async () => {
            await seedIp("1.2.3.4", false);
            const result = await getIpAccess("whitelist");
            expect(Object.keys(result)).toHaveLength(0);
        });
    });

    describe("'blacklist' type", () => {
        it("returns an empty object when there are no blacklist entries", async () => {
            const result = await getIpAccess("blacklist");
            expect(result).toEqual({});
        });

        it("returns only blacklist entries keyed by their DB id", async () => {
            const id1 = await seedIp("5.5.5.5", false);
            await seedIp("192.168.0.1", true); // whitelist – should not appear

            const result = await getIpAccess("blacklist");

            expect(Object.keys(result)).toHaveLength(1);
            expect(result[id1]).toMatchObject({ ip: "5.5.5.5" });
        });

        it("does not include whitelist entries", async () => {
            await seedIp("192.168.0.1", true);
            const result = await getIpAccess("blacklist");
            expect(Object.keys(result)).toHaveLength(0);
        });
    });

    it("returns an object where every value contains id and ip fields", async () => {
        await seedIp("10.10.10.10", true);
        const result = await getIpAccess("whitelist");
        const entries = Object.values(result);
        expect(entries[0]).toHaveProperty("id");
        expect(entries[0]).toHaveProperty("ip", "10.10.10.10");
    });

    it("handles mixed whitelist and blacklist without cross-contamination", async () => {
        await seedIp("white1", true);
        await seedIp("black1", false);
        await seedIp("white2", true);
        await seedIp("black2", false);

        const whitelist = await getIpAccess("whitelist");
        const blacklist = await getIpAccess("blacklist");

        const whiteIps = Object.values(whitelist).map((e) => e.ip);
        const blackIps = Object.values(blacklist).map((e) => e.ip);

        expect(whiteIps.sort()).toEqual(["white1", "white2"]);
        expect(blackIps.sort()).toEqual(["black1", "black2"]);
    });
});

describe("getIpAccessPaginated()", () => {
    it("returns paginated whitelist entries with a total count", async () => {
        await seedIp("192.168.1.1", true);
        const id2 = await seedIp("10.0.0.1", true);
        await seedIp("1.2.3.4", false);

        const result = await getIpAccessPaginated("whitelist", 1, 1);

        expect(result.total).toBe(2);
        expect(result.ips).toHaveLength(1);
        expect(result.ips[0]).toMatchObject({ id: id2, ip: "10.0.0.1" });
    });

    it("returns an empty page when the filtered list is empty", async () => {
        const result = await getIpAccessPaginated("blacklist", 10, 0);
        expect(result).toEqual({ ips: [], total: 0 });
    });
});
