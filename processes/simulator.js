var chance = require('chance').Chance();
var _ = require("underscore");

var ATMO_PRESSURE = 1013.25;

var baro_component;
var temp_components;

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
        class: "barometer",
        read_only: true,
        type: cascade.TYPES.NUMBER,
        value: ATMO_PRESSURE
    });

   var test_component = cascade.create_component({
        id: "test",
        name: "test",
        class: "test",
        read_only: true,
        persist : true
    });

    _.each(["FF4435641403", "FFED5694403"], function(probe_id){
        cascade.create_component({
            id: probe_id,
            name: "Temp. Probe " + probe_id + " Raw",
            units: cascade.UNITS.C,
            class: "raw_temperature",
            read_only : true,
            type: cascade.TYPES.NUMBER,
            value: 21.0
        });
    });
};

module.exports.loop = function (cascade) {
    randomize_component(baro_component, 0.3, ATMO_PRESSURE, 2);
};