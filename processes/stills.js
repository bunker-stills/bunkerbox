var _ = require("underscore");
var soft = require("./lib/soft_resources");

var BB_INTERFACE = process.env.BB_INTERFACE || "./interfaces/tf_redbrick_resources";

var RUN_GROUP = "00  Run";

var WARMUP_FEED_ABV = Number(process.env.WARMUP_FEED_ABV) || 1;
var WARMUP_FEED_RATE = Number(process.env.WARMUP_FEED_RATE) || 3;
var MIN_PUMP_RATE = Number(process.env.MIN_PUMP_RATE) || 1.5;


var std_TEMP_probe_names = [
    // column temps
    "heads_temp",
    "hearts_temp",
    "tails_temp",
    "sump_temp",
    //feed system temps
    "water_temp",
    "feed_temp",
    "pre_heater_temp",
    "post_heater_temp",
    "coils_output_temp",
    "water_feed_mix_temp",
    "stripper_input_temp",
];

var std_DAC_names = [
    // Analog (DAC) controls
    "main_heater",
    "pre_heater",
    "post_heater",
    "pump",
    "feed_pump",
];

// stepper motor controls (Future)
//"hearts_draw_pump",

var std_Relay_names = [
    // Solinoid valves (Relay)
    "heads_draw_relay",
];

var std_DutyCycle_Relay_names = [
    // Pseudo-analog controls (DutyCycleRelay)
    "feed_mix_dcr",
    "hearts_reflux_dcr",
    "tails_reflux_dcr",
];

var std_PID_names = [
    // PIDs
    "main_heater_pid",
    "pre_heater_pid",
    "post_heater_pid",
    "pump_pid",
    "feed_pump_pid",
    "feed_relay_pid",
    "hearts_draw_pid",
];

// Variable definitions are a subset of the component definition and can include
// name, description, group, ,read_only, persist, units.
// All variables are type number, name is required and is used for 'id' as well.
// 'units' is the last component of cascade unit , eg cascade.units.C is 'C'.
// Defaults are 'read_only: false', 'persist: true' 'group: "functions"',
// 'units: "NONE".
var std_Variables = [
    // user set variables
    {   name: "feed_abv",
        description: "Percent alcahol in source feed",
        units: "PERCENTAGE"
    },
    {   name: "desired_feed_abv",
        description: "Optimal ABV input to still"
    },
    {   name: "desired_feed_rate",
        description: "Feed flow rate into the still (GPH)",
    },
    // system set variable
    {   name: "boiling_point",
        description: "Water boiling point at current pressure",
        read_only:true,
        persist:false,
        units: "F"
    },
    {   name: "failsafe_temp",
        description: "Failsafe Temp.",
        group: RUN_GROUP,
        units: "C",
        value: 120
    }
];

var run_mode;
var failsafe_temp;
var barometer;
var boiling_point;
var sump_temp;
var feed_abv;
var mix_relay_control;
var pump_control;
var pump_pid;
var feed_pump_control;
var feed_pump_pid;
var desired_feed_rate;
var desired_feed_abv;
var programmedFeedRate;
var programmedFeedABV;

var currentOptionsList = [];


//////////////////////////////////////////////////////////////////////////////
// cascade process setup

module.exports.setup = function (cascade) {

    // hardware interface process
    cascade.require_process(BB_INTERFACE);

    // auxiliary application processes
    //cascade.require_process("warm_restart");
    //cascade.require_process("interfaces/data_recorder");

    for (let name of std_DAC_names) {
        new soft.DAC(cascade, name);
    }

    for (let name of std_Relay_names) {
        new soft.Relay(cascade, name);
    }

    for (let name of std_DutyCycle_Relay_names) {
        new soft.DutyCycle_Relay(cascade, name);
    }

    for (let vardef of std_Variables) {
        new soft.Variable(cascade, vardef);
    }

    for (let name of std_TEMP_probe_names) {
        new soft.TEMP_probe(cascade, name);
    }

    for (let name of std_PID_names) {
        new soft.PID(cascade, name);
    }

    new soft.Function(cascade, "function1");

    barometer = new soft.Barometer(cascade);

    failsafe_temp = soft.Variable.get_instance("failsafe_temp");
    boiling_point = soft.Variable.get_instance("boiling_point");
    sump_temp = soft.Variable.get_instance("sump_temp");
    feed_abv = soft.Variable.get_instance("feed_abv");
    desired_feed_rate = soft.Variable.get_instance("desired_feed_rate");
    desired_feed_abv = soft.Variable.get_instance("desired_feed_abv");
    mix_relay_control = soft.DutyCycle_Relay.get_instance("feed_mix_DCR");
    pump_control = soft.DAC.get_instance("pump");
    pump_pid = soft.PID.get_instance("pump_pid");
    feed_pump_control = soft.DAC.get_instance("feed_pump");
    feed_pump_pid = soft.PID.get_instance("feed_pump_pid");

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
};


