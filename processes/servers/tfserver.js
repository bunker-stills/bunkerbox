var spawn = require('child_process').spawn;

var tf_process;

module.exports.setup = function(cascade)
{
    cascade.log_info("Starting TinkerForge Daemon...");

    tf_process = spawn('/etc/init.d/brickd', ['start']);

    tf_process.on("error", function (error) {
        cascade.log_info.error("TinkerForge Daemon Failed: " + error);
    });
};