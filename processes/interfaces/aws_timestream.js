const _ = require("underscore");
const Timestream = require("@aws-sdk/client-timestream-write");

const writeClient = new Timestream.TimestreamWriteClient({});

let currentRecords = [];

function flushRecords() {

    if (currentRecords.length === 0) {
        return;
    }

    const recordsToSend = [...currentRecords];
    currentRecords = [];

    writeClient.send(new Timestream.WriteRecordsCommand({
        DatabaseName: "wid-still-development",
        TableName: "raw",
        Records: recordsToSend,
        CommonAttributes: {
            Dimensions: [
                {
                    Name: "device",
                    Value: device_name?.value ?? "development",
                    DimensionValueType: "VARCHAR"
                }
            ]
        }
    }))
        .catch(error => {
            console.error(error);
        });
}

function writeRecord(record) {
    currentRecords.push(record);
}

function recordComponent(component) {

    if (!component?.value) {
        return;
    }

    let type = "DOUBLE";

    if(_.isString(component.value))
    {
        type = "VARCHAR";
    }
    else if(_.isBoolean(component.value))
    {
        type = "BOOLEAN";
    }

    writeRecord(
        {
            Dimensions: [
                {
                    Name: "class",
                    Value: component.class,
                    DimensionValueType: "VARCHAR"
                }
            ],
            Time: Date.now().toString(),
            MeasureName: component.id,
            MeasureValue: component.value.toString(),
            MeasureValueType: type,
            Version: Date.now()
        }
    );
}

function recordLog(logType, message) {
    // TODO: implement later
    // if (!logType || !message) {
    //     return;
    // }
    //
    // writeRecord(
    //     {
    //         Dimensions: [
    //             {
    //                 Name: "log_type",
    //                 Value: logType,
    //                 DimensionValueType: "VARCHAR"
    //             }
    //         ],
    //         Time: Date.now().toString(),
    //         MeasureName: "logs",
    //         MeasureValue: message,
    //         MeasureValueType: "VARCHAR",
    //         Version: Date.now()
    //     }
    // );
}

var device_name;
var simulated_time_component;

// Data that changes is recorded right away. Data that doesn't change is recorded once a minute.
module.exports.setup = function (cascade) {

    device_name = cascade.create_component({
        id: "device_name",
        group: "data logging",
        display_order: 0,
        name: "Device Name",
        persist: true
    });

    // Integrate simulator time when present.
    cascade.components.require_component("simulated_time",
        function (component) {
            simulated_time_component = component;
        });

    cascade.cascade_server.on("log_error", function (message) {
        recordLog("error", message);
    });
    cascade.cascade_server.on("log_info", function (message) {
        recordLog("info", message);
    });
    cascade.cascade_server.on("log_warning", function (message) {
        recordLog("warning", message);
    });
};

module.exports.loop = function (cascade) {
    _.each(cascade.components.all_current, function (component) {
        recordComponent(component);
    });

    flushRecords();
};