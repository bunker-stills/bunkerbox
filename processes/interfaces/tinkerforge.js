var _ = require("underscore");
var tinkerforge = require('tinkerforge');
var tinkerforge_connection = require("./../lib/tinkerforge_connection");
var Bricklet1Wire = require("./../lib/Bricklet1Wire");  // old 1wire bricklet
var onewireTempSensors = require("./../lib/onewire_temp_sensors");  // sensor interface for new 1wire bricklet
var util = require("util");

var devices = {};

var MAIN_HEATER_DAC_POSITION = process.env.MAIN_HEATER_DAC_POSITION || "1A";
var PRE_HEATER_DAC_POSITION = process.env.PRE_HEATER_DAC_POSITION || "1B";
var PUMP_DAC_POSITION = process.env.PUMP_DAC_POSITION || "1C";
var POST_HEATER_DAC_POSITION = process.env.PRE_HEATER_DAC_POSITION || "3C";
var FEED_PUMP_DAC_POSITION = process.env.PUMP_DAC_POSITION || "3D";

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
var FEED_PUMP_OUTPUT_TYPE = process.env.PUMP_OUTPUT_TYPE || "VOLTAGE_RANGE_0_TO_5V";
var POST_HEATER_OUTPUT_TYPE = process.env.MAIN_HEATER_OUTPUT_TYPE || "CURRENT_RANGE_4_TO_20MA";

var dacs = {};
var relays = {};
var tempProbes = {};
var thermocoupleDevices = {};
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

