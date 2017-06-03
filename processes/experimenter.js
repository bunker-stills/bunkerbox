var _ = require("underscore");
var utils = require("./lib/utils");
var vm = require("vm");

// Set to true if we want to continually send values to our process outputs. Otherwise we only send values if they change.
// This is good if we want to be sure our outputs are always set, but can cause more load on the system.
var FORCE_UPDATES = false;

var run_mode;
var functions = {};
var components;

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

function create_variable_component(cascade, id)
{
    cascade.create_component({
        id: id,
        name: id,
        group: "functions",
        type: cascade.TYPES.TEXT,
        persist: true
    });
}

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
    update_component_if_needed(components.feed_relay, false);
}

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
            try {
                custom_function.script.runInNewContext(component_values, {timeout:3000});
            }
            catch (e) {
                cascade.log_error("ERROR: " + e.toString());
                return;
            }

            _.each(component_values, function(value, id){
                var component = cascade.components.all_current[id];
                if(component && !component.read_only && value != component.value)
                {
                    component.value = value;
                }
            });
        }
    });
}

module.exports.setup = function (cascade) {

    if(process.env.SIMULATE)
    {
        cascade.require_process("simulator/simulator");
    }
    else
    {
        cascade.require_process("interfaces/ds9490r");
        cascade.require_process("interfaces/tinkerforge");
    }

    cascade.require_process("update_manager");
    cascade.require_process("process_temps");
    cascade.require_process("reflux_control");
    cascade.require_process("pids");
    cascade.require_process("alerts");

    cascade.components.require_component([
        "allow_software_updates",
        "pump_enable",
        "pre_heater_enable",
        "pre_heater_pid_enable",
        "main_heater_enable",
        "main_heater_pid_enable",
        "tails_reflux_enable",
        "tails_reflux_relay",
        "hearts_reflux_enable",
        "hearts_reflux_relay",
        "feed_relay",
        "process_temps_online"
    ], function (comps) {
        components = comps;
    });

    run_mode = cascade.create_component({
        id: "run_mode",
        name: "Run Mode",
        group: "run",
        type: cascade.TYPES.OPTIONS,
        info: {
            options: ["IDLE", "MANUAL", "FUNCTIONS"]
        },
        value: "IDLE"
    });

    create_function_component(cascade, "function1");
    //create_function_component(cascade, "function2");
    //create_function_component(cascade, "function3");

    create_variable_component(cascade, "variable1");
    create_variable_component(cascade, "variable2");
    create_variable_component(cascade, "variable3");
};

module.exports.loop = function (cascade) {

    // If a temperature probe is offline, don't allow anything but idle
    if(!components.process_temps_online.value)
    {
        run_mode.value = "IDLE";
    }

    switch (run_mode.value.toUpperCase()) {
        case "MANUAL": {
            during_manual(cascade);
            break;
        }
        case "FUNCTIONS": {
            during_functions(cascade);
            break;
        }
        default: {
            during_idle(cascade);
            break;
        }
    }
};