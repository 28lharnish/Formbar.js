const { isAuthenticated } = require("@middleware/authentication");
const { hasScope, isOwnerOrHasScopes } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { addItemToInventory, getUserInventory, removeItemFromInventory } = require("@services/inventory-service");
const { requireParam, requireBodyParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");

module.exports = (router) => {
    function ownsInventory(req) {
        return Number(req.user.id) === Number(req.params.id);
    }

    function canGiveInventoryItem(req, res, next) {
        if (req.user?.oauth) {
            if (!ownsInventory(req)) {
                throw new ForbiddenError("OAuth apps can only give items to the authorized user.", {
                    event: "user.inventory.give.failed",
                    reason: "oauth_target_mismatch",
                });
            }

            return next();
        }

        return hasScope(SCOPES.GLOBAL.USERS.MANAGE)(req, res, next);
    }

    router.get("/user/:id/inventory/", isAuthenticated, isOwnerOrHasScopes(ownsInventory, [SCOPES.GLOBAL.USERS.MANAGE]), async (req, res) => {
        req.infoEvent("user.inventory.get", "Fetching user inventory");
        requireParam(req.params.id, "id");

        const parsedUserId = Number(req.params.id);
        if (!Number.isInteger(parsedUserId)) {
            throw new ValidationError("Invalid User Id", {
                reason: "invalid_user_id",
                event: "user.inventory.get.failed",
            });
        }

        const inventory = await getUserInventory(parsedUserId);
        res.status(200).json({ success: true, data: inventory });
    });

    router.post("/user/:id/inventory/:itemId", isAuthenticated, canGiveInventoryItem, async (req, res) => {
        const { id, itemId } = req.params;
        const { quantity } = req.body;

        requireParam(id, "id");
        requireParam(itemId, "itemId");
        requireBodyParam(quantity, "quantity");

        const parsedUserId = Number(id);
        const parsedItemId = Number(itemId);
        const parsedQuantity = Number(quantity);

        if (!Number.isInteger(parsedUserId)) {
            throw new ValidationError("Invalid User Id", {
                reason: "invalid_user_id",
                event: "user.inventory.give.failed",
            });
        }

        if (!Number.isInteger(parsedItemId)) {
            throw new ValidationError("Invalid Item Id", {
                reason: "invalid_item_id",
                event: "user.inventory.give.failed",
            });
        }

        if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
            throw new ValidationError("Invalid Quantity", {
                reason: "invalid_quantity",
                event: "user.inventory.give.failed",
            });
        }

        req.infoEvent("user.inventory.give_item", "Adding item to inventory", { itemId: parsedItemId, quantity: parsedQuantity });
        await addItemToInventory(parsedUserId, parsedItemId, parsedQuantity);

        res.status(200).json({
            success: true,
            data: {
                userId: parsedUserId,
                itemId: parsedItemId,
                quantity: parsedQuantity,
            },
        });
    });

    router.delete(
        "/user/:id/inventory/:itemId",
        isAuthenticated,
        isOwnerOrHasScopes(ownsInventory, [SCOPES.GLOBAL.USERS.MANAGE]),
        async (req, res) => {
            const { id, itemId } = req.params;
            const { quantity } = req.body;

            requireParam(id, "id");
            requireParam(itemId, "itemId");
            requireBodyParam(quantity, "quantity");

            const parsedUserId = Number(id);
            const parsedItemId = Number(itemId);
            const parsedQuantity = Number(quantity);

            if (!Number.isInteger(parsedUserId)) {
                throw new ValidationError("Invalid User Id", {
                    reason: "invalid_user_id",
                    event: "user.inventory.delete.failed",
                });
            }

            if (!Number.isInteger(parsedItemId)) {
                throw new ValidationError("Invalid Item Id", {
                    reason: "invalid_item_id",
                    event: "user.inventory.delete.failed",
                });
            }

            if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
                throw new ValidationError("Invalid Quantity", {
                    reason: "invalid_quantity",
                    event: "user.inventory.delete.failed",
                });
            }

            req.infoEvent("user.inventory.delete_item", "Removing item from inventory", { itemId: parsedItemId, quantity: parsedQuantity });
            await removeItemFromInventory(parsedUserId, parsedItemId, parsedQuantity);
            res.status(200).json({ success: true, data: {} });
        }
    );
};
