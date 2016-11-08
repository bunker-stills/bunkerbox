var _ = require("underscore");
var utils = require("./lib/utils");

// Set to true if we want to continually send values to our process outputs. Otherwise we only send values if they change.
// This is good if we want to be sure our outputs are always set, but can cause more load on the system.
var FORCE_UPDATES = false;

// If a temperature component hasn't been updated in this amount of time, we should stop execution
var MAX_TEMP_COMPONENT_OFFLINE_TIMEOUT_IN_SECONDS = 30;

// The temp in which we can move out of cooldown mode
var SUMP_TEMP_SAFE_TEMP = 100;

var run_mode;
var boiling_point;
var components;

function is_everything_online() {
    return !_.isUndefined(components);
}

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

module.exports.setup = function (cascade) {
    cascade.require_process("process_temps");
    cascade.require_process("reflux_control");
    cascade.require_process("pids");

    cascade.components.require_component([
        "pump_enable",
        "pre_heater_enable",
        "pre_heater_pid_enable",
        "pre_heater_pid_p_gain",
        "pre_heater_pid_i_gain",
        "pre_heater_pid_d_gain",
        "pre_heater_pid_set_point",
        "main_heater_enable",
        "main_heater_pid_enable",
        "main_heater_pid_p_gain",
        "main_heater_pid_i_gain",
        "main_heater_pid_d_gain",
        "main_heater_pid_set_point",
        "pre_heater_temp",
        "sump_temp",
        "tails_reflux_enable",
        "tails_reflux_relay",
        "hearts_reflux_enable",
        "hearts_reflux_relay",
        "feed_relay"
    ], function (comps) {
        components = comps;
    });

    run_mode = cascade.create_component({
        id: "run_mode",
        name: "Run Mode",
        group: "run",
        type: cascade.TYPES.OPTIONS,
        info: {
            options: ["Idle", "Warmup", "Continuous", "Cooldown", "Manual"]
        },
        value: "Idle"
    });
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
    update_component_if_needed(components.feed_relay, false);
}

/*var WARMUP_PRE_HEATER_P_GAIN = 1.0;
var WARMUP_PRE_HEATER_I_GAIN = 0.004;
var WARMUP_PRE_HEATER_D_GAIN = 0.0;
var WARMUP_PRE_HEATER_SET_POINT = 100;
var WARMUP_MAIN_HEATER_P_GAIN = 0.637;
var WARMUP_MAIN_HEATER_I_GAIN = 0.008;
var WARMUP_MAIN_HEATER_D_GAIN = 0.051;
var WARMUP_MAIN_HEATER_SET_POINT = 210;*/
function during_warmup(cascade) {
    // Run our pump
    update_component_if_needed(components.pump_enable, true);

    // Turn on full reflux
    update_component_if_needed(components.tails_reflux_enable, false);
    update_component_if_needed(components.tails_reflux_relay, true);
    update_component_if_needed(components.hearts_reflux_enable, false);
    update_component_if_needed(components.hearts_reflux_relay, true);

    // Set our Heater PID values
    update_component_if_needed(components.pre_heater_pid_p_gain, WARMUP_PRE_HEATER_P_GAIN);
    update_component_if_needed(components.pre_heater_pid_i_gain, WARMUP_PRE_HEATER_I_GAIN);
    update_component_if_needed(components.pre_heater_pid_d_gain, WARMUP_PRE_HEATER_D_GAIN);
    update_component_if_needed(components.main_heater_pid_p_gain, WARMUP_MAIN_HEATER_P_GAIN);
    update_component_if_needed(components.main_heater_pid_i_gain, WARMUP_MAIN_HEATER_I_GAIN);
    update_component_if_needed(components.main_heater_pid_d_gain, WARMUP_MAIN_HEATER_D_GAIN);

    update_component_if_needed(components.pre_heater_pid_set_point, WARMUP_PRE_HEATER_SET_POINT);
    update_component_if_needed(components.pre_heater_pid_enable, true);
    update_component_if_needed(components.pre_heater_enable, true);

    // If the preheater has reached 90% of its set point then we should be able to start up the main heater.
    // Once it's turned on it won't go back (to prevent from fluctuating)
    if (components.main_heater_enable.value == false && components.pre_heater_temp.value >= components.pre_heater_pid_set_point.value * 0.9) {
        update_component_if_needed(components.main_heater_enable, true);
    }

    if (components.main_heater_enable.value == true) {
        update_component_if_needed(components.main_heater_pid_set_point, WARMUP_MAIN_HEATER_SET_POINT);
        update_component_if_needed(components.main_heater_pid_enable, true);
        update_component_if_needed(components.main_heater_enable, true);
    }
    else {
        update_component_if_needed(components.main_heater_pid_set_point, 0.0);
        update_component_if_needed(components.main_heater_pid_enable, false);
        update_component_if_needed(components.main_heater_enable, false);
    }
}

function during_cooldown(cascade) {
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
    update_component_if_needed(components.feed_relay, false);

    // If the sump temp is at or below the safe value, we can move to the idle state
    if (components.sump_temp.value <= SUMP_TEMP_SAFE_TEMP) {
        run_mode.value = "Idle";
        cascade.log_info("Moving to idle after sufficient cooldown phase.");
    }
}

function during_manual(cascade) {
    // Anything goes
}

module.exports.loop = function (cascade) {

    if (!is_everything_online()) {
        // TODO add some debugging output
        return;
    }

    // Calculate

    // Check to make sure all of our temperature probes have valid values if we're in a critical state
    if (run_mode.value === "Warmup" || run_mode.value === "Continuous") {
        check_temp(cascade, components.pre_heater_temp);
        check_temp(cascade, components.sump_temp);
    }

    switch (run_mode.value) {
        case "Warmup": {
            during_warmup(cascade);
            break;
        }
        case "Manual": {
            during_manual(cascade);
            break;
        }
        case "Cooldown": {
            during_cooldown(cascade);
            break;
        }
        default: {
            during_idle(cascade);
            break;
        }
    }
};