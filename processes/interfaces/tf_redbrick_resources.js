var tinkerforge = require("tinkerforge");
var tinkerforge_connection = require("./../lib/tinkerforge_connection");
var onewireTempSensors = require("./../lib/onewire_temp_sensors");  // sensor interface for 1wire bricklet
var utils = require("./utils");

var ONEWIRE_ERROR_LIMIT = 3;

var RUN_GROUP = "00  Run";
var SENSORS_GROUP = "97  HR Sensors";
var PROCESS_CONTROLS_GROUP = "98  HR Controls";

// Display orders:
var RELAY_DISPLAY_BASE = 1000;
var IO4_DISPLAY_BASE = 2000;
var DAC_DISPLAY_BASE = 3000;
var STEPPER_DISPLAY_BASE = 4000;
var BAROMETER_DISPLAY_BASE = 10000;
var DISTIR_DISPLAY_BASE = 11000;
var PTC_DISPLAY_BASE = 12000;
var TC_DISPLAY_BASE = 13000;
var OW_DISPLAY_BASE = 14000;
var DUAL_ADC_DISPLAY_BASE = 15000;


// hard resource names at individual relay or probe level, eg "OW_2A_28af3098c5b7041d", "DAc_3a", "RELAY_2B_2"
var relay_names = [];
var dac_names = [];
var stepper_names = [];
var input_names = [];  // of io4
var output_names = []; // of io4
var adc_names = [];
var dist_names = [];
var ow_names = [];
var ptc_names = [];
var tc_names = [];

//info structures by type (at quadrelay or onewire level)  indexed by device id (eg "DAC_3C", "OW_2A", "RELAY_2B").
var quadrelays = {};
var dacs = {};
var steppers = {};
var io4s = {};
var dualADCs = {};
var barometers = {};
var distIRs = {};
var onewireNets = {};
var thermocoupleProbes = {};
var ptcProbes = {};
var allDevices = {};

// flag to signal loop function when setup is complete and it can proceed.
var setup_complete = false;

// periodic logging information
var log_obj = {
    OW_in_use : 0,
};


var name_regex = /[^\s,;]+/g;

var get_name_list = function(s) {
    var names = [];
    if (s) {
        s.replace(name_regex, function(name) {names.push(name);});
    }
    return names;
};

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

function reset_interface(cascade, info, interface) {
    cascade.log_info("TF interface reset on " + info.id);
    info.interface = interface;
}

function report_masterbrick(cascade, mb_info, non_zero) {
    let mb = mb_info.interface;
    if (mb) {
        mb.getStackVoltage(function(v) {
            mb.getStackCurrent(function(i) {
                if (non_zero && v===0 && i===0) return;
                log_obj[mb_info.id] = "voltage = " + v/1000 + "V; "
                                    + "current = " + i + "mA";
            }, function(err) {
                cascade.log_error("Masterbrick " + mb_info.id +
                    " current error: " + err);
            });
        }, function(err) {
            cascade.log_error("Masterbrick " + mb_info.id +
                " voltage error: " + err);
        });
    }
}

function renew_mastebrick(cascade, info, mb) {
    reset_interface(cascade, info, mb);
}

function setup_masterbrick(cascade, id, mb) {
    var mb_info = {
        id: id,
        interface: mb,
    };

    // Periodically report MB voltage/current status.
    setTimeout(function do_report() {
        report_masterbrick(cascade, mb_info);
        setTimeout(do_report, 600000);
    }, 300000);

    allDevices[id] = mb_info;
}

function set_relays(cascade, quadrelay_info) {
    var relay_interface = quadrelay_info.interface;

    if (relay_interface) {
        if (relay_interface.getChannelLEDConfig) {
            // this is V2 of hardware
            var values = quadrelay_info.relays.map(
                function(relay) {return relay.value;}
            );
            relay_interface.setValue(values, undefined, function(err) {
                cascade.log_info("Error setting relay " + quadrelay_info.id
                    + ": " + err);
            });
            return;
        }

        // this is V1 of hardware
        var bitmask = 0;
        for (let relay_index in quadrelay_info.relays) {
            let relay = quadrelay_info.relays[relay_index];
            bitmask = bitmask | (relay.value << relay_index);
        }

        relay_interface.setValue(bitmask, undefined, function(err) {
            cascade.log_info("Error setting relay " + quadrelay_info.id
                + ": " + err);
        });
    }
}

