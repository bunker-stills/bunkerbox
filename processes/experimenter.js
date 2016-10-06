var _ = require("underscore");
var utils = require("./lib/utils");
var vm = require("vm");

// Set to true if we want to continually send values to our process outputs. Otherwise we only send values if they change.
// This is good if we want to be sure our outputs are always set, but can cause more load on the system.
var FORCE_UPDATES = false;

var run_mode;
var functions = {};
var components;

function check_temp(cascade, temp_component) {
    if (temp_component.seconds_since_last_updated() >= MAX_TEMP_COMPONENT_OFFLINE_TIMEOUT_IN_SECONDS) {
        // Set to the cooldown state
        run_mode.value = "Cooldown";
        cascade.log_warning("The temperature probe named '" + temp_component.id + "' went offline for more than "
            + MAX_TEMP_COMPONENT_OFFLINE_TIMEOUT_IN_SECONDS + " seconds. Moving to cooldown state.")
    }
}

function update_component_if_needed(component, new_value) {
    if (FORCE_UPDATES || component.value != new_value) {
        component.value = new_value; // Let's always update the value for now.
    }
}

function create_script(cascade, function_info){
    if(!function_info.code.value)
    {
        function_info.script = undefined;
        return;
    }

    try
    {
        var script_code = "var _return_value; function custom(){" + function_info.code.value + "}; _return_value = custom();";
        function_info.script = vm.createScript(script_code);
    }
    catch(e)
    {
        cascade.log_error("ERROR: " + e.toString());
    }
}

function create_function_component(cascade, id)
{
    var function_info = {};

    function_info.code = cascade.create_component({
        id: id + "_code",
        name: id + " Code",
        group: "functions",
        type: cascade.TYPES.TEXT,
        persist: true
    });
    create_script(cascade, function_info);
    function_info.code.on("value_updated", function(){
        create_script(cascade, function_info);
    });

    functions[id] = function_info;
}

module.exports.setup = function (cascade) {
    cascade.require_process("process_temps");
    cascade.require_process("reflux_control");
    cascade.require_process("pids");

    cascade.components.require_component([
        "pump_enable",
        "pre_heater_enable",
        "pre_heater_pid_enable",
        "main_heater_enable",
        "main_heater_pid_enable",
        "tails_reflux_enable",
        "tails_reflux_relay",
        "hearts_reflux_enable",
        "hearts_reflux_relay",
        "wash_input_relay"
    ], function (comps) {
        components = comps;
    });

    run_mode = cascade.create_component({
        id: "run_mode",
        name: "Run Mode",
        group: "run",
        type: cascade.TYPES.OPTIONS,
        info: {
            options: ["Idle", "Manual", "Functions"]
        },
        value: "Idle"
    });

    create_function_component(cascade, "function1");
    create_function_component(cascade, "function2");
    create_function_component(cascade, "function3");
};

function during_idle(cascade) {
    // Turn off our pump
    update_component_if_needed(components.pump_enable, false);

    // Make sure our heaters are turned off
    update_component_if_needed(components.pre_heater_enable, false);
    update_component_if_needed(components.pre_heater_pid_enable, false);
    update_component_if_needed(components.main_heater_enable, false);
    update_component_if_needed(components.main_heater_pid_enable, false);

    // Make sure all of our relays are in the off state
    update_component_if_needed(components.tails_reflux_enable, false);
    update_component_if_needed(components.tails_reflux_relay, false);
    update_component_if_needed(components.hearts_reflux_enable, false);
    update_component_if_needed(components.hearts_reflux_relay, false);
    update_component_if_needed(components.wash_input_relay, false);
}

/*function during_cooldown(cascade) {
    // Run our pump
    update_component_if_needed(components.pump_enable, true);

    // Make sure our heaters are turned off
    update_component_if_needed(components.pre_heater_enable, false);
    update_component_if_needed(components.pre_heater_pid_enable, false);
    update_component_if_needed(components.main_heater_enable, false);
    update_component_if_needed(components.main_heater_pid_enable, false);

    // Make sure all of our relays are in the off state
    update_component_if_needed(components.tails_reflux_enable, false);
    update_component_if_needed(components.tails_reflux_relay, false);
    update_component_if_needed(components.hearts_reflux_enable, false);
    update_component_if_needed(components.hearts_reflux_relay, false);
    update_component_if_needed(components.wash_input_relay, false);

    // If the sump temp is at or below the safe value, we can move to the idle state
    if (components.sump_temp.value <= SUMP_TEMP_SAFE_TEMP) {
        run_mode.value = "Idle";
        cascade.log_info("Moving to idle after sufficient cooldown phase.");
    }
}*/

function during_manual(cascade) {
    // Anything goes
}

function during_functions(cascade) {
    // Get the current values of all of our components
    var component_values = {};
    _.each(cascade.components.all_current, function (component) {

        // Remove any functions themselves from the list
        if(_.find(functions, function(custom_function){
                return (component === custom_function.code);
            })){
            return;
        }

        component_values[component.id] = component.value;
    });

    // Evaluate our custom functions
    _.each(functions, function (custom_function) {
        if (custom_function.script) {
            component_values = _.omit(component_values, ["_return_value", "custom"]);
            try {
                custom_function.script.runInNewContext(component_values);

                _.each(cascade.components.all_current, function (component) {
                    if (!component.read_only && !_.isUndefined(component_values[component.id]) && component.value !== component_values[component.id]) {
                        component.value = (component_values[component.id]);
                    }
                });
            }
            catch (e) {
                cascade.log_error("ERROR: " + e.toString());
            }
        }
    });
}

module.exports.loop = function (cascade) {

    // Check to make sure all of our temperature probes have valid values if we're in a critical state
    if (run_mode.value === "Warmup" || run_mode.value === "Continuous") {
        check_temp(cascade, components.pre_heater_temp);
        check_temp(cascade, components.sump_temp);
    }

    switch (run_mode.value) {
        case "Manual": {
            during_manual(cascade);
            break;
        }
        case "Functions": {
            during_functions(cascade);
            break;
        }
        case "Cooldown": {
            //during_cooldown(cascade);
            break;
        }
        default: {
            during_idle(cascade);
            break;
        }
    }
};