var _ = require("underscore");
var tinkerforge = require("tinkerforge");
var tinkerforge_connection = require("./../lib/tinkerforge_connection");
var Bricklet1Wire = require("./../lib/Bricklet1Wire");  // old 1wire bricklet
var onewireTempSensors = require("./../lib/onewire_temp_sensors");  // sensor interface for new 1wire bricklet

var TESTING = Boolean(process.env.TESTING) || false;

var SENSORS_GROUP = "97  HR Sensors";
var PROCESS_CONTROLS_GROUP = "98  HR Controls";
var RESOURCE_NAMES_GROUP = "99  Hard Resources";

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
var input_names = [];  // of io4
var output_names = []; // of io4
var dist_names = [];
var ow_names = [];
var ptc_names = [];
var tc_names = [];

//info structures by type (at quadrelay or onewire level)  indexed by device id (eg "DAC_3C", "OW_2A", "RELAY_2B").
var quadrelays = {};
var dacs = {};
var steppers = {};
var io4s = {};
var barometers = {};
var distIRs = {};
var onewireNets = {};
var thermocoupleProbes = {};
var ptcProbes = {};
//var barometer_component;

// all temp probes by probe ids (tc_id, ptc_id, or ow_id + probe)
var tempProbes = {};

// tinkerforge hardware interfaces indexed by device id (eg "DAC_3C").
var devices = {};

var add_name_to_list = function(list, name, sorted) {
    if (!name) return;
    let i_name = list.indexOf(name);
    if (i_name >= 0) return;  // already in list
    list.push(name);
    if (sorted) {
        list.sort();
    }
    return name;
};

var remove_name_from_list = function(list, name) {
    if (!name) return;
    let i_name = list.indexOf(name);
    if (i_name < 0) return;
    list.splice(i_name, 1);
    return name;
};


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
        relay_component.on("value_updated", function() { set_relays(quadrelay_info); });

        relay_names.push(relay_id);
        //update_hard_resource_list_component(cascade, "RELAY_HR_names", relay_names.sort());
    }

    quadrelays[id] = quadrelay_info;
}

function mapRange(value, in_min, in_max, out_min, out_max) {
    var output = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    return output;
    //return Math.max(out_min, Math.min(output, out_max));
}

var DAC_OUTPUT_TYPES = {
    VOLTAGE_RANGE_0_TO_5V: function (tfInterface, outputPercent) {
        //tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOutV2.VOLTAGE_RANGE_0_TO_5V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 5000));
        tfInterface.setVoltage(output);
    },
    VOLTAGE_RANGE_0_TO_10V: function (tfInterface, outputPercent) {
        //tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOutV2.VOLTAGE_RANGE_0_TO_10V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 10000));
        tfInterface.setVoltage(output);
    },
    CURRENT_RANGE_4_TO_20MA: function (tfInterface, outputPercent) {
        //tfInterface.setConfiguration(0, tinkerforge.BrickletIndustrialAnalogOutV2.CURRENT_RANGE_4_TO_20MA);
        var output = Math.round(mapRange(outputPercent, 0, 100, 4000, 20000));
        tfInterface.setCurrent(output);
    },
    CURRENT_RANGE_0_TO_20MA: function (tfInterface, outputPercent) {
        //tfInterface.setConfiguration(0, tinkerforge.BrickletIndustrialAnalogOutV2.CURRENT_RANGE_0_TO_20MA);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 20000));
        tfInterface.setCurrent(output);
    },
    CURRENT_RANGE_0_TO_24MA: function (tfInterface, outputPercent) {
        //tfInterface.setConfiguration(0, tinkerforge.BrickletIndustrialAnalogOutV2.CURRENT_RANGE_0_TO_24MA);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 24000));
        tfInterface.setCurrent(output);
    },
};

