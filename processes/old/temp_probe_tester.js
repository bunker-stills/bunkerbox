var _ = require("underscore");
var owfs = require("owjs").Client;

var connection;

var TEMP_FAMILY_CODE = 28;

// Make sure we do this at most once a second
var throttled_get_temp_loop = _.throttle(get_temp_loop, 1000);

function get_temp_loop(cascade) {
    connection.write("/bus.0/simultaneous/temperature", "1", function () {
        connection.readFamily(TEMP_FAMILY_CODE, 'temperature12', function (err, temps) {
            if (err) {
                cascade.log_error("Unable to read temperatures.");
                cascade.log_error(err);
            }
            else {
                var current_probes = [];

                _.each(temps, function (temp) {

                    var path_data = temp.path.split('/');

                    if (path_data.length < 3) {
                        return; // An invalid path
                    }

                    var probe_data = path_data[1].split(".");

                    if (probe_data.length == 2 && probe_data[0] === TEMP_FAMILY_CODE.toString()) {
                        var probe_id = probe_data[1];
                        var temp_value = temp.value.replace(/[^0-9.]/g, ''); // TODO: Sometimes OWFS returns weird characters at the beginning of the value. Figure out why.
                        temp_value = Number(temp_value);

                        cascade.log_info(probe_id + ": " + temp_value);
                    }
                });
            }

            throttled_get_temp_loop(cascade);
        });
    });
}

module.exports.setup = function (cascade) {

    var ow_host = process.env.OW_HOST || 'localhost';
    connection = new owfs({host: ow_host, port: 4304});

    connection.write('/bus.0/interface/settings/usb/flexible_timing', "1");
    connection.write('/bus.0/interface/settings/usb/datasampleoffset', "7");
    connection.write('/bus.0/interface/settings/usb/pulldownslewrate', "3");
    connection.write('/bus.0/interface/settings/usb/writeonelowtime', "3");

    // Start getting our temps in a loop. The reason we do this is here as opposed to the main cascade loop function is that we
    // want to make sure this is only run once at a time as not to overwhelm our OWFS server.
    throttled_get_temp_loop(cascade);
};