function renew_quadrelay(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    set_relays(cascade, info);
}

function setup_quadrelay(cascade, id, quadrelay) {
    let display_base = RELAY_DISPLAY_BASE + utils.next_display_order(5);

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
        relay_component.on("value_updated", function() {
            set_relays(cascade, quadrelay_info);
        });

        relay_names.push(relay_id);
        //utils.update_hard_resource_list_component(cascade, "RELAY_HR_names", relay_names.sort());
    }

    set_relays(cascade, quadrelay_info);

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
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 5000));
        tfInterface.setVoltage(output);
    },
    VOLTAGE_RANGE_0_TO_10V: function (tfInterface, outputPercent) {
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 10000));
        tfInterface.setVoltage(output);
    },
    CURRENT_RANGE_4_TO_20MA: function (tfInterface, outputPercent) {
        var output = Math.round(mapRange(outputPercent, 0, 100, 4000, 20000));
        tfInterface.setCurrent(output);
    },
    CURRENT_RANGE_0_TO_20MA: function (tfInterface, outputPercent) {
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 20000));
        tfInterface.setCurrent(output);
    },
    CURRENT_RANGE_0_TO_24MA: function (tfInterface, outputPercent) {
        var output = Math.round(mapRange(outputPercent, 0, 100, 0, 24000));
        tfInterface.setCurrent(output);
    },
};

function configure_dac(dac_info) {
    let config = dac_info.output_type.value;
    let dac = dac_info.interface;
    if (dac) {
        if (config) {
            dac_info.setFunction = DAC_OUTPUT_TYPES[config];
            if (config.startsWith("VOLTAGE_RANGE")) {
                dac.setConfiguration(tinkerforge.BrickletIndustrialAnalogOutV2[config], 0);
            } else {
                dac.setConfiguration(0, tinkerforge.BrickletIndustrialAnalogOutV2[config]);
            }
        }
    }
}

function set_dac_enable(cascade, dac_info) {
    function log_err(err) {
        cascade.log_info("Error on " + dac_info.id + ": " + err);
    }

    let dac = dac_info.interface;
    if (dac) {
        if (dac_info.enable.value === true) {
            if (dac.setEnabled) dac.setEnabled(true, undefined, log_err);  // V2
            else dac.enable(undefined, log_err);                         // V1
        }
        else {
            if (dac.setEnabled) dac.setEnabled(false, undefined, log_err);  // V2
            else dac.disable(undefined, log_err);                         // V1
        }
    }
}

function set_dac(cascade, dac_info) {
    function log_err(err) {
        cascade.log_info("Error on " + dac_info.id + ": " + err);
    }

    let dac = dac_info.interface;
    if (dac) {

        if (dac_info.setFunction) {

            dac_info.setFunction(dac, dac_info.output.value);

            /*
            if (dac_info.enable.value === true) {
                if (dac.setEnabled) dac.setEnabled(true, undefined, log_err);  // V2
                else dac.enable(undefined, log_err);                           // V1
            }
            else {
                if (dac.setEnabled) dac.setEnabled(false, undefined, log_err);  // V2
                else dac.disable(undefined, log_err);                           // V1
            }
            */
        }
        else {
            if (dac.setEnabled) dac.setEnabled(false, undefined, log_err);  // V2
            else dac.disable(undefined, log_err);                           // V1
        }
    }
}

function renew_dac(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    configure_dac(info);
    set_dac_enable(cascade, info);
    set_dac(cascade, info);
}

function setup_dac(cascade, id, dac) {
    let display_base = DAC_DISPLAY_BASE + utils.next_display_order(5);

    var dac_info = {
        id: id,
        interface: dac,
        setFunction: undefined,
    };

    dac.setVoltage(0);
    dac.setCurrent(0);

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
        set_dac_enable(cascade, dac_info);
    });
    set_dac_enable(cascade, dac_info);

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
        set_dac(cascade, dac_info);
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
        configure_dac(dac_info);
        set_dac(cascade, dac_info);
    });

    // eslint-disable-next-line no-self-assign
    dac_info.output_type.value = dac_info.output_type.value;

    dacs[id] = dac_info;
    allDevices[id] = dac_info;
    dac_names.push(id);
    //utils.update_hard_resource_list_component(cascade, "DAC_HR_names", dac_names.sort());
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

