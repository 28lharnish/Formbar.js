const { flattenObject, convertHSLToHex, generateColors, generateKey, camelCaseToNormal } = require("@modules/util");

describe("flattenObject()", () => {
    it("collects nested string values recursively", () => {
        expect(
            flattenObject({
                top: "one",
                nested: {
                    inner: "two",
                    deeper: {
                        leaf: "three",
                    },
                },
                ignored: 42,
            })
        ).toEqual(["one", "two", "three"]);
    });
});

describe("convertHSLToHex()", () => {
    it("converts red (0, 100, 50) to #ff0000", () => {
        expect(convertHSLToHex(0, 100, 50)).toBe("#ff0000");
    });

    it("converts green (120, 100, 50) to #00ff00", () => {
        expect(convertHSLToHex(120, 100, 50)).toBe("#00ff00");
    });

    it("converts blue (240, 100, 50) to #0000ff", () => {
        expect(convertHSLToHex(240, 100, 50)).toBe("#0000ff");
    });

    it("returns a 7-character string starting with #", () => {
        const result = convertHSLToHex(60, 100, 50);
        expect(result).toHaveLength(7);
        expect(result[0]).toBe("#");
    });
});

describe("generateColors()", () => {
    it("returns an array of the requested length", () => {
        expect(generateColors(5)).toHaveLength(5);
    });

    it("returns hex color strings", () => {
        const colors = generateColors(3);
        for (const color of colors) {
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
        }
    });
});

describe("generateKey()", () => {
    it("returns a string of the given length", () => {
        expect(generateKey(10)).toHaveLength(10);
        expect(generateKey(1)).toHaveLength(1);
    });

    it("only contains lowercase letters and digits 1-9", () => {
        const key = generateKey(200);
        expect(key).toMatch(/^[a-z1-9]+$/);
    });
});

describe("camelCaseToNormal()", () => {
    it('converts "camelCase" to "Camel Case"', () => {
        expect(camelCaseToNormal("camelCase")).toBe("Camel Case");
    });

    it('converts "testString" to "Test String"', () => {
        expect(camelCaseToNormal("testString")).toBe("Test String");
    });

    it('capitalizes a single word "already" to "Already"', () => {
        expect(camelCaseToNormal("already")).toBe("Already");
    });
});