function create_temp_probe(cascade, probeAddress) {
    var probe_component = {};
    probe_component.ma_buf = [];
    probe_component.filterTemp = function(tempValue) {
        var ma_len = Math.min(20, Math.max(0, Math.trunc(this.ma_size.value || 0)));
        if (ma_len) {
            this.ma_buf.push(tempValue);
            while (this.ma_buf.length < ma_len) this.ma_buf.push(tempValue);
            while (this.ma_buf.length > ma_len) this.ma_buf.shift();
            return this.ma_buf.reduce( (sum, temp) => sum + temp ) / ma_len;
        }
        else {
            return tempValue;
        }
    };

    probe_component.ma_size = cascade.create_component({
        id: "temp_" + probeAddress + "_MAfilter",
        name: "Temp. Probe " + probeAddress + " MA Filter",
        group: "Sensors",
        units: cascade.UNITS.NONE,
        persist: true,
        type: cascade.TYPES.NUMBER
    });

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

        var masterbrick_position = {};
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
                        case tinkerforge.BrickMaster.DEVICE_IDENTIFIER : {
                            masterbrick_position[uid] = position;
                            break;
                        }
                        case tinkerforge.BrickletOneWire.DEVICE_IDENTIFIER : {
                            // This is the new TF one wire bricklet
                            var owTempSensors = new onewireTempSensors(uid, ipcon);
                            owTempSensors.uid_string = uid;
                            owTempSensors.position = masterbrick_position[connectedUid] + position;
                            owTempSensors.in_use = false;
                            devices["onewire2"] = owTempSensors;

                            // Set 12 bit resolution on temp probes
                            owTempSensors.tempSetResolution(12);

                            break;
                        }
                        case Bricklet1Wire.DEVICE_IDENTIFIER : {
                            var oneWire = new Bricklet1Wire(uid, ipcon);
                            oneWire.uid_string = uid;
                            oneWire.position = masterbrick_position[connectedUid] + position;
                            oneWire.in_use = false;
                            devices["onewire"] = oneWire;

                            // Set 12 bit resolution on temp probes
                            oneWire.tempSetResolution(12);

                            break;
                        }
                        case tinkerforge.BrickletThermocouple.DEVICE_IDENTIFIER : {
                            var tc = new tinkerforge.BrickletThermocouple(uid, ipcon);
                            tc.setConfiguration(tinkerforge.BrickletThermocouple.AVERAGING_16, tinkerforge.BrickletThermocouple.TYPE_K, tinkerforge.BrickletThermocouple.FILTER_OPTION_60HZ);
                            thermocoupleDevices["temp_" + uid] = tc;
                            break;
                        }
                        case tinkerforge.BrickletPTCV2.DEVICE_IDENTIFIER : {
                            var ptc = new tinkerforge.BrickletPTCV2(uid, ipcon);
                            ptc.isSensorConnected(
                                function(connected) {
                                    if (!connected) {
                                        cascade.log_error(new Error("No sensor connected to PTC uid " + uid + "."));
                                        return;
                                    }
                                    ptc.setWireMode(tinkerforge.BrickletPTCV2.WIRE_MODE_3, null,
                                        function(error) {
                                            cascade.log_error(new Error("Error on PTCV2.setWireMode: " + error));
                                        });
                                    return;
                                },
                                function(error) {
                                    cascade.log_error(new Error("Error on PTCV2.isSensorConnected: " + error));
                                });

                            thermocoupleDevices["PT100_" + uid] = ptc;
                            break;
                        }
                        case tinkerforge.BrickletIndustrialAnalogOut.DEVICE_IDENTIFIER : {
                            var dac = new tinkerforge.BrickletIndustrialAnalogOut(uid, ipcon);
                            dac.uid_string = uid;
                            dac.position = masterbrick_position[connectedUid] + position;
                            dac.disable();
                            dac.setVoltage(0);
                            dac.setCurrent(0);
                            devices["dac_" + dac.position.toUpperCase()] = dac;

                            break;
                        }
                        case tinkerforge.BrickletBarometer.DEVICE_IDENTIFIER : {
                            var barometer = new tinkerforge.BrickletBarometer(uid, ipcon);
                            barometer.uid_string = uid;
                            barometer.position = masterbrick_position[connectedUid] + position;
                            devices["barometer"] = barometer;
                            break;
                        }
                        case tinkerforge.BrickletIndustrialQuadRelay.DEVICE_IDENTIFIER : {
                            var relay = new tinkerforge.BrickletIndustrialQuadRelay(uid, ipcon);
                            relay.uid_string = uid;
                            relay.position = masterbrick_position[connectedUid] + position;
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
    create_dac(cascade, "post_heater", "Postheater", POST_HEATER_DAC_POSITION, POST_HEATER_OUTPUT_TYPE);
    create_dac(cascade, "feed_pump", "Feedpump", FEED_PUMP_DAC_POSITION, FEED_PUMP_OUTPUT_TYPE);

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

    _.each(thermocoupleDevices, function (tcProbe, probeID) {
        var tempProbe = tempProbes[probeID];

        if(!tempProbe)
        {
            create_temp_probe(cascade, probeID);
            tempProbe = tempProbes[probeID];
        }

        var tcDevice = thermocoupleDevices[probeID];
        tcDevice.getTemperature(function (temperature) {
            var tempValue = temperature / 100;
            tempProbe.raw.value = tempValue;
            tempValue = tempProbe.filterTemp(tempValue);
            tempProbe.calibrated.value = tempValue + (tempProbe.calibration.value || 0);
        });
    });

    _.each([devices["onewire"], devices["onewire2"]], function(ow) {
        if (ow && !ow.in_use) {
            ow.in_use = true;
            ow.getAllTemperatures(function (error, probes) {
                if (error) {
                    cascade.log_error(new Error("Unable to retrieve temperatures from onewire " + ow.uid_string + ": " + error));
                    ow.in_use = false;
                    return;
                }

                for (var probeAddress in probes) {
                    var tempValue = probes[probeAddress];
                    var tempComponent = tempProbes[probeAddress];
                    if (!tempComponent) {
                        create_temp_probe(cascade, probeAddress);
                        tempComponent = tempProbes[probeAddress];
                    }

                    tempComponent.raw.value = tempValue;
                    tempValue = tempComponent.filterTemp(tempValue);
                    tempComponent.calibrated.value = tempValue + (tempComponent.calibration.value || 0);
                }
                ow.in_use = false;
            });
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
