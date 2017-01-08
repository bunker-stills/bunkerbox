var fs = require("fs");
var path = require("path");

module.exports.setup = function (cascade) {

    var allowSoftwareUpdates = cascade.create_component({
        id: "allow_software_updates",
        name: "Allow Software Updates",
        type: cascade.TYPES.BOOLEAN,
        value: true,
        persist: true
    });

    allowSoftwareUpdates.on("value_updated", function(){

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
    });

};