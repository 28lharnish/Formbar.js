const { requireQueryParam, requireBodyParam, requireInternalParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");
const AppError = require("@errors/app-error");

describe("requireQueryParam()", () => {
    it("throws ValidationError when param is null", () => {
        expect(() => requireQueryParam(null, "id")).toThrow(ValidationError);
    });

    it("throws ValidationError when param is undefined", () => {
        expect(() => requireQueryParam(undefined, "id")).toThrow(ValidationError);
    });

    it("includes the param name in the error message", () => {
        expect(() => requireQueryParam(null, "foo")).toThrow(/foo/);
    });

    it.each([0, "", false, "value"])("does not throw for valid value %j", (val) => {
        expect(() => requireQueryParam(val, "p")).not.toThrow();
    });
});

describe("requireBodyParam()", () => {
    it("throws ValidationError when param is null", () => {
        expect(() => requireBodyParam(null, "name")).toThrow(ValidationError);
    });

    it("throws ValidationError when param is undefined", () => {
        expect(() => requireBodyParam(undefined, "name")).toThrow(ValidationError);
    });

    it.each([0, "", false, "value"])("does not throw for valid value %j", (val) => {
        expect(() => requireBodyParam(val, "p")).not.toThrow();
    });
});

describe("requireInternalParam()", () => {
    it("throws ValidationError when param is null", () => {
        expect(() => requireInternalParam(null, "config")).toThrow(ValidationError);
    });

    it("throws ValidationError when param is undefined", () => {
        expect(() => requireInternalParam(undefined, "config")).toThrow(ValidationError);
    });

    it("sets statusCode to 500", () => {
        try {
            requireInternalParam(null, "x");
        } catch (err) {
            expect(err.statusCode).toBe(500);
            return;
        }
        throw new Error("Expected an error to be thrown");
    });

    it.each([0, "", false, "value"])("does not throw for valid value %j", (val) => {
        expect(() => requireInternalParam(val, "p")).not.toThrow();
    });
});
