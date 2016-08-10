var _ = require("underscore");
var tinkerforge = require('tinkerforge');
var util = require("util");

module.exports.devices = {};

module.exports.VOLTAGE_RANGE_0_TO_5V = tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_5V;
module.exports.VOLTAGE_RANGE_0_TO_10V = tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_10V = 1;
module.exports.CURRENT_RANGE_4_TO_20MA = tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_4_TO_20MA = 0;
module.exports.CURRENT_RANGE_0_TO_20MA = tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_0_TO_20MA = 1;
module.exports.CURRENT_RANGE_0_TO_24MA = tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_0_TO_24MA = 2;

var ipcon = new tinkerforge.IPConnection();

ipcon.connect(process.env.TF_HOST || 'localhost', 4223);

ipcon.on(tinkerforge.IPConnection.CALLBACK_CONNECTED,
    function (connectReason) {
        ipcon.enumerate();
    }
);

ipcon.on(tinkerforge.IPConnection.CALLBACK_ENUMERATE,
    function (uid, connectedUid, position, hardwareVersion, firmwareVersion, deviceIdentifier, enumerationType) {

        if(enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_DISCONNECTED) {
            for(var key in module.exports.devices)
            {
                var device = module.exports.devices[key];

                if(device.uid_string === uid)
                {
                    delete module.exports.devices[key];
                    return;
                }
            }
        }
        else if (enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_CONNECTED || enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_AVAILABLE) {
            switch (deviceIdentifier) {
                case tinkerforge.BrickletIndustrialAnalogOut.DEVICE_IDENTIFIER : {
                    var dac = new tinkerforge.BrickletIndustrialAnalogOut(uid, ipcon);
                    dac.uid_string = uid;
                    dac.position = position;
                    module.exports.devices["dac_" + position.toUpperCase()] = dac;

                    break;
                }
                case tinkerforge.BrickletBarometer.DEVICE_IDENTIFIER : {
                    var barometer = new tinkerforge.BrickletBarometer(uid, ipcon);
                    barometer.uid_string = uid;
                    barometer.position = position;
                    module.exports.devices["barometer"] = barometer;
                    break;
                }
                case tinkerforge.BrickletIndustrialQuadRelay.DEVICE_IDENTIFIER : {
                    var relay = new tinkerforge.BrickletIndustrialQuadRelay(uid, ipcon);
                    relay.uid_string = uid;
                    relay.position = position;
                    module.exports.devices["relays"] = relay;
                    break;
                }
            }
        }
    });