var spawn = require('child_process').spawn;

var owfs_process;

module.exports.setup = function(cascade)
{
    cascade.log_info("Starting OWFS Server");

    owfs_process = spawn('owserver', ['-C', '-uall']);

    owfs_process.on("error", function (error) {
        cascade.log_error("OWFS Failed: " + error);
    });
};