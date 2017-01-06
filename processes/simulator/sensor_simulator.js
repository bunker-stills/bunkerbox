var chance = require('chance').Chance();
var _ = require("underscore");

var ATMO_PRESSURE = 1013.25;

var baro_component;
var temp_components = {};
var temp_pids = {};

function generate_random_value(chance_of_change, current_value, min, max) {
    var probability = chance.floating({min: 0, max: 1.0});

    if (probability > chance_of_change) {
        return current_value;
    }

    return chance.floating({min: min, max: max});
}

function randomize_component(component, chance_of_change, midpoint, range) {
    component.value = generate_random_value(chance_of_change, midpoint, midpoint - range, midpoint + range);
}

function create_temp_probe(cascade, probe_id, pid_cv_id, nominal_value)
{
    var probe_components = {
        nominal : nominal_value
    };

    probe_components.raw = cascade.create_component({
        id: probe_id + "_sim_raw",
        name: "Temp. Probe " + probe_id + " Raw",
        units: cascade.UNITS.C,
        group: "sensors",
        class: "raw_temperature",
        read_only: true,
        type: cascade.TYPES.NUMBER,
        value: 21.0
    });

    probe_components.calibration = cascade.create_component({
        id: probe_id + "_sim_calibration",
        name: "Temp. Probe " + probe_id + " Calibration",
        group: "sensors",
        units: cascade.UNITS.C,
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    probe_components.calibrated = cascade.create_component({
        id: probe_id + "_sim_calibrated",
        name: "Temp. Probe " + probe_id + " Calibrated",
        units: cascade.UNITS.C,
        group: "sensors",
        class: "calibrated_temperature",
        read_only: true,
        type: cascade.TYPES.NUMBER
    });

    probe_components.raw.on("value_updated", function () {
        probe_components.calibrated.value = this.value + probe_components.calibration.value;
    });

    if(pid_cv_id) {
        cascade.components.require_component(pid_cv_id, function (component) {
            probe_components.pid_cv = component;
        });
    }

    temp_components[probe_id] = probe_components;
}

module.exports.setup = function (cascade) {

    baro_component = cascade.create_component({
        id: "barometer",
        name: "Barometer",
        units: cascade.UNITS.MBAR,
        group: "sensors",
        class: "barometer",
        read_only: true,
        type: cascade.TYPES.NUMBER,
        value: ATMO_PRESSURE
    });

    // Simulate taking a few seconds for temp probes to come online
    setTimeout(function () {
        create_temp_probe(cascade, "pre_heater", "pre_heater_output", 43.33);
        create_temp_probe(cascade, "heads", null, 75.55);
        create_temp_probe(cascade, "hearts", null, 77.77);
        create_temp_probe(cascade, "tails", null, 85);
        create_temp_probe(cascade, "sump", null, 99.44);
    }, 3000);
};

module.exports.loop = function (cascade) {
    randomize_component(baro_component, 0.3, ATMO_PRESSURE, 2);

    _.each(temp_components, function (probe_components) {

        if(probe_components.pid_cv && probe_components.pid_cv.value > 0)
        {
            var current_temp = probe_components.raw.value;
            var simulated_temp = Number((current_temp + (probe_components.pid_cv.value * 0.50) - (current_temp * 0.10)).toFixed(3));
            simulated_temp = generate_random_value(0.3, simulated_temp, simulated_temp - 0.25,  simulated_temp + 0.25);
            probe_components.raw.value = simulated_temp;
        }
        else
        {
            randomize_component(probe_components.raw, 0.25, probe_components.nominal, 0.1);
        }
    });
};