function set_dac(dac_info) {
    let dac = dac_info.interface;
    if (dac) {

        if (dac_info.set_configuration) {
            let config = dac_info.output_type.value;
            if (config) {
                dac_info.set_configuration = false;
                dac_info.setFunction = DAC_OUTPUT_TYPES[config];
                dac.setConfiguration(0, tinkerforge.BrickletIndustrialAnalogOutV2[config]);
            }
        }
    
        if (dac_info.setFunction) {

            dac_info.setFunction(dac, dac_info.output.value);

            if (dac_info.enable.value === true) {
                if (dac.setEnabled) dac.setEnabled(true);  // V2
                else dac.enable();                         // V1
            }
            else {
                if (dac.setEnabled) dac.setEnabled(false);  // V2
                else dac.disable();                         // V1
            }
        }
        else {
            if (dac.setEnabled) dac.setEnabled(false);  // V2
            else dac.disable();                         // V1
        }
    }
}

function setup_dac(cascade, id, position) {
    var dac_info = {
        id: id,
        position: position,
        interface: devices[id],
        setFunction: DAC_OUTPUT_TYPES.NO_OUTPUT,
        set_configuration: true;
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
        persist: true,
        type: cascade.TYPES.OPTIONS,
        info: {options: Object.keys(DAC_OUTPUT_TYPES)},
    });

    dac_info.output_type.on("value_updated", function () {
        dac_info.set_configuration = true;
        //set_dac(dac_info);
    });

    // eslint-disable-next-line no-self-assign
    dac_info.output_type.value = dac_info.output_type.value;

    dacs[id] = dac_info;
    dac_names.push(id);
    //update_hard_resource_list_component(cascade, "DAC_HR_names", dac_names.sort());
}

var MIN_STEPPER_CURRENT = Number(process.env.MIN_STEPPER_CURRENT) || 100;
var MAX_STEPPER_CURRENT = Number(process.env.MAX_STEPPER_CURRENT) || 2291;
var MIN_SSTEPPER_CURRENT = Number(process.env.MIN_SSTEPPER_CURRENT) || 360;
var MAX_SSTEPPER_CURRENT = Number(process.env.MAX_SSTEPPER_CURRENT) || 1640;
var DEFAULT_STEPPER_CURRENT = Number(process.env.DEFAULT_STEPPER_CURRENT) ||800;
var DEFAULT_STEPPER_MAX_SPEED = Number(process.env.DEFAULT_STEPPER_MAX_SPEED) ||5000;

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
        if (stepper_info.enable.value === true) {
            stepper.enable();
        }

        let velocity = Math.round(mapRange(stepper_info.velocity.value,
            0, 100, 0, stepper_info.max_motor_speed.value));
        if (velocity) {
            stepper.setMaxVelocity(Math.min(65535, Math.abs(velocity)));
            if ((velocity<0) != (stepper_info.reverse.value==true)) {  // XOR operation
                stepper.driveBackward();
            }
            else {
                stepper.driveForward();
            }
        }
        else {
            stepper.stop();
        }

        if (stepper_info.enable.value === false) {
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
        persist: true,
        type: cascade.TYPES.NUMBER,
    });

    stepper_info.max_motor_speed.on("value_updated", function () {
        set_stepper(stepper_info);
    });

    if (stepper_info.max_motor_speed.value) {
        // eslint-disable-next-line no-self-assign
        stepper_info.max_motor_speed.value = stepper_info.max_motor_speed.value;
    }
    else {
        stepper_info.max_motor_speed.value = DEFAULT_STEPPER_MAX_SPEED;
    }

    stepper_info.reverse = cascade.create_component({
        id: id + "_reverse",
        name: id + " Reverse",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "stepper_configure",
        persist: true,
        type: cascade.TYPES.BOOLEAN,
    });

    stepper_info.reverse.on("value_updated", function () {
        set_stepper(stepper_info);
    });

    // eslint-disable-next-line no-self-assign
    stepper_info.reverse.value = stepper_info.reverse.value;

    stepper_info.motor_current = cascade.create_component({
        id: id + "_motor_current",
        name: id + " Motor Current (mA)",
        group: PROCESS_CONTROLS_GROUP,
        display_order: next_display_order(),
        class: "stepper_configure",
        persist: true,
        type: cascade.TYPES.NUMBER,
    });

    stepper_info.motor_current.on("value_updated", function () {
        set_stepper_current(stepper_info);
    });

    // eslint-disable-next-line no-self-assign
    stepper_info.motor_current.value = stepper_info.motor_current.value;

    steppers[id] = stepper_info;
    stepper_names.push(id);
    //update_hard_resource_list_component(cascade, "STEPPER_HR_names", stepper_names.sort());
}

