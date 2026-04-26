const bcrypt = require("bcrypt");
const crypto = require("crypto");

// Increases time to log in/verify
const saltRounds = parseInt(process.env.SALT_ROUNDS, 10) || 10;

/**
 * Generates a hash for the given text using bcrypt with a specified number of salt rounds.
 *
 * @param {string} text - The text to be hashed.
 * @returns {Promise<string>} A promise that resolves to the hashed text.
 */
function hashBcrypt(text) {
    return new Promise((resolve, reject) => {
        // Validate that text is a string
        if (typeof text !== "string") {
            reject(new Error("Text to hash must be a string"));
            return;
        }

        // Validate that text is not empty
        if (!text) {
            reject(new Error("Text to hash must be provided"));
            return;
        }

        bcrypt.genSalt(saltRounds, (err, salt) => {
            if (err) {
                reject(err);
            }

            bcrypt.hash(text, salt, (err, hash) => {
                if (err) {
                    reject(err);
                }
                resolve(hash);
            });
        });
    });
}

/**
 * Compares a given text with a hash to check if they match.
 *
 * @param {string} text - The text to be compared.
 * @param {string} hash - The hash to compare against.
 * @returns {Promise<boolean>} A promise that resolves to true if the text matches the hash, otherwise false.
 */
function compareBcrypt(text, hash) {
    return new Promise((resolve, reject) => {
        // Validate that both text and hash are strings
        if (typeof text !== "string" || typeof hash !== "string") {
            reject(new Error("Both text and hash must be strings"));
            return;
        }

        // Validate that neither text nor hash is null or undefined
        if (!text || !hash) {
            reject(new Error("Both text and hash must be provided"));
            return;
        }

        bcrypt.compare(text, hash, (err, res) => {
            if (err) {
                reject(err);
            }
            resolve(res);
        });
    });
}

/**
 * Checks if the given hash is a bcrypt hash.
 *
 * @param {string} hash - The hash to check.
 * @returns {boolean} True if the hash is a bcrypt hash, false otherwise.
 */
function isBcryptHash(hash) {
    return typeof hash === "string" && /^\$2[aby]\$\d{2}\$/.test(hash);
}

/**
 * Generates a SHA-256 hex digest for the provided input string.
 *
 * @param {string} input - The input to hash.
 * @returns {string} The SHA-256 hex digest of the input.
 */
function sha256(input) {
    if (typeof input !== "string") {
        throw new Error("Input to sha256 must be a string");
    }

    if (input.length === 0) {
        throw new Error("Input to sha256 must not be empty");
    }

    return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = {
    hashBcrypt,
    compareBcrypt,
    isBcryptHash,
    sha256,
};
