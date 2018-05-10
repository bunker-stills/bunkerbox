var _ = require("underscore");
var tinkerforge = require('tinkerforge');
var tinkerforge_connection = require("./../lib/tinkerforge_connection");
var Bricklet1Wire = require("./../lib/Bricklet1Wire");
var util = require("util");

var devices = {};

var MAIN_HEATER_DAC_POSITION = process.env.MAIN_HEATER_DAC_POSITION || "A";
var PRE_HEATER_DAC_POSITION = process.env.PRE_HEATER_DAC_POSITION || "B";
var PUMP_DAC_POSITION = process.env.MAIN_HEATER_DAC_POSITION || "C";

function mapRange(value, in_min, in_max, out_min, out_max) {
    var output = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    return output;
    //return Math.max(out_min, Math.min(output, out_max));
}

var OUTPUT_TYPES = {
    VOLTAGE_RANGE_0_TO_5V: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_5V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 5000));
        tfInterface.setVoltage(output);
    },
    VOLTAGE_RANGE_0_TO_10V: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_0_TO_10V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 10000));
        tfInterface.setVoltage(output);
    },
    VOLTAGE_RANGE_2_TO_10V: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOut.VOLTAGE_RANGE_2_TO_10V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 2000, 10000));
        tfInterface.setVoltage(output);
    },
    CURRENT_RANGE_4_TO_20MA: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(0, tinkerforge.BrickletIndustrialAnalogOut.CURRENT_RANGE_4_TO_20MA);
        var output = Math.round(mapRange(outputPercent, 0, 100, 4000, 20000));
        tfInterface.setCurrent(output);
    }
};

var PUMP_OUTPUT_TYPE = process.env.PUMP_OUTPUT_TYPE || "VOLTAGE_RANGE_0_TO_5V";
var PRE_HEATER_OUTPUT_TYPE = process.env.PRE_HEATER_OUTPUT_TYPE || "CURRENT_RANGE_4_TO_20MA";
var MAIN_HEATER_OUTPUT_TYPE = process.env.MAIN_HEATER_OUTPUT_TYPE || "CURRENT_RANGE_4_TO_20MA";

var dacs = {};
var relays = {};
var tempProbes = {};
var barometer_component;

function set_dac(dac_info) {
    if (dac_info.interface) {

        dac_info.setFunction(dac_info.interface, dac_info.output.value);

        if (dac_info.enable.value === true) {
            dac_info.interface.enable();
        }
        else {
            dac_info.interface.disable();
        }
    }
}

function create_temp_probe(cascade, probeAddress)
{
    var probe_component = {};

    probe_component.raw = cascade.create_component({
        id: "temp_" + probeAddress + "_raw",
        name: "Temp. Probe " + probeAddress + " Raw",
        units: cascade.UNITS.C,
        group: "Sensors",
        class: "raw_temperature",
        read_only: true,
        type: cascade.TYPES.NUMBER
    });

    probe_component.calibration = cascade.create_component({
        id: "temp_" + probeAddress + "_calibration",
        name: "Temp. Probe " + probeAddress + " Calibration",
        group: "Sensors",
        units: cascade.UNITS.C,
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    probe_component.calibrated = cascade.create_component({
        id: "temp_" + probeAddress + "_calibrated",
        name: "Temp. Probe " + probeAddress + " Calibrated",
        units: cascade.UNITS.C,
        group: "Sensors",
        class: "calibrated_temperature",
        read_only: true,
        type: cascade.TYPES.NUMBER
    });

    tempProbes[probeAddress] = probe_component;
}

function create_dac(cascade, id, description, dac_position, output_type) {
    var dac_info = {};

    dac_info.setFunction = OUTPUT_TYPES[output_type];
    dac_info.position = dac_position;

    dac_info.enable = cascade.create_component({
        id: id + "_enable",
        name: description + " Enable (Position " + dac_position + ")",
        group: "Process Controls",
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
        group: "Process Controls",
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
        group: "Process Controls",
        class: "relay",
        type: cascade.TYPES.BOOLEAN,
        value: false
    });

    relay_component.on("value_updated", set_relays);

    relays[position] = relay_component;
}

module.exports.setup = function (cascade) {

    tinkerforge_connection.create(function (error, ipcon) {

        if (error) {
            throw error;
        }

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
                        case Bricklet1Wire.DEVICE_IDENTIFIER : {
                            var oneWire = new Bricklet1Wire(uid, ipcon);
                            oneWire.uid_string = uid;
                            oneWire.position = position;
                            devices["onewire"] = oneWire;

                            // Set 12 bit resolution on temp probes
                            oneWire.tempSetResolution(12);

                            break;
                        }
                        case tinkerforge.BrickletIndustrialAnalogOut.DEVICE_IDENTIFIER : {
                            var dac = new tinkerforge.BrickletIndustrialAnalogOut(uid, ipcon);
                            dac.uid_string = uid;
                            dac.position = position;
                            dac.disable();
                            dac.setVoltage(0);
                            dac.setCurrent(0);
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

        ipcon.enumerate();
    });

    create_dac(cascade, "pump", "Pump", PUMP_DAC_POSITION, PUMP_OUTPUT_TYPE);
    create_dac(cascade, "pre_heater", "Preheater", PRE_HEATER_DAC_POSITION, PRE_HEATER_OUTPUT_TYPE);
    create_dac(cascade, "main_heater", "Main Heater", MAIN_HEATER_DAC_POSITION, MAIN_HEATER_OUTPUT_TYPE);

    create_relay(cascade, "relay_0", "Relay 0", 0);
    create_relay(cascade, "relay_1", "Relay 1", 1);
    create_relay(cascade, "relay_2", "Relay 2", 2);
    create_relay(cascade, "relay_3", "Relay 3", 3);

    barometer_component = cascade.create_component({
        id: "barometer",
        name: "Barometer",
        group: "Sensors",
        class: "barometer",
        units: "mbar",
        type: cascade.TYPES.NUMBER
    });
};

var lastOnewirePollTime = null;

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

    if(devices["onewire"])
    {
        if(!lastOnewirePollTime)
        {
            lastOnewirePollTime = Date.now();
            devices["onewire"].getAllTemperatures(function(error, probes) {
                if(error)
                {
                    cascade.log_error(new Error("Unable to retrieve 1wire temperatures."));
                    lastOnewirePollTime = null;
                    return;
                }

                for(var probeAddress in probes)
                {
                    var tempValue = probes[probeAddress];
                    var tempComponent = tempProbes[probeAddress];
                    if(!tempComponent)
                    {
                        create_temp_probe(cascade, probeAddress);
                        tempComponent = tempProbes[probeAddress];
                    }

                    tempComponent.raw.value = tempValue;
                    tempComponent.calibrated.value = tempValue + (tempComponent.calibration.value || 0);
                }

                lastOnewirePollTime = null;
            });
        }
    }

    if (devices["barometer"]) {
        devices["barometer"].getAirPressure(function (airPressure) {
            barometer_component.value = airPressure / 1000;
        });
    }

    if (!devices["relays"]) {
        online = false;
    }
};