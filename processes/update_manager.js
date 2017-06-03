var fs = require("fs");
var path = require("path");

module.exports.setup = function (cascade) {

    cascade.require_process("process_temps");

    var allowSoftwareUpdates = cascade.create_component({
        id: "allow_software_updates",
        name: "Allow Software Updates",
        type: cascade.TYPES.BOOLEAN,
        group : "Software Updates",
        value: false
    });

    function processLock() {
        var lockFilePath = path.join(cascade.cascade_server.config.data_storage_location, "resin-updates.lock");

        if(allowSoftwareUpdates.value)
        {
            if(fs.existsSync(lockFilePath))
            {
                fs.unlinkSync(lockFilePath);
            }
        }
        else
        {
            fs.closeSync(fs.openSync(lockFilePath, 'w'));
        }
    }

    allowSoftwareUpdates.on("value_updated", processLock)
    processLock();
};