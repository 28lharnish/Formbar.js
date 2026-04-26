/**
 * Flatten an object's string values into a single array.
 * Traverses nested objects recursively and collects strings.
 *
 * @param {Object} obj - The object to flatten.
 * @returns {string[]} An array containing all string values found in the object.
 */
function flattenObject(obj) {
    const flattenedArray = [];
    for (const value of Object.values(obj)) {
        if (typeof value === "string") {
            flattenedArray.push(value);
        } else if (typeof value === "object" && value !== null) {
            flattenedArray.push(...flattenObject(value));
        }
    }

    return flattenedArray;
}

/**
 * Converts HSL color values to Hex color values
 * @param hue
 * @param saturation
 * @param lightness
 * @returns {string}
 */
function convertHSLToHex(hue, saturation, lightness) {
    try {
        // Normalize lightness to range 0-1
        lightness /= 100;

        // Calculate chroma
        const chroma = (saturation * Math.min(lightness, 1 - lightness)) / 100;

        // Function to get color component
        /**
         * Convert one HSL channel into its hexadecimal color component.
         *
         * @param {*} colorIndex - colorIndex.
         * @returns {*}
         */
        function getColorComponent(colorIndex) {
            try {
                const colorPosition = (colorIndex + hue / 30) % 12;
                const colorValue = lightness - chroma * Math.max(Math.min(colorPosition - 3, 9 - colorPosition, 1), -1);

                // Return color component in hexadecimal format
                return Math.round(255 * colorValue)
                    .toString(16)
                    .padStart(2, "0");
            } catch (err) {
                return err;
            }
        }

        // Return the hex color
        let red = getColorComponent(0);
        let green = getColorComponent(8);
        let blue = getColorComponent(4);

        if (red instanceof Error) throw red;
        if (green instanceof Error) throw green;
        if (blue instanceof Error) throw blue;

        return `#${red}${green}${blue}`;
    } catch (err) {
        return err;
    }
}

/**
 * Generates random colors
 * @param amount - Amount of colors to generate
 * @returns {string[]}
 */
function generateColors(amount) {
    try {
        // Initialize colors array
        let colors = [];

        // Initialize hue
        let hue = 0;

        // Generate colors
        for (let i = 0; i < amount; i++) {
            // Add color to the colors array
            let color = convertHSLToHex(hue, 100, 50);

            if (color instanceof Error) throw color;

            colors.push(color);

            // Increment hue
            hue += 360 / amount;
        }

        // Return the colors array
        return colors;
    } catch (err) {
        return err;
    }
}

/**
 * Generate a short random key for temporary codes and other lightweight identifiers.
 *
 * @param {*} size - size.
 * @returns {*}
 */
function generateKey(size) {
    let key = "";
    for (let i = 0; i < size; i++) {
        let keygen = "abcdefghijklmnopqrstuvwxyz123456789";
        let letter = keygen[Math.floor(Math.random() * keygen.length)];
        key += letter;
    }

    return key;
}

/**
 * Camel Case To Normal.
 *
 * @param {*} str - str.
 * @returns {*}
 */
function camelCaseToNormal(str) {
    let result = str.replace(/([A-Z])/g, " $1");
    result = result.charAt(0).toUpperCase() + result.slice(1);
    return result;
}

module.exports = {
    flattenObject,
    convertHSLToHex,
    generateColors,
    generateKey,
    camelCaseToNormal,
};
