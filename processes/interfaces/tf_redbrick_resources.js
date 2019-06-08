var tinkerforge = require("tinkerforge");
var tinkerforge_connection = require("./../lib/tinkerforge_connection");
var onewireTempSensors = require("./../lib/onewire_temp_sensors");  // sensor interface for 1wire bricklet

var ONEWIRE_ERROR_LIMIT = 3;

var SENSORS_GROUP = "97  HR Sensors";
var PROCESS_CONTROLS_GROUP = "98  HR Controls";
var RESOURCE_NAMES_GROUP = "99  Hard Resources";
var RUN_GROUP = "00  Run";

// Display orders:
var global_display_order = 100;
var next_display_order = function(skip) {
    let rtn = global_display_order;
    global_display_order += skip || 1;
    return rtn;
};
var RELAY_DISPLAY_BASE = 1000;
var IO4_DISPLAY_BASE = 2000;
var DAC_DISPLAY_BASE = 3000;
var STEPPER_DISPLAY_BASE = 4000;
var BAROMETER_DISPLAY_BASE = 10000;
var DISTIR_DISPLAY_BASE = 11000;
var PTC_DISPLAY_BASE = 12000;
var TC_DISPLAY_BASE = 13000;
var OW_DISPLAY_BASE = 14000;
var HR_LISTS_DISPLAY_BASE = 20000;


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
var allDevices = {};

var max_temp;  // max value of all probes (component)

// flag to signal loop function when setup is complete and it can proceed.
var setup_complete = false;

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
        if (relay_interface.getChannelLEDConfig) {
            // this is V2 of hardware
            var values = quadrelay_info.relays.map(
                function(relay) {return relay.value;}
            );
            relay_interface.setValue(values);
            return;
        }

        var bitmask = 0;
        for (let relay_index in quadrelay_info.relays) {
            let relay = quadrelay_info.relays[relay_index];
            bitmask = bitmask | (relay.value << relay_index);
        }

        relay_interface.setValue(bitmask);
    }
}

function setup_quadrelay(cascade, id, quadrelay) {
    let display_base = RELAY_DISPLAY_BASE + next_display_order(5);

    var quadrelay_info = {
        id: id,
        interface: quadrelay,
        relays: []
    };

    for(let relay_index in [0,1,2,3]) {
        let relay_id_base = "RELAY_" + quadrelay.position;
        let relay_id = relay_id_base + "_" + relay_index;
        let relay_component = cascade.create_component({
            id: relay_id,
            name: relay_id_base + " # " + relay_index,
            group: PROCESS_CONTROLS_GROUP,
            display_order: display_base + Number(relay_index),
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
    allDevices[id] = quadrelay_info;
}

function mapRange(value, in_min, in_max, out_min, out_max) {
    var output = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    return output;
    //return Math.max(out_min, Math.min(output, out_max));
}

var DAC_OUTPUT_TYPES = {
    VOLTAGE_RANGE_0_TO_5V: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOutV2.VOLTAGE_RANGE_0_TO_5V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 5000));
        tfInterface.setVoltage(output);
    },
    VOLTAGE_RANGE_0_TO_10V: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOutV2.VOLTAGE_RANGE_0_TO_10V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 10000));
        tfInterface.setVoltage(output);
    },
    VOLTAGE_RANGE_2_TO_10V: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(tinkerforge.BrickletIndustrialAnalogOutV2.VOLTAGE_RANGE_2_TO_10V, 0);
        var output = Math.round(mapRange(outputPercent, 0, 100, 2000, 10000));
        tfInterface.setVoltage(output);
    },
    CURRENT_RANGE_4_TO_20MA: function (tfInterface, outputPercent) {
        tfInterface.setConfiguration(0, tinkerforge.BrickletIndustrialAnalogOutV2.CURRENT_RANGE_4_TO_20MA);
        var output = Math.round(mapRange(outputPercent, 0, 100, 4000, 20000));
        tfInterface.setCurrent(output);
    }
};