var IO4_CONFIGURATION = [
    "INPUT_WITH_PULLUP",
    "INPUT_FLOATING",
    "OUTPUT_INITIALIZED_LOW",
    "OUTPUT_INITIALIZED_HIGH",
];

function configure_io4(cascade, io4_info, io_index) {
    let io = io4_info.interface;
    if (io && io4_info.configuration[io_index]) {
        let direction;
        let value;
        let configuration = io4_info.configuration[io_index].value;
        if (configuration) {
            let port_name = io4_info.port_value[io_index].id;
            if (configuration.startsWith("INPUT")) {
                direction = "i";
                value = configuration.endsWith("PULLUP");
                add_name_to_list(input_names, port_name, true);
                remove_name_from_list(output_names, port_name);
            } else {
                direction = "o";
                value = configuration.endsWith("HIGH");
                add_name_to_list(output_names, port_name, true);
                remove_name_from_list(input_names, port_name);
            }
            
            io.setConfiguration(io_index, direction, value);
            
            if (direction == "i") {
                io.on(tinkerforge.BrickletIO4V2.CALLBACK_INPUT_VALUE, 
                    function(channel, changed, value) {
                        io4_info.port_value[channel].value = value;
                    });
                io.setInputValueCallbackConfiguration(io_index, 30, true);
                io.getValue(function(value) {
                    io4_info.port_value[io_index].value = value[io_index];
                });
            } else {
                io.setInputValueCallbackConfiguration(io_index, 0, false);
            }
            
            // If HR_names components are already created, then update them.
            if (cascade.components.all_current["BIT_IN_HR_names"]) {
                update_hard_resource_list_component(cascade,
                    "BIT_IN_HR_names", input_names.sort());
                update_hard_resource_list_component(cascade,
                    "BIT_OUT_HR_names", output_names.sort());
            }
        }
    }
}

function set_io4(io4_info, io_index) {
    let io = io4_info.interface;
    if (io && io4_info.port_value[io_index]) {
        io.setSelectedValue(io_index, io4_info.port_value[io_index].value);
    }
}

function setup_io4(cascade, id, position) {
    var io4_info = {
        id: id,
        position: position,
        interface: devices[id],
        port_value: [undefined, undefined, undefined, undefined],
        configuration: [undefined, undefined, undefined, undefined],
    };

    for(let io_index in [0,1,2,3]) {
        let io_id_base = "IO_" + position;
        let io_id = io_id_base + "_" + io_index;
        io4_info.port_value[io_index] = cascade.create_component({
            id: io_id,
            name: io_id_base + " # " + io_index,
            group: PROCESS_CONTROLS_GROUP,
            display_order: next_display_order(),
            class: "io",
            type: cascade.TYPES.BOOLEAN,
            value: false
        });
        
        io4_info.configuration[io_index] = cascade.create_component({
            id: io_id + "_configuration",
            name: io_id + " IO Configuration",
            group: PROCESS_CONTROLS_GROUP,
            display_order: next_display_order(),
            class: "io_configure",
            persist: true,
            type: cascade.TYPES.OPTIONS,
            info: {options: IO4_CONFIGURATION},
        });
    
        io4_info.configuration[io_index].on("value_updated", function () {
            configure_io4(cascade, io4_info, io_index);
        });
        // eslint-disable-next-line no-self-assign
        io4_info.configuration[io_index].value = io4_info.configuration[io_index].value;

        io4_info.port_value[io_index].on("value_updated", function() {
            set_io4(io4_info, io_index); 
        });
    }
    io4s[id] = io4_info;
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
        read_only: true,
        units: "mbar",
        type: cascade.TYPES.NUMBER
    });

    barometers[id] = barometer_info;
}