function configure_stepper(stepper) {
    if (stepper) {
        if (stepper.getBasicConfiguration) {
            // this is a silent stepper, set configurations
            stepper.setMotorCurrent(MAX_SSTEPPER_CURRENT);
            stepper.setBasicConfiguration(undefined, DEFAULT_STEPPER_CURRENT);
            stepper.setStepConfiguration(SSTEPPER_RESOLUTION, true);
        } else {
            stepper.setMotorCurrent(DEFAULT_STEPPER_CURRENT);
            stepper.setStepMode(STEPPER_RESOLUTION);
        }
    }
}

function set_stepper_current(stepper_info) {
    var stepper = stepper_info.interface;
    if (stepper) {
        let new_current = stepper_info.motor_current.value;
        if (stepper.getBasicConfiguration) {
            // this is a SilentStepper; set MotorRunCurrent
            new_current = Math.max(MIN_SSTEPPER_CURRENT, Math.min(MAX_SSTEPPER_CURRENT, new_current));
            stepper.setBasicConfiguration(undefined, new_current);
        } else {
            new_current = Math.max(MIN_STEPPER_CURRENT, Math.min(MAX_STEPPER_CURRENT, new_current));
            stepper.setMotorCurrent(new_current);
        }
    }
}

function set_stepper(cascade, stepper_info) {
    function log_err(err) {
        cascade.log_info("Error in Stepper " + stepper_info.id + ": " + err);
    }
    var stepper = stepper_info.interface;
    if (stepper) {
        if (stepper_info.enable.value === true) {
            stepper.enable(undefined, log_err);
        }

        let velocity = Math.round(mapRange(stepper_info.velocity.value,
            0, 100, 0, stepper_info.max_motor_speed.value));
        if (velocity) {
            stepper.setMaxVelocity(Math.min(65535, Math.abs(velocity)), undefined, log_err);
            if ((velocity<0) != (stepper_info.reverse.value==true)) {  // XOR operation
                stepper.driveBackward(undefined, log_err);
            }
            else {
                stepper.driveForward(undefined, log_err);
            }
        }
        else {
            stepper.stop(undefined, log_err);
        }

        if (stepper_info.enable.value === false) {
            stepper.stop(undefined, log_err);
            stepper.disable(undefined, log_err);
        }
    }
}

function renew_stepper(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    configure_stepper(interface);
    set_stepper_current(info);
    set_stepper(cascade, info);
}

function setup_stepper(cascade, id, stepper) {
    let display_base = STEPPER_DISPLAY_BASE + utils.next_display_order(10);

    var stepper_info = {
        id: id,
        interface: stepper,
        enable: null,
        velocity: null,
        max_motor_speed: null,
        motor_current: null
    };

    stepper.stop();
    stepper.disable();

    configure_stepper(stepper);

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
        set_stepper(cascade, stepper_info);
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
        set_stepper(cascade, stepper_info);
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
        set_stepper(cascade, stepper_info);
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
        set_stepper(cascade, stepper_info);
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
    //utils.update_hard_resource_list_component(cascade, "STEPPER_HR_names", stepper_names.sort());
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
            utils.update_hard_resource_list_component(cascade,
                "BIT_IN_HR_names", input_names.sort());
            utils.update_hard_resource_list_component(cascade,
                "BIT_OUT_HR_names", output_names.sort());
        }
    }
}

function set_io4(cascade, io4_info, io_index) {
    // This function sets the outbound value.  If not configured as output, return.
    if (io4_info.direction[io_index] != "o") return;
    function log_err(err) {
        cascade.log_info("Error on IO4 " + io4_info.id + "_" + io_index + ": " + err);
    }
    let io = io4_info.interface;
    if (io && io4_info.port_value[io_index]) {
        // outbound setting, ignored when configured as input.
        if (io4_info.invert[io_index]) {
            io.setSelectedValue(io_index, !io4_info.port_value[io_index].value,
                undefined, log_err);
        } else {
            io.setSelectedValue(io_index, io4_info.port_value[io_index].value,
                undefined, log_err);
        }
    }
}

function renew_io4(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    for(let io_index in [0,1,2,3]) {
        configure_io4(cascade, info, io_index);
        set_io4(cascade, info, io_index);
    }
}