function set_dac(dac_info) {
    let dac = dac_info.interface;
    if (dac) {

        dac_info.setFunction = DAC_OUTPUT_TYPES[dac_info.output_type.value];
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

function setup_dac(cascade, id, dac) {
    let display_base = DAC_DISPLAY_BASE + next_display_order(5);

    var dac_info = {
        id: id,
        interface: dac,
        setFunction: DAC_OUTPUT_TYPES.NO_OUTPUT
    };

    dac_info.enable = cascade.create_component({
        id: id + "_enable",
        name: id + " Enable",
        group: PROCESS_CONTROLS_GROUP,
        display_order: display_base,
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
        display_order: display_base + 1,
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
        display_order: display_base + 2,
        class: "dac_configure",
        persist: true,
        type: cascade.TYPES.OPTIONS,
        info: {options: Object.keys(DAC_OUTPUT_TYPES)},
    });

    dac_info.output_type.on("value_updated", function () {
        set_dac(dac_info);
    });

    // eslint-disable-next-line no-self-assign
    dac_info.output_type.value = dac_info.output_type.value;

    dacs[id] = dac_info;
    allDevices[id] = dac_info;
    dac_names.push(id);
    //update_hard_resource_list_component(cascade, "DAC_HR_names", dac_names.sort());
}

var MIN_STEPPER_CURRENT = Number(process.env.MIN_STEPPER_CURRENT) || 100;
var MAX_STEPPER_CURRENT = Number(process.env.MAX_STEPPER_CURRENT) || 2291;
var MIN_SSTEPPER_CURRENT = Number(process.env.MIN_SSTEPPER_CURRENT) || 360;
var MAX_SSTEPPER_CURRENT = Number(process.env.MAX_SSTEPPER_CURRENT) || 1640;
var DEFAULT_STEPPER_CURRENT = Number(process.env.DEFAULT_STEPPER_CURRENT) ||800;
var DEFAULT_STEPPER_MAX_SPEED = Number(process.env.DEFAULT_STEPPER_MAX_SPEED) ||5000;
var STEPPER_RESOLUTION = Number(process.env.STEPPER_RESOLUTION) ||
    tinkerforge.BrickStepper.STEP_MODE_EIGHTH_STEP;
var SSTEPPER_RESOLUTION = Number(process.env.STEPPER_RESOLUTION) ||
    tinkerforge.BrickSilentStepper.STEP_RESOLUTION_16;

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

function setup_stepper(cascade, id, stepper) {
    let display_base = STEPPER_DISPLAY_BASE + next_display_order(10);

    var stepper_info = {
        id: id,
        interface: stepper,
        enable: null,
        velocity: null,
        max_motor_speed: null,
        motor_current: null
    };

    if (stepper) {
        if (stepper.getBasicConfiguration) {
            // this is a silent stepper, set configurations
            stepper.setMotorCurrent(MAX_SSTEPPER_CURRENT);
            stepper.setBasicConfiguration(null, DEFAULT_STEPPER_CURRENT);
            stepper.setStepConfiguration(SSTEPPER_RESOLUTION, true);
        } else {
            stepper.setMotorCurrent(DEFAULT_STEPPER_CURRENT);
            stepper.setStepMode(STEPPER_RESOLUTION);
        }
    }

    stepper_info.enable = cascade.create_component({
        id: id + "_enable",
        name: id + " Enable",
        group: PROCESS_CONTROLS_GROUP,
        display_order: display_base,
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
        display_order: display_base + 1,
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
        name: id + " Max Motor Speed",
        group: PROCESS_CONTROLS_GROUP,
        display_order: display_base + 2,
        class: "stepper_configure",
        persist: true,
        type: cascade.TYPES.NUMBER,
        units: "steps/sec",
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
        display_order: display_base + 3,
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
        name: id + " Motor Current",
        group: PROCESS_CONTROLS_GROUP,
        display_order: display_base + 4,
        class: "stepper_configure",
        persist: true,
        type: cascade.TYPES.NUMBER,
        units: "mA",
    });

    stepper_info.motor_current.on("value_updated", function () {
        set_stepper_current(stepper_info);
    });

    // eslint-disable-next-line no-self-assign
    stepper_info.motor_current.value = stepper_info.motor_current.value;

    steppers[id] = stepper_info;
    allDevices[id] = stepper_info;
    stepper_names.push(id);
    //update_hard_resource_list_component(cascade, "STEPPER_HR_names", stepper_names.sort());
}

var IO4_CONFIGURATION = [
    "INPUT_WITH_PULLUP",
    "INPUT_FLOATING",
    "OUTPUT_INITIALIZED_LOW",
    "OUTPUT_INITIALIZED_HIGH",
    "INPUT_WITH_PULLUP, INVERTED",
    "INPUT_FLOATING, INVERTED",
    "OUTPUT_INITIALIZED_LOW, INVERTED",
    "OUTPUT_INITIALIZED_HIGH, INVERTED",
];

function configure_io4(cascade, io4_info, io_index) {
    let io = io4_info.interface;
    if (io) {
        let port_name = io4_info.port_value[io_index].id;
        let configuration = io4_info.configuration[io_index].value || "INPUT_WITH_PULLUP";
        let direction;
        let value;
        if (configuration.startsWith("INPUT")) {
            direction = "i";
            value = configuration.includes("PULLUP");
            add_name_to_list(input_names, port_name, true);
            remove_name_from_list(output_names, port_name);
        } else {
            direction = "o";
            value = configuration.includes("HIGH");
            add_name_to_list(output_names, port_name, true);
            remove_name_from_list(input_names, port_name);
        }

        io.setConfiguration(io_index, direction, value);
        io4_info.direction[io_index] = direction;
        io4_info.invert[io_index] = configuration.endsWith("INVERTED");

        if (direction == "i") {
            // For inputs register a callback to maintain value
            io.on(tinkerforge.BrickletIO4V2.CALLBACK_INPUT_VALUE,
                function(channel, changed, value) {
                    if (io4_info.invert[io_index]) {
                        io4_info.port_value[channel].value = !value;
                    } else {
                        io4_info.port_value[channel].value = value;
                    }
                });
            io.setInputValueCallbackConfiguration(io_index, 30, true);
            // initialize the value
            io.getValue(function(value) {
                if (io4_info.invert[io_index]) {
                    io4_info.port_value[io_index].value = !value[io_index];
                } else {
                    io4_info.port_value[io_index].value = value[io_index];
                }
            });
        } else {
            // For outputs deregister callback.
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

function set_io4(io4_info, io_index) {
    // This function sets the outbound value.  If not configured as output, return.
    if (io4_info.direction[io_index] != "o") return;
    let io = io4_info.interface;
    if (io && io4_info.port_value[io_index]) {
        // outbound setting, ignored when configured as input.
        if (io4_info.invert[io_index]) {
            io.setSelectedValue(io_index, !io4_info.port_value[io_index].value);
        } else {
            io.setSelectedValue(io_index, io4_info.port_value[io_index].value);
        }
    }
}

function setup_io4(cascade, id, io4) {
    let display_base = IO4_DISPLAY_BASE + next_display_order(20);

    var io4_info = {
        id: id,
        interface: io4,
        port_value: [undefined, undefined, undefined, undefined],
        configuration: [undefined, undefined, undefined, undefined],
        direction: [undefined, undefined, undefined, undefined],
        invert: [false, false, false, false],
    };

    for(let io_index in [0,1,2,3]) {
        let io_id_base = "IO_" + io4.position;
        let io_id = io_id_base + "_" + io_index;
        io4_info.port_value[io_index] = cascade.create_component({
            id: io_id,
            name: io_id_base + " # " + io_index,
            group: PROCESS_CONTROLS_GROUP,
            display_order: display_base + 3 * io_index,
            class: "io",
            type: cascade.TYPES.BOOLEAN,
            value: false
        });

        io4_info.configuration[io_index] = cascade.create_component({
            id: io_id + "_configuration",
            name: io_id + " IO Configuration",
            group: PROCESS_CONTROLS_GROUP,
            display_order: display_base + 3 * io_index + 1,
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
    allDevices[id] = io4_info;
}

function setup_barometer(cascade, id, barometer) {
    var barometer_info = {
        id: id,
        interface: barometer,
        component: undefined
    };
    barometer_info.component = cascade.create_component({
        id: "barometer",  // assumes only one barometer per system
        name: "Barometer",
        group: SENSORS_GROUP,
        display_order: BAROMETER_DISPLAY_BASE + next_display_order(),
        class: "barometer",
        read_only: true,
        units: "mbar",
        type: cascade.TYPES.NUMBER
    });

    barometers[id] = barometer_info;
    allDevices[id] = barometer_info;
}

function configure_dist_ma(dist_info) {
    let dist = dist_info.interface;
    if (dist) {
        dist.setMovingAverageConfiguration(dist_info.dist_ma.value);
    }
}

function setup_distIR(cascade, id, distIR) {
    let display_base = DISTIR_DISPLAY_BASE + next_display_order(5);
    var dist_info = {
        id: id,
        interface: distIR,
        dist: undefined,
        dist_ma: undefined,
    };

    dist_info.dist = cascade.create_component({
        id: id + "_distance",
        group: SENSORS_GROUP,
        display_order: display_base,
        class: "dist",
        read_only: true,
        units: "mm",
        type: cascade.TYPES.NUMBER
    });

    if (distIR) {
        distIR.setDistanceCallbackConfiguration(1000, false, "x", 0, 0);

        distIR.on(tinkerforge.BrickletDistanceIRV2.CALLBACK_DISTANCE, function(distance) {
            dist_info.dist.value = distance;
        });
    }

    dist_info.dist_ma = cascade.create_component({
        id: id + "_ma",
        name: id + " Moving Average Length",
        group: SENSORS_GROUP,
        display_order: display_base + 1,
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
    allDevices[id] = dist_info;
}

function getAllProbes(cascade, ow_info, display_base, error_count) {
    ow_info.interface.getAllTempSensors(
        function(error, probes) {
            if (error) {
                if (error_count < ONEWIRE_ERROR_LIMIT) {
                    cascade.log_error(new Error(
                        "Onewire get-all-probes attempt " + error_count +
                        " failed with error: " + error));
                    getAllProbes(cascade, ow_info, display_base, error_count+1);
                    return;
                } else {
                    cascade.log_error(new Error("Onewire get-all-probes error: " + error));
                    return;
                }
            }
            for (let ow_address of probes) {
                let probe_name = ow_info.id + "_" + ow_address;
                let probe = create_temp_probe(cascade, probe_name, display_base);
                display_base += 5;
                ow_info.probes[ow_address] = probe;
                ow_names.push(probe_name);
                //update_hard_resource_list_component(cascade, "OW_PROBE_HR_names",
                //    ow_names.sort());
                //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
                //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
            }
        });
}

function setup_onewire_net(cascade, id, owNet) {
    let display_base = OW_DISPLAY_BASE + next_display_order(100);
    var ow_info = {
        id: id,
        interface: owNet,
        probes: {},
    };

    //  Set 12 bit resolution and generate individual OW probes.
    if (owNet) {

        // The tempSetResolution call does not return nor error -- unknown bug
        owNet.tempSetResolution(12, null,
            function(error) {
                cascade.log_error(new Error("Onewire set-resolution error: " + error));
            });
        getAllProbes(cascade, ow_info, display_base, 0);
    }

    onewireNets[id] = ow_info;
    allDevices[id] = ow_info;
}

var PTC_WIRE_MODES = {
    TWO_WIRE: tinkerforge.BrickletPTCV2.WIRE_MODE_2,
    THREE_WIRE: tinkerforge.BrickletPTCV2.WIRE_MODE_3,
    FOUR_WIRE: tinkerforge.BrickletPTCV2.WIRE_MODE_4
};

function setup_ptc_probe(cascade, id, ptc) {
    let display_base = PTC_DISPLAY_BASE + next_display_order(10);
    var ptc_info = {
        id: id,
        interface: ptc,
        probe: create_temp_probe(cascade, id, display_base),
    };

    ptc_info.wire_mode = cascade.create_component({
        id: id + "_wire_mode",
        name: id + " Wire Mode",
        group: SENSORS_GROUP,
        display_order: display_base + 5,
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
    allDevices[id] = ptc_info;
    ptc_names.push(id);
    //update_hard_resource_list_component(cascade, "PTC_PROBE_HR_names", ptc_names.sort());
    //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
    //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
}

function setup_thermocouple_probe(cascade, id, tc) {
    var display_base = TC_DISPLAY_BASE + next_display_order(5);
    var tc_info = {
        id: id,
        interface: tc,
        probe: create_temp_probe(cascade, id, display_base),
    };


    if (tc) {
        tc.setConfiguration(tinkerforge.BrickletThermocouple.AVERAGING_16,
            tinkerforge.BrickletThermocouple.TYPE_K,
            tinkerforge.BrickletThermocouple.FILTER_OPTION_60HZ);
    }

    thermocoupleProbes[id] = tc_info;
    allDevices[id] = tc_info;
    tc_names.push(id);
    //update_hard_resource_list_component(cascade, "TC_PROBE_HR_names", tc_names.sort());
    //update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
    //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));

}

function create_temp_probe(cascade, probe_name, display_base) {
    var probe_component = {};

    probe_component.raw = cascade.create_component({
        id: probe_name + "_raw",
        name: probe_name + " Raw",
        group: SENSORS_GROUP,
        display_order: display_base,
        class: "raw_temperature",
        read_only: true,
        units: cascade.UNITS.C,
        type: cascade.TYPES.NUMBER
    });

    probe_component.calibration = cascade.create_component({
        id: probe_name + "_calibration",
        name: probe_name + " Calibration",
        group: SENSORS_GROUP,
        display_order: display_base + 1,
        persist: true,
        units: cascade.UNITS.C,
        type: cascade.TYPES.NUMBER
    });

    probe_component.calibrated = cascade.create_component({
        id: probe_name + "_calibrated",
        name: probe_name + " Calibrated",
        group: SENSORS_GROUP,
        display_order: display_base + 2,
        class: "calibrated_temperature",
        read_only: true,
        units: cascade.UNITS.C,
        type: cascade.TYPES.NUMBER
    });

    return probe_component;
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
            display_order: HR_LISTS_DISPLAY_BASE + next_display_order(),
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
    // Create max_temp component used by stills overtemp shutdown feature.
    max_temp = cascade.create_component({
        id: "max_temp",
        name: "Max Temperature",
        description: "Peak measured temperature",
        group: RUN_GROUP,
        display_order: 1000,
        units: "C",
        value: 0,
    });

    // Discover resources on the tf stack.
    tinkerforge_connection.create(function (error, ipcon) {
        if (error) {
            throw error;
        }

        var masterbrick_position = {};
        ipcon.on(tinkerforge.IPConnection.CALLBACK_ENUMERATE,
            function (uid, connectedUid, position, hardwareVersion, firmwareVersion, deviceIdentifier, enumerationType) {

                position = position.toUpperCase();

                if (enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_DISCONNECTED) {
                    for (var key in allDevices) {
                        var info = allDevices[key];

                        if (info.interface && info.interface.uid_string === uid) {
                            info.interface = undefined;
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
                            let owNet = new onewireTempSensors(uid, ipcon);
                            owNet.in_use = false;

                            owNet.uid_string = uid;
                            owNet.position = masterbrick_position[connectedUid] + position;

                            let ow_id = "OW_" + owNet.position;

                            setup_onewire_net(cascade, ow_id, owNet);
                            break;
                        }
                        case tinkerforge.BrickletThermocouple.DEVICE_IDENTIFIER : {
                            var tc = new tinkerforge.BrickletThermocouple(uid, ipcon);

                            tc.uid_string = uid;
                            tc.position = masterbrick_position[connectedUid] + position;

                            var tc_id = "TC_" + tc.position;

                            setup_thermocouple_probe(cascade, tc_id, tc);
                            break;
                        }
                        case tinkerforge.BrickletPTCV2.DEVICE_IDENTIFIER : {
                            var ptc = new tinkerforge.BrickletPTCV2(uid, ipcon);

                            ptc.uid_string = uid;
                            ptc.position = masterbrick_position[connectedUid] + position;
                            let ptc_id = "PTC_" + ptc.position;

                            setup_ptc_probe(cascade, ptc_id, ptc);
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

                            setup_dac(cascade, dac_id, dac);
                            break;
                        }
                        case tinkerforge.BrickletIndustrialQuadRelayV2.DEVICE_IDENTIFIER :
                        case tinkerforge.BrickletIndustrialQuadRelay.DEVICE_IDENTIFIER : {
                            var quadrelay;
                            if (deviceIdentifier == tinkerforge.BrickletIndustrialQuadRelay.DEVICE_IDENTIFIER) {
                                quadrelay = new tinkerforge.BrickletIndustrialQuadRelay(uid, ipcon);
                            } else {
                                quadrelay = new tinkerforge.BrickletIndustrialQuadRelayV2(uid, ipcon);
                            }

                            quadrelay.uid_string = uid;
                            quadrelay.position = masterbrick_position[connectedUid] + position;

                            var quadrelay_id = "QUADRELAY_" + quadrelay.position;

                            setup_quadrelay(cascade, quadrelay_id, quadrelay);
                            break;
                        }
                        case tinkerforge.BrickletBarometer.DEVICE_IDENTIFIER : {
                            var barometer = new tinkerforge.BrickletBarometer(uid, ipcon);

                            barometer.uid_string = uid;
                            barometer.position = masterbrick_position[connectedUid] + position.toUpperCase;

                            var barometer_id = "barometer_" + barometer.position;

                            setup_barometer(cascade, barometer_id, barometer);
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

                            setup_stepper(cascade, stepper_id, stepper);

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

                            setup_io4(cascade, IO4_id, IO4);

                            break;
                        }
                        case tinkerforge.BrickletDistanceIRV2.DEVICE_IDENTIFIER : {

                            var distIR = new tinkerforge.BrickletDistanceIRV2(uid, ipcon);

                            distIR.uid_string = uid;
                            distIR.position = masterbrick_position[connectedUid] + position;
                            let distIR_id = "DISTIR_" + distIR.position;

                            setup_distIR(cascade, distIR_id, distIR);

                            break;
                        }
                        default:
                            // report any unhandled device
                            if (deviceIdentifier == 17) break;
                            cascade.log_info("Unrecognized TF device: uid=" + uid
                                + " connected=" + connectedUid
                                + " (" + masterbrick_position[connectedUid] + ")"
                                + " position=" + position
                                + " deviceId=" + deviceIdentifier);
                            break;
                    }
                }
            });

        ipcon.enumerate();
        cascade.log_info("TF stack enumeration initiated.");
    });

    // Provide time for tinkerforge stack enumeration to complete.
    // Then create lists of all hard resources by type.
    setTimeout(function() {
        cascade.log_info("TF setup completing.");
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
        max_temp.value = 0;  // last chance in setup to clear this value.
        setup_complete = true;
        cascade.log_info("TF setup completed.");
    }, 10000);
    cascade.log_info("TF setup exits.");
};


module.exports.loop = function (cascade) {
    if (!setup_complete) return;

    /*
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
    */

    for (let id in thermocoupleProbes) {
        let tc_info = thermocoupleProbes[id];
        let tc = tc_info.interface;
        let tempProbe = tc_info.probe;

        if(!tempProbe) {
            cascade.log_error(new Error("No temp probe for " +id+ " in loop function."));
            continue;
        }

        if (tc) {
            tc.getTemperature(function (temperature) {
                var tempValue = temperature / 100;
                tempProbe.raw.value = tempValue;
                tempValue = tempValue + (tempProbe.calibration.value || 0);
                tempProbe.calibrated.value = tempValue;
                if (tempValue > max_temp.value && tempValue < 4000) {
                    max_temp.value = tempValue;
                }
            });
        }
    }

    for (let id in ptcProbes) {
        let ptc_info = ptcProbes[id];
        let ptc = ptc_info.interface;
        let tempProbe = ptc_info.probe;

        if(!tempProbe) {
            cascade.log_error(new Error("No temp probe for " +id+ " in loop function."));
            continue;
        }

        if (ptc) {
            ptc.getTemperature(function (temperature) {
                var tempValue = temperature / 100;
                tempProbe.raw.value = tempValue;
                tempValue = tempValue + (tempProbe.calibration.value || 0);
                tempProbe.calibrated.value = tempValue;
                if (tempValue > max_temp.value && tempValue < 4000) {
                    max_temp.value = tempValue;
                }
            });

        }
    }

    for (let id in onewireNets) {
        let ow_info = onewireNets[id];
        var ow = ow_info.interface;
        if (ow && !ow.in_use) {
            ow.in_use = true;
            ow.getAllTemperatures(function (error, ow_probes) {
                if (error) {
                    cascade.log_warning(new Error(
                        "Unable to retrieve temperatures from onewire " + id +
                        ": " + error));
                    ow.in_use = false;
                    return;
                }

                for (let ow_address in ow_probes) {
                    var tempProbe = ow_info.probes[ow_address];
                    var tempValue = ow_probes[ow_address];
                    if (!tempProbe) {
                        let probe_name = id + "_" + ow_address;
                        cascade.log_error(new Error(
                            "No temp probe for " +probe_name+ " in loop function."));
                        continue;
                    }

                    tempProbe.raw.value = tempValue;
                    tempValue = tempValue + (tempProbe.calibration.value || 0);
                    tempProbe.calibrated.value = tempValue;
                    if (tempValue > max_temp.value && tempValue < 4000) {
                        max_temp.value = tempValue;
                    }
                }
                ow.in_use = false;
            });
        }
    }

    for (let id in barometers) {
        let barometer_info = barometers[id];
        var barometer = barometer_info.interface;
        if (barometer) {
            barometer.getAirPressure(
                function(airPressure) {
                    barometer_info.component.value = airPressure / 1000;
                });
        }
    }
};
