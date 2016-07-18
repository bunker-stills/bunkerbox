var barometer_component;

module.exports.setup = function (cascade) {
    cascade.require_component("barometer", function(err, component){
        barometer_component = component;
    });
};

module.exports.loop = function (cascade) {
    if(barometer_component)
    {
        console.log("Test1: " + barometer_component.value);
    }
};