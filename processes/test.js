module.exports.setup = function (cascade) {
    cascade.components.require_component_class("temperature", "ws://localhost");
};

module.exports.loop = function (cascade)
{
    /*if(cascade.components.test)
    {
        cascade.components.test.value = "Test 123";
        //console.log(cascade.components.barometer.value)
    }*/
};