var _ = require("underscore");
var map_range = require("map-range");
var control_interface = require("./../lib/tinkerforge");

var PUMP_DAC_POSITION = "C";
var PRE_HEATER_DAC_POSITION = "B";
var MAIN_HEATER_DAC_POSITION = "A";

var HEARTS_REFLUX_RELAY_POSITION = 2;
var TAILS_REFLUX_RELAY_POSITION = 3;
var WASH_INPUT_RELAY_POSITION = 0;

var dacs = {};
var relays = {};
var is_online;

function linear(x) {
    return x;
}

function set_dac(dac_info)
{
    if(dac_info.interface)
    {
        dac_info.interface.setConfiguration(dac_info.output_type);

        if(dac_info.enable.value === true)
        {
            dac_info.interface.enable();
        }
        else
        {
            dac_info.interface.disable();
        }

        var output_value = dac_info.value_map(dac_info.output.value);

        switch(dac_info.output_type)
        {
            case control_interface.VOLTAGE_RANGE_0_TO_5V:
            case control_interface.VOLTAGE_RANGE_0_TO_10V:
            {
                dac_info.interface.setVoltage(output_value);
                break;
            }
        }
    }
}

function create_dac(cascade, id, description, dac_position, output_type)
{
    var dac_info = {};

    dac_info.output_type = output_type;
    dac_info.position = dac_position;

    switch(output_type)
    {
        case control_interface.VOLTAGE_RANGE_0_TO_5V:
        {
            dac_info.value_map = map_range(linear, 0, 100, 0, 5000);
            break;
        }
        case control_interface.VOLTAGE_RANGE_0_TO_10V:
        {
            dac_info.value_map = map_range(linear, 0, 100, 0, 10000);
            break;
        }
    }

    dac_info.enable = cascade.create_component({
        id: id + "_enable",
        name: description + " Enable (Position " + dac_position + ")",
        group : "process_controls",
        class: "dac_enable",
        type: cascade.TYPES.BOOLEAN,
        value : false
    });

    dac_info.enable.on("value_updated", function(){
        set_dac(dac_info);
    });

    dac_info.output = cascade.create_component({
        id: id + "_output",
        name: description + " Output Percent (Position " + dac_position + ")",
        group : "process_controls",
        class: "dac_output",
        type: cascade.TYPES.NUMBER,
        units : cascade.UNITS.PERCENTAGE,
        value : 0
    });

    dac_info.output.on("value_updated", function(){
        set_dac(dac_info);
    });

    dacs[id] = dac_info;
}

function set_relays()
{
    var relay_interface = control_interface.devices["relays"];

    if(relay_interface) {

        var bitmask = 0;

        _.each(relays, function (relay, relay_position) {
            bitmask = bitmask | (relay.value << relay_position);
        });

        relay_interface.setValue(bitmask);
    }
}

function create_relay(cascade, id, description, position)
{
    var relay_component = cascade.create_component({
        id: id,
        name: description,
        group : "process_controls",
        class: "relay",
        type: cascade.TYPES.BOOLEAN,
        value : false
    });

    relay_component.on("value_updated", set_relays);

    relays[position] = relay_component;
}

module.exports.setup = function (cascade) {

    is_online = cascade.create_component({
        id: "process_control_online",
        name: "Is Online",
        group : "process_controls",
        class: "online_state",
        read_only: true,
        type: cascade.TYPES.BOOLEAN
    });

    create_dac(cascade, "pump", "Pump", PUMP_DAC_POSITION, control_interface.VOLTAGE_RANGE_0_TO_5V);
    create_dac(cascade, "pre_heater", "Preheater", PRE_HEATER_DAC_POSITION, control_interface.VOLTAGE_RANGE_0_TO_10V);
    create_dac(cascade, "main_heater", "Main Heater", MAIN_HEATER_DAC_POSITION, control_interface.VOLTAGE_RANGE_0_TO_10V);

    create_relay(cascade, "hearts_reflux_relay", "Hearts Reflux Relay", HEARTS_REFLUX_RELAY_POSITION);
    create_relay(cascade, "tails_reflux_relay", "Tails Reflux Relay", TAILS_REFLUX_RELAY_POSITION);
    create_relay(cascade, "wash_input_relay", "Wash Input Relay", WASH_INPUT_RELAY_POSITION);
};

module.exports.loop = function (cascade)
{
    var online = true;

    _.each(dacs, function(dac_info){

        var dac_interface = control_interface.devices["dac_" + dac_info.position];

        if(!dac_interface)
        {
            online = false;
            dac_info.interface = null;
        }
        else if(!dac_info.interface)
        {
            dac_info.interface = dac_interface;
            set_dac(dac_info);
        }
    });

    if(!control_interface.devices["relays"])
    {
        online = false;
    }

    is_online.value = online;
};