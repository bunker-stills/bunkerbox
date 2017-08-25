var reflux_controls = {};

function process_reflux_cycle(reflux_control)
{
    if(reflux_control.enable.value === false)
    {
        return;
    }

    var cycle_time_in_ms = reflux_control.cycle_length.value * 1000.0;

    // If anything less than 1 second, let's ignore it
    if(cycle_time_in_ms <= 1000)
    {
        return;
    }

    var ms_off = (reflux_control.reflux_percent.value / 100.0) * cycle_time_in_ms;
    var ms_on = cycle_time_in_ms - ms_off;

    if(ms_on > 0 && reflux_control.relay_component)
    {
        reflux_control.relay_component.value = true; // Start our reflux
    }

    reflux_control.timer = setTimeout(function(){

        if(ms_off > 0 && reflux_control.relay_component)
        {
            reflux_control.relay_component.value = false; // Stop our reflux
        }

        reflux_control.timer = setTimeout(function(){
            process_reflux_cycle(reflux_control); // Start all over again
        }, ms_off);

    }, ms_on);
}

function stop_timer(reflux_control)
{
    if(reflux_control.timer)
    {
        clearTimeout(reflux_control.timer);
        delete reflux_control.timer;
    }

    if(reflux_control.relay_component)
    {
        reflux_control.relay_component.value = false;
    }
}

function create_reflux_controller(cascade, relay_id, id, description)
{
    var reflux_control = {};

    cascade.components.require_component(relay_id, function(component){
        reflux_control.relay_component = component;
    });

    reflux_control.enable = cascade.create_component({
        id: id + "_enable",
        name: description + " Enable",
        group : "reflux control",
        class: "enable",
        type: cascade.TYPES.BOOLEAN,
        units: "seconds",
        value: false
    });
    reflux_control.enable.on("value_updated", function(){
        stop_timer(reflux_control);

        if(reflux_control.enable.value)
        {
            process_reflux_cycle(reflux_control);
        }
    });

    reflux_control.cycle_length = cascade.create_component({
        id: id + "_cycle_length",
        name: description + " Cycle Length",
        group : "reflux control",
        class: "cycle_length",
        type: cascade.TYPES.NUMBER,
        units: "seconds",
        value: 20,
        persist: true
    });
    reflux_control.cycle_length.on("value_updated", function(){
        stop_timer(reflux_control);
        if(reflux_control.enable.value)
        {
            process_reflux_cycle(reflux_control);
        }
    });

    reflux_control.reflux_percent = cascade.create_component({
        id: id + "_percent",
        name: description + " Percentage",
        group : "reflux control",
        class: "reflux_percent",
        type: cascade.TYPES.NUMBER,
        units: cascade.UNITS.PERCENTAGE,
        value: 0
    });

    process_reflux_cycle(reflux_control);

    reflux_controls[id] = reflux_control;
}

module.exports.setup = function (cascade) {
    create_reflux_controller(cascade, "hearts_reflux_relay", "hearts_draw", "Hearts Draw");
    create_reflux_controller(cascade, "tails_reflux_relay", "tails_draw", "Tails Draw");
    create_reflux_controller(cascade, "feed_relay", "feed_water_ratio", "Feed/Water Ratio");
};