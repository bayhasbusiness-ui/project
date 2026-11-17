"use strict";
const { handleSync } = require("../lib/sync-store");

module.exports = (req, res) => handleSync(req, res);
