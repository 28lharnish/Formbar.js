// 43_assign_missing_app_pool_shares.js
// Assigns share item ids to pools that have shares but were created before the share_item column was created

const { dbGetAll, dbRun, dbGet } = require("@modules/database");
module.exports = {
    async run(database) {
		//? For each app, ensure its pool has the share_item id

        const columns = await dbGetAll("PRAGMA table_info(digipog_pools)", [], database);
        const shareItemColumn = columns.find((column) => column.name === "share_item");
		if(!shareItemColumn) {
			// await dbRun("ALTER TABLE digipog_pools ADD COLUMN share_item TEXT DEFAULT NULL");

			// const apps = await dbGetAll("SELECT id, share_item_id, pool_id FROM apps")

			// console.log(apps)
		} else {
			throw new Error("ALREADY_DONE");
		}

		
    },
};
