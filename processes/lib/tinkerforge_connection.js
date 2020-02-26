var tinkerforge = require('tinkerforge');
var fs = require("fs");

module.exports.create = function(callback)
{
    var tfPassword = process.env.TF_PASSWORD;

    // Is TF protected by a password?
    if (fs.existsSync("/etc/brickd.conf")) {
        try {
            var configString = fs.readFileSync("/etc/brickd.conf", 'utf8');
            tfPassword = /authentication\.secret\s?=\s?([^\r\n]+)/.exec(configString)[1];
        }
        catch (e) {
        }
    }
    if (tfPassword) tfPassword = tfPassword.trim();

    var tfHost = process.env.TF_HOST || 'localhost';

    var ipcon = new tinkerforge.IPConnection();

    ipcon.on(tinkerforge.IPConnection.CALLBACK_CONNECTED,
        function (connectReason) {

            if (tfPassword) {
                ipcon.authenticate(tfPassword,
                    function () {
                        callback(null, ipcon);
                    },
                    function (error) {
                        callback(error);
                    }
                );
            }
            else {
                callback(null, ipcon);
            }
        }
    );

    ipcon.connect(tfHost, 4223);
};
