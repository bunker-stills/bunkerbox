var pid_controller = require("./lib/pid");

var pids = {};

function create_pid(name, description, cascade)
{
    var pid = new pid_controller(0,0,0,0,0,'direct');
    pid.setSampleTime(1000);
    pid.setMode("auto");

    var definition = {};

    definition.name = name;
    definition.pid = pid;

    definition.enable = cascade.create_component({
        id: name + "_enable",
        name: description + " Enable",
        persist : false,
        type: cascade.TYPES.BOOLEAN
    });

    definition.set_point = cascade.create_component({
        id: name + "_set_point",
        name : description + " Set Point",
        persist : false,
        read_only : false,
        type: cascade.TYPES.NUMBER,
        units : cascade.UNITS.F
    });

    definition.process_value = cascade.create_component({
        id: name + "_process_sensor",
        name : description + " Process Sensor",
        persist : true,
        read_only : true,
        type: cascade.TYPES.NUMBER,
        units : cascade.UNITS.F
    });

    definition.control_value = cascade.create_component({
        id: name + "_control_value",
        name: description + " Control Value",
        persist : false,
        read_only : true,
        type: cascade.TYPES.NUMBER
    });

    definition.i_term = cascade.create_component({
        id: name + "_i_term",
        name: description + " I Term",
        persist : false,
        read_only : false,
        type: cascade.TYPES.NUMBER
    });

    definition.p_gain = cascade.create_component({
        id: name + "_p_gain",
        name: description + " P Gain",
        class_name: "pid_gain",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    definition.i_gain = cascade.create_component({
        id: name + "_i_gain",
        name: description + " I Gain",
        class_name: "pid_gain",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    definition.d_gain = cascade.create_component({
        id: name + "_d_gain",
        name: description + " D Gain",
        class_name: "pid_gain",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    definition.min_cv = cascade.create_component({
        id: name + "_min_cv",
        name: description + " Minimum Control Value",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    definition.max_cv = cascade.create_component({
        id: name + "_max_cv",
        name: description + " Maximum Control Value",
        persist : true,
        type: cascade.TYPES.NUMBER
    });

    return definition;
}

module.exports.setup = function (cascade)
{
    pids["pre_heater_pid"] = create_pid("pre_heater_pid", "Preheater", cascade);
    pids["main_heater_pid"] = create_pid("main_heater_pid", "Main Heater", cascade);
};

module.exports.loop = function (cascade)
{
};