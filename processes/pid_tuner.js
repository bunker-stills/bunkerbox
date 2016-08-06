var _ = require("underscore");

var start_time;
var start_process_value;
var cv_delta;

var start_component;
var process_value_sensor_component;
var process_value_component;
var dac_output_component;
var dac_cv_offset;
var pid_values_component;

var measurement_points = [];

module.exports.setup = function (cascade) {

    cascade.require_process("process_temps");
    cascade.require_process("process_controls");

    return;

    start_component = cascade.create_component({
        id: "tuner_start",
        name: "Start",
        group : "pid_tuner",
        type: cascade.TYPES.BOOLEAN
    });

    start_component.on("value_updated", function () {
        if (this.value) {
            measurement_points = [];
            start_time = Date.now() / 1000;
            start_process_value = process_value_component.value;
            cv_delta = dac_cv_offset.value;
            dac_output_component.value += dac_cv_offset.value;
        }
    });

    process_value_sensor_component = cascade.create_component({
        id: "tuner_process_value_sensor",
        name: "Process Temp. Sensor",
        type: cascade.TYPES.OPTIONS,
        group : "pid_tuner"
    });
    cascade.components.create_options_for_components_of_class(process_value_sensor_component, "process_temperature");

    process_value_component = cascade.create_component({
        id: "tuner_process_value",
        name: "Process Temp.",
        type : cascade.TYPES.NUMBER,
        units: cascade.UNITS.F,
        read_only : true
    });

    /*var process_values = _.keys(_.pick(temp_interface.components, function (temp_component, key) {
        return (temp_component.class == "temperature");
    })).sort();

    process_value_sensor_component = cascade.define_component({
        id: "tuner_process_value_sensor",
        name: "Process Temp. Sensor",
        type: cascade.TYPES.OPTIONS,
        info: {
            options: process_values
        }
    });

    process_value_sensor_component.on("value_updated", function () {
        process_value_component.create_value_reference(temp_interface.components[this.value]);
    });

    process_value_component = cascade.define_component({
        id: "tuner_process_value",
        name: "Process Temp.",
        type : cascade.TYPES.NUMBER,
        units: cascade.UNITS.F,
        read_only : true
    });

    var dac_component_chooser = cascade.define_component({
        id: "dac",
        name: "DAC",
        type: cascade.TYPES.OPTIONS,
        info: {
            options: ["preheater"]
        }
    });

    dac_component_chooser.on("value_updated", function () {
        dac_output_component.create_value_reference(dac_interface.components[this.value + "_output"]);
    });

    dac_output_component = cascade.define_component({
        id: "dac_output",
        name: "DAC Output",
        type: cascade.TYPES.NUMBER
    });

    dac_cv_offset = cascade.define_component({
        id: "dac_cv_offset",
        name: "DAC Output Change",
        persist: true,
        type: cascade.TYPES.NUMBER
    });

    pid_values_component = cascade.define_component({
        id: "pid_values",
        name: "PID Values",
        read_only: true,
        value : "See Info"
    });*/
};

module.exports.loop = function (cascade) {

    /*if(temp_component.mapper.value !== process_value_component.mirrored_component)
    {
        temp_component.value.mirror_component(cascade.components[temp_component.mapper.value]);
    }*/

    return;

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