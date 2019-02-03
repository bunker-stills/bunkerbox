var _ = require("underscore");
var tinkerforge = require("tinkerforge");
var tinkerforge_connection = require("./../lib/tinkerforge_connection");
var Bricklet1Wire = require("./../lib/Bricklet1Wire");  // old 1wire bricklet
var onewireTempSensors = require("./../lib/onewire_temp_sensors");  // sensor interface for new 1wire bricklet

var TESTING = Boolean(process.env.TESTING) || false;

var SENSORS_GROUP = "97  Hard Sensors";
var PROCESS_CONTROLS_GROUP = "98  Hard Process Controls";
var RESOURCE_NAMES_GROUP = "99  Hard Resource Names";

// Display orders:
var global_display_order = 1000;
var next_display_order = function() {
    global_display_order += 1;
    return global_display_order;
};


// hard resource names at individual relay or probe level, eg "OW_2A_28af3098c5b7041d", "DAc_3a", "RELAY_2B_2"
var relay_names = [];
var dac_names = [];
var stepper_names = [];
var ow_names = [];
var ptc_names = [];
var tc_names = [];

//info structures by type (at quadrelay or onewire level)  indexed by device id (eg "DAC_3C", "OW_2A", "RELAY_2B").
var quadrelays = {};
var dacs = {};
var steppers = {};
var barometers = {};
var onewireNets = {};
var thermocoupleProbes = {};
var ptcProbes = {};
//var barometer_component;

// all temp probes by probe address (tc_id, ptc_id, or ow_id + probe)
var tempProbes = {};

// tinkerforge hardware interfaces indexed by device id (eg "DAC_3C").
var devices = {};


function set_relays(quadrelay_info) {
    var relay_interface = quadrelay_info.interface;

    if (relay_interface) {

        var bitmask = 0;

        _.each(quadrelay_info.relays, function (relay, relay_position) {
            bitmask = bitmask | (relay.value << relay_position);
        });

        relay_interface.setValue(bitmask);
    }
}

function setup_quadrelay(cascade, id, position) {
    var quadrelay_info = {
        id: id,
        position: position,
        interface: devices[id],
        relays: []
    };

    for(let relay_index in [0,1,2,3]) {
        let relay_id_base = "RELAY_" + position;
        let relay_id = relay_id_base + "_" + relay_index;
        let relay_component = cascade.create_component({
            id: relay_id,
            name: relay_id_base + " # " + relay_index,
            group: PROCESS_CONTROLS_GROUP,
            display_order: next_display_order(),
            class: "relay",
            type: cascade.TYPES.BOOLEAN,
            value: false
        });
        quadrelay_info.relays[relay_index] = relay_component;
        relay_component.on("value_update", function() { set_relays(quadrelay_info); });

        relay_names.push(relay_id);
    }

    quadrelays[id] = quadrelay_info;
}

function mapRange(value, in_min, in_max, out_min, out_max) {
    var output = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    return output;
    //return Math.max(out_min, Math.min(output, out_max));
}