//////////////////////////////////////////////////////////////////////////////
// cascade process loop and supporting functions

function getCurrentH2OBoilingPoint()
{
    if (!barometer || !barometer.air_pressure) return 212.0;

    var baroInHG = barometer.air_pressure.value * 0.02953;
    if (!baroInHG) return 212.0;

    return Math.log(baroInHG) * 49.160999 + 44.93;
}

function setFlowAndMixing(flow, abv)
{
    var inputABV = feed_abv.value || 0.0;
    var feed_rate;
    var pump_rate;

    if (mix_relay_control.HR_assignment) {  // relay controlled mix
        if (inputABV <= abv) {
            mix_relay_control.reset_dcr();  // shut down cycling
            mix_relay_control.RELAY_enable.value = true;  // turn on relay
        }
        else {
            mix_relay_control.DCR_cycle_enable.value = true;
            mix_relay_control.DCR_on_percent.value = abv / inputABV;
        }
        pump_pid.set_point.value = flow;
    }
    else if (feed_pump_control.HR_assignment && pump_control.HR_assignment) {
        if(inputABV <= abv) {
            // TODO: We probably want a minimum pump rate to insure
            //       water is flowing through the comumn coils.
            feed_rate = flow - MIN_PUMP_RATE;
            pump_rate = MIN_PUMP_RATE;
        }
        else {
            feed_rate = flow * abv / inputABV;
            pump_rate = Math.max(flow - feed_rate, MIN_PUMP_RATE);
            feed_rate = flow - pump_rate;
        }
        pump_pid.set_point.value = pump_rate;
        feed_pump_pid.set_point.value = feed_rate;
    }
}

function should_temp_failsafe()
{
    var fs_temp = failsafe_temp.value;

    _.each(soft.Temp.get_instances(), function(probe) {
        if(probe.get_temperature() >= fs_temp) return true;
    });
    return false;
}

function during_stop() {

    // Turn off all our PIDs
    _.each(soft.PID.get_instances(), function(pid) {pid.disable_pid();});

    // Turn off all of our control values
    _.each(soft.DAC.get_instances(), function(dac) {dac.reset_dac();});
    _.each(soft.Relay.get_instances(), function(relay) {relay.reset_relay();});
    _.each(soft.DutyCycle_Relay.get_instances(), function(dcr) {dcr.reset_dcr();});
}

function during_run(cascade) {
    if(should_temp_failsafe())
    {
        run_mode.value = "STOP";
        return;
    }

    let warming = sump_temp.value < boiling_point.value - 5;

    if (warming) {
        programmedFeedRate = WARMUP_FEED_RATE;
        programmedFeedABV = WARMUP_FEED_ABV;
    }
    else {
        programmedFeedRate = desired_feed_rate.value;
        programmedFeedABV = desired_feed_abv.value;
    }
    setFlowAndMixing(programmedFeedRate, programmedFeedABV);

    // process Functions;
    _.each(soft.Function.get_instances(), function(func) {func.process_function(cascade);});
    // process PIDs
    _.each(soft.PID.get_instances(), function(pid) {pid.process_pid();});
}


module.exports.loop = function (cascade) {

    boiling_point.value = getCurrentH2OBoilingPoint();

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

    switch (run_mode.value.toUpperCase()) {
        case "RUN": {
            during_run(cascade);
            break;
        }
        default: {
            during_stop(cascade);
            break;
        }
    }
};
