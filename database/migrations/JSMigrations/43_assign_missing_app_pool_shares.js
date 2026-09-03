// 43_assign_missing_app_pool_shares.js
// Assigns share item ids to pools that have shares but were created before the share_item column was created

const { dbGetAll, dbRun, dbGet } = require("@modules/database");
module.exports = {
    async run(database) {
		//? For each app, ensure its pool has the share_item id

        const columns = await dbGetAll("PRAGMA table_info(digipog_pools)", [], database);
        const shareItemColumn = columns.find((column) => column.name === "share_item");
		if(!shareItemColumn) {
			await dbRun("ALTER TABLE digipog_pools ADD COLUMN share_item TEXT DEFAULT NULL", [], database);

			const apps = await dbGetAll("SELECT id, share_item_id, pool_id FROM apps", [], database)
			for(const app of apps) {
				//? Align each apps pool with it's share item

				await dbRun("UPDATE digipog_pools SET share_item = ? WHERE id = ?", [app.share_item_id, app.pool_id], database);
			};
		} else {
			throw new Error("ALREADY_DONE");
		}

		
    },
};