function configure_dist_ma(dist_info) {
    let dist = dist_info.interface;
    if (dist) {
        dist.setMovingAverageConfiguration(dist_info.dist_ma.value);
    }
}

function setup_distIR(cascade, id, position) {
    var dist_info = {
        id: id,
        position: position,
        interface: devices[id],
        dist: undefined,
        dist_ma: undefined,
    };

    dist_info.dist = cascade.create_component({
        id: id + "_distance",
        group: SENSORS_GROUP,
        display_order: next_display_order(),
        class: "dist",
        read_only: true,
        units: "mm",
        type: cascade.TYPES.NUMBER
    });

    let dist = dist_info.interface;

    if (dist) {
        dist.setDistanceCallbackConfiguration(1000, false, "x", 0, 0);
            
        dist.on(tinkerforge.BrickletDistanceIRV2.CALLBACK_DISTANCE, function(distance) {
            dist_info.dist.value = distance;
        });
    }
        
    dist_info.dist_ma = cascade.create_component({
        id: id + "_ma",
        name: id + " Moving Average Length",
        group: SENSORS_GROUP,
        display_order: next_display_order(),
        class: "dist_ma",
        persist: true,
        type: cascade.TYPES.NUMBER,
        value: 50,
    });

    dist_info.dist_ma.on("value_updated", function () {
        configure_dist_ma(dist_info);
    });
    // eslint-disable-next-line no-self-assign
    dist_info.dist_ma.value = dist_info.dist_ma.value;

    dist_names.push(id);
    distIRs[id] = dist_info;
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

        // The tempSetResolution call does not return nor error -- unknown bug
        owNet.tempSetResolution(12, null,
            function(error) {
                cascade.log_error(new Error("Onewire set-resolution error: " + error));
            });
        owNet.getAllTempSensors(
            function(error, probes) {
                if (error) {
                    cascade.log_error(new Error("Onewire get-all-probes error: " + error));
                }
                else {
                    for (let ow_address of probes) {
                        let probe_address = id + "_" + ow_address;
                        create_temp_probe(cascade, probe_address);
                        ow_info.probes.push(probe_address);
                        ow_names.push(probe_address);
                        //update_hard_resource_list_component(cascade, "OW_PROBE_HR_names",
                        //    ow_names.sort());
                        //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
                        //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
                    }
                }
            });
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
                                //update_hard_resource_list_component(cascade, "OW_PROBE_HR_names",
                                //    ow_names.sort());
                                //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
                                //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));

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
        persist: true,
        type: cascade.TYPES.OPTIONS,
        info: {options: Object.keys(PTC_WIRE_MODES)},
    });

    ptc_info.wire_mode.on("value_updated", function () {
        var ptc = ptc_info.interface;
        if (ptc && ptc_info.wire_mode.value) {
            ptc.setWireMode(PTC_WIRE_MODES[ptc_info.wire_mode.value], null,
                function(error) {
                    cascade.log_error(new Error("Error on PTCV2.setWireMode: " + error));
                });
        }
    });

    // eslint-disable-next-line no-self-assign
    ptc_info.wire_mode.value = ptc_info.wire_mode.value;

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
    //update_hard_resource_list_component(cascade, "PTC_PROBE_HR_names", ptc_names.sort());
    //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
    //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
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
    //update_hard_resource_list_component(cascade, "TC_PROBE_HR_names", tc_names.sort());
    //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
    //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));

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