var DAC_OUTPUT_TYPES = {
    NO_OUTPUT: undefined,
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

function set_dac(dac_info) {
    if (dac_info.interface) {

        dac_info.setFunction = DAC_OUTPUT_TYPES[dac_info.output_type.value];
        if (dac_info.setFunction) {

            dac_info.setFunction(dac_info.interface, dac_info.output.value);

            if (dac_info.enable.value === true) {
                dac_info.interface.enable();
            }
            else {
                dac_info.interface.disable();
            }
        }
        else {
            dac_info.interface.disable();
        }
    }
}

function setup_dac(cascade, id, position) {
    var dac_info = {
        id: id,
        position: position,
        interface: devices[id],
        setFunction: DAC_OUTPUT_TYPES.NO_OUTPUT
    };

    dac_info.enable = cascade.create_component({
        id: id + "_enable",
        name: id + " Enable",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "dac_enable",
        type: cascade.TYPES.BOOLEAN,
        value: false
    });

    dac_info.enable.on("value_updated", function () {
        set_dac(dac_info);
    });

    dac_info.output = cascade.create_component({
        id: id + "_output",
        name: id + " Output Percent",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "dac_output",
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE,
        value: 0
    });

    dac_info.output.on("value_updated", function () {
        set_dac(dac_info);
    });

    dac_info.output_type = cascade.create_component({
        id: id + "_output_type",
        name: id + " Output Type",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "dac_configure",
        type: cascade.TYPES.OPTIONS,
        info: {options: Object.keys(DAC_OUTPUT_TYPES)},
        value: "NO_OUTPUT"
    });

    dac_info.output_type.on("value_updated", function () {
        set_dac(dac_info);
    });

    dacs[id] = dac_info;
    dac_names.push(id);
}

var MIN_STEPPER_CURRENT = Number(process.env.MIN_STEPPER_CURRENT) || 100;
var MAX_STEPPER_CURRENT = Number(process.env.MAX_STEPPER_CURRENT) || 2291;
var MIN_SSTEPPER_CURRENT = Number(process.env.MIN_SSTEPPER_CURRENT) || 360;
var MAX_SSTEPPER_CURRENT = Number(process.env.MAX_SSTEPPER_CURRENT) || 1640;
var DEFAULT_STEPPER_CURRENT = Number(process.env.DEFAULT_STEPPER_CURRENT) ||800;
var DEFAULT_STEPPER_MAX_SPEED = Number(process.env.DEFAULT_STEPPER_MAX_SPEED) ||1000;

function set_stepper_current(stepper_info) {
    var stepper = stepper_info.interface;
    if (stepper) {
        let new_current = stepper_info.motor_current.value;
        if (stepper.getBasicConfiguration) {
            // this is a SilentStepper; set MotorRunCurrent
            new_current = Math.max(MIN_SSTEPPER_CURRENT, Math.min(MAX_SSTEPPER_CURRENT, new_current));
            stepper.setBasicConfiguration(null, new_current);
        } else {
            new_current = Math.max(MIN_STEPPER_CURRENT, Math.min(MAX_STEPPER_CURRENT, new_current));
            stepper.setMotorCurrent(new_current);
        }
    }
}

function set_stepper(stepper_info) {
    var stepper = stepper_info.interface;
    if (stepper) {
        let velocity = Math.round(mapRange(stepper_info.velocity.value,
            0, 100, 0, stepper_info.max_motor_speed.value));
        if (velocity) {
            stepper.setMaxVelocity(Math.abs(velocity));
            if ((velocity<0) != (stepper.reverse.value==true)) {  // XOR operation
                stepper.driveBackward();
            }
            else {
                stepper.driveForward();
            }
        }
        else {
            stepper.stop();
        }

        if (stepper_info.enable.value === true) {
            stepper.enable();
        }
        else {
            stepper.stop();
            stepper.disable();
        }
    }
}

function setup_stepper(cascade, id, position) {
    var stepper_info = {
        id: id,
        position: position,
        interface: devices[id],
        enable: null,
        velocity: null,
        max_motor_speed: null,
        motor_current: null
    };

    var stepper = stepper_info.interface;

    if (stepper) {
        if (stepper.getBasicConfiguration) {
            // this is a silent stepper, set configurations
            stepper.setMotorCurrent(MAX_SSTEPPER_CURRENT);
            stepper.setBasicConfiguration(null, DEFAULT_STEPPER_CURRENT);
        } else {
            stepper.setMotorCurrent(DEFAULT_STEPPER_CURRENT);
        }
    }

    stepper_info.enable = cascade.create_component({
        id: id + "_enable",
        name: id + " Enable",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "stepper_enable",
        type: cascade.TYPES.BOOLEAN,
        value: false
    });

    stepper_info.enable.on("value_updated", function () {
        set_stepper(stepper_info);
    });

    stepper_info.velocity = cascade.create_component({
        id: id + "_velocity",
        name: id + " Velocity Percent",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "stepper_velocity",
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE,
        value: 0
    });

    stepper_info.velocity.on("value_updated", function () {
        set_stepper(stepper_info);
    });

    stepper_info.max_motor_speed = cascade.create_component({
        id: id + "_max_motor_speed",
        name: id + " Max Motor Speed (steps/sec)",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "stepper_configure",
        type: cascade.TYPES.NUMBER,
        value: DEFAULT_STEPPER_MAX_SPEED
    });

    stepper_info.max_motor_speed.on("value_updated", function () {
        set_stepper(stepper_info);
    });

    stepper_info.reverse = cascade.create_component({
        id: id + "_reverse",
        name: id + " Reverse",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "stepper_configure",
        type: cascade.TYPES.BOOLEAN,
        value: false
    });

    stepper_info.reverse.on("value_updated", function () {
        set_stepper(stepper_info);
    });

    stepper_info.motor_current = cascade.create_component({
        id: id + "_motor_current",
        name: id + " Motor Current (mA)",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "stepper_configure",
        type: cascade.TYPES.NUMBER,
        value: 0
    });

    stepper_info.motor_current.on("value_updated", function () {
        set_stepper_current(stepper_info);
    });

    steppers[id] = stepper_info;
    stepper_names.push(id);
}

function setup_barometer(cascade, id, position) {
    var barometer_info = {
        id: id,
        position: position,
        interface: devices[id],
        component: undefined
    };
    barometer_info.component = cascade.create_component({
        id: "barometer",  // assumes only one barometer per system
        name: "Barometer",
        group: SENSORS_GROUP,
        display_order: next_display_order(),
        class: "barometer",
        units: "mbar",
        type: cascade.TYPES.NUMBER
    });
}

function setup_onewire_net(cascade, id, position) {
    var ow_info = {
        id: id,
        position: position,
        interface: devices[id],
        probes: []
    };

    //  Set 12 bit resolution and generate individual OW probes.
    var owNet = devices[id];
    if (owNet) {

        owNet.tempSetResolution(12,
            function() {
                owNet.getAllTempSensors(function(error, probes) {
                    if (error) {
                        cascade.log_error(new Error("Onewire get-all-probes error: " + error));
                    }
                    else {
                        for (let ow_address of probes) {
                            let probe_address = id + "_" + ow_address;
                            create_temp_probe(cascade, probe_address);
                            ow_info.probes.push(probe_address);
                            ow_names.push(probe_address);
                        }
                    }
                });
            },
            function(error) {
                cascade.log_error(new Error("Onewire set-resolution error: " + error));
            }
        );
    }

    onewireNets[id] = ow_info;
}

function setup_1wire_net(cascade, id, position) {
    var ow_info = {
        id: id,
        position: position,
        interface: devices[id],
        probes: []
    };

    //  Set 12 bit resolution and generate individual OW probes.
    var owNet = devices[id];
    if (owNet) {

        owNet.tempSetResolution(12,
            function() {

                owNet.getConnectedDevices(function(error, probes) {
                    if (error) {
                        cascade.log_error(new Error("Onewire get-all-probes error: " + error));
                    }
                    else {
                        for (let ow_address of probes) {
                            // Check device_family for temperature probes.  Silently ignore others.
                            if (ow_address.startsWith("10") || ow_address.startsWith("28")) {
                                let probe_address = id + "_" + ow_address;
                                create_temp_probe(probe_address);
                                ow_info.probes.push(probe_address);
                                ow_names.push(probe_address);
                            }
                        }
                    }
                });
            },
            function(error) {
                cascade.log_error(new Error("Onewire set-resolution error: " + error));
            }
        );

        onewireNets[id] = ow_info;
    }
}

var PTC_WIRE_MODES = {
    NO_WIRE_MODE: undefined,
    TWO_WIRE: tinkerforge.BrickletPTCV2.WIRE_MODE_2,
    THREE_WIRE: tinkerforge.BrickletPTCV2.WIRE_MODE_3,
    FOUR_WIRE: tinkerforge.BrickletPTCV2.WIRE_MODE_4
};

function setup_ptc_probe(cascade, id, position) {
    var ptc_info = {
        id: id,
        position: position,
        interface: devices[id]
    };

    create_temp_probe(cascade, id);

    ptc_info.wire_mode = cascade.create_component({
        id: id + "_wire_mode",
        name: id + " Wire Mode",
        group: SENSORS_GROUP,
        display_order: next_display_order(),
        class: "ptc_configure",
        type: cascade.TYPES.OPTIONS,
        info: {options: Object.keys(PTC_WIRE_MODES)},
        value: "NO_WIRE_MODE"
    });

    ptc_info.wire_mode.on("value_updated", function () {
        var ptc = ptc_info.interface;
        if (ptc) {
            ptc.setWireMode(PTC_WIRE_MODES[ptc_info.wire_mode.value], null,
                function(error) {
                    cascade.log_error(new Error("Error on PTCV2.setWireMode: " + error));
                });
        }
    });

    var ptc = ptc_info.interface;
    if (ptc) {
        ptc.isSensorConnected(
            function(connected) {
                if (!connected) {
                    cascade.log_error(new Error(
                        "No sensor connected to PTC at " + ptc.position + "."));
                    return;
                }
                return;
            },
            function(error) {
                cascade.log_error(new Error("Error on PTCV2.isSensorConnected: " + error));
            });
    }

    ptcProbes[id] = ptc_info;
    ptc_names.push(id);
}

function setup_thermocouple_probe(cascade, id, position) {
    var tc_info = {
        id: id,
        position: position,
        interface: devices[id]
    };

    create_temp_probe(cascade, id);

    var tc = tc_info.interface;
    if (tc) {
        tc.setConfiguration(tinkerforge.BrickletThermocouple.AVERAGING_16,
            tinkerforge.BrickletThermocouple.TYPE_K,
            tinkerforge.BrickletThermocouple.FILTER_OPTION_60HZ);
    }

    thermocoupleProbes[id] = tc_info;
    tc_names.push(id);
}

function create_temp_probe(cascade, probe_name) {
    var probe_component = {};

    probe_component.raw = cascade.create_component({
        id: probe_name + "_raw",
        name: probe_name + " Raw",
        group: SENSORS_GROUP,
        display_order: next_display_order(),
        class: "raw_temperature",
        read_only: true,
        units: cascade.UNITS.C,
        type: cascade.TYPES.NUMBER
    });

    probe_component.calibration = cascade.create_component({
        id: probe_name + "_calibration",
        name: probe_name + " Calibration",
        group: SENSORS_GROUP,
        display_order: next_display_order(),
        persist: true,
        units: cascade.UNITS.C,
        type: cascade.TYPES.NUMBER
    });

    probe_component.calibrated = cascade.create_component({
        id: probe_name + "_calibrated",
        name: probe_name + " Calibrated",
        group: SENSORS_GROUP,
        display_order: next_display_order(),
        class: "calibrated_temperature",
        read_only: true,
        units: cascade.UNITS.C,
        type: cascade.TYPES.NUMBER
    });

    tempProbes[probe_name] = probe_component;
}

function create_hard_resource_list_component(cascade, id, list) {
    var type;
    var value = list.join(" ");
    if (value.length > 32) {
        type = cascade.TYPES.BIG_TEXT;
    }
    else {
        type = cascade.TYPES.TEXT;
    }

    let component = cascade.create_component({
        id: id,
        group: RESOURCE_NAMES_GROUP,
        display_order: next_display_order(),
        read_only: true,
        type: type,
        value: value
    });
    component.value = value;
}

module.exports.setup = function (cascade) {

    if (TESTING) {
        let id;
        // for testing we fabricate some hardware interfaces
        for (let pos of ["3A", "3B"]) {
            id = "OW_"+pos;
            setup_onewire_net(cascade, id, pos);
            let ow_info = onewireNets[id];
            for (let x of [0, 1, 2, 3, 4]) {
                let ow_address =  "28" + "0" + x + Math.random().toString(16).slice(2,12);
                let probe_address = id + "_" + ow_address;
                create_temp_probe(cascade, probe_address);
                ow_info.probes.push(probe_address);
                ow_names.push(probe_address);
            }
        }

        for (let pos of ["1A", "1B"]) {
            id = "TC_"+pos;
            setup_thermocouple_probe(cascade, id, pos);
        }

        for (let pos of ["1C", "1D"]) {
            id = "PTC_"+pos;
            setup_ptc_probe(cascade, id, pos);
        }

        for (let pos of ["2A", "2B", "2C", "2D"]) {
            id = "DAC_"+pos;
            setup_dac(cascade, id, pos);
        }

        for (let pos of ["3C", "3D"]) {
            id = "QUADRELAY_"+pos;
            setup_quadrelay(cascade, id, pos);
        }

        setup_stepper(cascade, "STEPPER_4", "4");

        setup_barometer(cascade, "barometer_4A", "4A");
    }
    else {
        tinkerforge_connection.create(function (error, ipcon) {
            if (error) {
                throw error;
            }

            var masterbrick_position = {};
            ipcon.on(tinkerforge.IPConnection.CALLBACK_ENUMERATE,
                function (uid, connectedUid, position, hardwareVersion, firmwareVersion, deviceIdentifier, enumerationType) {

                    position = position.toUpperCase();

                    if (enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_DISCONNECTED) {
                        for (var key in devices) {
                            var device = devices[key];

                            if (device.uid_string === uid) {
                                delete devices[key];
                                return;
                            }
                        }
                    }
                    else if (enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_CONNECTED ||
                             enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_AVAILABLE) {
                        switch (deviceIdentifier) {
                            case tinkerforge.BrickMaster.DEVICE_IDENTIFIER : {
                                masterbrick_position[uid] = position;
                                break;
                            }
                            case tinkerforge.BrickletOneWire.DEVICE_IDENTIFIER : {
                                // This is the new TF one wire bricklet
                                let owNet = new onewireTempSensors(uid, ipcon);
                                owNet.in_use = false;

                                owNet.uid_string = uid;
                                owNet.position = masterbrick_position[connectedUid] + position;

                                let ow_id = "OW_" + owNet.position;
                                devices[ow_id] = owNet;

                                setup_onewire_net(cascade, ow_id, owNet.position);
                                break;
                            }
                            case Bricklet1Wire.DEVICE_IDENTIFIER : {
                                let owNet = new Bricklet1Wire(uid, ipcon);
                                owNet.in_use = false;

                                owNet.uid_string = uid;
                                owNet.position = masterbrick_position[connectedUid] + position;

                                let ow_id = "OW_" + owNet.position;
                                devices[ow_id] = owNet;

                                setup_1wire_net(cascade, ow_id, owNet.position);
                                break;
                            }
                            case tinkerforge.BrickletThermocouple.DEVICE_IDENTIFIER : {
                                var tc = new tinkerforge.BrickletThermocouple(uid, ipcon);

                                tc.uid_string = uid;
                                tc.position = masterbrick_position[connectedUid] + position;

                                var tc_id = "TC_" + tc.position;
                                devices[tc_id] = tc;

                                setup_thermocouple_probe(cascade, tc_id, tc.position);
                                break;
                            }
                            case tinkerforge.BrickletPTCV2.DEVICE_IDENTIFIER : {
                                var ptc = new tinkerforge.BrickletPTCV2(uid, ipcon);

                                ptc.uid_string = uid;
                                ptc.position = masterbrick_position[connectedUid] + position;
                                let ptc_id = "PTC_" + ptc.position;
                                devices[ptc_id] = ptc;

                                setup_ptc_probe(cascade, ptc_id, ptc.position);
                                break;
                            }
                            case tinkerforge.BrickletIndustrialAnalogOut.DEVICE_IDENTIFIER : {
                                var dac = new tinkerforge.BrickletIndustrialAnalogOut(uid, ipcon);
                                dac.disable();
                                dac.setVoltage(0);
                                dac.setCurrent(0);

                                dac.uid_string = uid;
                                dac.position = masterbrick_position[connectedUid] + position;

                                var dac_id = "DAC_" + dac.position;
                                devices[dac_id] = dac;

                                setup_dac(cascade, dac_id, dac.position);
                                break;
                            }
                            case tinkerforge.BrickletIndustrialQuadRelay.DEVICE_IDENTIFIER : {
                                var quadrelay = new tinkerforge.BrickletIndustrialQuadRelay(uid, ipcon);

                                quadrelay.uid_string = uid;
                                quadrelay.position = masterbrick_position[connectedUid] + position;

                                var quadrelay_id = "QUADRELAY_" + quadrelay.position;
                                devices[quadrelay_id] = quadrelay;

                                setup_quadrelay(cascade, quadrelay_id, quadrelay.position );
                                break;
                            }
                            case tinkerforge.BrickletBarometer.DEVICE_IDENTIFIER : {
                                var barometer = new tinkerforge.BrickletBarometer(uid, ipcon);

                                barometer.uid_string = uid;
                                barometer.position = masterbrick_position[connectedUid] + position.toUpperCase;

                                var barometer_id = "barometer_" + barometer.position;
                                devices[barometer_id] = barometer;

                                setup_barometer(cascade, barometer_id, barometer.position);
                                break;
                            }
                            case tinkerforge.BrickSilentStepper.DEVICE_IDENTIFIER : {
                                // this brick can have up to 2 bricklets
                                masterbrick_position[uid] = position;

                                var sstepper = new tinkerforge.BrickSilentStepper(uid, ipcon);
                                sstepper.stop();
                                sstepper.disable();

                                sstepper.uid_string = uid;
                                sstepper.position = position;
                                let sstepper_id = "sstepper_" + sstepper.position;
                                devices[sstepper_id] = sstepper;

                                setup_stepper(cascade, sstepper_id, sstepper.position);

                                break;
                            }
                            case tinkerforge.BrickStepper.DEVICE_IDENTIFIER : {
                                // this brick can have up to 2 bricklets
                                masterbrick_position[uid] = position;

                                var stepper = new tinkerforge.BrickStepper(uid, ipcon);
                                stepper.stop();
                                stepper.disable();

                                stepper.uid_string = uid;
                                stepper.position = position;
                                let stepper_id = "stepper_" + stepper.position;
                                devices[stepper_id] = stepper;

                                setup_stepper(cascade, stepper_id, stepper.position);

                                break;
                            }
                            case tinkerforge.BrickletIndustrialDual020mA.DEVICE_IDENTIFIER : {

                                cascade.log_error(new Error("Device not yet supported: BrickletIndustrialDual020mA"));
                                break;
                            }
                            case tinkerforge.BrickletIndustrialDual020mAV2.DEVICE_IDENTIFIER : {

                                cascade.log_error(new Error("Device not yet supported: BrickletIndustrialDual020mAV2"));
                                break;
                            }
                            case tinkerforge.BrickletIO4V2.DEVICE_IDENTIFIER : {

                                cascade.log_error(new Error("Device not yet supported: BrickletIO4V2"));
                                break;
                            }
                            case tinkerforge.BrickletDistanceIRV2.DEVICE_IDENTIFIER : {

                                cascade.log_error(new Error("Device not yet supported: BrickletDistanceIRV2"));
                                break;
                            }
                        }
                    }
                });

            ipcon.enumerate();
        });
    }

    // Provide time for tinkerforge stack enumeration to complete.
    setTimeout(function() {
        // create device selection components from name lists
        create_hard_resource_list_component(cascade, "RELAY_names", relay_names.sort());
        create_hard_resource_list_component(cascade, "DAC_names", dac_names.sort());
        create_hard_resource_list_component(cascade, "STEPPER_names", stepper_names.sort());
        create_hard_resource_list_component(cascade, "PTC_PROBE_names", ptc_names.sort());
        create_hard_resource_list_component(cascade, "TC_PROBE_names", tc_names.sort());
        create_hard_resource_list_component(cascade, "OW_PROBE_names", ow_names.sort());
        create_hard_resource_list_component(cascade, "TEMP_PROBE_names",
            ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
    }, 2000);
};


module.exports.loop = function (cascade) {
    //var online = true;

    _.each(quadrelays, function(quadrelay_info, id) {
        if (!devices[id]) null;  //online = false;
    });

    _.each(dacs, function (dac_info, id) {

        var dac_interface = devices[id];

        if (!dac_interface) {
            //online = false;
            dac_info.interface = null;
        }
        else if (!dac_info.interface) {
            dac_info.interface = dac_interface;
            set_dac(dac_info);
        }
    });

    _.each(thermocoupleProbes, function (tc_info, id) {
        let tempProbe = tempProbes[id];

        if(!tempProbe) {
            create_temp_probe(cascade, id);
            tempProbe = tempProbes[id];
        }

        var tcDevice = devices[id];
        if (tcDevice) {
            tcDevice.getTemperature(function (temperature) {
                var tempValue = temperature / 100;
                tempProbe.raw.value = tempValue;
                tempProbe.calibrated.value = tempValue + (tempProbe.calibration.value || 0);
            });
        }
    });

    _.each(ptcProbes, function (ptc_info, id) {
        let tempProbe = tempProbes[id];

        if(!tempProbe) {
            create_temp_probe(cascade, id);
            tempProbe = tempProbes[id];
        }

        var ptcDevice = devices[id];
        if (ptcDevice) {
            ptcDevice.getTemperature(function (temperature) {
                var tempValue = temperature / 100;
                tempProbe.raw.value = tempValue;
                tempProbe.calibrated.value = tempValue + (tempProbe.calibration.value || 0);
            });
        }
    });

    _.each(onewireNets, function(ow_info, id) {
        var ow = devices[id];
        if (ow && !ow.in_use) {
            ow.in_use = true;
            ow.getAllTemperatures(function (error, probes) {
                if (error) {
                    cascade.log_error(new Error("Unable to retrieve temperatures from onewire " + id + ": " + error));
                    ow.in_use = false;
                    return;
                }

                for (let netAddress in probes) {
                    var tempValue = probes[netAddress];
                    let probe_name = id + "_" + netAddress;
                    var tempComponent = tempProbes[probe_name];
                    if (!tempComponent) {
                        create_temp_probe(cascade, probe_name);
                        tempComponent = tempProbes[probe_name];
                    }

                    tempComponent.raw.value = tempValue;
                    tempComponent.calibrated.value = tempValue + (tempComponent.calibration.value || 0);
                }
                ow.in_use = false;
            });
        }
    });

    _.each(barometers, function(barometer_info, id) {
        var barometerDevice = devices[id];
        if (barometerDevice) {
            barometerDevice.getAirPressure(
                function(airPressure) {barometer_info.component.value = airPressure / 1000;});
        }
    });
};