function setup_io4(cascade, id, io4) {
    let display_base = IO4_DISPLAY_BASE + utils.next_display_order(20);

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
            set_io4(cascade, io4_info, io_index);
        });
    }
    io4s[id] = io4_info;
    allDevices[id] = io4_info;
}

function schedule_dualADC_callback(cascade, info) {
    let dualADC = info.interface;
    if (dualADC) {
        dualADC.setAllVoltagesCallbackConfiguration(1000, false);
        dualADC.on(tinkerforge.BrickletIndustrialDualAnalogInV2.CALLBACK_ALL_VOLTAGES,
           function (voltages) {
               // voltages – Type: [int, ...], Length: 2, Unit: 1 mV, Range: [-35000 to 35000] 
               for(let adc_index in [0,1]) {
                   info.voltage[adc_index].value = ((voltages[adc_index] * 0.001) + info.offset[adc_index].value)
                                                      * info.multiplier[adc_index].value;
               }
           });
    }
}
function configure_dualADC(cascade, info) {
}
function renew_dualADC(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    configure_dualADC(cascade, info);
    schedule_dualADC_callback(cascade, info);
}
function setup_dualADC(cascade, id, dualADC) {

    let display_base = DUAL_ADC_DISPLAY_BASE + utils.next_display_order(10);

    var dualADC_info = {
        id: id,
        interface: dualADC,
        voltage: [undefined, undefined],
        offset: [undefined, undefined],
        multiplier: [undefined, undefined],
        units: [undefined, undefined]
    }

    var adc_index;
    for(adc_index in [0,1]) {
        let adc_id_base = "ADC_" + dualADC.position;
        let adc_id = adc_id_base + "_" + adc_index;
        dualADC_info.voltage[adc_index] = cascade.create_component({
            id: adc_id,
            name: adc_id_base + " # " + adc_index,
            group: SENSORS_GROUP,
            display_order: display_base + 5 * adc_index,
            class: "adc",
            type: cascade.TYPES.NUMBER,
            read_only: true,
            units: "V",
            value: 0
        });
        dualADC_info.offset[adc_index] = cascade.create_component({
            id: adc_id + "_offset",
            name: adc_id + " Offset",
            group: SENSORS_GROUP,
            display_order: display_base + 5 * adc_index + 1,
            class: "adc",
            persist: true,
            type: cascade.TYPES.NUMBER,
            value: 0
        });
        dualADC_info.multiplier[adc_index] = cascade.create_component({
            id: adc_id + "_multiplier",
            name: adc_id + " Multiplier",
            group: SENSORS_GROUP,
            display_order: display_base + 5 * adc_index + 2,
            class: "adc",
            persist: true,
            type: cascade.TYPES.NUMBER,
            value: 1
        });
        dualADC_info.units[adc_index] = cascade.create_component({
            id: adc_id + "_units",
            name: adc_id + " Units",
            group: SENSORS_GROUP,
            display_order: display_base + 5 * adc_index + 3,
            class: "adc",
            persist: true,
            type: cascade.TYPES.TEXT,
            value: "V"
        });
        var unit_index = adc_index;
        dualADC_info.units[adc_index].on("value_updated", function() {
            dualADC_info.voltage[unit_index].units = dualADC_info.units[unit_index].value;
        });
        // eslint-disable-next-line no-self-assign
        dualADC_info.units[adc_index].value = dualADC_info.units[adc_index].value;

        adc_names.push(adc_id);
    }

    configure_dualADC(cascade, dualADC_info);
    schedule_dualADC_callback(cascade, dualADC_info);

    dualADCs[id] = dualADC_info;
    allDevices[id] = dualADC_info;
}

function configure_barometer(cascade, info) {
    if (info.interface) {
        if (info.interface.getTemperature) {
            info.V2 = true;
        } else {
            info.V2 = false;
        }
    }
}

function schedule_barometer_callback(info) {
    var barometer = info.interface;
    if (barometer) {
        // configure callbacks once per second if value changes
        if (info.V2) {
            barometer.setAirPressureCallbackConfiguration(1000, true, "x", 0, 0);
            barometer.on(tinkerforge.BrickletBarometerV2.CALLBACK_AIR_PRESSURE,
                function(airPressure) {
                    info.air_pressure.value = airPressure / 1000;
                });
            // barometerV2 supports callbacks on temperature (not so V1).
            barometer.setTemperatureCallbackConfiguration(1000, true, "x", 0, 0);
            barometer.on(tinkerforge.BrickletBarometerV2.CALLBACK_TEMPERATURE,
                function(temperature) {
                    info.chip_temp.value = temperature/100;
                });
        } else {
            barometer.setAirPressureCallbackPeriod(1000);
            barometer.on(tinkerforge.BrickletBarometer.CALLBACK_AIR_PRESSURE,
                function(airPressure) {
                    info.air_pressure.value = airPressure / 1000;
                });
        }
    }
}

