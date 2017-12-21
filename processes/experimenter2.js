var _ = require("underscore");
var vm = require("vm");
var pid_controller = require("./lib/pid");

var pids = [];
var functions = [];
var run_mode;

function create_pid(cascade, name, description) {
    var pid = new pid_controller();

    var definition = {};

    definition.name = name;
    definition.pid = pid;

    definition.enable = cascade.create_component({
        id: name + "_pid_enable",
        group: description,
        name: description + " Enable",
        type: cascade.TYPES.BOOLEAN
    });
    definition.enable.on("value_updated", function () {
        // Reset our PID
        if (definition.enable.value == false) {
            definition.i_term.value = null;
            definition.control_value.value = 0;
            definition.pid.reset();
        }
        else {
            definition.pid.setIntegral(definition.i_term.value);
        }
    });

    definition.set_point = cascade.create_component({
        id: name + "_pid_set_point",
        name: description + " Set Point",
        group: description,
        read_only: false,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.F
    });

    definition.process_value = cascade.create_component({
        id: name + "_pid_process_value",
        name: description + " Process Value",
        group: description,
        read_only: true,
        type: cascade.TYPES.NUMBER
    });

    definition.process_component_name = cascade.create_component({
        id: name + "_pid_process_component",
        name: description + " Process Component",
        group: description,
        persist: true,
        type: cascade.TYPES.TEXT
    });
    definition.process_component_name.on("value_updated", function () {

        definition.process_component = null;

        cascade.components.require_component(definition.process_component_name.value, function (component) {
            definition.process_component = component;
        });
    });
    definition.process_component_name.value = definition.process_component_name.value

    definition.control_component_name = cascade.create_component({
        id: name + "_pid_control_component",
        name: description + " Control Component",
        group: description,
        persist: true,
        type: cascade.TYPES.TEXT
    });
    definition.control_component_name.on("value_updated", function () {

        definition.control_component = null;

        cascade.components.require_component(definition.control_component_name.value, function (component) {
            definition.control_component = component;
        });
    });
    definition.control_component_name.value = definition.control_component_name.value

    definition.control_value = cascade.create_component({
        id: name + "_pid_control_value",
        name: description + " Control Value",
        group: description,
        read_only: true,
        type: cascade.TYPES.NUMBER
    });

    definition.i_term = cascade.create_component({
        id: name + "_pid_i_term",
        name: description + " I Term",
        group: description,
        read_only: false,
        type: cascade.TYPES.NUMBER
    });

    definition.p_gain = cascade.create_component({
        id: name + "_pid_p_gain",
        name: description + " P Gain",
        group: description,
        class_name: "pid_gain",
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    definition.i_gain = cascade.create_component({
        id: name + "_pid_i_gain",
        name: description + " I Gain",
        group: description,
        class_name: "pid_gain",
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    definition.d_gain = cascade.create_component({
        id: name + "_pid_d_gain",
        name: description + " D Gain",
        group: description,
        class_name: "pid_gain",
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    definition.min_cv = cascade.create_component({
        id: name + "_pid_min_cv",
        name: description + " Minimum Control Value",
        group: description,
        persist: true,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE
    });

    definition.max_cv = cascade.create_component({
        id: name + "_pid_max_cv",
        name: description + " Maximum Control Value",
        group: description,
        persist: true,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE
    });

    return definition;
}

function create_script(cascade, function_info) {
    if (!function_info.code.value) {
        function_info.script = undefined;
        return;
    }

    try {
        var script_code = "var _return_value; function custom(){" + function_info.code.value + "}; _return_value = custom();";
        function_info.script = vm.createScript(script_code);
    }
    catch (e) {
        cascade.log_error("ERROR: " + e.toString());
    }
}

function create_variable_component(cascade, name, description) {
    cascade.create_component({
        id: name,
        name: description,
        group: "functions",
        type: cascade.TYPES.NUMBER,
        persist: true
    });
}

function create_function_component(cascade, name, description) {
    var function_info = {};

    function_info.code = cascade.create_component({
        id: name + "_code",
        name: description,
        group: "functions",
        type: cascade.TYPES.TEXT,
        persist: true
    });
    create_script(cascade, function_info);
    function_info.code.on("value_updated", function () {
        create_script(cascade, function_info);
    });

    functions.push(function_info);
}

module.exports.setup = function (cascade) {

    if (process.env.SIMULATE) {
        cascade.require_process("simulator/simulator");
    }
    else {
        cascade.require_process("interfaces/ds9490r");
        cascade.require_process("interfaces/tinkerforge");
    }

    cascade.require_process("update_manager");
    cascade.require_process("reflux_control");
    cascade.require_process("warm_restart");

    pids.push(create_pid(cascade, "pid_1", "PID 1"));
    pids.push(create_pid(cascade, "pid_2", "PID 2"));
    pids.push(create_pid(cascade, "pid_3", "PID 3"));
    pids.push(create_pid(cascade, "pid_4", "PID 4"));
    pids.push(create_pid(cascade, "pid_5", "PID 5"));
    pids.push(create_pid(cascade, "pid_6", "PID 6"));
    pids.push(create_pid(cascade, "pid_7", "PID 7"));
    pids.push(create_pid(cascade, "pid_8", "PID 8"));

    create_function_component(cascade, "function1", "Function 1");
    //create_function_component(cascade, "function2", "Function 2");
    //create_function_component(cascade, "function3", "Function 3");

    create_variable_component(cascade, "variable1", "Variable 1");
    create_variable_component(cascade, "variable2", "Variable 2");
    create_variable_component(cascade, "variable3", "Variable 3");
    create_variable_component(cascade, "variable4", "Variable 4");
    create_variable_component(cascade, "variable5", "Variable 5");
    create_variable_component(cascade, "variable6", "Variable 6");
    create_variable_component(cascade, "variable7", "Variable 7");
    create_variable_component(cascade, "variable8", "Variable 8");
    create_variable_component(cascade, "variable9", "Variable 9");
    create_variable_component(cascade, "variable10", "Variable 10");

    run_mode = cascade.create_component({
        id: "run_mode",
        name: "Run Mode",
        group: "run",
        type: cascade.TYPES.OPTIONS,
        info: {
            options: ["STOP", "AUTOMATIC", "MANUAL"]
        },
        value: "STOP"
    });
};

function processFunctions(cascade) {
    // Get the current values of all of our components
    // TODO: This needs to be moved into the "Evaluate out custom functions" otherwise previous variables get overwritten.
    var component_values = {};
    _.each(cascade.components.all_current, function (component) {

        // Remove any functions themselves from the list
        if (_.find(functions, function (custom_function) {
                return (component === custom_function.code);
            })) {
            return;
        }

        component_values[component.id] = component.value;
    });

    // Evaluate our custom functions
    _.each(functions, function (custom_function) {
        if (custom_function.script) {
            try {
                custom_function.script.runInNewContext(component_values, {timeout: 3000});
            }
            catch (e) {
                cascade.log_error("ERROR: " + e.toString());
                return;
            }

            _.each(component_values, function (value, id) {
                var component = cascade.components.all_current[id];
                if (component && !component.read_only && value != component.value) {
                    component.value = value;
                }
            });
        }
    });
}

function processPIDs() {
    _.each(pids, function (pid_definition) {

        if (pid_definition.process_component) {
            pid_definition.process_value.value = pid_definition.process_component.value;
        }
        else {
            pid_definition.process_value.value = 0.0;
        }

        if (pid_definition.enable.value == true) {
            pid_definition.pid.setControlValueLimits(
                pid_definition.min_cv.value || 0.0,
                pid_definition.max_cv.value || 0.0,
                0
            );

            pid_definition.pid.setProportionalGain(pid_definition.p_gain.value || 0.0);
            pid_definition.pid.setIntegralGain(pid_definition.i_gain.value || 0.0);
            pid_definition.pid.setDerivativeGain(pid_definition.d_gain.value || 0.0);

            pid_definition.pid.setDesiredValue(pid_definition.set_point.value || 0.0);


            pid_definition.control_value.value = pid_definition.pid.update(pid_definition.process_value.value || 0.0);

            if (pid_definition.control_component) {
                pid_definition.control_component.value = pid_definition.control_value.value;
            }

            pid_definition.i_term.value = pid_definition.pid.getIntegral();
        }
    });
}

function during_automatic(cascade) {
    processFunctions(cascade);
    processPIDs();
}

function during_stop(cascade) {

    // Turn off all our PIDs
    _.each(pids, function (pid_definition) {
        if (pid_definition.enable.value == true) pid_definition.enable.value = false;
    });

    // Turn off all of our control values
    if (cascade.components.all_current.pump_enable) cascade.components.all_current.pump_enable.value = false;
    if (cascade.components.all_current.pump_output) cascade.components.all_current.pump_output.value = 0;

    if (cascade.components.all_current.pre_heater_enable) cascade.components.all_current.pre_heater_enable.value = false;
    if (cascade.components.all_current.pre_heater_output) cascade.components.all_current.pre_heater_output.value = 0;

    if (cascade.components.all_current.main_heater_enable) cascade.components.all_current.main_heater_enable.value = false;
    if (cascade.components.all_current.main_heater_output) cascade.components.all_current.main_heater_output.value = 0;

    if (cascade.components.all_current.feed_water_ratio_enable) cascade.components.all_current.feed_water_ratio_enable.value = false;
    if (cascade.components.all_current.hearts_draw_enable) cascade.components.all_current.hearts_draw_enable.value = false;
    if (cascade.components.all_current.tails_draw_enable) cascade.components.all_current.tails_draw_enable.value = false;

    if (cascade.components.all_current.feed_relay) cascade.components.all_current.feed_relay.value = false;
    if (cascade.components.all_current.hearts_reflux_relay) cascade.components.all_current.hearts_reflux_relay.value = false;
    if (cascade.components.all_current.tails_reflux_relay) cascade.components.all_current.tails_reflux_relay.value = false;
}

module.exports.loop = function (cascade) {
    switch (run_mode.value.toUpperCase()) {
        case "MANUAL": {
            // Anything goes here.
            break;
        }
        case "AUTOMATIC": {
            during_automatic(cascade);
            break;
        }
        default: {
            during_stop(cascade);
            break;
        }
    }
};