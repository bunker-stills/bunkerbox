var _ = require("underscore");
var map_range = require("map-range");
var tinkerforge = require('tinkerforge');
var util = require("util");
var fs = require("fs");

var devices = {};

var MAIN_HEATER_DAC_POSITION = "A";
var PRE_HEATER_DAC_POSITION = "B";
var PUMP_DAC_POSITION = "C";

var HEARTS_REFLUX_RELAY_POSITION = 2;
var TAILS_REFLUX_RELAY_POSITION = 1;
var FEED_RELAY_POSITION = 0;

var dacs = {};
var relays = {};
var barometer_component;

function linear(x) {
    return x;
}

function set_dac(dac_info) {
    if (dac_info.interface) {
        dac_info.interface.setConfiguration(dac_info.output_type);

        if (dac_info.enable.value === true) {
            dac_info.interface.enable();
        }
        else {
            dac_info.interface.disable();
        }

        var output_value = dac_info.value_map(dac_info.output.value);

        switch (dac_info.output_type) {
            case tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_5V:
            case tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_10V: {
                dac_info.interface.setVoltage(output_value);
                break;
            }
            case tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_4_TO_20MA: {
                dac_info.interface.setCurrent(output_value);
                break;
            }
        }
    }
}

function create_dac(cascade, id, description, dac_position, output_type) {
    var dac_info = {};

    dac_info.output_type = output_type;
    dac_info.position = dac_position;

    switch (output_type) {
        case tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_5V: {
            dac_info.value_map = map_range(linear, 0, 100, 0, 5000);
            break;
        }
        case tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_10V: {
            dac_info.value_map = map_range(linear, 0, 100, 0, 10000);
            break;
        }
        case tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_4_TO_20MA: {
            dac_info.value_map = map_range(linear, 0, 100, 4000, 20000);
            break;
        }
    }

    dac_info.enable = cascade.create_component({
        id: id + "_enable",
        name: description + " Enable (Position " + dac_position + ")",
        group: "process_controls",
        class: "dac_enable",
        type: cascade.TYPES.BOOLEAN,
        value: false
    });

    dac_info.enable.on("value_updated", function () {
        set_dac(dac_info);
    });

    dac_info.output = cascade.create_component({
        id: id + "_output",
        name: description + " Output Percent (Position " + dac_position + ")",
        group: "process_controls",
        class: "dac_output",
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE,
        value: 0
    });

    dac_info.output.on("value_updated", function () {
        set_dac(dac_info);
    });

    dacs[id] = dac_info;
}

function set_relays() {
    var relay_interface = devices["relays"];

    if (relay_interface) {

        var bitmask = 0;

        _.each(relays, function (relay, relay_position) {
            bitmask = bitmask | (relay.value << relay_position);
        });

        relay_interface.setValue(bitmask);
    }
}

function create_relay(cascade, id, description, position) {
    var relay_component = cascade.create_component({
        id: id,
        name: description,
        group: "process_controls",
        class: "relay",
        type: cascade.TYPES.BOOLEAN,
        value: false
    });

    relay_component.on("value_updated", set_relays);

    relays[position] = relay_component;
}

module.exports.setup = function (cascade) {

    var tfPassword = process.env.TF_PASSWORD;

    // Is TF protected by a password?
    if (fs.statSync("/etc/brickd.conf")) {
        try
        {
            tfPassword = fs.readFileSync("/etc/brickd.conf", 'utf8').split("=")[1].trim();
        }
        catch(e)
        {
        }
    }

    var tfHost = process.env.TF_HOST || 'localhost';

    var ipcon = new tinkerforge.IPConnection();
    ipcon.connect(tfHost, 4223);

    ipcon.on(tinkerforge.IPConnection.CALLBACK_CONNECTED,
        function (connectReason) {

            if(tfPassword)
            {
                ipcon.authenticate(tfPassword,
                    function () {
                        ipcon.enumerate();
                    },
                    function (error) {
                        cascade.log_error('Could not authenticate to brickd');
                    }
                );
            }
            else
            {
                ipcon.enumerate();
            }
        }
    );

    ipcon.on(tinkerforge.IPConnection.CALLBACK_ENUMERATE,
        function (uid, connectedUid, position, hardwareVersion, firmwareVersion, deviceIdentifier, enumerationType) {

            if (enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_DISCONNECTED) {
                for (var key in devices) {
                    var device = devices[key];

                    if (device.uid_string === uid) {
                        delete devices[key];
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
                        devices["dac_" + position.toUpperCase()] = dac;
                        break;
                    }
                    case tinkerforge.BrickletBarometer.DEVICE_IDENTIFIER : {
                        var barometer = new tinkerforge.BrickletBarometer(uid, ipcon);
                        barometer.uid_string = uid;
                        barometer.position = position;
                        devices["barometer"] = barometer;
                        break;
                    }
                    case tinkerforge.BrickletIndustrialQuadRelay.DEVICE_IDENTIFIER : {
                        var relay = new tinkerforge.BrickletIndustrialQuadRelay(uid, ipcon);
                        relay.uid_string = uid;
                        relay.position = position;
                        devices["relays"] = relay;
                        break;
                    }
                }
            }
        });

    create_dac(cascade, "pump", "Pump", PUMP_DAC_POSITION, tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_5V);
    create_dac(cascade, "pre_heater", "Preheater", PRE_HEATER_DAC_POSITION, tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_4_TO_20MA);
    create_dac(cascade, "main_heater", "Main Heater", MAIN_HEATER_DAC_POSITION, tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_4_TO_20MA);

    create_relay(cascade, "hearts_reflux_relay", "Hearts Reflux Relay", HEARTS_REFLUX_RELAY_POSITION);
    create_relay(cascade, "tails_reflux_relay", "Tails Reflux Relay", TAILS_REFLUX_RELAY_POSITION);
    create_relay(cascade, "feed_relay", "Feed Relay", FEED_RELAY_POSITION);

    barometer_component = cascade.create_component({
        id: "barometer",
        name: "Barometer",
        group: "sensors",
        class: "barometer",
        units: "mbar",
        type: cascade.TYPES.NUMBER
    });
};

module.exports.loop = function (cascade) {
    var online = true;

    _.each(dacs, function (dac_info) {

        var dac_interface = devices["dac_" + dac_info.position];

        if (!dac_interface) {
            online = false;
            dac_info.interface = null;
        }
        else if (!dac_info.interface) {
            dac_info.interface = dac_interface;
            set_dac(dac_info);
        }
    });

    if (devices["barometer"]) {
        devices["barometer"].getAirPressure(function (airPressure) {
            barometer_component.value = airPressure / 1000;
        });
    }

    if (!devices["relays"]) {
        online = false;
    }
};