function renew_barometer(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    configure_barometer(cascade, info);
    schedule_barometer_callback(info);
}

function setup_barometer(cascade, id, barometer) {
    var barometer_info = {
        id: id,
        interface: barometer,
        air_pressure: undefined,
        chip_temp: undefined,
        V2: undefined,
    };

    barometer_info.air_pressure = cascade.create_component({
        id: "barometer",  // assumes only one barometer per system
        name: "Barometer",
        group: SENSORS_GROUP,
        display_order: BAROMETER_DISPLAY_BASE + utils.next_display_order(),
        class: "barometer",
        read_only: true,
        units: "mbar",
        type: cascade.TYPES.NUMBER
    });

    barometer_info.chip_temp = cascade.create_component({
        id: "controller_temp",  // assumes only one barometer per system
        name: "Controller temperature",
        group: RUN_GROUP,
        display_order: BAROMETER_DISPLAY_BASE + utils.next_display_order(),
        class: "barometer",
        read_only: true,
        units: "C",
        type: cascade.TYPES.NUMBER
    });

    configure_barometer(cascade, barometer_info);
    schedule_barometer_callback(barometer_info);

    barometers[id] = barometer_info;
    allDevices[id] = barometer_info;
}

function schedule_distIR_callback(info) {
    let distIR = info.interface;
    if (distIR) {
        distIR.setDistanceCallbackConfiguration(1000, false, "x", 0, 0);

        distIR.on(tinkerforge.BrickletDistanceIRV2.CALLBACK_DISTANCE, function(distance) {
            info.dist.value = distance;
        });
    }
}

function configure_distIR_ma(dist_info) {
    let dist = dist_info.interface;
    if (dist) {
        dist.setMovingAverageConfiguration(dist_info.dist_ma.value);
    }
}

function renew_distIR(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    schedule_distIR_callback(info);
    configure_distIR_ma(info);
}

function setup_distIR(cascade, id, distIR) {
    let display_base = DISTIR_DISPLAY_BASE + utils.next_display_order(5);

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
        configure_distIR_ma(dist_info);
    });

    configure_distIR_ma(dist_info);
    schedule_distIR_callback(dist_info);

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
                    ow_info.interface.resetBus();
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
                check_hard_resource_name(cascade, "OW_PROBE_HR_names", probe_name);
                check_hard_resource_name(cascade, "TEMP_PROBE_HR_names", probe_name);
            }
        });
}

function renew_onewire_net(cascade, info, interface) {
    reset_interface(cascade, info, interface);
}

