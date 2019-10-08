var _ = require("underscore");
var soft = require("./lib/soft_resources");

var TESTING = Boolean(process.env.TESTING) || false;
var BB_INTERFACE = process.env.BB_INTERFACE || "./interfaces/tf_redbrick_resources";

var RUN_GROUP = "00  Run";


// System Variable definitions are a subset of the component definition and can
// include name, description, group, ,read_only, persist, units.
// All variables are type number, name is required and is used for 'id' as well.
// 'units' is the last component of cascade unit , eg cascade.units.C is 'C'.
// Defaults are 'read_only: false', 'persist: false' 'group: "functions"',
// 'units: "NONE".
var system_Variables = [
    {   name: "log_message",
        description: "Log a console message",
        group: RUN_GROUP,
        type: "TEXT",
        value: " ",
    },
    {   name: "failsafe_temp",
        description: "Failsafe Temp.",
        group: RUN_GROUP,
        units: "C",
        persist: false,
        value: 120
    },
    // system set variable
    {   name: "boiling_point",
        description: "Water boiling point at current pressure",
        read_only:true,
        units: "C"
    },
// max_temp is created at the hardware level and scans all hardware temps.
//    {   name: "max_temp",
//        description: "Peak measured temperature",
//        units: "C",
//        value: 0,
//    },
];

var run_mode;
var failsafe_temp;
var boiling_point;
var max_temp;
var barometer;

var do_PID_options = true;
var currentOptionsList = [];

var simulated_time_component;

//////////////////////////////////////////////////////////////////////////////
// cascade process setup and supporting functions


module.exports.setup = function (cascade) {

    // hardware interface process
    cascade.require_process(BB_INTERFACE);

    // auxiliary application processes
    cascade.require_process("warm_restart");
    if (!TESTING) {
        cascade.require_process("interfaces/data_recorder");
    }

    // Get max_temp component for failsafe check.
    cascade.components.require_component("max_temp",
        function(component) {max_temp = component;});

    // Integrate simulator time when present.
    cascade.components.require_component("simulated_time",
        function(component) {simulated_time_component = component;});

    for (let vardef of system_Variables) {
        new soft.Variable(cascade, vardef);
    }

    cascade.components.require_component("log_message",
        function(component) {
            component.on("value_updated", function() {
                cascade.log_notice("OPERATOR MSG: " + component.value);
            });
        });

    // delay creation of soft resources until hard resources are created.
    setTimeout(function(){
        cascade.log_info("Stills soft resource creation started");
        for (let soft_resource_type of soft.resource_types) {
            if (soft_resource_type === "Barometer") continue;
            if (soft_resource_type === "OW_probe") continue;
            if (soft_resource_type === "TC_probe") continue;
            if (soft_resource_type === "PTC_probe") continue;
            soft.create_resource_name_list(cascade, soft_resource_type);
        }
    }, 20000);

    barometer = new soft.Barometer(cascade);

    cascade.components.require_component("failsafe_temp",
        function(component) {failsafe_temp = component;});
    cascade.components.require_component("boiling_point",
        function(component) {boiling_point = component;});

    run_mode = cascade.create_component({
        id: "run_mode",
        name: "Run Mode",
        group: RUN_GROUP,
        type: cascade.TYPES.OPTIONS,
        info: {
            options: ["STOP", "RUN"]
        },
        value: "STOP"
    });
    run_mode.on("value_updated", function() {
        cascade.log_info("Run mode set to " + run_mode.value);
    });
};


//////////////////////////////////////////////////////////////////////////////
// cascade process loop and supporting functions

function getCurrentH2OBoilingPoint()
{
    if (!barometer || !barometer.air_pressure) return 100.0;

    var baroInHG = barometer.air_pressure.value * 0.02953;
    if (!baroInHG) return 100.0;

    return ((Math.log(baroInHG) * 49.160999 + 44.93) -32) * 5/9;
}

function during_stop() {

    // Turn off all our PIDs
    _.each(soft.PID.get_instances(), function(pid) {pid.disable_pid();});

    // Turn off all of our control values
    _.each(soft.DAC.get_instances(), function(dac) {dac.reset_dac();});
    _.each(soft.Relay.get_instances(), function(relay) {relay.reset_relay();});
    _.each(soft.DutyCycleRelay.get_instances(), function(dcr) {dcr.reset_dcr();});
}

function during_run(cascade) {
    if(max_temp) {
        if (max_temp.value >= failsafe_temp.value)
        {
            run_mode.value = "STOP";
            return;
        }
    } else {
        cascade.log_warning(new Error(
            "stills.loop: no max_temp component at this time."));
    }

    // process Functions;
    _.each(soft.Function.get_instances(),
        function(func) {func.process_function(cascade);});

    // process PIDs
    var time;
    if (simulated_time_component) {
        time = simulated_time_component.value * 1000;
    } else {
        time = Date.now();
    }
    _.each(soft.PID.get_instances(), function(pid) {pid.process_pid(time);});
}

function set_OptionsList(cascade) {
    var _optionsComponentList = _.filter(
        _.map(cascade.components.all_current,
            function(component) {
                if (component.group.toUpperCase().startsWith("9")) return null;  // hard resource
                if (component.type != cascade.TYPES.NUMBER) return null;
                return component;
            }),
        function(component_or_null) {return Boolean(component_or_null);}
    );
    if (_optionsComponentList.length != currentOptionsList.length) {

        _optionsComponentList.sort(
            function(elem1, elem2) {
                if (elem1.group < elem2.group) return -1;
                if (elem1.group > elem2.group) return 1;
                if (elem1.display_order < elem2.display_order) return -1;
                if (elem1.display_order > elem2.display_order) return 1;
                if (elem1.id < elem2.id) return -1;
                return 1;
            });
        currentOptionsList = _.map(_optionsComponentList,
            function(component) {return component.id;});

        _.each(soft.PID.get_instances(), function(pid) {
            pid.set_pid_options(currentOptionsList);
        });
    }
}

module.exports.loop = function (cascade) {

    // Because PID options are a significant procedure and rarely change,
    // we do them every 30 seconds.
    if (do_PID_options) {
        set_OptionsList(cascade);
        do_PID_options = false;
        setTimeout(function() {
            do_PID_options = true;
        }, 30000);
    }

    boiling_point.value = getCurrentH2OBoilingPoint();

    switch (run_mode.value.toUpperCase()) {
        case "RUN": {
            during_run(cascade);
            break;
        }
        case "PAUSE": {
            break;
        }
        default: {
            during_stop(cascade);
            break;
        }
    }
};
