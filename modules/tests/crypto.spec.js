// Use low salt rounds so bcrypt tests finish quickly
process.env.SALT_ROUNDS = "4";

const { hashBcrypt, compareBcrypt, isBcryptHash, sha256 } = require("@modules/crypto");

describe("hashBcrypt()", () => {
    it("returns a bcrypt hash starting with $2b$", async () => {
        const result = await hashBcrypt("password");
        expect(result).toMatch(/^\$2b\$/);
    });

    it("rejects when given a non-string", async () => {
        await expect(hashBcrypt(123)).rejects.toThrow("Text to hash must be a string");
    });

    it("rejects when given an empty string", async () => {
        await expect(hashBcrypt("")).rejects.toThrow("Text to hash must be provided");
    });
});

describe("compareBcrypt()", () => {
    it("returns true for matching text and hash", async () => {
        const hashed = await hashBcrypt("secret");
        const result = await compareBcrypt("secret", hashed);
        expect(result).toBe(true);
    });

    it("returns false for non-matching text and hash", async () => {
        const hashed = await hashBcrypt("secret");
        const result = await compareBcrypt("wrong", hashed);
        expect(result).toBe(false);
    });

    it("rejects when text is not a string", async () => {
        await expect(compareBcrypt(123, "hash")).rejects.toThrow("Both text and hash must be strings");
    });

    it("rejects when hash is not a string", async () => {
        await expect(compareBcrypt("text", 456)).rejects.toThrow("Both text and hash must be strings");
    });
});

describe("isBcryptHash()", () => {
    it("recognizes supported bcrypt prefixes", () => {
        expect(isBcryptHash("$2a$10$abcdefghijklmnopqrstuuKdJ1tEFr1L1mZGhLeNYM8xA0xk1zYuG")).toBe(true);
        expect(isBcryptHash("$2b$10$abcdefghijklmnopqrstuuKdJ1tEFr1L1mZGhLeNYM8xA0xk1zYuG")).toBe(true);
        expect(isBcryptHash("$2y$10$abcdefghijklmnopqrstuuKdJ1tEFr1L1mZGhLeNYM8xA0xk1zYuG")).toBe(true);
    });

    it("rejects sha256-looking hashes", () => {
        expect(isBcryptHash(sha256("api-key"))).toBe(false);
    });
});

describe("sha256()", () => {
    it("returns a 64-character hex string", () => {
        const result = sha256("hello");
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic", () => {
        expect(sha256("test")).toBe(sha256("test"));
    });

    it("produces different hashes for different inputs", () => {
        expect(sha256("abc")).not.toBe(sha256("xyz"));
    });

    it("throws on non-string input", () => {
        expect(() => sha256(42)).toThrow("Input to sha256 must be a string");
    });

    it("throws on empty string", () => {
        expect(() => sha256("")).toThrow("Input to sha256 must not be empty");
    });
});