function update_hard_resource_list_component(cascade, id, list) {

    var value = list.join(" ");
    var component = cascade.components.all_current[id];

    if (!component) {
        var type;
        if (value.length > 32) {
            type = cascade.TYPES.BIG_TEXT;
        }
        else {
            type = cascade.TYPES.TEXT;
        }

        cascade.create_component({
            id: id,
            group: RESOURCE_NAMES_GROUP,
            display_order: next_display_order(),
            read_only: true,
            type: type,
            value: value
        });
    }
    else {
        component.value = value;
    }
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
                //update_hard_resource_list_component(cascade, "OW_PROBE_HR_names",
                //    ow_names.sort());
                //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
                //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
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

        setup_distIR(cascade, "DIST_3A", "3A");
        setup_io4(cascade, "IO_3B", "3B");

        for (let pos of ["3C", "3D"]) {
            id = "QUADRELAY_" + pos;
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
                            case tinkerforge.BrickletIndustrialAnalogOut.DEVICE_IDENTIFIER : 
                            case tinkerforge.BrickletIndustrialAnalogOutV2.DEVICE_IDENTIFIER : {
                                let dac;
                                if (deviceIdentifier == tinkerforge.BrickletIndustrialAnalogOut.DEVICE_IDENTIFIER) {
                                    dac = new tinkerforge.BrickletIndustrialAnalogOut(uid, ipcon);
                                    dac.disable();
                                } else {
                                    dac = new tinkerforge.BrickletIndustrialAnalogOutV2(uid, ipcon);
                                    dac.setEnabled(false);
                                }
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
                            case tinkerforge.BrickSilentStepper.DEVICE_IDENTIFIER : 
                            case tinkerforge.BrickStepper.DEVICE_IDENTIFIER : {
                                // this brick can have up to 2 bricklets
                                masterbrick_position[uid] = position;

                                let stepper;
                                let stepper_id;
                                if (deviceIdentifier == tinkerforge.BrickSilentStepper.DEVICE_IDENTIFIER) {
                                    stepper = new tinkerforge.BrickSilentStepper(uid, ipcon);
                                    stepper_id = "SSTEPPER_";
                                } else {
                                    stepper = new tinkerforge.BrickStepper(uid, ipcon);
                                    stepper_id = "STEPPER_";
                                }
                                stepper.stop();
                                stepper.disable();

                                stepper.uid_string = uid;
                                stepper.position = position;
                                stepper_id = stepper_id + stepper.position;
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

                                var IO4 = new tinkerforge.BrickletIO4V2(uid, ipcon);

                                IO4.uid_string = uid;
                                IO4.position = masterbrick_position[connectedUid] + position;
                                let IO4_id = "IO4_" + IO4.position;
                                devices[IO4_id] = IO4;

                                setup_io4(cascade, IO4_id, IO4.position);

                                break;
                            }
                            case tinkerforge.BrickletDistanceIRV2.DEVICE_IDENTIFIER : {

                                var distIR = new tinkerforge.BrickletDistanceIRV2(uid, ipcon);

                                distIR.uid_string = uid;
                                distIR.position = masterbrick_position[connectedUid] + position;
                                let distIR_id = "DISTIR_" + distIR.position;
                                devices[distIR_id] = distIR;

                                setup_distIR(cascade, distIR_id, distIR.position);

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
        update_hard_resource_list_component(cascade, "RELAY_HR_names", relay_names.sort());
        update_hard_resource_list_component(cascade, "DAC_HR_names", dac_names.sort());
        update_hard_resource_list_component(cascade, "STEPPER_HR_names", stepper_names.sort());
        update_hard_resource_list_component(cascade, "BIT_IN_HR_names", input_names.sort());
        update_hard_resource_list_component(cascade, "BIT_OUT_HR_names", output_names.sort());
        update_hard_resource_list_component(cascade, "DISTANCE_HR_names", dist_names.sort());
        update_hard_resource_list_component(cascade, "PTC_PROBE_HR_names", ptc_names.sort());
        update_hard_resource_list_component(cascade, "TC_PROBE_HR_names", tc_names.sort());
        update_hard_resource_list_component(cascade, "OW_PROBE_HR_names", ow_names.sort());
        update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
            ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
    }, 10000);
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
