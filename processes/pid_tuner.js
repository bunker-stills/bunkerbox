var _ = require("underscore");

var start_time;
var start_process_value;
var cv_delta;
var start_cv;

var start_component;
var process_value_component;
var dac_output_component;
var dac_cv_offset;
var pid_values_component;

var measurement_points = [];

module.exports.setup = function (cascade) {

    cascade.require_process("process_temps");

    start_component = cascade.create_component({
        id: "tuner_start",
        name: "Start",
        group : "pid_tuner",
        type: cascade.TYPES.BOOLEAN
    });

    start_component.on("value_updated", function () {

        var dac_component = cascade.components[dac_output_component.value];

        // Reset all of our values
        if (this.value) {
            measurement_points = [];
            start_time = Date.now() / 1000;
            start_process_value = process_value_component.value;
            cv_delta = dac_cv_offset.value;

            if(dac_component)
            {
                start_cv = dac_component.value;
                dac_component.value += dac_cv_offset.value;
            }
        }
        else {
            if(dac_component && !_.isUndefined(start_cv))
            {
                dac_component.value = start_cv;
                start_cv = undefined;
            }
        }
    });

    var process_value_sensor_component = cascade.create_component({
        id: "tuner_process_value_sensor",
        name: "Process Temp. Sensor",
        type: cascade.TYPES.OPTIONS,
        persist: true,
        group : "pid_tuner"
    });

    process_value_component = cascade.create_component({
        id: "tuner_process_value",
        name: "Process Temp.",
        type : cascade.TYPES.NUMBER,
        units: cascade.UNITS.F,
        read_only : true
    });
    cascade.components.create_mapper_value_pair_for_class(process_value_sensor_component, "process_temperature", process_value_component);

    dac_output_component = cascade.create_component({
        id: "tuner_output_control",
        name: "Output Control",
        type: cascade.TYPES.OPTIONS,
        persist: true,
        group : "pid_tuner"
    });
    cascade.components.create_mapper_for_class(dac_output_component, "dac_output");

    dac_cv_offset = cascade.create_component({
        id: "tuner_output_change",
        name: "DAC Output Change",
        group : "pid_tuner",
        persist: true,
        type: cascade.TYPES.NUMBER,
        units : "%"
    });

    pid_values_component = cascade.create_component({
        id: "tuner_pid_values",
        name: "Tuner Results",
        group : "pid_tuner",
        read_only: true,
        value : "See Details"
    });
};

module.exports.loop = function (cascade) {

    if (start_component.value) {
        measurement_points.push({
            time: Date.now() / 1000,
            value: process_value_component.value
        });

        var t0 = start_time;
        var A = cv_delta;
        var B = process_value_component.value - start_process_value;
        var B_div_2 = B * 0.5 + start_process_value;
        var B_632 = B * 0.632 + start_process_value;
        var t2;
        var t3;

        for(var index = 0; index < measurement_points.length; index++)
        {
            var measurement = measurement_points[index];

            if(measurement.value <= B_div_2)
            {
                t2 = measurement.time;
            }

            if(measurement.value <= B_632)
            {
                t3 = measurement.time;
            }
            else
            {
                break;
            }
        }

        //console.log("t2: " + t2);
        //console.log("t3: ")

        var t1 = (t2 - Math.log(2) * t3) / (1 - Math.log(2));
        var t = t3 - t1;
        var tdel = t1 - t0;
        var K = B / A;
        var r = tdel / t;

        var output = {
            P : {},
            PI : {},
            PID : {}
        };

        output.P.P = (1 / (K * r)) * (1 + (r / 3));

        output.PI.P = (1 / (K * r)) * (0.9 + (r / 12));
        output.PI.I = tdel * ((30 + (3 * r)) / (9 + (20 * r)));

        output.PID.P = (1 / (K * r)) * ((4 / 3) + (r / 4));
        output.PID.I = tdel * ((32 + (6 * r)) / (13 + (8 * r)));
        output.PID.D = tdel * (4 / (11 + (2 * r)));

        pid_values_component.info = output;
    }

};