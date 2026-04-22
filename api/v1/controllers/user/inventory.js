const { isAuthenticated } = require("@middleware/authentication");
const { isOwnerOrHasScopes } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { getUserInventory, removeItemFromInventory } = require("@services/inventory-service");
const {requireParam, requireBodyParam} = require("@modules/error-wrapper");

module.exports = (router) => {

    function ownsInventory(req) {
        return req.user.id === req.params.id;
    }

    router.get("/user/:id/inventory/", isAuthenticated, isOwnerOrHasScopes(ownsInventory, [SCOPES.GLOBAL.INVENTORY.MANAGE_OTHERS]), async (req, res) => {
        req.infoEvent("Fetching user inventory");
        const inventory = await getUserInventory(req.params.id);
        res.status(200).json({ success: true, data: inventory });
    });

    router.delete("/user/:id/inventory/:itemId", isAuthenticated, isOwnerOrHasScopes(ownsInventory, [SCOPES.GLOBAL.INVENTORY.MANAGE_OTHERS]), async (req, res) => {
        const {itemId} = req.params;
        const {quantity} = req.body;

        requireParam(itemId, "itemId");
        requireBodyParam(quantity, "quantity");

        req.infoEvent("Removing item from inventory", { itemId, quantity });
        await removeItemFromInventory(req.params.id, itemId, quantity);
        res.status(200).json({ success: true, data: {} });
    });
};