var _ = require("underscore");
var process_temps = {};
var calculatedSumpTemp;

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
    process_temps[id] = value_component;
}

module.exports.setup = function (cascade) {
    create_process_temp(cascade, "pre_heater", "Preheater Temperature");
    create_process_temp(cascade, "heads", "Heads Temperature");
    create_process_temp(cascade, "hearts", "Hearts Temperature");
    create_process_temp(cascade, "tails", "Tails Temperature");
    create_process_temp(cascade, "sump1", "Sump Temperature 1");
    create_process_temp(cascade, "sump2", "Sump Temperature 2");
    create_process_temp(cascade, "sump3", "Sump Temperature 3");
    create_process_temp(cascade, "sump4", "Sump Temperature 4");

    calculatedSumpTemp = cascade.create_component({
        id: "sump_temp",
        name: "Calculated Sump Temperature",
        units: cascade.UNITS.F,
        group : "Process Temps",
        class: "process_temperature",
        read_only : true,
        type: cascade.TYPES.NUMBER
    });
};

module.exports.loop = function(cascade)
{
    calculatedSumpTemp.value = Math.max(process_temps["sump1"].value, process_temps["sump2"].value, process_temps["sump3"].value, process_temps["sump4"].value);
};