var run_component;

module.exports.setup = function (cascade) {
    cascade.require_process("process_temps");
    cascade.require_process("process_controls");
    //cascade.require_process("pids");

    /*run_component = cascade.create_component({
        id: "run",
        name: description + " Enable",
        persist : false,
        type: cascade.TYPES.BOOLEAN
    });*/


    //cascade.components.require_component("barometer");
    //cascade.components.require_component("test");
    //cascade.components.require_component_class("temperature");
};

module.exports.loop = function (cascade)
{
};