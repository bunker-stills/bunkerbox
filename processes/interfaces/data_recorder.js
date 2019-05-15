var dgram = require('dgram');
var _ = require("underscore");

var recorder = function (host, port) {
    this.host = host;
    this.port = port;
    this.socket = dgram.createSocket('udp4');

    this.measurements = [];
};

function escape_key(input_value) {
    input_value = input_value.replace(/,/g, "\\,");
    input_value = input_value.replace(/ /g, "\\ ");
    input_value = input_value.replace(/=/g, "\\=");

    return input_value;
}

function escape_field_value(value) {
    var output = "";

    if (_.isNumber(value)) {
        output += value;
    }
    else if (_.isBoolean(value)) {
        output += value ? "true" : "false";
    }
    else {
        output += '"' + value.replace(/"/g, '\\"') + '"';
    }

    return output;
}

var time_base = Date.now();
var simulated_time_component;

recorder.prototype.flush = function () {
    if (this.measurements.length > 0) {
        var current_measurements = this.measurements;
        this.measurements = [];

        var record_time;
        if (simulated_time_component) {
            record_time = Math.round(time_base / 1000 + simulated_time_component.value);
        }

        var message = "";

        _.each(current_measurements, function (measurement) {

            var tags = [escape_key(measurement.name)];

            _.each(measurement.tags, function (tag_value, tag_name) {

                if (_.isNull(tag_value) || _.isUndefined(tag_value)) return;

                tags.push(escape_key(tag_name) + "=" + escape_key(tag_value));
            });

            var values = [];

            _.each(measurement.values, function (value_value, value_name) {

                if (_.isNull(value_value) || _.isUndefined(value_value)) return;

                values.push(escape_key(value_name) + "=" + escape_field_value(value_value));
            });

            message += tags.join(",") + " " + values.join(",");

            if (record_time) {
                message += " " + record_time;
            } else
            if (!_.isUndefined(measurement.timestamp)) {
                message += " " + Math.round(measurement.timestamp / 1000);
            }

            message += "\n";
        });

        var message_buffer = new Buffer(message);

        try {
            this.socket.send(message_buffer, 0, message_buffer.length, this.port, this.host)
        }
        catch (e) {
            //console.log("Unable to record data: ")
        }
    }
};

recorder.prototype.record = function (measurement_name, values, tags) {

    if (_.isString(values.value)) {
        measurement_name += ".string";
    }
    else {
        measurement_name += ".number";
    }

    this.measurements.push({
        name: measurement_name,
        values: values,
        tags: tags
    });
};

function recordComponent(component)
{
    data_recorder.record(component.id, {
            value: component.value,
            units: component.units
        }, {
            device_id: device_name.value || "development",
            class: component.class
        }
    );
}

function recordLog(logType, message)
{
    data_recorder.record("logs", {
            value: message,
            log_type: logType
        }, {
            device_id: device_name.value || "development"
        }
    );
}

var data_recorder;
var device_name;

// Data that changes is recorded right away. Data that doesn't change is recorded once a minute.
module.exports.setup = function (cascade) {
    data_recorder = new recorder("52.39.173.27", 8089);

    device_name = cascade.create_component({
        id: "device_name",
        group: "data logging",
        display_order: 0,
        name: "Device Name",
        persist: true
    });

    // Integrate simulator time when present.
    cascade.components.require_component("simulated_time",
        function(component) {simulated_time_component = component;});

    cascade.cascade_server.on("component_value_updated", recordComponent);
    cascade.cascade_server.on("log_error", function(message){ recordLog("error", message); });
    cascade.cascade_server.on("log_info", function(message){ recordLog("info", message); });
    cascade.cascade_server.on("log_warning", function(message){ recordLog("warning", message); });
};

var lastUpdate;
module.exports.loop = function (cascade) {

    var now = new Date();

    if(lastUpdate && now - lastUpdate <= 60000)
    {
        data_recorder.flush();
        return;
    }

    // Pick up any components that haven't been changed in over a minute
    _.each(cascade.components.all_current, function (component) {
        if(component.seconds_since_last_updated() >= 60)
        {
            recordComponent(component);
        }
    });

    lastUpdate = now;
    data_recorder.flush();
};