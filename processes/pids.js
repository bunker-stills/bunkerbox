var _ = require("underscore");
var pid_controller = require("./lib/pid");

var pids = {};

function create_pid(name, description, temp_component_name, output_component_name, cascade)
{
    var pid = new pid_controller(0,0,0,0,0,'direct');
    pid.setSampleTime(1000);
    pid.setMode("auto");

    var definition = {};

    definition.name = name;
    definition.pid = pid;

    definition.enable = cascade.create_component({
        id: name + "_pid_enable",
        name: description + " Enable",
        type: cascade.TYPES.BOOLEAN
    });
    definition.enable.on("value_updated", function(){
        // Reset our PID
        if(definition.enable.value == false) {
            definition.i_term.value = null;
            definition.control_value.value = 0;
            definition.pid.reset();

            if (definition.output_component) {
                definition.output_component.value = 0;
            }
        }
    });

    definition.set_point = cascade.create_component({
        id: name + "_pid_set_point",
        name : description + " Set Point",
        read_only : false,
        type: cascade.TYPES.NUMBER,
        units : cascade.UNITS.F
    });

    definition.process_value = cascade.create_component({
        id: name + "_pid_process_sensor",
        name : description + " Process Sensor",
        read_only : true,
        type: cascade.TYPES.NUMBER,
        units : cascade.UNITS.F
    });
    cascade.components.require_component(temp_component_name, function(temp_component){
        definition.process_value.mirror_component(temp_component);
    });

    definition.control_value = cascade.create_component({
        id: name + "_pid_control_value",
        name: description + " Control Value",
        read_only : true,
        type: cascade.TYPES.NUMBER
    });

    definition.i_term = cascade.create_component({
        id: name + "_pid_i_term",
        name: description + " I Term",
        read_only : false,
        type: cascade.TYPES.NUMBER
    });

    definition.p_gain = cascade.create_component({
        id: name + "_pid_p_gain",
        name: description + " P Gain",
        class_name: "pid_gain",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    definition.i_gain = cascade.create_component({
        id: name + "_pid_i_gain",
        name: description + " I Gain",
        class_name: "pid_gain",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    definition.d_gain = cascade.create_component({
        id: name + "_pid_d_gain",
        name: description + " D Gain",
        class_name: "pid_gain",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    definition.min_cv = cascade.create_component({
        id: name + "_pid_min_cv",
        name: description + " Minimum Control Value",
        persist : true,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE
    });

    definition.max_cv = cascade.create_component({
        id: name + "_pid_max_cv",
        name: description + " Maximum Control Value",
        persist : true,
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE
    });

    cascade.components.require_component(output_component_name, function(output_component){
        definition.output_component = output_component;
    });

    return definition;
}

module.exports.setup = function (cascade)
{
    pids["pre_heater_pid"] = create_pid("pre_heater", "Preheater PID", "pre_heater_temp", "pre_heater_output", cascade);
    pids["main_heater_pid"] = create_pid("main_heater", "Main Heater PID", "sump_temp", "main_heater_output", cascade);
    pids["hearts_reflux_pid"] = create_pid("hearts_reflux", "Hearts Reflux PID", "heads_temp", "hearts_reflux_percent", cascade);
    pids["tails_reflux_pid"] = create_pid("tails_reflux", "Tails Reflux PID", "tails_temp", "tails_reflux_percent", cascade);
};

module.exports.loop = function (cascade)
{
    _.each(pids, function(pid_definition){

        if(pid_definition.enable.value == true) {
            pid_definition.pid.setOutputLimits(
                pid_definition.min_cv.value || 0.0,
                pid_definition.max_cv.value || 0.0
            );

            pid_definition.pid.setTunings(
                pid_definition.p_gain.value || 0.0,
                pid_definition.i_gain.value || 0.0,
                pid_definition.d_gain.value || 0.0
            );

            pid_definition.pid.setPoint(
                pid_definition.set_point.value || 0.0
            );

            pid_definition.pid.setInput(
                pid_definition.process_value.value || 0.0
            );

            pid_definition.pid.compute();
            pid_definition.control_value.value = pid_definition.pid.getOutput();

            if (pid_definition.output_component) {
                pid_definition.output_component.value = pid_definition.control_value.value;
            }

            pid_definition.i_term.value = pid_definition.pid.getITerm();
        }

    });
};