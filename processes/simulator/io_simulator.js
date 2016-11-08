var dacs = {};
var relays = {};

function create_dac(cascade, id, description)
{
    var dac_info = {};

    dac_info.enable = cascade.create_component({
        id: id + "_enable",
        name: description + " Enable",
        group : "process_controls",
        class: "dac_enable",
        type: cascade.TYPES.BOOLEAN,
        value : false
    });

    dac_info.output = cascade.create_component({
        id: id + "_output",
        name: description + " Output Percent",
        group : "process_controls",
        class: "dac_output",
        type: cascade.TYPES.NUMBER,
        units : cascade.UNITS.PERCENTAGE,
        value : 0
    });

    dacs[id] = dac_info;
}

function create_relay(cascade, id, description)
{
    var relay_component = cascade.create_component({
        id: id,
        name: description,
        group : "process_controls",
        class: "relay",
        type: cascade.TYPES.BOOLEAN,
        value : false
    });

    relays[id] = relay_component;
}

module.exports.setup = function (cascade) {
    create_dac(cascade, "pump", "Pump");
    create_dac(cascade, "pre_heater", "Preheater");
    create_dac(cascade, "main_heater", "Main Heater");

    create_relay(cascade, "hearts_reflux_relay", "Hearts Reflux Relay");
    create_relay(cascade, "tails_reflux_relay", "Tails Reflux Relay");
    create_relay(cascade, "feed_relay", "Feed Relay");
};

module.exports.loop = function (cascade) {
};