function setup_onewire_net(cascade, id, owNet) {
    let display_base = OW_DISPLAY_BASE + utils.next_display_order(100);

    var ow_info = {
        id: id,
        interface: owNet,
        probes: {},
    };

    //  Set 12 bit resolution and generate individual OW probes.
    if (owNet) {

        // The tempSetResolution call does not return nor error -- unknown bug
        owNet.tempSetResolution(12, undefined,
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

function configure_ptc(cascade, ptc_info) {
    var ptc = ptc_info.interface;
    if (ptc && ptc_info.wire_mode.value) {
        ptc.setWireMode(PTC_WIRE_MODES[ptc_info.wire_mode.value], undefined,
            function(error) {
                cascade.log_error(new Error("Error on PTCV2.setWireMode: " + error));
            });
    }
}

function schedule_ptc_callback(cascade, ptc_info) {
    var ptc = ptc_info.interface;
    var tempProbe = ptc_info.probe;

    if (ptc) {

        // configure temperature callbacks
        ptc.setTemperatureCallbackConfiguration(1000, true, "x", 0, 0);

        // Register temperature callback
        ptc.on(tinkerforge.BrickletPTCV2.CALLBACK_TEMPERATURE,
            function (temperature) {
                var tempValue = temperature / 100;
                set_temperature(tempProbe, tempValue);
            });

    }
}

function renew_ptc_probe(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    configure_ptc(cascade, info);
    schedule_ptc_callback(cascade, info);
}

function setup_ptc_probe(cascade, id, ptc) {
    let display_base = PTC_DISPLAY_BASE + utils.next_display_order(10);
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
        configure_ptc(cascade, ptc_info);
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

    schedule_ptc_callback(cascade, ptc_info);

    ptcProbes[id] = ptc_info;
    allDevices[id] = ptc_info;
    ptc_names.push(id);
    //utils.update_hard_resource_list_component(cascade, "PTC_PROBE_HR_names", ptc_names.sort());
    //utils.update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
    //    ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
}

function configure_tc(tc_info) {
    let tc = tc_info.interface;
    if (tc) {
        tc.setConfiguration(tinkerforge.BrickletThermocouple.AVERAGING_16,
            tinkerforge.BrickletThermocouple.TYPE_K,
            tinkerforge.BrickletThermocouple.FILTER_OPTION_60HZ);
    }
}

function schedule_tc_callback(cascade, tc_info) {
    var tc = tc_info.interface;
    var tempProbe = tc_info.probe;

    if (tc) {

        // configure temperature callbacks
        //tc.setTemperatureCallbackConfiguration(1000, true, "x", 0, 0);
        tc.setTemperatureCallbackPeriod(1000);

        // Register temperature callback
        //tc.on(tinkerforge.BrickletThermocoupleV2.CALLBACK_TEMPERATURE,
        tc.on(tinkerforge.BrickletThermocouple.CALLBACK_TEMPERATURE,
            function (temperature) {
                var tempValue = temperature / 100;
                set_temperature(tempProbe, tempValue);
            });

    }
}

function renew_thermocouple_probe(cascade, info, interface) {
    reset_interface(cascade, info, interface);
    schedule_tc_callback(cascade, info);
    configure_tc(info);
}

function setup_thermocouple_probe(cascade, id, tc) {
    var display_base = TC_DISPLAY_BASE + utils.next_display_order(5);
    var tc_info = {
        id: id,
        interface: tc,
        probe: create_temp_probe(cascade, id, display_base),
    };

    configure_tc(tc_info);
    schedule_tc_callback(cascade, tc_info);

    thermocoupleProbes[id] = tc_info;
    allDevices[id] = tc_info;
    tc_names.push(id);
    //utils.update_hard_resource_list_component(cascade, "TC_PROBE_HR_names", tc_names.sort());
    //utils.update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
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

function set_temperature(probe_component, raw_temp) {
    var calibrated_temp = raw_temp +  (probe_component.calibration.value || 0);
    if (utils.check_max_temp(calibrated_temp, probe_component.calibrated.name)) {
        probe_component.raw.value = raw_temp;
        probe_component.calibrated.value = calibrated_temp;
    }
}

// function to add late arrivals to name lists.
function check_hard_resource_name(cascade, HR_names_id, name) {
    var component = cascade.components.all_current[HR_names_id];
    if (component) {
        let name_list = get_name_list(component.value);
        if (name_list.indexOf(name) < 0) {
            add_name_to_list(name_list, name, true);
            utils.update_hard_resource_list_component(cascade, HR_names_id, name_list);
        }
    }
}

var IPCON_DISCONNECT_TEXT = [
    "Disconnect was requested by user.",
    "Disconnect because of an unresolvable error.",
    "Disconnect initiated by Brick Daemon or WIFI/Ethernet Extension.",
];

module.exports.setup = function (cascade) {
    utils.setup_utils(cascade);
    utils.setup_overtemp(RUN_GROUP);

    // Discover resources on the tf stack.
    tinkerforge_connection.create(function (error, ipcon) {
        if (error) {
            throw error;
        }

        // Print a message on ipcon disconnect.
        ipcon.on(tinkerforge.IPConnection.CALLBACK_DISCONNECTED,
            function (disconnectReason) {
                cascade.log_info("TF IPConnection disconnected -- reason: ("
                    + disconnectReason + ") " + IPCON_DISCONNECT_TEXT[disconnectReason]);
            });

        var masterbrick_position = {};
        ipcon.on(tinkerforge.IPConnection.CALLBACK_ENUMERATE,
            function (uid, connectedUid, position, hardwareVersion, firmwareVersion, deviceIdentifier, enumerationType) {

                position = position.toUpperCase();

                if (enumerationType === tinkerforge.IPConnection.ENUMERATION_TYPE_DISCONNECTED) {
                    for (var key in allDevices) {
                        var info = allDevices[key];
                        if (info.interface && info.interface.uid_string === uid) {
                            cascade.log_info("Stack device disconnected: " + key);
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

                            var mb = new tinkerforge.BrickMaster(uid, ipcon);

                            mb.uid_string = uid;
                            mb.position = position;

                            let id = "MB_" + position;

                            info = allDevices[id];
                            if (info) {
                                renew_mastebrick(cascade, info, mb);
                            } else {
                                setup_masterbrick(cascade, id, mb);
                            }
                            break;
                        }
                        case tinkerforge.BrickletOneWire.DEVICE_IDENTIFIER : {
                            let owNet = new onewireTempSensors(uid, ipcon);
                            owNet.in_use = false;

                            owNet.uid_string = uid;
                            owNet.position = masterbrick_position[connectedUid] + position;

                            let id = "OW_" + owNet.position;

                            info = allDevices[id];
                            if (info) {
                                renew_onewire_net(cascade, info, owNet);
                            } else {
                                setup_onewire_net(cascade, id, owNet);
                            }
                            break;
                        }
                        case tinkerforge.BrickletThermocouple.DEVICE_IDENTIFIER : {
                            var tc = new tinkerforge.BrickletThermocouple(uid, ipcon);

                            tc.uid_string = uid;
                            tc.position = masterbrick_position[connectedUid] + position;

                            let id = "TC_" + tc.position;

                            info = allDevices[id];
                            if (info) {
                                renew_thermocouple_probe(cascade, info, tc);
                            } else {
                                setup_thermocouple_probe(cascade, id, tc);
                            }
                            break;
                        }
                        case tinkerforge.BrickletPTCV2.DEVICE_IDENTIFIER : {
                            var ptc = new tinkerforge.BrickletPTCV2(uid, ipcon);

                            ptc.uid_string = uid;
                            ptc.position = masterbrick_position[connectedUid] + position;

                            let id = "PTC_" + ptc.position;

                            info = allDevices[id];
                            if (info) {
                                renew_ptc_probe(cascade, info, ptc);
                            } else {
                                setup_ptc_probe(cascade, id, ptc);
                            }
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

                            dac.uid_string = uid;
                            dac.position = masterbrick_position[connectedUid] + position;

                            let id = "DAC_" + dac.position;

                            info = allDevices[id];
                            if (info) {
                                renew_dac(cascade, info, dac);
                            } else {
                                setup_dac(cascade, id, dac);
                            }
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

                            let id = "QUADRELAY_" + quadrelay.position;

                            info = allDevices[id];
                            if (info) {
                                renew_quadrelay(cascade, info, quadrelay);
                            } else {
                                setup_quadrelay(cascade, id, quadrelay);
                            }
                            break;
                        }
                        case tinkerforge.BrickletBarometerV2.DEVICE_IDENTIFIER :
                        case tinkerforge.BrickletBarometer.DEVICE_IDENTIFIER : {
                            var barometer;
                            if (deviceIdentifier == tinkerforge.BrickletBarometer.DEVICE_IDENTIFIER) {
                                barometer = new tinkerforge.BrickletBarometer(uid, ipcon);
                            } else {
                                barometer = new tinkerforge.BrickletBarometerV2(uid, ipcon);
                            }

                            barometer.uid_string = uid;
                            barometer.position = masterbrick_position[connectedUid] + position;

                            let id = "barometer_" + barometer.position;

                            info = allDevices[id];
                            if (info) {
                                renew_barometer(cascade, info, barometer);
                            } else {
                                setup_barometer(cascade, id, barometer);
                            }
                            break;
                        }
                        case tinkerforge.BrickSilentStepper.DEVICE_IDENTIFIER :
                        case tinkerforge.BrickStepper.DEVICE_IDENTIFIER : {
                            // this brick can have up to 2 bricklets
                            masterbrick_position[uid] = position;

                            let stepper;
                            let id;
                            if (deviceIdentifier == tinkerforge.BrickSilentStepper.DEVICE_IDENTIFIER) {
                                stepper = new tinkerforge.BrickSilentStepper(uid, ipcon);
                                id = "SSTEPPER_";
                            } else {
                                stepper = new tinkerforge.BrickStepper(uid, ipcon);
                                id = "STEPPER_";
                            }

                            stepper.uid_string = uid;
                            stepper.position = position;

                            id = id + stepper.position;

                            info = allDevices[id];
                            if (info) {
                                renew_stepper(cascade, info, stepper);
                            } else {
                                setup_stepper(cascade, id, stepper);
                            }

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

                            let id = "IO4_" + IO4.position;

                            info = allDevices[id];
                            if (info) {
                                renew_io4(cascade, info, IO4);
                            } else {
                                setup_io4(cascade, id, IO4);
                            }

                            break;
                        }
                        case tinkerforge.BrickletDistanceIRV2.DEVICE_IDENTIFIER : {

                            var distIR = new tinkerforge.BrickletDistanceIRV2(uid, ipcon);

                            distIR.uid_string = uid;
                            distIR.position = masterbrick_position[connectedUid] + position;

                            let id = "DISTIR_" + distIR.position;

                            info = allDevices[id];
                            if (info) {
                                renew_distIR(cascade, info, distIR);
                            } else {
                                setup_distIR(cascade, id, distIR);
                            }

                            break;
                        }
                        case tinkerforge.BrickletIndustrialDualAnalogInV2.DEVICE_IDENTIFIER: {

                            var dualAnalogIn = new tinkerforge.BrickletIndustrialDualAnalogInV2(uid, ipcon);

                            dualAnalogIn.uid_string = uid;
                            dualAnalogIn.position = masterbrick_position[connectedUid] + position;

                            let id = "DUAL_ADC_" + dualAnalogIn.position;

                            info = allDevices[id];
                            if (info) {
                                renew_dualADC(cascade, info, dualAnalogIn);
                            } else {
                                setup_dualADC(cascade, id, dualAnalogIn);
                            }

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
        utils.update_hard_resource_list_component(cascade, "RELAY_HR_names", relay_names.sort());
        utils.update_hard_resource_list_component(cascade, "DAC_HR_names", dac_names.sort());
        utils.update_hard_resource_list_component(cascade, "STEPPER_HR_names", stepper_names.sort());
        utils.update_hard_resource_list_component(cascade, "BIT_IN_HR_names", input_names.sort());
        utils.update_hard_resource_list_component(cascade, "BIT_OUT_HR_names", output_names.sort());
        utils.update_hard_resource_list_component(cascade, "ADC_HR_names", adc_names.sort());
        utils.update_hard_resource_list_component(cascade, "DISTANCE_HR_names", dist_names.sort());
        utils.update_hard_resource_list_component(cascade, "PTC_PROBE_HR_names", ptc_names.sort());
        utils.update_hard_resource_list_component(cascade, "TC_PROBE_HR_names", tc_names.sort());
        utils.update_hard_resource_list_component(cascade, "OW_PROBE_HR_names", ow_names.sort());
        utils.update_hard_resource_list_component(cascade, "TEMP_PROBE_HR_names",
            ptc_names.sort().concat(tc_names.sort().concat(ow_names.sort())));
        //max_temp.value = 0;  // last chance in setup to clear this value.
        setup_complete = true;
        cascade.log_info("TF setup completed.");
    }, 10000);
    cascade.log_info("TF setup exits.");
};

module.exports.loop = function (cascade) {
    if (!setup_complete) return;

    utils.log_cycle(log_obj, true);

    for (let id in onewireNets) {
        let ow_info = onewireNets[id];
        var ow = ow_info.interface;
        if (ow && ow.in_use) {
            log_obj.OW_in_use = log_obj.OW_in_use+1 || 1;
            /*cascade.log_info("OW " + id + " is in use at start of loop.");*/
        }
        if (ow && !ow.in_use) {
            ow.in_use = true;
            ow.getAllTemperatures(function (error, ow_probes) {
                if (error) {
                    ow.resetBus();
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
                    set_temperature(tempProbe, tempValue);
                }
                ow.in_use = false;
            });
        }
    }

    for (let id in barometers) {
        let barometer_info = barometers[id];
        var barometer = barometer_info.interface;

        if (barometer && !barometer_info.V2) {

            barometer.getChipTemperature(
                function(rawtemp) {
                    barometer_info.chip_temp.value = rawtemp/100;
                },
                function(err) {
                    cascade.log_info("Error getting barometer temperature: " + err);
                });
        }
    }
};
