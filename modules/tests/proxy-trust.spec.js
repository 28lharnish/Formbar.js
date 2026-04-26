const { parseTrustProxySetting } = require("@modules/proxy-trust");

describe("parseTrustProxySetting()", () => {
    it("falls back to one trusted proxy when the env var is absent", () => {
        expect(parseTrustProxySetting(undefined)).toBe(1);
    });

    it("falls back to one trusted proxy when the env var is invalid", () => {
        expect(parseTrustProxySetting("not-a-number")).toBe(1);
    });

    it("falls back to one trusted proxy when the env var is blank", () => {
        expect(parseTrustProxySetting("   ")).toBe(1);
    });

    it("uses the explicit numeric env var value", () => {
        expect(parseTrustProxySetting("2")).toBe(2);
    });
});
