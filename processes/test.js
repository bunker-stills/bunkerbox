var another_temp;

module.exports.setup = function (cascade) {
    cascade.require_process("test2");

    cascade.components.require_component("some_temp", function(component){
        another_temp.mirror_component(component);
    });

    another_temp = cascade.create_component({
        id: "another_temp",
        name: "Another Temp",
        units: cascade.UNITS.C,
        group : "sensors",
        class: "temp",
        read_only : true,
        type: cascade.TYPES.NUMBER
    });

};

module.exports.loop = function (cascade)
{
};