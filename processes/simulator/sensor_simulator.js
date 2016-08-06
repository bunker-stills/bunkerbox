var chance = require('chance').Chance();
var _ = require("underscore");

var ATMO_PRESSURE = 1013.25;

var baro_component;
var temp_components = {};

function generate_random_value(chance_of_change, current_value, min, max)
{
    var probability = chance.floating({min: 0, max: 1.0});

    if(probability > chance_of_change)
    {
        return current_value;
    }

    return chance.floating({min: min, max: max});
}

function randomize_component(component, chance_of_change, midpoint, range)
{
    component.value = generate_random_value(chance_of_change, midpoint, midpoint - range, midpoint + range);
}

module.exports.setup = function (cascade) {

    baro_component = cascade.create_component({
        id: "barometer",
        name: "Barometer",
        units: cascade.UNITS.MBAR,
        group : "sensors",
        class: "barometer",
        read_only: true,
        type: cascade.TYPES.NUMBER,
        value: ATMO_PRESSURE
    });

    _.each(["FF4435641403", "FFED5694403"], function(probe_id){

        var probe_components = {};

        probe_components.raw = cascade.create_component({
            id: probe_id + "_raw",
            name: "Temp. Probe " + probe_id + " Raw",
            units: cascade.UNITS.C,
            group : "sensors",
            class: "raw_temperature",
            read_only : true,
            type: cascade.TYPES.NUMBER,
            value: 21.0
        });

        probe_components.calibration = cascade.create_component({
            id: probe_id + "_calibration",
            name: "Temp. Probe " + probe_id + " Calibration",
            group : "sensors",
            units: cascade.UNITS.C,
            persist : true,
            type: cascade.TYPES.NUMBER
        });

        probe_components.calibrated = cascade.create_component({
            id: probe_id + "_calibrated",
            name: "Temp. Probe " + probe_id + " Calibrated",
            units: cascade.UNITS.C,
            group : "sensors",
            class: "calibrated_temperature",
            read_only : true,
            type: cascade.TYPES.NUMBER
        });

        probe_components.raw.on("value_updated", function(){
            probe_components.calibrated.value = this.value + probe_components.calibration.value;
        });

        temp_components[probe_id] = probe_components;
    });
};

module.exports.loop = function (cascade) {
    randomize_component(baro_component, 0.3, ATMO_PRESSURE, 2);

    _.each(temp_components, function(probe_components){
        randomize_component(probe_components.raw, 0.5, 21.0, 3);
    });
};