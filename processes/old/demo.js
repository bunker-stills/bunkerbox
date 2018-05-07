var run;

module.exports.setup = function (cascade) {
    cascade.require_process("pids");

    run = cascade.create_component({
        id: "run",
        name: "Run",
        group: "run",
        type: cascade.TYPES.BOOLEAN
    });
};

module.exports.loop = function (cascade) {

};