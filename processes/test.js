module.exports.setup = function (cascade) {
    cascade.components.require_component_class("calibrated_temperature", "ws://admin:admin@localhost:3030", function(component){

    });
};

module.exports.loop = function (cascade)
{
    /*if(cascade.components.test)
    {
        cascade.components.test.value = "Test 123";
        //console.log(cascade.components.barometer.value)
    }*/
};