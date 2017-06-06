var _ = require("underscore");
var pid_controller = require("./lib/pid");

var pids = {};

function create_pid(name, description, output_component_name, cascade) {
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

            if (definition.output_component) {
                definition.output_component.value = 0;
            }
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

    definition.process_component = cascade.create_component({
        id: name + "_pid_process_component",
        name: description + " Process Component",
        group: description,
        persist: true,
        type: cascade.TYPES.TEXT
    });
    definition.process_component.on("value_updated", function () {

        if (_.isUndefined(definition.process_component.value) || _.isNull(definition.process_component.value)) {
            definition.process_value.mirror_component(null);
        }
        else {
            cascade.components.require_component(definition.process_component.value, function (temp_component) {
                definition.process_value.mirror_component(temp_component);
            });
        }
    });
    definition.process_component.value = definition.process_component.value;

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

    cascade.components.require_component(output_component_name, function (output_component) {
        definition.output_component = output_component;
    });

    return definition;
}

module.exports.setup = function (cascade) {
    pids["pre_heater_pid"] = create_pid("pre_heater", "Preheater PID", "pre_heater_output", cascade);
    pids["main_heater_pid"] = create_pid("main_heater", "Main Heater PID", "main_heater_output", cascade);
    pids["pump"] = create_pid("pump", "Pump PID", "pump_output", cascade);
    pids["hearts_reflux_pid"] = create_pid("hearts_reflux", "Hearts Reflux PID", "hearts_draw_percent", cascade);
    pids["tails_reflux_pid"] = create_pid("tails_reflux", "Tails Reflux PID", "tails_draw_percent", cascade);
};

module.exports.loop = function (cascade) {
    _.each(pids, function (pid_definition, pid_name) {

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

            if (pid_definition.output_component) {
                pid_definition.output_component.value = pid_definition.control_value.value;
            }

            pid_definition.i_term.value = pid_definition.pid.getIntegral();
        }
    });
};