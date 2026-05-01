const { isAuthenticated } = require("@middleware/authentication");
const { getItemById } = require("@services/inventory-service");
const { requireParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.get("/item/:id", isAuthenticated, async (req, res) => {
        const { id } = req.params;
        requireParam(id, "id");

        const parsedId = Number(id);

        if (!Number.isInteger(parsedId)) {
            throw new ValidationError("Invalid Item Id", { reason: "invalid_id", event: "item.get.failed" });
        }

        req.infoEvent("item.get", "Fetching item info", { itemId: parsedId });
        const item = await getItemById(parsedId);
        res.status(200).json({ success: true, data: item });
    });
};
