var barometer_component;

module.exports.setup = function (cascade) {
    cascade.get_component("barometer", "mqtt://localhost:1883", function(err, component){
        barometer_component = component;
    });
};

module.exports.loop = function (cascade) {
    if(barometer_component)
    {
        console.log("Test2: " + barometer_component.value);
    }
};