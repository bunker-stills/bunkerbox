var _ = require("underscore");

var calibrated_temperatures;

var temp_components = {};
var temp_sensors_options = [];

function create_process_temp(cascade, id, description)
{
    temp_components[id] = {};

    var value_component = cascade.create_component({
        id: id + "_temp",
        name: description,
        units: cascade.UNITS.F,
        group : "process_temps",
        class: "process_temperature",
        read_only : true,
        type: cascade.TYPES.NUMBER
    });
    temp_components[id].value = value_component;

    var mapper_component = cascade.create_component({
        id: id + "_temp_sensor",
        name: description + " Sensor",
        group : "process_temps",
        class: "sensor_mapping",
        persist : true,
        type: cascade.TYPES.OPTIONS
    });
    //cascade.components.create_options_for_components_of_class(mapper_component, "calibrated_temperature");

    cascade.components.create_mapper_value_pair_for_class(mapper_component, "calibrated_temperature", value_component);

    temp_components[id].mapper = mapper_component;
}

module.exports.setup = function (cascade) {

    create_process_temp(cascade, "pre_heater", "Preheater Temperature");
    create_process_temp(cascade, "heads", "Heads Temperature");
    create_process_temp(cascade, "hearts", "Hearts Temperature");
    create_process_temp(cascade, "tails", "Tails Temperature");
    create_process_temp(cascade, "sump", "Sump Temperature");
};

module.exports.loop = function (cascade)
{
    /*_.each(temp_components, function(temp_component){
        if(temp_component.mapper.value !== temp_component.value.mirrored_component.id)
        {
            console.log("blah");
            temp_component.value.mirror_component(cascade.components[temp_component.mapper.value]);
        }
    });*/
};