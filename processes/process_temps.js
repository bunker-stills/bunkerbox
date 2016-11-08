var _ = require("underscore");
var process_temps = [];

function create_process_temp(cascade, id, description)
{
    var value_component = cascade.create_component({
        id: id + "_temp",
        name: description,
        units: cascade.UNITS.F,
        group : "Process Temps",
        class: "process_temperature",
        read_only : true,
        type: cascade.TYPES.NUMBER
    });

    var mapper_component = cascade.create_component({
        id: id + "_temp_sensor",
        name: description + " Sensor",
        group : "Process Temps",
        class: "sensor_mapping",
        persist : true,
        type: cascade.TYPES.OPTIONS
    });

    cascade.components.create_mapper_value_pair_for_class(mapper_component, "calibrated_temperature", value_component);
}

module.exports.setup = function (cascade) {
    create_process_temp(cascade, "pre_heater", "Preheater Temperature");
    create_process_temp(cascade, "heads", "Heads Temperature");
    create_process_temp(cascade, "hearts", "Hearts Temperature");
    create_process_temp(cascade, "tails", "Tails Temperature");
    create_process_temp(cascade, "sump", "Sump Temperature");
};

module.exports.loop = function(cascade)
{

};