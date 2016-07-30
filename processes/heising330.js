module.exports.setup = function (cascade) {
    cascade.require_process("pids");
    //cascade.components.require_component("barometer");
    //cascade.components.require_component("test");
    //cascade.components.require_component_class("temperature");
};

module.exports.loop = function (cascade)
{
    if(cascade.components.test)
    {
        cascade.components.test.value = "Test 123";
        //console.log(cascade.components.barometer.value)
    }
};